# AFS Local — Context Engineering for LLMs

## The Problem

You're using Claude, GPT, or another LLM. You paste in some code, some docs, maybe a previous conversation. The model gives a decent answer — but not a great one. Why?

Because **you're managing context by hand**. Copy-pasting. Hoping the right information fits. Losing track of what the model already knows. Every session starts from zero.

This is the same problem every team hits:

- **Context gets stale.** You told the model about your architecture three sessions ago. Now it's forgotten.
- **Token windows fill up with noise.** You dump 50K tokens of docs when the model only needed 3 paragraphs.
- **No memory between sessions.** Every conversation is a blank slate.
- **No audit trail.** You can't reconstruct why the model gave a particular answer.

## What This Does

AFS Local is a **local context management system** that sits between your files and your LLM. It:

1. **Remembers things** — facts, preferences, past sessions, tool schemas — in a structured SQLite database
2. **Selects what matters** — when you ask a question, it picks the most relevant context and fits it within the token budget
3. **Tracks everything** — every read, write, and decision is logged so you can see exactly what context produced what answer
4. **Mounts anything** — local directories, documents, REST APIs all appear as searchable context sources

Think of it as a **local knowledge base with a token-aware retrieval pipeline**. No cloud. No API keys needed for the storage layer. Just SQLite and your filesystem.

## Who This Is For

