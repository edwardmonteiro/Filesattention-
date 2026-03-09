/**
 * Output Evaluator — closes the loop.
 * Validates model outputs against provided context,
 * detects hallucinations, and writes back to the repository.
 */

import type { ContextManifest } from "./manifest.js";
import type { MemoryStore } from "../repository/memory.js";
import type { HistoryStore } from "../repository/history.js";
import type { ScratchpadStore } from "../repository/scratchpad.js";
import type { LLMClient } from "../llm/client.js";
import { estimateTokenCount } from "../llm/token-budget.js";

export interface EvaluationResult {
  outputId: string;
  checks: {
    factualConsistency: number;
    hallucinationRisk: number;
    relevance: number;
    confidence: number;
  };
  extractedFacts: Array<{
    statement: string;
    confidence: number;
    sourceContext: string;
  }>;
  writeBack: Array<{
    targetPath: string;
    content: string;
    memoryType: string;
  }>;
  humanReviewRequired: boolean;
}

export interface EvaluatorConfig {
  confidenceThreshold: number;
  maxFactsToExtract: number;
  enableLLMEvaluation: boolean;
}

const DEFAULT_CONFIG: EvaluatorConfig = {
  confidenceThreshold: 0.7,
  maxFactsToExtract: 10,
  enableLLMEvaluation: true,
};

export class OutputEvaluator {
  private memoryStore: MemoryStore;
  private historyStore: HistoryStore;
  private scratchpadStore: ScratchpadStore;
  private llm: LLMClient;
  private config: EvaluatorConfig;

  constructor(
    memoryStore: MemoryStore,
    historyStore: HistoryStore,
    scratchpadStore: ScratchpadStore,
    llm: LLMClient,
    config?: Partial<EvaluatorConfig>
  ) {
    this.memoryStore = memoryStore;
    this.historyStore = historyStore;
    this.scratchpadStore = scratchpadStore;
    this.llm = llm;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Evaluate model output against the context that produced it.
   */
  async evaluate(
    output: string,
    manifest: ContextManifest,
    resolvedContent: Map<string, string>,
    sessionId: string,
    taskId?: string
  ): Promise<EvaluationResult> {
    const outputId = `eval-${Date.now()}`;
    const contextText = Array.from(resolvedContent.values()).join("\n\n");

    // Extract facts from output
    let extractedFacts: EvaluationResult["extractedFacts"] = [];
    let checks: EvaluationResult["checks"] = {
      factualConsistency: 1.0,
      hallucinationRisk: 0.0,
      relevance: 1.0,
      confidence: 1.0,
    };

    if (this.config.enableLLMEvaluation && contextText.length > 0) {
      try {
        // Extract facts using LLM
        const facts = await this.llm.extractFacts(output);
        extractedFacts = facts
          .slice(0, this.config.maxFactsToExtract)
          .map((f) => ({
            statement: f,
            confidence: 0.8,
            sourceContext: "",
          }));

        // Check consistency for each fact
        let consistentCount = 0;
        for (const fact of extractedFacts) {
          try {
            const result = await this.llm.checkConsistency(
              fact.statement,
              contextText.slice(0, 3000)
            );
            fact.confidence = result.confidence;
            fact.sourceContext = result.explanation;
            if (result.consistent) consistentCount++;
          } catch {
            fact.confidence = 0.5;
          }
        }

        const total = extractedFacts.length || 1;
        checks = {
          factualConsistency: consistentCount / total,
          hallucinationRisk: 1 - consistentCount / total,
          relevance: this.computeRelevance(output, manifest),
          confidence: consistentCount / total,
        };
      } catch {
        // If LLM evaluation fails, use heuristic defaults
        checks = {
          factualConsistency: 0.8,
          hallucinationRisk: 0.2,
          relevance: this.computeRelevance(output, manifest),
          confidence: 0.7,
        };
      }
    } else {
      checks.relevance = this.computeRelevance(output, manifest);
    }

    // Determine write-back actions
    const writeBack: EvaluationResult["writeBack"] = [];
    const humanReviewRequired = checks.confidence < this.config.confidenceThreshold;

    if (checks.confidence >= this.config.confidenceThreshold) {
      // Write verified facts to memory
      for (const fact of extractedFacts.filter(
        (f) => f.confidence >= this.config.confidenceThreshold
      )) {
        const path = `/context/memory/default/facts/${outputId}-${extractedFacts.indexOf(fact)}`;
        writeBack.push({
          targetPath: path,
          content: fact.statement,
          memoryType: "fact",
        });

        this.memoryStore.createFromText("fact", path, fact.statement, {
          sessionId,
          createdBy: "summarizer",
        });
      }

      // Create episodic memory for this interaction
      const episodicPath = `/context/memory/default/episodic/${outputId}`;
      const summary = output.slice(0, 500);
      writeBack.push({
        targetPath: episodicPath,
        content: summary,
        memoryType: "episodic",
      });

      this.memoryStore.createFromText("episodic", episodicPath, summary, {
        sessionId,
        createdBy: "summarizer",
      });
    } else {
      // Low confidence: write to scratchpad for review
      if (taskId) {
        this.scratchpadStore.add(taskId, output, "draft");
      }
    }

    // Always append to history
    this.historyStore.append({
      sessionId,
      type: "model_output",
      content: output,
      metadata: {
        modelVersion: "",
        tokenCount: estimateTokenCount(output),
      },
    });

    return {
      outputId,
      checks,
      extractedFacts,
      writeBack,
      humanReviewRequired,
    };
  }

  private computeRelevance(
    output: string,
    manifest: ContextManifest
  ): number {
    // Simple keyword overlap between output and task description
    const taskWords = new Set(
      manifest.taskDescription.toLowerCase().split(/\s+/)
    );
    const outputWords = new Set(
      output.toLowerCase().split(/\s+/).slice(0, 200)
    );
    const overlap = [...taskWords].filter((w) => outputWords.has(w)).length;
    return taskWords.size > 0 ? Math.min(1.0, overlap / taskWords.size) : 0.5;
  }
}
