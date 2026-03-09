/**
 * Episodic Memory — session summaries and case histories.
 * Records what happened during a session for future reference.
 */

import type { MemoryStore } from "../repository/memory.js";

export interface Episode {
  sessionId: string;
  summary: string;
  keyTopics: string[];
  outcome: string;
  timestamp: string;
}

export class EpisodicMemory {
  private store: MemoryStore;
  private agentId: string;

  constructor(store: MemoryStore, agentId: string = "default") {
    this.store = store;
    this.agentId = agentId;
  }

  recordEpisode(episode: Episode): string {
    const value = JSON.stringify(episode);
    const entry = this.store.createFromText(
      "episodic",
      `episode:${episode.sessionId}`,
      value,
      { sessionId: episode.sessionId, createdBy: "summarizer" }
    );
    return entry.id;
  }

  getEpisodes(limit: number = 20): Episode[] {
    const entries = this.store.getByType("episodic", limit);
    return entries.map((e) => {
      try {
        return JSON.parse(e.value) as Episode;
      } catch {
        return {
          sessionId: e.source.sessionId ?? "unknown",
          summary: e.value,
          keyTopics: [],
          outcome: "",
          timestamp: e.metadata.createdAt,
        };
      }
    });
  }

  searchEpisodes(query: string): Episode[] {
    const entries = this.store.search(query, "episodic");
    return entries.map((e) => {
      try {
        return JSON.parse(e.value) as Episode;
      } catch {
        return {
          sessionId: e.source.sessionId ?? "unknown",
          summary: e.value,
          keyTopics: [],
          outcome: "",
          timestamp: e.metadata.createdAt,
        };
      }
    });
  }

  getBySession(sessionId: string): Episode | null {
    const entries = this.store.getByKey(`episode:${sessionId}`);
    if (entries.length === 0) return null;
    try {
      return JSON.parse(entries[0].value) as Episode;
    } catch {
      return null;
    }
  }
}
