/**
 * Token counting and budget management.
 * The hard constraint that everything else serves.
 */

export type TaskType =
  | "code_generation"
  | "analysis"
  | "conversation"
  | "document_processing";

export interface BudgetAllocation {
  instructions: number;
  memory: number;
  tools: number;
  history: number;
  knowledge: number;
  reserve: number;
}

/** Allocation percentages by task type */
const TASK_ALLOCATIONS: Record<TaskType, BudgetAllocation> = {
  code_generation: {
    instructions: 0.1,
    memory: 0.1,
    tools: 0.25,
    history: 0.2,
    knowledge: 0.15,
    reserve: 0.2,
  },
  analysis: {
    instructions: 0.1,
    memory: 0.2,
    tools: 0.1,
    history: 0.15,
    knowledge: 0.25,
    reserve: 0.2,
  },
  conversation: {
    instructions: 0.1,
    memory: 0.15,
    tools: 0.1,
    history: 0.35,
    knowledge: 0.1,
    reserve: 0.2,
  },
  document_processing: {
    instructions: 0.1,
    memory: 0.1,
    tools: 0.1,
    history: 0.1,
    knowledge: 0.4,
    reserve: 0.2,
  },
};

export interface CompactionPlan {
  targetFreeTokens: number;
  actions: Array<{
    category: string;
    action: "summarize" | "truncate" | "remove";
    tokensSaved: number;
  }>;
}

export class TokenBudget {
  modelLimit: number;
  private allocations: Map<string, number> = new Map();
  private used: Map<string, number> = new Map();

  constructor(modelLimit: number = 200_000) {
    this.modelLimit = modelLimit;
  }

  /**
   * Configure budget allocation for a task type.
   */
  configureForTask(taskType: TaskType): void {
    const alloc = TASK_ALLOCATIONS[taskType];
    this.allocations.set("instructions", Math.floor(this.modelLimit * alloc.instructions));
    this.allocations.set("memory", Math.floor(this.modelLimit * alloc.memory));
    this.allocations.set("tools", Math.floor(this.modelLimit * alloc.tools));
    this.allocations.set("history", Math.floor(this.modelLimit * alloc.history));
    this.allocations.set("knowledge", Math.floor(this.modelLimit * alloc.knowledge));
    this.allocations.set("reserve", Math.floor(this.modelLimit * alloc.reserve));
  }

  /**
   * Get the token budget for a category.
   */
  getBudget(category: string): number {
    return this.allocations.get(category) ?? 0;
  }

  /**
   * Record tokens used in a category.
   */
  use(category: string, tokens: number): void {
    const current = this.used.get(category) ?? 0;
    this.used.set(category, current + tokens);
  }

  /**
   * Check if tokens can fit in a category.
   */
  canFit(category: string, tokens: number): boolean {
    const budget = this.allocations.get(category) ?? 0;
    const usedTokens = this.used.get(category) ?? 0;
    return usedTokens + tokens <= budget;
  }

  /**
   * Get remaining tokens in a category.
   */
  remaining(category: string): number {
    const budget = this.allocations.get(category) ?? 0;
    const usedTokens = this.used.get(category) ?? 0;
    return Math.max(0, budget - usedTokens);
  }

  /**
   * Get total remaining tokens across all categories (excluding reserve).
   */
  totalRemaining(): number {
    let total = 0;
    for (const [cat, budget] of this.allocations) {
      if (cat === "reserve") continue;
      const usedTokens = this.used.get(cat) ?? 0;
      total += Math.max(0, budget - usedTokens);
    }
    return total;
  }

  /**
   * Get total used tokens.
   */
  totalUsed(): number {
    let total = 0;
    for (const used of this.used.values()) {
      total += used;
    }
    return total;
  }

  /**
   * Utilization percentage.
   */
  utilization(): number {
    const reserveBudget = this.allocations.get("reserve") ?? 0;
    const available = this.modelLimit - reserveBudget;
    return available === 0 ? 0 : this.totalUsed() / available;
  }

  /**
   * Plan compaction to free up tokens.
   */
  compact(targetFreeTokens: number): CompactionPlan {
    const actions: CompactionPlan["actions"] = [];
    let freed = 0;

    // Prioritize compacting largest categories first
    const categories = Array.from(this.used.entries())
      .filter(([cat]) => cat !== "reserve" && cat !== "instructions")
      .sort((a, b) => b[1] - a[1]);

    for (const [category, usedTokens] of categories) {
      if (freed >= targetFreeTokens) break;

      // Estimate savings from summarization (~60% reduction)
      const savings = Math.floor(usedTokens * 0.6);
      actions.push({
        category,
        action: "summarize",
        tokensSaved: savings,
      });
      freed += savings;
    }

    return { targetFreeTokens, actions };
  }

  /**
   * Reset usage tracking.
   */
  reset(): void {
    this.used.clear();
  }

  /**
   * Get a summary of budget status.
   */
  summary(): Record<string, { budget: number; used: number; remaining: number }> {
    const result: Record<string, { budget: number; used: number; remaining: number }> = {};
    for (const [cat, budget] of this.allocations) {
      const usedTokens = this.used.get(cat) ?? 0;
      result[cat] = {
        budget,
        used: usedTokens,
        remaining: Math.max(0, budget - usedTokens),
      };
    }
    return result;
  }
}

/**
 * Estimate token count for a string.
 * Rough approximation: ~4 chars per token for English.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
