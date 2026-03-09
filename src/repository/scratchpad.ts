/**
 * Temporary task workspace.
 * Scoped to a task, with automatic lifecycle management.
 * After task completion, entries are promoted to Memory or archived to History.
 */

import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type { AFSMetadata } from "../afs/metadata.js";
import { createMetadata, estimateTokens } from "../afs/metadata.js";

export type ScratchpadType =
  | "hypothesis"
  | "computation"
  | "draft"
  | "intermediate";

export interface ScratchpadEntry {
  id: string;
  taskId: string;
  content: string;
  type: ScratchpadType;
  metadata: AFSMetadata;
}

export class ScratchpadStore {
  private db: Database.Database;
  private ttlMs: number;

  constructor(db: Database.Database, ttlMs: number = 24 * 60 * 60 * 1000) {
    this.db = db;
    this.ttlMs = ttlMs;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scratchpad (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        metadata TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_scratch_task ON scratchpad(task_id);
    `);
  }

  add(
    taskId: string,
    content: string,
    type: ScratchpadType
  ): ScratchpadEntry {
    const id = uuidv4();
    const metadata = createMetadata({
      author: "agent",
      provenance: `task:${taskId}`,
      tokenEstimate: estimateTokens(content),
      tags: [type],
    });

    const stmt = this.db.prepare(`
      INSERT INTO scratchpad (id, task_id, content, type, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, taskId, content, type, JSON.stringify(metadata));

    return { id, taskId, content, type, metadata };
  }

  getByTask(taskId: string): ScratchpadEntry[] {
    const stmt = this.db.prepare(
      `SELECT * FROM scratchpad WHERE task_id = ?`
    );
    const rows = stmt.all(taskId) as Array<Record<string, unknown>>;
    return rows.map(this.rowToEntry);
  }

  getById(id: string): ScratchpadEntry | null {
    const stmt = this.db.prepare(`SELECT * FROM scratchpad WHERE id = ?`);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToEntry(row) : null;
  }

  update(id: string, content: string): void {
    const stmt = this.db.prepare(
      `UPDATE scratchpad SET content = ? WHERE id = ?`
    );
    stmt.run(content, id);
  }

  delete(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM scratchpad WHERE id = ?`);
    stmt.run(id);
  }

  deleteByTask(taskId: string): void {
    const stmt = this.db.prepare(
      `DELETE FROM scratchpad WHERE task_id = ?`
    );
    stmt.run(taskId);
  }

  /**
   * Prune stale entries beyond TTL.
   */
  pruneStale(): number {
    const cutoff = new Date(Date.now() - this.ttlMs).toISOString();
    // Parse metadata to check createdAt
    const all = this.db
      .prepare(`SELECT id, metadata FROM scratchpad`)
      .all() as Array<{ id: string; metadata: string }>;

    let pruned = 0;
    for (const row of all) {
      const meta = JSON.parse(row.metadata) as AFSMetadata;
      if (meta.createdAt < cutoff) {
        this.delete(row.id);
        pruned++;
      }
    }
    return pruned;
  }

  count(taskId?: string): number {
    if (taskId) {
      const stmt = this.db.prepare(
        `SELECT COUNT(*) as cnt FROM scratchpad WHERE task_id = ?`
      );
      const row = stmt.get(taskId) as { cnt: number };
      return row.cnt;
    }
    const stmt = this.db.prepare(`SELECT COUNT(*) as cnt FROM scratchpad`);
    const row = stmt.get() as { cnt: number };
    return row.cnt;
  }

  private rowToEntry(row: Record<string, unknown>): ScratchpadEntry {
    return {
      id: row.id as string,
      taskId: row.task_id as string,
      content: row.content as string,
      type: row.type as ScratchpadType,
      metadata: JSON.parse(row.metadata as string),
    };
  }
}
