/**
 * Context Constructor — the most critical component.
 * Determines what context reaches the model by selecting, scoring,
 * and assembling context from the AFS.
 */

import type { VirtualFileSystem } from "../afs/vfs.js";
import type { AFSNode } from "../afs/resolver.js";
import type { MemoryStore } from "../repository/memory.js";
import type { HistoryStore } from "../repository/history.js";
import {
  TokenBudget,
  estimateTokenCount,
  type TaskType,
} from "../llm/token-budget.js";
import type { LLMClient } from "../llm/client.js";
import {
  createManifest,
  addSelected,
  addExcluded,
  addCompression,
  finalizeManifest,
  type ContextManifest,
} from "./manifest.js";

export interface ConstructorConfig {
  tokenBudget: number;
  relevanceThreshold: number;
  recencyWeight: number;
  provenanceWeight: number;
}

const DEFAULT_CONFIG: ConstructorConfig = {
  tokenBudget: 200_000,
  relevanceThreshold: 0.3,
  recencyWeight: 0.2,
  provenanceWeight: 0.2,
};

interface ScoredCandidate {
  node: AFSNode;
  content: string;
  score: number;
  category: string;
  reason: string;
}

export class ContextConstructor {
  private vfs: VirtualFileSystem;
  private memoryStore: MemoryStore;
  private historyStore: HistoryStore;
  private llm: LLMClient;
  private config: ConstructorConfig;

