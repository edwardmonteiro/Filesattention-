#!/usr/bin/env node

/**
 * AFS Local — Agentic File System for Local Context Engineering
 * CLI entrypoint.
 */

import { Command } from "commander";
import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";

import { VirtualFileSystem } from "./afs/vfs.js";
import { AccessControl } from "./afs/access-control.js";
import { TransactionLog } from "./afs/transaction-log.js";
import { HistoryStore } from "./repository/history.js";
import { MemoryStore } from "./repository/memory.js";
import { ScratchpadStore } from "./repository/scratchpad.js";
import { LifecycleManager } from "./repository/lifecycle.js";
import { FactMemory } from "./memory-types/fact-memory.js";
import { EpisodicMemory } from "./memory-types/episodic-memory.js";
import { ProceduralMemory } from "./memory-types/procedural-memory.js";
import { ExperientialMemory } from "./memory-types/experiential-memory.js";
import { UserMemory } from "./memory-types/user-memory.js";
import { FilesystemResolver } from "./integrations/filesystem-mount.js";
import { RAGResolver } from "./integrations/rag-mount.js";
import { LLMClient } from "./llm/client.js";
import { TokenBudget } from "./llm/token-budget.js";

function createDataDir(dataDir: string): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function initializeSystem(dataDir: string) {
  createDataDir(dataDir);

  const dbPath = path.join(dataDir, "afs.sqlite");
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma("journal_mode = WAL");

  const acl = new AccessControl();
  const txLog = new TransactionLog(db);
  const vfs = new VirtualFileSystem(acl, txLog);

  const historyStore = new HistoryStore(db);
  const memoryStore = new MemoryStore(db);
  const scratchpadStore = new ScratchpadStore(db);
  const lifecycle = new LifecycleManager(historyStore, memoryStore, scratchpadStore);

  return {
    db,
    vfs,
    acl,
    txLog,
    historyStore,
    memoryStore,
    scratchpadStore,
    lifecycle,
  };
}

const program = new Command();

program
  .name("afs")
  .description("Agentic File System for Local Context Engineering")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize AFS data directory")
  .option("-d, --data-dir <path>", "Data directory path", "./data")
  .action((options) => {
    const { db } = initializeSystem(options.dataDir);
    console.log(`AFS initialized at ${options.dataDir}`);
    db.close();
  });

program
  .command("status")
  .description("Show AFS status and statistics")
  .option("-d, --data-dir <path>", "Data directory path", "./data")
  .action((options) => {
    const sys = initializeSystem(options.dataDir);

    console.log("=== AFS Status ===");
    console.log(`History entries: ${sys.historyStore.count()}`);
    console.log(`Memory entries: ${sys.memoryStore.count()}`);
    console.log(`  Facts: ${sys.memoryStore.count("fact")}`);
    console.log(`  Episodic: ${sys.memoryStore.count("episodic")}`);
    console.log(`  Procedural: ${sys.memoryStore.count("procedural")}`);
    console.log(`  Experiential: ${sys.memoryStore.count("experiential")}`);
    console.log(`  User: ${sys.memoryStore.count("user")}`);
    console.log(`Scratchpad entries: ${sys.scratchpadStore.count()}`);
    console.log(`Recent transactions:`);

    const recent = sys.txLog.getRecent(5);
    for (const tx of recent) {
      console.log(
        `  ${tx.timestamp} | ${tx.operation} | ${tx.path} | ${tx.status}`
      );
    }

    sys.db.close();
  });

