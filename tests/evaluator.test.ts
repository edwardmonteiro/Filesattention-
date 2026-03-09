import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { MemoryStore } from "../src/repository/memory.js";
import { HistoryStore } from "../src/repository/history.js";
import { ScratchpadStore } from "../src/repository/scratchpad.js";
import { OutputEvaluator } from "../src/pipeline/evaluator.js";
import { LLMClient } from "../src/llm/client.js";
import { createManifest, addSelected } from "../src/pipeline/manifest.js";

describe("OutputEvaluator", () => {
  let db: Database.Database;
  let memoryStore: MemoryStore;
  let historyStore: HistoryStore;
  let scratchpadStore: ScratchpadStore;

  beforeEach(() => {
    db = new Database(":memory:");
    memoryStore = new MemoryStore(db);
    historyStore = new HistoryStore(db);
    scratchpadStore = new ScratchpadStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should evaluate output without LLM (heuristic mode)", async () => {
    const llm = new LLMClient({ apiKey: "test-key" });
    const evaluator = new OutputEvaluator(
      memoryStore,
      historyStore,
      scratchpadStore,
      llm,
      { enableLLMEvaluation: false, confidenceThreshold: 0.5 }
    );

    const manifest = createManifest("What is TypeScript?");
    addSelected(manifest, "/context/memory/fact/1", 0.9, 50, "relevant");

    const content = new Map<string, string>();
    content.set("/context/memory/fact/1", "TypeScript is a typed superset of JavaScript");

    const result = await evaluator.evaluate(
      "TypeScript is a programming language that adds types to JavaScript.",
      manifest,
      content,
      "test-session"
    );

    expect(result.outputId).toBeDefined();
    expect(result.checks.relevance).toBeGreaterThan(0);
    expect(result.checks.confidence).toBeGreaterThanOrEqual(0);
    // Should have recorded to history
    const history = historyStore.getBySession("test-session");
    expect(history.length).toBe(1);
    expect(history[0].type).toBe("model_output");
  });

  it("should write low-confidence output to scratchpad", async () => {
    const llm = new LLMClient({ apiKey: "test-key" });
    const evaluator = new OutputEvaluator(
      memoryStore,
      historyStore,
      scratchpadStore,
      llm,
      {
        enableLLMEvaluation: false,
        confidenceThreshold: 2.0, // impossibly high to force scratchpad
      }
    );

    const manifest = createManifest("test");
    const content = new Map<string, string>();

    const result = await evaluator.evaluate(
      "Some output",
      manifest,
      content,
      "test-session",
      "task-1"
    );

    expect(result.humanReviewRequired).toBe(true);
    const scratches = scratchpadStore.getByTask("task-1");
    expect(scratches.length).toBe(1);
    expect(scratches[0].content).toBe("Some output");
  });
});