  constructor(
    vfs: VirtualFileSystem,
    memoryStore: MemoryStore,
    historyStore: HistoryStore,
    llm: LLMClient,
    config?: Partial<ConstructorConfig>
  ) {
    this.vfs = vfs;
    this.memoryStore = memoryStore;
    this.historyStore = historyStore;
    this.llm = llm;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Construct optimal context for a given task/query.
   * Returns the manifest and resolved content map.
   */
  async construct(
    query: string,
    taskType?: TaskType,
    sessionId?: string
  ): Promise<{
    manifest: ContextManifest;
    content: Map<string, string>;
  }> {
    // 1. Classify task if not provided
    const resolvedTaskType = taskType ?? (await this.classifyTask(query));

    // 2. Set up token budget
    const budget = new TokenBudget(this.config.tokenBudget);
    budget.configureForTask(resolvedTaskType);

    // 3. Retrieve candidates
    const candidates = await this.retrieveCandidates(query, sessionId);

    // 4. Score and rank candidates
    const scored = this.scoreCandidates(candidates, query);

    // 5. Filter below threshold
    const filtered = scored.filter(
      (c) => c.score >= this.config.relevanceThreshold
    );

    // 6. Select within budget
    const manifest = createManifest(query);
    const content = new Map<string, string>();

    for (const candidate of filtered) {
      const category = candidate.category;
      const tokens = estimateTokenCount(candidate.content);

      if (budget.canFit(category, tokens)) {
        // Fits within budget
        budget.use(category, tokens);
        addSelected(
          manifest,
          candidate.node.path,
          candidate.score,
          tokens,
          candidate.reason
        );
        content.set(candidate.node.path, candidate.content);
      } else if (tokens > budget.remaining(category) && budget.remaining(category) > 100) {
        // Needs compression
        const targetTokens = budget.remaining(category);
        const compressed = this.compress(candidate.content, targetTokens);
        const compressedTokens = estimateTokenCount(compressed);

        budget.use(category, compressedTokens);
        addSelected(
          manifest,
          candidate.node.path,
          candidate.score,
          compressedTokens,
          `${candidate.reason} (compressed)`
        );
        addCompression(
          manifest,
          candidate.node.path,
          tokens,
          compressedTokens,
          "truncation"
        );
        content.set(candidate.node.path, compressed);
      } else {
        addExcluded(
          manifest,
          candidate.node.path,
          candidate.score,
          `Budget exceeded for category: ${category}`
        );
      }
    }

    finalizeManifest(manifest, this.config.tokenBudget);

    return { manifest, content };
  }

  private async classifyTask(query: string): Promise<TaskType> {
    try {
      return await this.llm.classifyTask(query);
    } catch {
      return "conversation";
    }
  }

  private async retrieveCandidates(
    query: string,
    sessionId?: string
  ): Promise<Array<{ node: AFSNode; content: string; category: string }>> {
    const candidates: Array<{
      node: AFSNode;
      content: string;
      category: string;
    }> = [];

    // Search memory
    const memories = this.memoryStore.search(query, undefined, 30);
    for (const mem of memories) {
      candidates.push({
        node: {
          path: `/context/memory/${mem.type}/${mem.id}`,
          type: "file",
          metadata: mem.metadata,
          resolver: "memory",
        },
        content: mem.value,
        category: "memory",
      });
    }

    // Get recent history
    if (sessionId) {
      const history = this.historyStore.getBySession(sessionId, 20);
      for (const entry of history) {
        candidates.push({
          node: {
            path: `/context/history/${sessionId}/${entry.id}`,
            type: "file",
            metadata: {
              createdAt: entry.timestamp,
              updatedAt: entry.timestamp,
              author: entry.type === "user_input" ? "human" : "agent",
              provenance: `history:${sessionId}`,
              confidence: 1.0,
              accessScope: ["*"],
              tokenEstimate: entry.metadata.tokenCount,
              version: 1,
              tags: [entry.type],
            },
            resolver: "history",
          },
          content: entry.content,
          category: "history",
        });
      }
    }

    // Search VFS for knowledge
    try {
      const vfsResults = await this.vfs.search(query, "/context/knowledge");
      for (const node of vfsResults) {
        try {
          const { content } = await this.vfs.read(node.path);
          candidates.push({ node, content, category: "knowledge" });
        } catch {
          // Skip unreadable nodes
        }
      }
    } catch {
      // No knowledge mounted
    }

    // Search VFS for tools
    try {
      const toolResults = await this.vfs.search(query, "/context/tools");
      for (const node of toolResults) {
        try {
          const { content } = await this.vfs.read(node.path);
          candidates.push({ node, content, category: "tools" });
        } catch {
          // Skip
        }
      }
    } catch {
      // No tools mounted
    }

    return candidates;
  }

  private scoreCandidates(
    candidates: Array<{ node: AFSNode; content: string; category: string }>,
    query: string
  ): ScoredCandidate[] {
    const queryWords = new Set(query.toLowerCase().split(/\s+/));

    return candidates
      .map((c) => {
        const contentWords = new Set(
          c.content.toLowerCase().split(/\s+/).slice(0, 200)
        );

        // Keyword overlap as proxy for semantic similarity
        const overlap = [...queryWords].filter((w) => contentWords.has(w)).length;
        const semanticScore = queryWords.size > 0 ? overlap / queryWords.size : 0;

        // Recency decay
        const ageMs =
          Date.now() - new Date(c.node.metadata.createdAt).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        const recencyScore = Math.exp(-ageDays / 30); // decay over 30 days

        // Provenance confidence
        const provenanceScore = c.node.metadata.confidence;

        // Composite score
        const score =
          semanticScore * 0.4 +
          recencyScore * this.config.recencyWeight +
          provenanceScore * this.config.provenanceWeight +
          0.1 + // base relevance
          0.1; // source authority placeholder

        const reason = `semantic=${semanticScore.toFixed(2)}, recency=${recencyScore.toFixed(2)}, provenance=${provenanceScore.toFixed(2)}`;

        return { node: c.node, content: c.content, score, category: c.category, reason };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Simple compression by truncation to fit token budget.
   */
  private compress(content: string, targetTokens: number): string {
    const targetChars = targetTokens * 4;
    if (content.length <= targetChars) return content;
    return content.slice(0, targetChars - 3) + "...";
  }
}
