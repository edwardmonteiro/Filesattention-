#!/usr/bin/env npx tsx
/**
 * Exemplo básico de uso do AFS Local.
 *
 * Demonstra:
 * 1. Inicialização do sistema
 * 2. Armazenamento de memórias (facts, episodic, user)
 * 3. Busca por keyword
 * 4. Montagem de diretório como fonte de conhecimento
 * 5. Lifecycle: promoção e consolidação
 * 6. Token budget
 *
 * Rodar: npx tsx examples/basic-usage.ts
 */

import Database from "better-sqlite3";
import * as path from "node:path";

import { VirtualFileSystem } from "../src/afs/vfs.js";
import { AccessControl } from "../src/afs/access-control.js";
import { TransactionLog } from "../src/afs/transaction-log.js";
import { HistoryStore } from "../src/repository/history.js";
import { MemoryStore } from "../src/repository/memory.js";
import { ScratchpadStore } from "../src/repository/scratchpad.js";
import { LifecycleManager } from "../src/repository/lifecycle.js";
import { UserMemory } from "../src/memory-types/user-memory.js";
import { FilesystemResolver } from "../src/integrations/filesystem-mount.js";
import { TokenBudget } from "../src/llm/token-budget.js";

// ══════════════════════════════════════════════════
// 1. Inicialização
// ══════════════════════════════════════════════════

console.log("═══ AFS Local — Exemplo Básico ═══\n");

const db = new Database(":memory:");
db.pragma("journal_mode = WAL");

const acl = new AccessControl();
const txLog = new TransactionLog(db);
const vfs = new VirtualFileSystem(acl, txLog);

const historyStore = new HistoryStore(db);
const memoryStore = new MemoryStore(db);
const scratchpadStore = new ScratchpadStore(db);
const lifecycle = new LifecycleManager(historyStore, memoryStore, scratchpadStore);

console.log("✓ Sistema inicializado (banco em memória)\n");

// ══════════════════════════════════════════════════
// 2. Armazenamento de memórias
// ══════════════════════════════════════════════════

console.log("── Armazenando memórias ──\n");

// Fatos atômicos
memoryStore.createFromText(
  "fact", "linguagem:typescript",
  "TypeScript é um superset tipado de JavaScript",
  { createdBy: "human" }
);
memoryStore.createFromText(
  "fact", "linguagem:python",
  "Python é uma linguagem dinâmica de alto nível",
  { createdBy: "human" }
);
memoryStore.createFromText(
  "fact", "conceito:afs",
  "AFS (Agentic File System) unifica fontes de contexto em um namespace hierárquico",
  { createdBy: "human" }
);
memoryStore.createFromText(
  "fact", "conceito:token-window",
  "A janela de tokens é a memória de trabalho finita do LLM",
  { createdBy: "human" }
);

console.log(`  ${memoryStore.count("fact")} fatos armazenados`);

// Preferências do usuário
const userMemory = new UserMemory(memoryStore);
userMemory.setPreference({ key: "idioma", value: "pt-br", category: "geral" });
userMemory.setPreference({ key: "formato", value: "conciso", category: "output" });
userMemory.setContext("projeto_atual", "Implementação do AFS Local para context engineering");

console.log(`  ${memoryStore.count("user")} memórias de usuário armazenadas`);

// Memória episódica
memoryStore.createFromText(
  "episodic",
  "sessao:exemplo-1",
  "Sessão de exemplo onde o usuário explorou o sistema AFS pela primeira vez.",
  { createdBy: "summarizer", sessionId: "exemplo-1" }
);

console.log(`  ${memoryStore.count("episodic")} memórias episódicas armazenadas`);

// ══════════════════════════════════════════════════
// 3. Busca por keyword
// ══════════════════════════════════════════════════

console.log("\n── Busca por keyword ──\n");

const resultados = memoryStore.search("TypeScript");
console.log(`  Busca "TypeScript": ${resultados.length} resultado(s)`);
for (const r of resultados) {
  console.log(`    [${r.type}] ${r.key}: ${r.value.slice(0, 60)}...`);
}

const resultados2 = memoryStore.search("contexto namespace");
console.log(`\n  Busca "contexto namespace": ${resultados2.length} resultado(s)`);
for (const r of resultados2) {
  console.log(`    [${r.type}] ${r.key}: ${r.value.slice(0, 60)}...`);
}

// ══════════════════════════════════════════════════
// 4. Montar diretório local como fonte de conhecimento
// ══════════════════════════════════════════════════

