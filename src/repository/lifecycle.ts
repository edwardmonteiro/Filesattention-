/**
 * Lifecycle manager for context transitions between repository layers.
 *
 * History → Memory (summarization, embedding, indexing)
 * Scratchpad → Memory (validation)
 * Scratchpad → History (archival)
 * Memory → Memory (consolidation)
 */

import type { HistoryStore, HistoryEntry } from "./history.js";
import type { MemoryStore, MemoryType } from "./memory.js";
import type { ScratchpadStore, ScratchpadEntry } from "./scratchpad.js";
import { createMetadata, estimateTokens } from "../afs/metadata.js";

export interface LifecycleConfig {
  /** Cosine similarity threshold for deduplication */
  deduplicationThreshold: number;
  /** Days after which unused memories move to cold storage */
  coldStorageDays: number;
  /** Maximum entries per session to promote */
  maxPromotionBatch: number;
}

const DEFAULT_CONFIG: LifecycleConfig = {
  deduplicationThreshold: 0.95,
  coldStorageDays: 30,
  maxPromotionBatch: 50,
};

export class LifecycleManager {
  private history: HistoryStore;
  private memory: MemoryStore;
  private scratchpad: ScratchpadStore;
  private config: LifecycleConfig;

  constructor(
    history: HistoryStore,
    memory: MemoryStore,
    scratchpad: ScratchpadStore,
    config?: Partial<LifecycleConfig>
  ) {
    this.history = history;
    this.memory = memory;
    this.scratchpad = scratchpad;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Promote history entries from a session into structured memory.
   * Extracts key facts, creates session summary, records tool patterns.
   */
  async promoteSessionToMemory(
    sessionId: string,
    agentId: string = "default"
  ): Promise<{ factsCreated: number; episodicCreated: number }> {
    const entries = this.history.getBySession(sessionId);
    if (entries.length === 0) return { factsCreated: 0, episodicCreated: 0 };

    let factsCreated = 0;
    let episodicCreated = 0;

    // Create episodic memory (session summary)
    const summary = this.summarizeSession(entries);
    this.memory.createFromText(
      "episodic",
      `session:${sessionId}`,
      summary,
      { sessionId, createdBy: "summarizer" }
    );
    episodicCreated++;

    // Extract tool call patterns for experiential memory
    const toolCalls = entries.filter((e) => e.type === "tool_call");
    for (const tc of toolCalls.slice(0, this.config.maxPromotionBatch)) {
      this.memory.createFromText(
        "experiential",
        `tool:${sessionId}:${tc.id}`,
        tc.content,
        { historyId: tc.id, sessionId, createdBy: "summarizer" }
      );
    }

    // Extract user inputs as potential fact sources
    const userInputs = entries.filter((e) => e.type === "user_input");
    for (const ui of userInputs.slice(0, 10)) {
      // Only promote substantial inputs (more than a short message)
      if (ui.content.length > 100) {
        this.memory.createFromText(
          "fact",
          `user-input:${ui.id}`,
          ui.content.slice(0, 500),
          { historyId: ui.id, sessionId, createdBy: "summarizer" }
        );
        factsCreated++;
      }
    }

    return { factsCreated, episodicCreated };
  }

  /**
   * Validate and promote scratchpad entries to memory.
   */
  promoteScratchpadToMemory(
    taskId: string,
    targetType: MemoryType = "fact"
  ): number {
    const entries = this.scratchpad.getByTask(taskId);
    let promoted = 0;

    for (const entry of entries) {
      // Only promote drafts and hypotheses that look substantial
      if (
        (entry.type === "draft" || entry.type === "hypothesis") &&
        entry.content.length > 50
      ) {
        this.memory.createFromText(
          targetType,
          `scratch:${entry.id}`,
          entry.content,
          { createdBy: "agent" }
        );
        this.scratchpad.delete(entry.id);
        promoted++;
      }
    }

    return promoted;
  }

  /**
   * Archive scratchpad entries to history after task completion.
   */
  archiveScratchpadToHistory(
    taskId: string,
    sessionId: string
  ): number {
    const entries = this.scratchpad.getByTask(taskId);
    let archived = 0;

    for (const entry of entries) {
      this.history.append({
        sessionId,
        type: "system",
        content: `[Scratchpad archived] ${entry.type}: ${entry.content}`,
        metadata: {
          modelVersion: "",
          tokenCount: estimateTokens(entry.content),
        },
      });
      this.scratchpad.delete(entry.id);
      archived++;
    }

    return archived;
  }

  /**
   * Consolidate duplicate memories.
   * Merges entries with identical or near-identical content.
   */
  consolidateMemories(type: MemoryType): number {
    const entries = this.memory.getByType(type, 500);
    const toDelete: string[] = [];

    for (let i = 0; i < entries.length; i++) {
      if (toDelete.includes(entries[i].id)) continue;

      for (let j = i + 1; j < entries.length; j++) {
        if (toDelete.includes(entries[j].id)) continue;

        // Simple text similarity check (Jaccard on words)
        const sim = this.textSimilarity(entries[i].value, entries[j].value);
        if (sim >= this.config.deduplicationThreshold) {
          // Keep the one with higher confidence or more recent
          const keepI =
            entries[i].metadata.confidence >= entries[j].metadata.confidence;
          toDelete.push(keepI ? entries[j].id : entries[i].id);
        }
      }
    }

    for (const id of toDelete) {
      this.memory.delete(id);
    }

    return toDelete.length;
  }

  /**
   * Prune stale scratchpad entries.
   */
  pruneStale(): number {
    return this.scratchpad.pruneStale();
  }

  private summarizeSession(entries: HistoryEntry[]): string {
    const userInputs = entries
      .filter((e) => e.type === "user_input")
      .map((e) => e.content.slice(0, 200));
    const modelOutputs = entries
      .filter((e) => e.type === "model_output")
      .map((e) => e.content.slice(0, 200));
    const toolCount = entries.filter((e) => e.type === "tool_call").length;

    return [
      `Session with ${entries.length} interactions (${toolCount} tool calls).`,
      `User topics: ${userInputs.slice(0, 3).join("; ")}`,
      `Key outputs: ${modelOutputs.slice(0, 2).join("; ")}`,
    ].join("\n");
  }

  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }
}
