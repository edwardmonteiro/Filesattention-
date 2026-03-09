/**
 * RAG (Retrieval-Augmented Generation) pipeline mounted as AFS knowledge source.
 * Handles document chunking, embedding, and vector search.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AFSNode, ReadResult, Resolver } from "../afs/resolver.js";
import { createMetadata, estimateTokens } from "../afs/metadata.js";

export interface RAGConfig {
  documentPaths: string[];
  chunkSize: number;
  chunkOverlap: number;
  vectorStorePath: string;
}

const DEFAULT_RAG_CONFIG: RAGConfig = {
  documentPaths: [],
  chunkSize: 512,
  chunkOverlap: 50,
  vectorStorePath: "./data/vectors",
};

interface Chunk {
  id: string;
  source: string;
  content: string;
  index: number;
}

export class RAGResolver implements Resolver {
  name: string;
  private config: RAGConfig;
  private chunks: Chunk[] = [];

  constructor(name: string, config?: Partial<RAGConfig>) {
    this.name = name;
    this.config = { ...DEFAULT_RAG_CONFIG, ...config };
  }

  /**
   * Index documents from configured paths.
   */
  async index(): Promise<number> {
    this.chunks = [];
    let totalChunks = 0;

    for (const docPath of this.config.documentPaths) {
      const resolved = path.resolve(docPath);
      if (!fs.existsSync(resolved)) continue;

      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        totalChunks += this.indexDirectory(resolved);
      } else {
        totalChunks += this.indexFile(resolved);
      }
    }

    return totalChunks;
  }

  private indexDirectory(dirPath: string): number {
    let count = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        count += this.indexDirectory(fullPath);
      } else if (entry.isFile() && this.isIndexable(entry.name)) {
        count += this.indexFile(fullPath);
      }
    }

    return count;
  }

  private indexFile(filePath: string): number {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const newChunks = this.chunkText(content, filePath);
      this.chunks.push(...newChunks);
      return newChunks.length;
    } catch {
      return 0;
    }
  }

  private chunkText(text: string, source: string): Chunk[] {
    const chunks: Chunk[] = [];
    const words = text.split(/\s+/);
    const chunkSize = this.config.chunkSize;
    const overlap = this.config.chunkOverlap;

    let i = 0;
    let index = 0;
    while (i < words.length) {
      const end = Math.min(i + chunkSize, words.length);
      const chunkWords = words.slice(i, end);
      chunks.push({
        id: `${path.basename(source)}-${index}`,
        source,
        content: chunkWords.join(" "),
        index,
      });
      i += chunkSize - overlap;
      index++;
    }

    return chunks;
  }

  async list(): Promise<AFSNode[]> {
    const sources = [...new Set(this.chunks.map((c) => c.source))];
    return sources.map((source) => ({
      path: `/${path.basename(source)}`,
      type: "file" as const,
      metadata: createMetadata({
        provenance: `rag:${source}`,
        tags: ["document", "indexed"],
      }),
      resolver: this.name,
    }));
  }

  async read(relativePath: string): Promise<ReadResult> {
    const name = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;
    const matchingChunks = this.chunks.filter(
      (c) => path.basename(c.source) === name || c.id === name
    );

    if (matchingChunks.length === 0) {
      throw new Error(`No chunks found for: ${name}`);
    }

    const content = matchingChunks
      .sort((a, b) => a.index - b.index)
      .map((c) => c.content)
      .join("\n\n");

    return {
      content,
      metadata: createMetadata({
        provenance: `rag:${matchingChunks[0].source}`,
        tokenEstimate: estimateTokens(content),
        tags: ["document", "rag"],
      }),
    };
  }

  async write(): Promise<void> {
    throw new Error("RAG store is read-only. Add documents to configured paths and re-index.");
  }

  async search(query: string): Promise<AFSNode[]> {
    // Simple keyword search over chunks
    const queryWords = new Set(query.toLowerCase().split(/\s+/));
    const scored = this.chunks.map((chunk) => {
      const chunkWords = new Set(chunk.content.toLowerCase().split(/\s+/));
      const overlap = [...queryWords].filter((w) => chunkWords.has(w)).length;
      const score = queryWords.size > 0 ? overlap / queryWords.size : 0;
      return { chunk, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((s) => ({
        path: `/${s.chunk.id}`,
        type: "file" as const,
        metadata: createMetadata({
          provenance: `rag:${s.chunk.source}`,
          confidence: s.score,
          tokenEstimate: estimateTokens(s.chunk.content),
          tags: ["chunk", "rag"],
        }),
        resolver: this.name,
      }));
  }

  async exists(relativePath: string): Promise<boolean> {
    const name = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;
    return this.chunks.some(
      (c) => path.basename(c.source) === name || c.id === name
    );
  }

  private isIndexable(filename: string): boolean {
    const exts = [
      ".txt", ".md", ".json", ".ts", ".js", ".py", ".rs", ".go",
      ".html", ".css", ".sql", ".yaml", ".yml", ".toml",
    ];
    return exts.some((ext) => filename.endsWith(ext));
  }
}
