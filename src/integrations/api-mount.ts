/**
 * Mount REST/OpenAPI endpoints as AFS nodes.
 * API responses become readable context in the namespace.
 */

import type { AFSNode, ReadResult, Resolver } from "../afs/resolver.js";
import { createMetadata, estimateTokens } from "../afs/metadata.js";

export interface APIEndpoint {
  name: string;
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  description?: string;
}

export class APIResolver implements Resolver {
  name: string;
  private endpoints: Map<string, APIEndpoint> = new Map();
  private cache: Map<string, { content: string; timestamp: number }> =
    new Map();
  private cacheTtlMs: number;

  constructor(
    name: string,
    endpoints: APIEndpoint[],
    cacheTtlMs: number = 60_000
  ) {
    this.name = name;
    this.cacheTtlMs = cacheTtlMs;
    for (const ep of endpoints) {
      this.endpoints.set(ep.name, ep);
    }
  }

  async list(): Promise<AFSNode[]> {
    return Array.from(this.endpoints.values()).map((ep) => ({
      path: `/${ep.name}`,
      type: "executable" as const,
      metadata: createMetadata({
        author: "system",
        provenance: `api:${this.name}:${ep.url}`,
        tags: ["api", ep.method.toLowerCase()],
      }),
      resolver: this.name,
    }));
  }

  async read(relativePath: string): Promise<ReadResult> {
    const epName = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;
    const ep = this.endpoints.get(epName);
    if (!ep) throw new Error(`API endpoint not found: ${epName}`);

    // Check cache
    const cached = this.cache.get(epName);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return {
        content: cached.content,
        metadata: createMetadata({
          provenance: `api:${this.name}:${ep.url}`,
          tokenEstimate: estimateTokens(cached.content),
          tags: ["api", "cached"],
        }),
      };
    }

    // Fetch
    const response = await fetch(ep.url, {
      method: ep.method,
      headers: ep.headers,
    });
    const content = await response.text();

    this.cache.set(epName, { content, timestamp: Date.now() });

    return {
      content,
      metadata: createMetadata({
        provenance: `api:${this.name}:${ep.url}`,
        tokenEstimate: estimateTokens(content),
        tags: ["api", "fresh"],
      }),
    };
  }

  async write(): Promise<void> {
    throw new Error("API endpoints are read-only via write. Use exec for POST/PUT.");
  }

  async search(query: string): Promise<AFSNode[]> {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.endpoints.values())
      .filter(
        (ep) =>
          ep.name.toLowerCase().includes(lowerQuery) ||
          (ep.description?.toLowerCase().includes(lowerQuery) ?? false)
      )
      .map((ep) => ({
        path: `/${ep.name}`,
        type: "executable" as const,
        metadata: createMetadata({
          provenance: `api:${this.name}:${ep.url}`,
          tags: ["api"],
        }),
        resolver: this.name,
      }));
  }

  async exec(
    relativePath: string,
    args?: Record<string, unknown>
  ): Promise<unknown> {
    const epName = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;
    const ep = this.endpoints.get(epName);
    if (!ep) throw new Error(`API endpoint not found: ${epName}`);

    const response = await fetch(ep.url, {
      method: ep.method,
      headers: {
        "Content-Type": "application/json",
        ...ep.headers,
      },
      body: args ? JSON.stringify(args) : undefined,
    });

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    const epName = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;
    return this.endpoints.has(epName);
  }
}
