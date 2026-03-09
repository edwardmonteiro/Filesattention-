/**
 * Procedural Memory — tool definitions, function schemas, and how-to knowledge.
 * Stores the "know-how" for executing specific operations.
 */

import type { MemoryStore } from "../repository/memory.js";

export interface Procedure {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  steps?: string[];
  examples?: string[];
}

export class ProceduralMemory {
  private store: MemoryStore;
  private agentId: string;

  constructor(store: MemoryStore, agentId: string = "default") {
    this.store = store;
    this.agentId = agentId;
  }

  registerProcedure(procedure: Procedure): string {
    const value = JSON.stringify(procedure);
    const entry = this.store.createFromText(
      "procedural",
      `proc:${procedure.name}`,
      value,
      { createdBy: "agent" }
    );
    return entry.id;
  }

  getProcedure(name: string): Procedure | null {
    const entries = this.store.getByKey(`proc:${name}`);
    if (entries.length === 0) return null;
    try {
      return JSON.parse(entries[0].value) as Procedure;
    } catch {
      return null;
    }
  }

  listProcedures(): Procedure[] {
    const entries = this.store.getByType("procedural");
    return entries
      .map((e) => {
        try {
          return JSON.parse(e.value) as Procedure;
        } catch {
          return null;
        }
      })
      .filter((p): p is Procedure => p !== null);
  }

  searchProcedures(query: string): Procedure[] {
    const entries = this.store.search(query, "procedural");
    return entries
      .map((e) => {
        try {
          return JSON.parse(e.value) as Procedure;
        } catch {
          return null;
        }
      })
      .filter((p): p is Procedure => p !== null);
  }

  removeProcedure(name: string): void {
    const entries = this.store.getByKey(`proc:${name}`);
    for (const e of entries) {
      this.store.delete(e.id);
    }
  }
}
