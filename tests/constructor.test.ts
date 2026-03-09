import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { VirtualFileSystem } from "../src/afs/vfs.js";
import { AccessControl } from "../src/afs/access-control.js";
import { TransactionLog } from "../src/afs/transaction-log.js";
import { MemoryStore } from "../src/repository/memory.js";
import { HistoryStore } from "../src/repository/history.js";
import { ContextConstructor } from "../src/pipeline/constructor.js";
import { LLMClient } from "../src/llm/client.js";

describe("ContextConstructor", () => {
  let db: Database.Database;
  let vfs: VirtualFileSystem;
  let memoryStore: MemoryStore;
  let historyStore: HistoryStore;

  beforeEach(() => {
    db = new Database(":memory:");
    const acl = new AccessControl();
    const txLog = new TransactionLog(db);
    vfs = new VirtualFileSystem(acl, txLog);
    memoryStore = new MemoryStore(db);
    historyStore = new HistoryStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should create a manifest for a simple query", async () => {
    // Add some test memories
    memoryStore.createFromText(
      "fact",
      "test:greeting",
      "The user prefers concise answers",
      { createdBy: "human" }
    );
    memoryStore.createFromText(
      "fact",
      "test:language",
      "The project uses TypeScript",
      { createdBy: "agent" }
    );

    // Constructor without real LLM (will fall back to heuristics)
    const llm = new LLMClient({ apiKey: "test-key" });
    const constructor = new ContextConstructor(
      vfs,
      memoryStore,
      historyStore,
      llm,
      { tokenBudget: 10000, relevanceThreshold: 0.1 }
    );

    const result = await constructor.construct("Tell me about TypeScript", "conversation");
    expect(result.manifest).toBeDefined();
    expect(result.manifest.taskDescription).toBe("Tell me about TypeScript");
    expect(result.manifest.selected.length).toBeGreaterThanOrEqual(0);
  });

  it("should respect token budget", async () => {
    // Add many memories
    for (let i = 0; i < 20; i++) {
      memoryStore.createFromText(
        "fact",
        `test:fact-${i}`,
        `This is test fact number ${i} with some content to take up tokens`,
        { createdBy: "agent" }
      );
    }

    const llm = new LLMClient({ apiKey: "test-key" });
    const constructor = new ContextConstructor(
      vfs,
      memoryStore,
      historyStore,
      llm,
      { tokenBudget: 500, relevanceThreshold: 0.1 }
    );

    const result = await constructor.construct("test facts", "conversation");
    expect(result.manifest.totalTokens).toBeLessThanOrEqual(500);
  });
});
