/**
 * Backend resolvers for AFS.
 * Each resolver handles a specific type of storage backend.
 */

import type { AFSMetadata } from "./metadata.js";

export interface AFSNode {
  path: string;
  type: "file" | "directory" | "executable";
  metadata: AFSMetadata;
  resolver: string;
}

export interface ReadResult {
  content: string;
  metadata: AFSMetadata;
}

export interface Resolver {
  name: string;

  list(relativePath: string, depth?: number): Promise<AFSNode[]>;
  read(relativePath: string): Promise<ReadResult>;
  write(
    relativePath: string,
    content: string,
    metadata?: Partial<AFSMetadata>
  ): Promise<void>;
  search(query: string, scope?: string): Promise<AFSNode[]>;
  exec?(
    relativePath: string,
    args?: Record<string, unknown>
  ): Promise<unknown>;
  exists(relativePath: string): Promise<boolean>;
}

/**
 * SQLite-backed resolver for structured data (history, memory, scratchpad).
 */
export class SQLiteResolver implements Resolver {
  name: string;
  private db: import("better-sqlite3").Database;
  private tableName: string;

  constructor(
    name: string,
    db: import("better-sqlite3").Database,
    tableName: string
  ) {
    this.name = name;
    this.db = db;
    this.tableName = tableName;
  }

  async list(relativePath: string, depth?: number): Promise<AFSNode[]> {
    const stmt = this.db.prepare(
      `SELECT id, key, metadata FROM ${this.tableName} WHERE key LIKE ? LIMIT ?`
    );
    const pattern = relativePath === "/" ? "%" : relativePath.slice(1) + "%";
    const rows = stmt.all(pattern, depth ?? 100) as Array<{
      id: string;
      key: string;
      metadata: string;
    }>;

    return rows.map((row) => ({
      path: `/${row.key}`,
      type: "file" as const,
      metadata: JSON.parse(row.metadata),
      resolver: this.name,
    }));
  }

  async read(relativePath: string): Promise<ReadResult> {
    const key = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;
    const stmt = this.db.prepare(
      `SELECT value, metadata FROM ${this.tableName} WHERE key = ?`
    );
    const row = stmt.get(key) as
      | { value: string; metadata: string }
      | undefined;

    if (!row) {
      throw new Error(`Not found: ${relativePath} in ${this.tableName}`);
    }

    return {
      content: row.value,
      metadata: JSON.parse(row.metadata),
    };
  }

  async write(
    relativePath: string,
    content: string,
    metadata?: Partial<AFSMetadata>
  ): Promise<void> {
    const key = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;
    const now = new Date().toISOString();
    const meta = JSON.stringify({
      createdAt: now,
      updatedAt: now,
      author: "system",
      provenance: "sqlite",
      confidence: 1.0,
      accessScope: ["*"],
      tokenEstimate: Math.ceil(content.length / 4),
      version: 1,
      tags: [],
      ...metadata,
    });

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.tableName} (id, key, value, metadata)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(key, key, content, meta);
  }

  async search(query: string): Promise<AFSNode[]> {
    const stmt = this.db.prepare(
      `SELECT id, key, metadata FROM ${this.tableName} WHERE value LIKE ? LIMIT 20`
    );
    const rows = stmt.all(`%${query}%`) as Array<{
      id: string;
      key: string;
      metadata: string;
    }>;

    return rows.map((row) => ({
      path: `/${row.key}`,
      type: "file" as const,
      metadata: JSON.parse(row.metadata),
      resolver: this.name,
    }));
  }

  async exists(relativePath: string): Promise<boolean> {
    const key = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;
    const stmt = this.db.prepare(
      `SELECT 1 FROM ${this.tableName} WHERE key = ?`
    );
    return stmt.get(key) !== undefined;
  }
}
