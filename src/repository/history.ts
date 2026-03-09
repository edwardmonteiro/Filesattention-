/**
 * Immutable interaction history.
 * Every input, output, tool call, and intermediate step is recorded.
 * Never delete, never update. Append-only.
 */

import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

export interface HistoryEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  type: "user_input" | "model_output" | "tool_call" | "tool_result" | "system";
  content: string;
  metadata: {
    modelVersion: string;
    tokenCount: number;
    parentId?: string;
  };
}

export class HistoryStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        model_version TEXT,
        token_count INTEGER DEFAULT 0,
        parent_id TEXT
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_history_session ON history(session_id);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_history_type ON history(type);
    `);
  }

  append(entry: Omit<HistoryEntry, "id" | "timestamp">): HistoryEntry {
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO history (id, session_id, timestamp, type, content, model_version, token_count, parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      entry.sessionId,
      timestamp,
      entry.type,
      entry.content,
      entry.metadata.modelVersion,
      entry.metadata.tokenCount,
      entry.metadata.parentId ?? null
    );

    return { ...entry, id, timestamp };
  }

  getBySession(sessionId: string, limit?: number): HistoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM history WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?
    `);
    const rows = stmt.all(sessionId, limit ?? 1000) as Array<Record<string, unknown>>;
    return rows.map(this.rowToEntry);
  }

  getById(id: string): HistoryEntry | null {
    const stmt = this.db.prepare(`SELECT * FROM history WHERE id = ?`);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToEntry(row) : null;
  }

  getRecent(limit: number = 50): HistoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM history ORDER BY timestamp DESC LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<Record<string, unknown>>;
    return rows.map(this.rowToEntry);
  }

  getByType(
    type: HistoryEntry["type"],
    limit: number = 50
  ): HistoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM history WHERE type = ? ORDER BY timestamp DESC LIMIT ?
    `);
    const rows = stmt.all(type, limit) as Array<Record<string, unknown>>;
    return rows.map(this.rowToEntry);
  }

  searchContent(query: string, limit: number = 20): HistoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM history WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?
    `);
    const rows = stmt.all(`%${query}%`, limit) as Array<Record<string, unknown>>;
    return rows.map(this.rowToEntry);
  }

  getSessionIds(): string[] {
    const stmt = this.db.prepare(
      `SELECT DISTINCT session_id FROM history ORDER BY MAX(timestamp) DESC`
    );
    // Use a simpler query to avoid GROUP BY issues
    const stmt2 = this.db.prepare(
      `SELECT DISTINCT session_id FROM history`
    );
    const rows = stmt2.all() as Array<{ session_id: string }>;
    return rows.map((r) => r.session_id);
  }

  count(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as cnt FROM history`);
    const row = stmt.get() as { cnt: number };
    return row.cnt;
  }

  private rowToEntry(row: Record<string, unknown>): HistoryEntry {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      timestamp: row.timestamp as string,
      type: row.type as HistoryEntry["type"],
      content: row.content as string,
      metadata: {
        modelVersion: (row.model_version as string) ?? "",
        tokenCount: (row.token_count as number) ?? 0,
        parentId: (row.parent_id as string) ?? undefined,
      },
    };
  }
}
