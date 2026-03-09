/**
 * Metadata schema and operations for AFS nodes.
 * Every piece of context carries provenance, confidence, and lifecycle metadata.
 */

export interface AFSMetadata {
  createdAt: string;
  updatedAt: string;
  author: "agent" | "human" | "system";
  provenance: string;
  confidence: number;
  accessScope: string[];
  tokenEstimate: number;
  version: number;
  tags: string[];
}

export function createMetadata(partial?: Partial<AFSMetadata>): AFSMetadata {
  const now = new Date().toISOString();
  return {
    createdAt: partial?.createdAt ?? now,
    updatedAt: partial?.updatedAt ?? now,
    author: partial?.author ?? "system",
    provenance: partial?.provenance ?? "unknown",
    confidence: partial?.confidence ?? 1.0,
    accessScope: partial?.accessScope ?? ["*"],
    tokenEstimate: partial?.tokenEstimate ?? 0,
    version: partial?.version ?? 1,
    tags: partial?.tags ?? [],
  };
}

export function updateMetadata(
  existing: AFSMetadata,
  updates: Partial<AFSMetadata>
): AFSMetadata {
  return {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
    version: existing.version + 1,
  };
}

export function serializeMetadata(meta: AFSMetadata): string {
  return JSON.stringify(meta);
}

export function deserializeMetadata(raw: string): AFSMetadata {
  return JSON.parse(raw) as AFSMetadata;
}

export function estimateTokens(text: string): number {
  // Rough approximation: ~4 chars per token for English text
  return Math.ceil(text.length / 4);
}
