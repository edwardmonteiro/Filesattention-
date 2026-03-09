/**
 * Experiential Memory — observation-action trajectories.
 * Records what was tried, what worked, and what didn't.
 */

import type { MemoryStore } from "../repository/memory.js";

export interface Experience {
  observation: string;
  action: string;
  result: string;
  success: boolean;
  context: string;
  timestamp: string;
}

export class ExperientialMemory {
  private store: MemoryStore;
  private agentId: string;

  constructor(store: MemoryStore, agentId: string = "default") {
    this.store = store;
    this.agentId = agentId;
  }

  recordExperience(experience: Experience, sessionId?: string): string {
    const value = JSON.stringify(experience);
    const entry = this.store.createFromText(
      "experiential",
      `exp:${Date.now()}`,
      value,
      { sessionId, createdBy: "agent" }
    );
    return entry.id;
  }

  getExperiences(limit: number = 20): Experience[] {
    const entries = this.store.getByType("experiential", limit);
    return entries
      .map((e) => {
        try {
          return JSON.parse(e.value) as Experience;
        } catch {
          return null;
        }
      })
      .filter((x): x is Experience => x !== null);
  }

  getSuccessful(limit: number = 20): Experience[] {
    return this.getExperiences(limit * 2).filter((e) => e.success).slice(0, limit);
  }

  getFailed(limit: number = 20): Experience[] {
    return this.getExperiences(limit * 2).filter((e) => !e.success).slice(0, limit);
  }

  searchExperiences(query: string): Experience[] {
    const entries = this.store.search(query, "experiential");
    return entries
      .map((e) => {
        try {
          return JSON.parse(e.value) as Experience;
        } catch {
          return null;
        }
      })
      .filter((x): x is Experience => x !== null);
  }
}
