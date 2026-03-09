/**
 * Immutable operation log for AFS.
 * Every operation (read, write, exec, mount, unmount) is recorded.
 */

import type Database from "better-sqlite3";

export interface TransactionEntry {
  id: number;
  timestamp: string;
  operation: string;
  path: string;
  actor: string;
  status: "success" | "failure" | "denied";
  detail?: string;
}

export class TransactionLog {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transaction_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        operation TEXT NOT NULL,
        path TEXT NOT NULL,
        actor TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_txlog_path ON transaction_log(path);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_txlog_timestamp ON transaction_log(timestamp);
    `);
  }

  log(
    operation: string,
    path: string,
    actor: string,
    status: "success" | "failure" | "denied",
    detail?: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO transaction_log (timestamp, operation, path, actor, status, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(new Date().toISOString(), operation, path, actor, status, detail ?? null);
  }

  query(options: {
    path?: string;
    operation?: string;
    actor?: string;
    since?: string;
    limit?: number;
  }): TransactionEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.path) {
      conditions.push("path LIKE ?");
      params.push(options.path + "%");
    }
    if (options.operation) {
      conditions.push("operation = ?");
      params.push(options.operation);
    }
    if (options.actor) {
      conditions.push("actor = ?");
      params.push(options.actor);
    }
    if (options.since) {
      conditions.push("timestamp >= ?");
      params.push(options.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ? `LIMIT ${options.limit}` : "LIMIT 100";

    const stmt = this.db.prepare(
      `SELECT * FROM transaction_log ${where} ORDER BY timestamp DESC ${limit}`
    );
    return stmt.all(...params) as TransactionEntry[];
  }

  getRecent(count: number = 20): TransactionEntry[] {
    const stmt = this.db.prepare(
      `SELECT * FROM transaction_log ORDER BY id DESC LIMIT ?`
    );
    return stmt.all(count) as TransactionEntry[];
  }
}