console.log("\n── Montagem de diretório ──\n");

const srcResolver = new FilesystemResolver("src", path.resolve("./src"));
vfs.mount("/context/knowledge/src", srcResolver);

const mounts = vfs.listMounts();
console.log(`  ${mounts.length} mount(s) ativo(s):`);
for (const m of mounts) {
  console.log(`    ${m.mountPoint} → ${m.resolverName}`);
}

// Listar arquivos montados
const files = await vfs.list("/context/knowledge/src");
console.log(`\n  ${files.length} arquivo(s) no diretório montado:`);
for (const f of files.slice(0, 5)) {
  console.log(`    ${f.path} (${f.type})`);
}
if (files.length > 5) {
  console.log(`    ... e mais ${files.length - 5}`);
}

// ══════════════════════════════════════════════════
// 5. Simulação do histórico e promoção
// ══════════════════════════════════════════════════

console.log("\n── Histórico e promoção ──\n");

historyStore.append({
  sessionId: "demo-session",
  type: "user_input",
  content: "Explique como o AFS gerencia o contexto do LLM. Quero entender a arquitetura de três camadas: history, memory e scratchpad. Também quero saber sobre token budgets.",
  metadata: { modelVersion: "claude-sonnet-4-20250514", tokenCount: 50 },
});

historyStore.append({
  sessionId: "demo-session",
  type: "model_output",
  content: "O AFS usa três camadas: History (log imutável), Memory (visões estruturadas) e Scratchpad (workspace temporário).",
  metadata: { modelVersion: "claude-sonnet-4-20250514", tokenCount: 80 },
});

historyStore.append({
  sessionId: "demo-session",
  type: "tool_call",
  content: JSON.stringify({ tool: "memory_search", args: { query: "token budget" } }),
  metadata: { modelVersion: "claude-sonnet-4-20250514", tokenCount: 20 },
});

console.log(`  ${historyStore.count()} entradas no histórico`);

// Promover sessão para memória
const promotion = await lifecycle.promoteSessionToMemory("demo-session");
console.log(`  Promoção: ${promotion.factsCreated} fatos, ${promotion.episodicCreated} episódico(s)`);

// ══════════════════════════════════════════════════
// 6. Token Budget
// ══════════════════════════════════════════════════

console.log("\n── Token Budget ──\n");

const budget = new TokenBudget(128000);
budget.configureForTask("code_generation");

console.log(`  Modelo: 128K tokens`);
console.log(`  Tipo de tarefa: code_generation`);
console.log(`  Alocação:`);
console.log(`    Instruções:   ${budget.getBudget("instructions")} tokens`);
console.log(`    Memória:      ${budget.getBudget("memory")} tokens`);
console.log(`    Ferramentas:  ${budget.getBudget("tools")} tokens`);
console.log(`    Histórico:    ${budget.getBudget("history")} tokens`);
console.log(`    Conhecimento: ${budget.getBudget("knowledge")} tokens`);
console.log(`    Reserva:      ${budget.getBudget("reserve")} tokens`);

// Simular uso
budget.use("memory", 2000);
budget.use("tools", 5000);
console.log(`\n  Após usar 7K tokens:`);
console.log(`    Usado:     ${budget.totalUsed()} tokens`);
console.log(`    Restante:  ${budget.totalRemaining()} tokens`);
console.log(`    Pode caber 10K em knowledge? ${budget.canFit("knowledge", 10000) ? "Sim" : "Não"}`);

// ══════════════════════════════════════════════════
// 7. Status final
// ══════════════════════════════════════════════════

console.log("\n── Status Final ──\n");
console.log(`  Histórico:      ${historyStore.count()} entradas`);
console.log(`  Memória total:  ${memoryStore.count()} entradas`);
console.log(`    Fatos:        ${memoryStore.count("fact")}`);
console.log(`    Episódico:    ${memoryStore.count("episodic")}`);
console.log(`    Procedural:   ${memoryStore.count("procedural")}`);
console.log(`    Experiencial: ${memoryStore.count("experiential")}`);
console.log(`    Usuário:      ${memoryStore.count("user")}`);
console.log(`  Scratchpad:     ${scratchpadStore.count()} entradas`);

const recentTx = txLog.getRecent(5);
console.log(`\n  Últimas ${recentTx.length} transações:`);
for (const tx of recentTx) {
  console.log(`    ${tx.operation.padEnd(8)} | ${tx.path} | ${tx.status}`);
}

db.close();
console.log("\n═══ Exemplo completo! ═══\n");
