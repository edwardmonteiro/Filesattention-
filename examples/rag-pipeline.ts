#!/usr/bin/env npx tsx
/**
 * Exemplo de pipeline RAG com AFS Local.
 *
 * Demonstra:
 * 1. Indexação de documentos locais (chunking)
 * 2. Busca por keyword nos chunks
 * 3. Construção de contexto com budget
 * 4. Montagem do prompt final via PromptSchema
 *
 * Rodar: npx tsx examples/rag-pipeline.ts
 */

import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";

import { VirtualFileSystem } from "../src/afs/vfs.js";
import { AccessControl } from "../src/afs/access-control.js";
import { TransactionLog } from "../src/afs/transaction-log.js";
import { MemoryStore } from "../src/repository/memory.js";
import { RAGResolver } from "../src/integrations/rag-mount.js";
import { TokenBudget, estimateTokenCount } from "../src/llm/token-budget.js";
import { PromptSchema } from "../src/llm/prompt-schema.js";
import {
  createManifest,
  addSelected,
  finalizeManifest,
  serializeManifest,
} from "../src/pipeline/manifest.js";

console.log("═══ AFS Local — Pipeline RAG ═══\n");

// ──────────────────────────────────────────────
// 1. Setup
// ──────────────────────────────────────────────

const db = new Database(":memory:");
const acl = new AccessControl();
const txLog = new TransactionLog(db);
const vfs = new VirtualFileSystem(acl, txLog);
const memoryStore = new MemoryStore(db);

// ──────────────────────────────────────────────
// 2. Criar documentos de exemplo para indexar
// ──────────────────────────────────────────────

const tmpDir = path.join("/tmp", "afs-rag-example");
fs.mkdirSync(tmpDir, { recursive: true });

fs.writeFileSync(
  path.join(tmpDir, "arquitetura.md"),
  `# Arquitetura do AFS

O AFS (Agentic File System) é um sistema de arquivos virtual que unifica
fontes heterogêneas de contexto sob um namespace hierárquico único.

## Camadas

### History (Histórico)
Log imutável de todas as interações. Cada input, output, chamada de ferramenta
e resultado é registrado com timestamps e metadados completos.
Nunca deletar, nunca atualizar. Comprimir entradas antigas via sumarização.

### Memory (Memória)
Visões estruturadas derivadas do histórico. Cinco tipos coexistem:
- Fatos: declarações atômicas (key-value/triples)
- Episódica: resumos de sessão e casos
- Procedural: definições de ferramentas e schemas
- Experiencial: trajetórias de observação-ação
- Usuário: preferências e perfis

### Scratchpad (Rascunho)
Workspace temporário para raciocínio em progresso. Escopo limitado a uma tarefa.
Após conclusão, entradas relevantes são promovidas para Memory ou arquivadas.

## Pipeline de Contexto

O pipeline tem três estágios:
1. Constructor: seleciona e prioriza contexto dentro do budget de tokens
2. Updater: injeta e atualiza contexto na janela de tokens durante a sessão
3. Evaluator: valida outputs, detecta alucinações, e escreve de volta no repositório
`
);

fs.writeFileSync(
  path.join(tmpDir, "token-budget.md"),
  `# Token Budget

O token budget é a restrição fundamental que governa toda a arquitetura.

## Alocação por Tipo de Tarefa

| Tipo              | Instruções | Memória | Tools | History | Knowledge | Reserva |
|-------------------|------------|---------|-------|---------|-----------|---------|
| Code generation   | 10%        | 10%     | 25%   | 20%     | 15%       | 20%     |
| Analysis          | 10%        | 20%     | 10%   | 15%     | 25%       | 20%     |
| Conversation      | 10%        | 15%     | 10%   | 35%     | 10%       | 20%     |
| Doc processing    | 10%        | 10%     | 10%   | 10%     | 40%       | 20%     |

## Estratégia de Compressão

Quando o budget está apertado:
1. Documentos longos: sumarizar com Haiku (barato e rápido)
2. Conversas: extrair apenas os turnos chave
3. Fatos: sem compressão (já são atômicos)

## Contagem de Tokens

A contagem deve ser precisa. Usar tiktoken ou @anthropic-ai/tokenizer.
Aproximação: ~4 caracteres por token para inglês, ~3 para código.
`
);

fs.writeFileSync(
  path.join(tmpDir, "mcp-integration.md"),
  `# Integração MCP

Qualquer servidor MCP se monta como módulo AFS de primeira classe.

## Como Funciona

1. Iniciar processo do servidor MCP
2. Descobrir ferramentas disponíveis via protocolo MCP
3. Para cada ferramenta, criar nó executável no AFS
4. Registrar handler que traduz AFS exec → MCP tool call
5. Logar evento de montagem no transaction log

## Exemplos de Montagem

- File system: montar diretórios locais como conhecimento pesquisável
- Git: montar repositório para contexto de código
- Obsidian: montar vault de notas como conhecimento recuperável
- Browser: montar para capacidade de busca web
- Database: montar SQLite/Postgres para queries em dados estruturados
`
);

