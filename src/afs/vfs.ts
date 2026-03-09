/**
 * Virtual File System — the unifying abstraction for AFS.
 * Every context source appears as a node in a single hierarchical namespace.
 */

import type { AFSMetadata } from "./metadata.js";
import type { AFSNode, ReadResult, Resolver } from "./resolver.js";
import { NamespaceManager } from "./namespace.js";
import { AccessControl, type AccessRequest } from "./access-control.js";
import type { TransactionLog } from "./transaction-log.js";

export interface AFSOperations {
  list(path: string, depth?: number): Promise<AFSNode[]>;
  read(path: string): Promise<ReadResult>;
  write(
    path: string,
    content: string,
    metadata?: Partial<AFSMetadata>
  ): Promise<void>;
  search(query: string, scope?: string): Promise<AFSNode[]>;
  exec(path: string, args?: Record<string, unknown>): Promise<unknown>;
  mount(mountPoint: string, resolver: Resolver): void;
  unmount(mountPoint: string): void;
}

export class VirtualFileSystem implements AFSOperations {
  private namespace: NamespaceManager;
  private resolvers: Map<string, Resolver> = new Map();
  private acl: AccessControl;
  private txLog: TransactionLog;
  private actor: string;

  constructor(
    acl: AccessControl,
    txLog: TransactionLog,
    actor: string = "system"
  ) {
    this.namespace = new NamespaceManager();
    this.acl = acl;
    this.txLog = txLog;
    this.actor = actor;
  }

  mount(mountPoint: string, resolver: Resolver): void {
    this.namespace.mount(mountPoint, resolver.name);
    this.resolvers.set(resolver.name, resolver);
    this.txLog.log("mount", mountPoint, this.actor, "success", resolver.name);
  }

  unmount(mountPoint: string): void {
    const entry = this.namespace.resolve(mountPoint);
    if (entry) {
      this.resolvers.delete(entry.resolverName);
    }
    this.namespace.unmount(mountPoint);
    this.txLog.log("unmount", mountPoint, this.actor, "success");
  }

  async list(path: string, depth?: number): Promise<AFSNode[]> {
    this.checkAccess("list", path);
    const { resolver, relativePath } = this.resolveOrThrow(path);

    try {
      const nodes = await resolver.list(relativePath, depth);
      this.txLog.log("list", path, this.actor, "success");
      return nodes;
    } catch (err) {
      this.txLog.log("list", path, this.actor, "failure", String(err));
      throw err;
    }
  }

  async read(path: string): Promise<ReadResult> {
    this.checkAccess("read", path);
    const { resolver, relativePath } = this.resolveOrThrow(path);

    try {
      const result = await resolver.read(relativePath);
      this.txLog.log("read", path, this.actor, "success");
      return result;
    } catch (err) {
      this.txLog.log("read", path, this.actor, "failure", String(err));
      throw err;
    }
  }

  async write(
    path: string,
    content: string,
    metadata?: Partial<AFSMetadata>
  ): Promise<void> {
    this.checkAccess("write", path);
    const { resolver, relativePath } = this.resolveOrThrow(path);

    try {
      await resolver.write(relativePath, content, metadata);
      this.txLog.log("write", path, this.actor, "success");
    } catch (err) {
      this.txLog.log("write", path, this.actor, "failure", String(err));
      throw err;
    }
  }

  async search(query: string, scope?: string): Promise<AFSNode[]> {
    const searchScope = scope ?? "/";
    this.checkAccess("search", searchScope);

    const results: AFSNode[] = [];
    const entry = this.namespace.resolve(searchScope);

    if (entry) {
      const resolver = this.resolvers.get(entry.resolverName);
      if (resolver) {
        const nodes = await resolver.search(query, searchScope);
        results.push(...nodes);
      }
    } else {
      // Search all mounted resolvers
      for (const resolver of this.resolvers.values()) {
        try {
          const nodes = await resolver.search(query);
          results.push(...nodes);
        } catch {
          // Skip resolvers that fail
        }
      }
    }

    this.txLog.log("search", searchScope, this.actor, "success", query);
    return results;
  }

  async exec(
    path: string,
    args?: Record<string, unknown>
  ): Promise<unknown> {
    this.checkAccess("exec", path);
    const { resolver, relativePath } = this.resolveOrThrow(path);

    if (!resolver.exec) {
      throw new Error(`Resolver ${resolver.name} does not support exec`);
    }

    try {
      const result = await resolver.exec(relativePath, args);
      this.txLog.log("exec", path, this.actor, "success");
      return result;
    } catch (err) {
      this.txLog.log("exec", path, this.actor, "failure", String(err));
      throw err;
    }
  }

  listMounts(): Array<{ mountPoint: string; resolverName: string }> {
    return this.namespace.listMounts();
  }

  private resolveOrThrow(path: string): {
    resolver: Resolver;
    relativePath: string;
  } {
    const entry = this.namespace.resolve(path);
    if (!entry) {
      throw new Error(`No resolver found for path: ${path}`);
    }

    const resolver = this.resolvers.get(entry.resolverName);
    if (!resolver) {
      throw new Error(`Resolver not found: ${entry.resolverName}`);
    }

    const relativePath = this.namespace.relativePath(path, entry.mountPoint);
    return { resolver, relativePath };
  }

  private checkAccess(
    operation: AccessRequest["operation"],
    path: string
  ): void {
    const allowed = this.acl.check({
      actor: this.actor,
      operation,
      path,
    });

    if (!allowed) {
      this.txLog.log(operation, path, this.actor, "denied");
      throw new Error(
        `Access denied: ${this.actor} cannot ${operation} ${path}`
      );
    }
  }
}
