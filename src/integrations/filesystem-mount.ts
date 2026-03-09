/**
 * Mount local directories as AFS knowledge sources.
 * Files become searchable and readable through the VFS.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AFSNode, ReadResult, Resolver } from "../afs/resolver.js";
import { createMetadata, estimateTokens } from "../afs/metadata.js";

export class FilesystemResolver implements Resolver {
  name: string;
  private rootPath: string;

  constructor(name: string, rootPath: string) {
    this.name = name;
    this.rootPath = path.resolve(rootPath);
  }

  async list(relativePath: string, depth?: number): Promise<AFSNode[]> {
    const fullPath = this.resolvePath(relativePath);
    if (!fs.existsSync(fullPath)) return [];

    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) {
      return [this.fileToNode(relativePath, stat)];
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const nodes: AFSNode[] = [];

    for (const entry of entries) {
      const entryPath = path.join(relativePath, entry.name);
      const entryStat = fs.statSync(path.join(fullPath, entry.name));

      nodes.push(
        this.fileToNode(
          entryPath,
          entryStat,
          entry.isDirectory() ? "directory" : "file"
        )
      );

      if (entry.isDirectory() && (depth === undefined || depth > 1)) {
        const children = await this.list(
          entryPath,
          depth ? depth - 1 : undefined
        );
        nodes.push(...children);
      }
    }

    return nodes;
  }

  async read(relativePath: string): Promise<ReadResult> {
    const fullPath = this.resolvePath(relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }

    const content = fs.readFileSync(fullPath, "utf-8");
    const stat = fs.statSync(fullPath);

    return {
      content,
      metadata: createMetadata({
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
        author: "human",
        provenance: `file:${fullPath}`,
        tokenEstimate: estimateTokens(content),
        tags: [path.extname(fullPath).slice(1)],
      }),
    };
  }

  async write(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  async search(query: string): Promise<AFSNode[]> {
    const results: AFSNode[] = [];
    this.searchRecursive(this.rootPath, "", query.toLowerCase(), results, 50);
    return results;
  }

  async exists(relativePath: string): Promise<boolean> {
    return fs.existsSync(this.resolvePath(relativePath));
  }

  private resolvePath(relativePath: string): string {
    const clean = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;
    return path.join(this.rootPath, clean);
  }

  private fileToNode(
    relativePath: string,
    stat: fs.Stats,
    type?: "file" | "directory"
  ): AFSNode {
    return {
      path: relativePath.startsWith("/") ? relativePath : `/${relativePath}`,
      type: type ?? (stat.isDirectory() ? "directory" : "file"),
      metadata: createMetadata({
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
        author: "human",
        provenance: `filesystem:${this.name}`,
        tokenEstimate: stat.isFile() ? Math.ceil(stat.size / 4) : 0,
      }),
      resolver: this.name,
    };
  }

  private searchRecursive(
    dirPath: string,
    relativePath: string,
    query: string,
    results: AFSNode[],
    limit: number
  ): void {
    if (results.length >= limit) return;
    if (!fs.existsSync(dirPath)) return;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= limit) break;

      const fullEntryPath = path.join(dirPath, entry.name);
      const entryRelative = path.join(relativePath, entry.name);

      // Match filename
      if (entry.name.toLowerCase().includes(query)) {
        const stat = fs.statSync(fullEntryPath);
        results.push(
          this.fileToNode(
            entryRelative,
            stat,
            entry.isDirectory() ? "directory" : "file"
          )
        );
      }

      // Search file content for text files
      if (entry.isFile() && this.isTextFile(entry.name)) {
        try {
          const content = fs.readFileSync(fullEntryPath, "utf-8");
          if (content.toLowerCase().includes(query)) {
            const stat = fs.statSync(fullEntryPath);
            if (!results.find((r) => r.path === `/${entryRelative}`)) {
              results.push(this.fileToNode(entryRelative, stat, "file"));
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        this.searchRecursive(fullEntryPath, entryRelative, query, results, limit);
      }
    }
  }

  private isTextFile(filename: string): boolean {
    const textExts = [
      ".ts", ".js", ".json", ".md", ".txt", ".yaml", ".yml",
      ".toml", ".py", ".rs", ".go", ".html", ".css", ".sql",
      ".sh", ".bash", ".env.example", ".gitignore",
    ];
    return textExts.some((ext) => filename.endsWith(ext));
  }
}
