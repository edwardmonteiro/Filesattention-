/**
 * Context Updater — manages how context enters the token window during a session.
 * Supports three modes: static snapshot, incremental streaming, adaptive refresh.
 */

import type { ContextConstructor } from "./constructor.js";
import type { ContextManifest } from "./manifest.js";
import type { HistoryStore } from "../repository/history.js";
import type { TaskType } from "../llm/token-budget.js";
import { estimateTokenCount } from "../llm/token-budget.js";

export type UpdateMode = "static" | "incremental" | "adaptive";

export interface UpdaterConfig {
  mode: UpdateMode;
  /** Max tokens before triggering compaction in adaptive mode */
  compactionThreshold: number;
  /** Relevance drift threshold to trigger refresh */
  driftThreshold: number;
  /** Max staleness in ms before refreshing a context item */
  maxStalenessMs: number;
}

const DEFAULT_CONFIG: UpdaterConfig = {
  mode: "incremental",
  compactionThreshold: 150_000,
  driftThreshold: 0.3,
  maxStalenessMs: 10 * 60 * 1000, // 10 minutes
};

export interface SessionState {
  sessionId: string;
  taskType: TaskType;
  currentManifest: ContextManifest | null;
  currentContent: Map<string, string>;
  totalTokensUsed: number;
  turnCount: number;
  lastRefresh: number;
}

export class ContextUpdater {
  private constructor_: ContextConstructor;
  private historyStore: HistoryStore;
  private config: UpdaterConfig;
  private sessions: Map<string, SessionState> = new Map();

  constructor(
    constructor_: ContextConstructor,
    historyStore: HistoryStore,
    config?: Partial<UpdaterConfig>
  ) {
    this.constructor_ = constructor_;
    this.historyStore = historyStore;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize a new session.
   */
  async initSession(
    sessionId: string,
    query: string,
    taskType?: TaskType
  ): Promise<{ manifest: ContextManifest; content: Map<string, string> }> {
    const result = await this.constructor_.construct(
      query,
      taskType,
      sessionId
    );

    const state: SessionState = {
      sessionId,
      taskType: taskType ?? "conversation",
      currentManifest: result.manifest,
      currentContent: result.content,
      totalTokensUsed: result.manifest.totalTokens,
      turnCount: 1,
      lastRefresh: Date.now(),
    };

    this.sessions.set(sessionId, state);
    return result;
  }

  /**
   * Update context for a new turn in the session.
   */
  async onNewTurn(
    sessionId: string,
    query: string
  ): Promise<{
    manifest: ContextManifest;
    content: Map<string, string>;
    refreshed: boolean;
  }> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      const result = await this.initSession(sessionId, query);
      return { ...result, refreshed: true };
    }

    state.turnCount++;

    if (this.config.mode === "static") {
      // Static mode: return existing context
      return {
        manifest: state.currentManifest!,
        content: state.currentContent,
        refreshed: false,
      };
    }

    // Check if refresh is needed
    const needsRefresh = this.shouldRefresh(state, query);

    if (needsRefresh || this.config.mode === "incremental") {
      const result = await this.constructor_.construct(
        query,
        state.taskType,
        sessionId
      );

      state.currentManifest = result.manifest;
      state.currentContent = result.content;
      state.totalTokensUsed = result.manifest.totalTokens;
      state.lastRefresh = Date.now();

      return { ...result, refreshed: true };
    }

    return {
      manifest: state.currentManifest!,
      content: state.currentContent,
      refreshed: false,
    };
  }

  /**
   * Check if context needs to be refreshed.
   */
  private shouldRefresh(state: SessionState, query: string): boolean {
    if (this.config.mode !== "adaptive") return false;

    // Check staleness
    const timeSinceRefresh = Date.now() - state.lastRefresh;
    if (timeSinceRefresh > this.config.maxStalenessMs) return true;

    // Check budget pressure
    if (state.totalTokensUsed > this.config.compactionThreshold) return true;

    // Check relevance drift (simple keyword overlap with current manifest)
    if (state.currentManifest) {
      const currentPaths = state.currentManifest.selected.map((s) => s.path);
      const queryWords = new Set(query.toLowerCase().split(/\s+/));
      const contextWords = new Set(
        currentPaths.flatMap((p) => p.toLowerCase().split(/[/\-_]/))
      );
      const overlap = [...queryWords].filter((w) => contextWords.has(w)).length;
      const drift =
        queryWords.size > 0 ? 1 - overlap / queryWords.size : 1;
      if (drift > this.config.driftThreshold) return true;
    }

    return false;
  }

  /**
   * Get current session state.
   */
  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * End a session and clean up.
   */
  endSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