console.log(`✓ ${3} documentos criados em ${tmpDir}\n`);

// ──────────────────────────────────────────────
// 3. Indexar documentos (chunking)
// ──────────────────────────────────────────────

console.log("── Indexação ──\n");

const rag = new RAGResolver("docs", {
  documentPaths: [tmpDir],
  chunkSize: 100,      // chunks pequenos para demo
  chunkOverlap: 20,
  vectorStorePath: "/tmp/afs-vectors",
});

const chunkCount = await rag.index();
console.log(`  ${chunkCount} chunks indexados`);

// Montar no VFS
vfs.mount("/context/knowledge/docs", rag);

// ──────────────────────────────────────────────
// 4. Buscar chunks relevantes
// ──────────────────────────────────────────────

console.log("\n── Busca ──\n");

const query = "como funciona o token budget e alocação";
console.log(`  Query: "${query}"\n`);

const searchResults = await rag.search(query);
console.log(`  ${searchResults.length} chunks encontrados:\n`);

for (const result of searchResults.slice(0, 5)) {
  const content = await rag.read(result.path);
  const preview = content.content.slice(0, 120).replace(/\n/g, " ");
  console.log(`    [score: ${result.metadata.confidence.toFixed(2)}] ${preview}...`);
}

// ──────────────────────────────────────────────
// 5. Construir contexto com budget
// ──────────────────────────────────────────────

console.log("\n── Construção de Contexto ──\n");

const budget = new TokenBudget(8000); // budget pequeno para demo
budget.configureForTask("analysis");
const manifest = createManifest(query);

// Adicionar memórias relevantes
memoryStore.createFromText(
  "fact",
  "budget:principio",
  "O token budget governa toda alocação de contexto no pipeline",
  { createdBy: "human" }
);

const memories = memoryStore.search("token budget");
for (const mem of memories) {
  const tokens = estimateTokenCount(mem.value);
  if (budget.canFit("memory", tokens)) {
    budget.use("memory", tokens);
    addSelected(manifest, `/context/memory/${mem.key}`, 0.9, tokens, "Memória relevante ao query");
  }
}

// Adicionar chunks RAG
const resolvedContent = new Map<string, string>();
for (const result of searchResults.slice(0, 3)) {
  const content = await rag.read(result.path);
  const tokens = estimateTokenCount(content.content);
  if (budget.canFit("knowledge", tokens)) {
    budget.use("knowledge", tokens);
    const fullPath = `/context/knowledge/docs${result.path}`;
    addSelected(
      manifest,
      fullPath,
      result.metadata.confidence,
      tokens,
      "Chunk RAG com alta relevância"
    );
    resolvedContent.set(fullPath, content.content);
  }
}

const finalManifest = finalizeManifest(manifest, 8000);

console.log(`  Tokens usados: ${budget.totalUsed()} / 8000`);
console.log(`  Utilização: ${(finalManifest.budgetUtilization * 100).toFixed(1)}%`);
console.log(`  Items selecionados: ${finalManifest.selected.length}`);

// ──────────────────────────────────────────────
// 6. Montar prompt final com PromptSchema
// ──────────────────────────────────────────────

console.log("\n── Prompt Montado ──\n");

// Add memory content to resolved content map
for (const mem of memories) {
  const key = `/context/memory/${mem.key}`;
  resolvedContent.set(key, `[${mem.type}] ${mem.key}: ${mem.value}`);
}

const promptSchema = new PromptSchema();
const assembled = promptSchema.assemble(
  finalManifest,
  resolvedContent,
  query,
  "Você é um assistente especializado em context engineering para LLMs."
);

console.log(`  Total tokens estimados: ${assembled.totalTokens}`);
console.log(`  Seções: ${assembled.sections.length}`);
for (const section of assembled.sections) {
  console.log(`    [${section.role}] ${section.tokenEstimate} tokens`);
}
console.log(`\n  System prompt (primeiros 200 chars):`);
console.log(`  ${assembled.systemPrompt.slice(0, 200)}...\n`);
if (assembled.contextBlock) {
  console.log(`  Context block (primeiros 300 chars):`);
  console.log(`  ${assembled.contextBlock.slice(0, 300).replace(/\n/g, "\n  ")}...\n`);
}

// ──────────────────────────────────────────────
// 7. Manifest (audit trail)
// ──────────────────────────────────────────────

console.log("── Manifest (Audit Trail) ──\n");
const manifestJson = serializeManifest(finalManifest);
console.log(manifestJson);

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });
db.close();

console.log("\n═══ Pipeline RAG completo! ═══\n");
