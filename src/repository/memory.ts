/**
 * Structured memory store.
 * Multiple memory types coexist: fact, episodic, procedural, experiential, user.
 * Supports both keyword and semantic (vector) search.
 */

import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type { AFSMetadata } from "../afs/metadata.js";
import { createMetadata, estimateTokens } from "../afs/metadata.js";

export type MemoryType =
  | "fact"
  | "episodic"
  | "procedural"
  | "experiential"
  | "user";

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  key: string;
  value: string;
  embedding?: number[];
  source: {
    historyId?: string;
    sessionId?: string;
    createdBy: "agent" | "human" | "summarizer";
  };
  metadata: AFSMetadata;
}

export class MemoryStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        embedding BLOB,
        history_id TEXT,
        session_id TEXT,
        created_by TEXT NOT NULL DEFAULT 'system',
        metadata TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(type);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(key);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_type_key ON memory(type, key);
    `);
  }

  store(entry: Omit<MemoryEntry, "id">): MemoryEntry {
    const id = uuidv4();
    const meta =
      typeof entry.metadata === "string"
        ? entry.metadata
        : JSON.stringify(entry.metadata);

    const embeddingBlob = entry.embedding
      ? Buffer.from(new Float32Array(entry.embedding).buffer)
      : null;

    const stmt = this.db.prepare(`
      INSERT INTO memory (id, type, key, value, embedding, history_id, session_id, created_by, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      entry.type,
      entry.key,
      entry.value,
      embeddingBlob,
      entry.source.historyId ?? null,
      entry.source.sessionId ?? null,
      entry.source.createdBy,
      meta
    );

    return { ...entry, id };
  }

  getById(id: string): MemoryEntry | null {
    const stmt = this.db.prepare(`SELECT * FROM memory WHERE id = ?`);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToEntry(row) : null;
  }

  getByType(type: MemoryType, limit: number = 50): MemoryEntry[] {
    const stmt = this.db.prepare(
      `SELECT * FROM memory WHERE type = ? LIMIT ?`
    );
    const rows = stmt.all(type, limit) as Array<Record<string, unknown>>;
    return rows.map(this.rowToEntry);
  }

  getByKey(key: string): MemoryEntry[] {
    const stmt = this.db.prepare(`SELECT * FROM memory WHERE key = ?`);
    const rows = stmt.all(key) as Array<Record<string, unknown>>;
    return rows.map(this.rowToEntry);
  }

  search(query: string, type?: MemoryType, limit: number = 20): MemoryEntry[] {
    let sql = `SELECT * FROM memory WHERE (key LIKE ? OR value LIKE ?)`;
    const params: unknown[] = [`%${query}%`, `%${query}%`];

    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }

    sql += ` LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<Record<string, unknown>>;
    return rows.map(this.rowToEntry);
  }

  update(id: string, updates: Partial<Pick<MemoryEntry, "value" | "key" | "metadata">>): void {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Memory entry not found: ${id}`);

    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.value !== undefined) {
      sets.push("value = ?");
      params.push(updates.value);
    }
    if (updates.key !== undefined) {
      sets.push("key = ?");
      params.push(updates.key);
    }
    if (updates.metadata !== undefined) {
      sets.push("metadata = ?");
      params.push(JSON.stringify(updates.metadata));
    }

    if (sets.length === 0) return;

    params.push(id);
    const stmt = this.db.prepare(
      `UPDATE memory SET ${sets.join(", ")} WHERE id = ?`
    );
    stmt.run(...params);
  }

  delete(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM memory WHERE id = ?`);
    stmt.run(id);
  }

  count(type?: MemoryType): number {
    if (type) {
      const stmt = this.db.prepare(
        `SELECT COUNT(*) as cnt FROM memory WHERE type = ?`
      );
      const row = stmt.get(type) as { cnt: number };
      return row.cnt;
    }
    const stmt = this.db.prepare(`SELECT COUNT(*) as cnt FROM memory`);
    const row = stmt.get() as { cnt: number };
    return row.cnt;
  }

  /**
   * Create a memory entry from raw text with automatic metadata.
   */
  createFromText(
    type: MemoryType,
    key: string,
    value: string,
    source: MemoryEntry["source"]
  ): MemoryEntry {
    const metadata = createMetadata({
      author: source.createdBy === "human" ? "human" : "agent",
      provenance: source.sessionId
        ? `session:${source.sessionId}`
        : "direct",
      tokenEstimate: estimateTokens(value),
    });

    return this.store({ type, key, value, source, metadata });
  }

  private rowToEntry(row: Record<string, unknown>): MemoryEntry {
    let embedding: number[] | undefined;
    if (row.embedding) {
      const buf = row.embedding as Buffer;
      embedding = Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
    }

    return {
      id: row.id as string,
      type: row.type as MemoryType,
      key: row.key as string,
      value: row.value as string,
      embedding,
      source: {
        historyId: (row.history_id as string) ?? undefined,
        sessionId: (row.session_id as string) ?? undefined,
        createdBy: (row.created_by as MemoryEntry["source"]["createdBy"]) ?? "agent",
      },
      metadata: JSON.parse(row.metadata as string),
    };
  }
}
