# Getting Started — A Real Walkthrough

This walks you through a concrete scenario: you're working on a project and want your LLM to remember things between sessions, find relevant docs automatically, and stop wasting tokens on irrelevant context.

## 1. Install

```bash
# Prerequisites: Node.js v18+
node -v  # should print v18.x or higher

# Clone and setup
git clone https://github.com/edwardmonteiro/Filesattention-.git
cd Filesattention-
npm install
npx tsc
node dist/index.js init
```

That creates `data/afs.sqlite` — a single file that holds all your context.

## 2. Teach it about your project

Say you're working on a web app. Tell AFS about it:

```bash
# Key architectural decisions
node dist/index.js memory add -t fact \
  -k "arch:frontend" \
  -v "React 18 with TypeScript, Vite for bundling, Tailwind for styling"

node dist/index.js memory add -t fact \
  -k "arch:api" \
  -v "REST API on Express, authentication via JWT stored in httpOnly cookies"

node dist/index.js memory add -t fact \
  -k "arch:database" \
  -v "PostgreSQL with Prisma ORM, migrations in prisma/migrations/"

# Conventions your team follows
node dist/index.js memory add -t fact \
  -k "convention:naming" \
  -v "React components use PascalCase files. API routes use kebab-case. DB columns use snake_case."

node dist/index.js memory add -t fact \
  -k "convention:testing" \
  -v "Unit tests with Vitest, E2E with Playwright. Test files next to source as *.test.ts"

# Known gotchas
node dist/index.js memory add -t fact \
  -k "gotcha:auth-refresh" \
  -v "Token refresh endpoint returns 401 if called within 10s of previous refresh. Add debounce."

node dist/index.js memory add -t fact \
  -k "gotcha:prisma-enums" \
  -v "Prisma enums must be re-generated after schema change: npx prisma generate"
```

Check what you've stored:

```bash
node dist/index.js memory list -t fact
```

## 3. Store your preferences

```bash
node dist/index.js memory add -t user \
  -k "pref:language" \
  -v "Portuguese for comments and docs, English for code"

node dist/index.js memory add -t user \
  -k "pref:style" \
  -v "Direct answers. Show code first, explain after. No emoji."
```

## 4. Record what you've done (episodic memory)

After a work session, save what happened:

```bash
node dist/index.js memory add -t episodic \
  -k "session:2025-03-08:auth-bug" \
  -v "Fixed JWT refresh race condition. Root cause: concurrent requests both triggered refresh, second one got 401. Solution: added mutex lock on refresh function with 10s cooldown."

node dist/index.js memory add -t episodic \
  -k "session:2025-03-09:search-feature" \
  -v "Implemented full-text search on products table. Used PostgreSQL tsvector with GIN index. Performance: 2ms for 100K rows. Need to add index on categories next."
```

Now in your next session, search for relevant context:

```bash
node dist/index.js memory search "JWT"
# Found 2 results:
#   [fact] gotcha:auth-refresh: Token refresh endpoint returns 401 if...
#   [episodic] session:2025-03-08:auth-bug: Fixed JWT refresh race condition...

node dist/index.js memory search "search"
# Found 1 results:
#   [episodic] session:2025-03-09:search-feature: Implemented full-text search...
```

The model no longer starts from zero. It can see what you already tried and what worked.

## 5. Index your docs for retrieval

If you have markdown docs, code comments, or any text files:

```bash
# Index entire directories
node dist/index.js index ./docs ./src/README.md

# Now those documents are chunked and searchable
```

## 6. Use it in your code

Here's how you'd wire this into a script that calls Claude:

```typescript
import Database from "better-sqlite3";
import Anthropic from "@anthropic-ai/sdk";
import { MemoryStore } from "./src/repository/memory.js";
import { TokenBudget, estimateTokenCount } from "./src/llm/token-budget.js";

// Open the database
const db = new Database("./data/afs.sqlite");
const memory = new MemoryStore(db);

// User's question
const userQuestion = "How should I add pagination to the products API?";

// Find relevant context
const relevantFacts = memory.search("API");
const relevantEpisodic = memory.search("products");
const preferences = memory.search("pref:", "user");

// Build context within budget
const budget = new TokenBudget(128_000);
budget.configureForTask("code_generation");

let contextBlock = "";

// Add facts
for (const fact of relevantFacts) {
  const tokens = estimateTokenCount(fact.value);
  if (budget.canFit("memory", tokens)) {
    budget.use("memory", tokens);
    contextBlock += `- ${fact.key}: ${fact.value}\n`;
  }
}

// Add session history
for (const episode of relevantEpisodic) {
  const tokens = estimateTokenCount(episode.value);
  if (budget.canFit("memory", tokens)) {
    budget.use("memory", tokens);
    contextBlock += `- Previous work: ${episode.value}\n`;
  }
}

// Add preferences
const prefText = preferences.map(p => p.value).join(". ");

// Call Claude with structured context
const anthropic = new Anthropic();
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 4096,
  system: `You are a senior developer helping with a web application.

## User Preferences
${prefText}

## Project Context
${contextBlock}`,
  messages: [{ role: "user", content: userQuestion }],
});

console.log(response.content[0].type === "text" ? response.content[0].text : "");

// Save this interaction for next time
memory.createFromText(
  "episodic",
  `session:${new Date().toISOString().split("T")[0]}:pagination`,
  `Asked about adding pagination to products API. Used offset/limit pattern with Prisma.`,
  { createdBy: "agent" }
);

db.close();
```

The difference: instead of a bare "add pagination to my API" prompt, the model sees your tech stack, conventions, previous search implementation work, and known gotchas — automatically.

## 7. Maintenance

```bash
# See what's in the system
node dist/index.js status

# Remove duplicate memories
node dist/index.js consolidate

# Check the audit trail
node dist/index.js log
```

## Common Patterns

**Before each LLM session:** query relevant memories and inject them as system context.

**After each LLM session:** save a one-line summary as episodic memory. This compounds — after 20 sessions, the model has real project history.

**When onboarding a teammate:** they clone the repo, run `setup.sh`, and the model already knows the project conventions.

**When debugging:** search episodic memory for similar past issues. "We hit this before" is now searchable.

## Next Steps

- Run `npx tsx examples/basic-usage.ts` to see all features in action
- Run `npx tsx examples/rag-pipeline.ts` to see the full retrieval pipeline
- Read the source — it's ~2500 lines total, well-typed TypeScript