program
  .command("memory")
  .description("Memory management commands")
  .addCommand(
    new Command("add")
      .description("Add a memory entry")
      .requiredOption("-t, --type <type>", "Memory type (fact|episodic|procedural|experiential|user)")
      .requiredOption("-k, --key <key>", "Memory key")
      .requiredOption("-v, --value <value>", "Memory value")
      .option("-d, --data-dir <path>", "Data directory path", "./data")
      .action((options) => {
        const sys = initializeSystem(options.dataDir);
        const entry = sys.memoryStore.createFromText(
          options.type,
          options.key,
          options.value,
          { createdBy: "human" }
        );
        console.log(`Memory added: ${entry.id} (${entry.type})`);
        sys.db.close();
      })
  )
  .addCommand(
    new Command("search")
      .description("Search memory entries")
      .argument("<query>", "Search query")
      .option("-t, --type <type>", "Filter by memory type")
      .option("-d, --data-dir <path>", "Data directory path", "./data")
      .action((query, options) => {
        const sys = initializeSystem(options.dataDir);
        const results = sys.memoryStore.search(query, options.type);
        console.log(`Found ${results.length} results:`);
        for (const r of results) {
          console.log(`  [${r.type}] ${r.key}: ${r.value.slice(0, 100)}`);
        }
        sys.db.close();
      })
  )
  .addCommand(
    new Command("list")
      .description("List memory entries")
      .option("-t, --type <type>", "Filter by memory type")
      .option("-l, --limit <number>", "Limit results", "20")
      .option("-d, --data-dir <path>", "Data directory path", "./data")
      .action((options) => {
        const sys = initializeSystem(options.dataDir);
        const entries = options.type
          ? sys.memoryStore.getByType(options.type, parseInt(options.limit))
          : sys.memoryStore.getByType("fact", parseInt(options.limit));
        console.log(`Memory entries (${entries.length}):`);
        for (const e of entries) {
          console.log(
            `  ${e.id} [${e.type}] ${e.key}: ${e.value.slice(0, 80)}`
          );
        }
        sys.db.close();
      })
  );

program
  .command("mount")
  .description("Mount a local directory as knowledge source")
  .argument("<path>", "Directory path to mount")
  .option("-n, --name <name>", "Mount name")
  .option("-d, --data-dir <path>", "Data directory path", "./data")
  .action((dirPath, options) => {
    const sys = initializeSystem(options.dataDir);
    const name = options.name || path.basename(dirPath);
    const resolver = new FilesystemResolver(name, dirPath);
    sys.vfs.mount(`/context/knowledge/${name}`, resolver);
    console.log(`Mounted ${dirPath} at /context/knowledge/${name}`);
    sys.db.close();
  });

program
  .command("index")
  .description("Index documents for RAG")
  .argument("<paths...>", "Document paths to index")
  .option("-d, --data-dir <path>", "Data directory path", "./data")
  .action(async (paths, options) => {
    const sys = initializeSystem(options.dataDir);
    const rag = new RAGResolver("rag", {
      documentPaths: paths,
      chunkSize: 512,
      chunkOverlap: 50,
      vectorStorePath: path.join(options.dataDir, "vectors"),
    });

    const count = await rag.index();
    console.log(`Indexed ${count} chunks from ${paths.length} paths`);
    sys.db.close();
  });

program
  .command("history")
  .description("View interaction history")
  .option("-s, --session <id>", "Filter by session ID")
  .option("-l, --limit <number>", "Limit results", "20")
  .option("-d, --data-dir <path>", "Data directory path", "./data")
  .action((options) => {
    const sys = initializeSystem(options.dataDir);
    const entries = options.session
      ? sys.historyStore.getBySession(options.session, parseInt(options.limit))
      : sys.historyStore.getRecent(parseInt(options.limit));

    console.log(`History entries (${entries.length}):`);
    for (const e of entries) {
      console.log(
        `  ${e.timestamp} [${e.type}] ${e.content.slice(0, 100)}`
      );
    }
    sys.db.close();
  });

program
  .command("consolidate")
  .description("Run lifecycle consolidation")
  .option("-d, --data-dir <path>", "Data directory path", "./data")
  .action((options) => {
    const sys = initializeSystem(options.dataDir);

    const pruned = sys.lifecycle.pruneStale();
    console.log(`Pruned ${pruned} stale scratchpad entries`);

    for (const type of [
      "fact",
      "episodic",
      "procedural",
      "experiential",
      "user",
    ] as const) {
      const deduped = sys.lifecycle.consolidateMemories(type);
      if (deduped > 0) {
        console.log(`Deduplicated ${deduped} ${type} memories`);
      }
    }

    sys.db.close();
  });

program
  .command("log")
  .description("View transaction log")
  .option("-l, --limit <number>", "Limit results", "20")
  .option("-d, --data-dir <path>", "Data directory path", "./data")
  .action((options) => {
    const sys = initializeSystem(options.dataDir);
    const entries = sys.txLog.getRecent(parseInt(options.limit));

    console.log(`Transaction log (${entries.length} entries):`);
    for (const e of entries) {
      console.log(
        `  ${e.timestamp} | ${e.operation.padEnd(8)} | ${e.path} | ${e.status} ${e.detail ? `| ${e.detail}` : ""}`
      );
    }
    sys.db.close();
  });

program.parse();