- Developers building tools on top of LLMs who need structured context management
- Anyone doing repeated LLM work on the same codebase/project and tired of re-explaining context
- Teams exploring [context engineering](https://www.anthropic.com/research/building-effective-agents) as described in recent research (Xu et al., 2025)

## Quick Start (Linux/macOS)

**Prerequisites:** Node.js v18+

### Option A: One-command setup

```bash
git clone https://github.com/edwardmonteiro/Filesattention-.git
cd Filesattention-
chmod +x setup.sh && ./setup.sh
```

This installs dependencies, builds, runs tests, initializes the database, and loads example data.

### Option B: Manual setup

```bash
git clone https://github.com/edwardmonteiro/Filesattention-.git
cd Filesattention-
npm install
npx tsc                          # compile
node dist/index.js init          # create database in ./data/
```

### Verify it works

```bash
node dist/index.js status
```

You should see:

```
=== AFS Status ===
History entries: 0
Memory entries: 0
  Facts: 0
  ...
```

## How to Use It

### 1. Store knowledge the model should remember

```bash
# Add facts
node dist/index.js memory add -t fact \
  -k "stack:backend" \
  -v "Backend uses Express + TypeScript + Prisma with PostgreSQL"

node dist/index.js memory add -t fact \
  -k "convention:errors" \
  -v "All API errors return {code, message, details} shape, never raw strings"

# Add user preferences
node dist/index.js memory add -t user \
  -k "pref:style" \
  -v "Prefer concise answers with code examples, no lengthy explanations"

# Add procedural knowledge (tool schemas, workflows)
node dist/index.js memory add -t procedural \
  -k "deploy:staging" \
  -v "To deploy: run npm test, then npm run build, then ./scripts/deploy.sh staging"
```

### 2. Search what's stored

```bash
node dist/index.js memory search "backend"
# Found 1 results:
#   [fact] stack:backend: Backend uses Express + TypeScript + Prisma...

node dist/index.js memory list -t fact
node dist/index.js memory list -t user
```

### 3. Mount local directories as searchable context

```bash
# Mount your source code
node dist/index.js mount ./src -n "source-code"

# Mount documentation
node dist/index.js mount ./docs -n "documentation"
```

### 4. Index documents for retrieval (RAG)

```bash
# Chunk and index documents for keyword search
node dist/index.js index ./docs ./README.md
```

### 5. Check the audit trail

```bash
# See what happened
node dist/index.js log

# Output:
#   2025-03-09T... | write    | /context/memory/... | success
#   2025-03-09T... | mount    | /context/knowledge/source-code | success

# Clean up duplicates
node dist/index.js consolidate
```

## Using It Programmatically

The CLI is just a thin wrapper. The real power is in the TypeScript API.

### Basic: store and retrieve memories

```typescript
import Database from "better-sqlite3";
import { MemoryStore } from "./src/repository/memory.js";

const db = new Database("./data/afs.sqlite");
const memory = new MemoryStore(db);

// Store a fact
memory.createFromText(
  "fact",
  "api:rate-limit",
  "Rate limit is 100 requests/minute per API key",
  { createdBy: "human" }
);

// Search
const results = memory.search("rate limit");
console.log(results[0].value);
// → "Rate limit is 100 requests/minute per API key"
```

### Token budget: decide what fits

```typescript
import { TokenBudget } from "./src/llm/token-budget.js";

const budget = new TokenBudget(128_000); // Claude's context window
budget.configureForTask("code_generation");

// See how much room you have
console.log(budget.summary());
// → { instructions: { budget: 12800, used: 0, remaining: 12800 },
//     memory:       { budget: 12800, used: 0, remaining: 12800 },
//     tools:        { budget: 32000, used: 0, remaining: 32000 },
//     ... }

// Track what you're putting in the context
budget.use("memory", 500);
budget.use("knowledge", 3000);

// Check before adding more
if (budget.canFit("knowledge", 10_000)) {
  // add it
}
```

### RAG pipeline: chunk, index, search local docs

```typescript
import { RAGResolver } from "./src/integrations/rag-mount.js";

const rag = new RAGResolver("my-docs", {
  documentPaths: ["./docs", "./README.md"],
  chunkSize: 512,
  chunkOverlap: 50,
});

await rag.index();                            // chunk all documents
const results = await rag.search("deploy");   // keyword search
const content = await rag.read(results[0].path); // get the chunk
```

### Full pipeline: build context for an LLM call

See [`examples/rag-pipeline.ts`](examples/rag-pipeline.ts) for a complete working example that:
1. Indexes local documents
2. Searches for relevant chunks
3. Allocates a token budget
4. Assembles a prompt with memory + knowledge context
5. Produces an audit manifest showing exactly what was selected and why

Run it:
```bash
npx tsx examples/rag-pipeline.ts
```

## Architecture (the short version)

```
Your files/docs/APIs
        │
        ▼
┌─────────────────────┐
│  Virtual File System │  ← Unified namespace: /context/memory/..., /context/knowledge/...
│  (mount anything)    │     SQLite, filesystem, REST APIs, MCP servers
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Repository          │  ← Three layers:
│                      │     History  (immutable log of everything)
│                      │     Memory   (structured facts, sessions, preferences)
│                      │     Scratchpad (temporary task workspace)
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Pipeline            │  ← Constructor: pick relevant context within token budget
│                      │     Updater: refresh context during multi-turn sessions
│                      │     Evaluator: validate outputs, detect hallucinations
└────────┬────────────┘
         │
         ▼
    LLM prompt
    (only what matters, with audit trail)
```

**Storage:** Everything lives in a single SQLite file (`data/afs.sqlite`). Portable, no server, works offline.

**Memory types:**
| Type | What it stores | Example |
|------|---------------|---------|
| `fact` | Atomic knowledge | "API rate limit is 100/min" |
| `episodic` | Session summaries | "Debugged auth flow, found token expiry bug" |
| `procedural` | How-to / tool schemas | "Deploy: test → build → deploy.sh" |
| `experiential` | What worked/failed | "Retry with backoff fixed the timeout issue" |
| `user` | Preferences | "Prefers concise answers with code examples" |

## Project Structure

```
src/
├── afs/           Core VFS: namespace, metadata, access control, transaction log
├── repository/    Storage: history, memory, scratchpad, lifecycle management
├── pipeline/      Context engineering: constructor, updater, evaluator, manifest
├── memory-types/  Typed wrappers: fact, episodic, procedural, experiential, user
├── integrations/  Mounts: filesystem, MCP servers, REST APIs, RAG
├── llm/           Token budget, prompt assembly, Anthropic client wrapper
└── index.ts       CLI
```

## Running Tests

```bash
npm test              # 8 tests across constructor, evaluator, lifecycle
npm run test:watch    # watch mode
```

## Development

```bash
npm run dev -- status              # run without compiling (uses tsx)
npm run dev -- memory search "x"   # any CLI command via tsx
npx tsc --noEmit                   # type-check without building
```

## What This Is Not

- **Not an agent framework.** It doesn't call LLMs for you. It manages the context that goes *into* LLM calls.
- **Not a vector database.** It has basic keyword search + optional embeddings. For heavy semantic search, use a real vector DB and mount it via the integration layer.
- **Not production-ready.** This is a working prototype for exploring context engineering patterns locally. The APIs will change.

## Based On

The architecture follows the Agentic File System (AFS) design from *"Everything is Context"* (Xu et al., 2025), which argues that LLM reasoning quality is bounded by context quality, not model quality. A well-curated 30K-token context outperforms a sloppy 128K-token dump.
