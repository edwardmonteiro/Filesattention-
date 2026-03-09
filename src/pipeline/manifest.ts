/**
 * Context manifest generation and logging.
 * The manifest is the audit trail — every reasoning session is reconstructable.
 */

import { v4 as uuidv4 } from "uuid";

export interface ContextManifest {
  id: string;
  timestamp: string;
  taskDescription: string;
  selected: Array<{
    path: string;
    relevanceScore: number;
    tokenCount: number;
    reason: string;
  }>;
  excluded: Array<{
    path: string;
    relevanceScore: number;
    reason: string;
  }>;
  totalTokens: number;
  budgetUtilization: number;
  compressionApplied: Array<{
    path: string;
    originalTokens: number;
    compressedTokens: number;
    method: "summary" | "truncation" | "extraction";
  }>;
}

export function createManifest(
  taskDescription: string,
  partial?: Partial<ContextManifest>
): ContextManifest {
  return {
    id: partial?.id ?? uuidv4(),
    timestamp: partial?.timestamp ?? new Date().toISOString(),
    taskDescription,
    selected: partial?.selected ?? [],
    excluded: partial?.excluded ?? [],
    totalTokens: partial?.totalTokens ?? 0,
    budgetUtilization: partial?.budgetUtilization ?? 0,
    compressionApplied: partial?.compressionApplied ?? [],
  };
}

export function addSelected(
  manifest: ContextManifest,
  path: string,
  relevanceScore: number,
  tokenCount: number,
  reason: string
): void {
  manifest.selected.push({ path, relevanceScore, tokenCount, reason });
  manifest.totalTokens += tokenCount;
}

export function addExcluded(
  manifest: ContextManifest,
  path: string,
  relevanceScore: number,
  reason: string
): void {
  manifest.excluded.push({ path, relevanceScore, reason });
}

export function addCompression(
  manifest: ContextManifest,
  path: string,
  originalTokens: number,
  compressedTokens: number,
  method: "summary" | "truncation" | "extraction"
): void {
  manifest.compressionApplied.push({
    path,
    originalTokens,
    compressedTokens,
    method,
  });
}

export function finalizeManifest(
  manifest: ContextManifest,
  totalBudget: number
): ContextManifest {
  manifest.budgetUtilization =
    totalBudget > 0 ? manifest.totalTokens / totalBudget : 0;
  return manifest;
}

export function serializeManifest(manifest: ContextManifest): string {
  return JSON.stringify(manifest, null, 2);
}
