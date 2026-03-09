import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { HistoryStore } from "../src/repository/history.js";
import { MemoryStore } from "../src/repository/memory.js";
import { ScratchpadStore } from "../src/repository/scratchpad.js";
import { LifecycleManager } from "../src/repository/lifecycle.js";

describe("LifecycleManager", () => {
  let db: Database.Database;
  let historyStore: HistoryStore;
  let memoryStore: MemoryStore;
  let scratchpadStore: ScratchpadStore;
  let lifecycle: LifecycleManager;

  beforeEach(() => {
    db = new Database(":memory:");
    historyStore = new HistoryStore(db);
    memoryStore = new MemoryStore(db);
    scratchpadStore = new ScratchpadStore(db);
    lifecycle = new LifecycleManager(historyStore, memoryStore, scratchpadStore);
  });

  afterEach(() => {
    db.close();
  });

  it("should promote session history to memory", async () => {
    // Create some history entries
    historyStore.append({
      sessionId: "session-1",
      type: "user_input",
      content: "This is a detailed question about TypeScript generics that requires a thorough explanation with examples",
      metadata: { modelVersion: "test", tokenCount: 50 },
    });
    historyStore.append({
      sessionId: "session-1",
      type: "model_output",
      content: "TypeScript generics allow you to create reusable components...",
      metadata: { modelVersion: "test", tokenCount: 100 },
    });
    historyStore.append({
      sessionId: "session-1",
      type: "tool_call",
      content: JSON.stringify({ tool: "search", args: { query: "generics" } }),
      metadata: { modelVersion: "test", tokenCount: 30 },
    });

    const result = await lifecycle.promoteSessionToMemory("session-1");
    expect(result.episodicCreated).toBe(1);
    expect(result.factsCreated).toBe(1); // the long user input

    // Verify memories were created
    const episodic = memoryStore.getByType("episodic");
    expect(episodic.length).toBeGreaterThan(0);
  });

  it("should promote scratchpad entries to memory", () => {
    scratchpadStore.add("task-1", "This is a validated hypothesis that should be preserved in memory as a fact", "hypothesis");
    scratchpadStore.add("task-1", "short", "computation"); // too short

    const promoted = lifecycle.promoteScratchpadToMemory("task-1", "fact");
    expect(promoted).toBe(1);

    // Verify the promoted entry
    const facts = memoryStore.getByType("fact");
    expect(facts.length).toBe(1);

    // The short entry should still be in scratchpad
    const remaining = scratchpadStore.getByTask("task-1");
    expect(remaining.length).toBe(1);
    expect(remaining[0].type).toBe("computation");
  });

  it("should archive scratchpad to history", () => {
    scratchpadStore.add("task-2", "Some intermediate result", "intermediate");
    scratchpadStore.add("task-2", "A draft output", "draft");

    const archived = lifecycle.archiveScratchpadToHistory("task-2", "session-2");
    expect(archived).toBe(2);

    // Verify scratchpad is empty
    const remaining = scratchpadStore.getByTask("task-2");
    expect(remaining.length).toBe(0);

    // Verify history has the archived entries
    const history = historyStore.getBySession("session-2");
    expect(history.length).toBe(2);
  });

  it("should consolidate duplicate memories", () => {
    // Add near-duplicate memories
    memoryStore.createFromText(
      "fact",
      "key-1",
      "TypeScript is a typed superset of JavaScript",
      { createdBy: "agent" }
    );
    memoryStore.createFromText(
      "fact",
      "key-2",
      "TypeScript is a typed superset of JavaScript",
      { createdBy: "agent" }
    );
    memoryStore.createFromText(
      "fact",
      "key-3",
      "Python is a dynamic programming language",
      { createdBy: "agent" }
    );

    expect(memoryStore.count("fact")).toBe(3);

    const deduped = lifecycle.consolidateMemories("fact");
    expect(deduped).toBe(1); // one duplicate removed

    expect(memoryStore.count("fact")).toBe(2);
  });
});
