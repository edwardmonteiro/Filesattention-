/**
 * Fact Memory — atomic factual statements.
 * Stored as key-value pairs or subject-predicate-object triples.
 */

import type { MemoryStore } from "../repository/memory.js";

export interface Fact {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

export class FactMemory {
  private store: MemoryStore;
  private agentId: string;

  constructor(store: MemoryStore, agentId: string = "default") {
    this.store = store;
    this.agentId = agentId;
  }

  addFact(fact: Fact, sourceSessionId?: string): string {
    const key = `${fact.subject}:${fact.predicate}`;
    const value = JSON.stringify(fact);

    const entry = this.store.createFromText("fact", key, value, {
      sessionId: sourceSessionId,
      createdBy: "agent",
    });
    return entry.id;
  }

  getFacts(subject?: string): Fact[] {
    const entries = subject
      ? this.store.search(subject, "fact")
      : this.store.getByType("fact");

    return entries.map((e) => {
      try {
        return JSON.parse(e.value) as Fact;
      } catch {
        return {
          subject: e.key,
          predicate: "states",
          object: e.value,
          confidence: e.metadata.confidence,
        };
      }
    });
  }

  searchFacts(query: string): Fact[] {
    const entries = this.store.search(query, "fact");
    return entries.map((e) => {
      try {
        return JSON.parse(e.value) as Fact;
      } catch {
        return {
          subject: e.key,
          predicate: "states",
          object: e.value,
          confidence: e.metadata.confidence,
        };
      }
    });
  }

  removeFact(id: string): void {
    this.store.delete(id);
  }
}
