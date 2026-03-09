/**
 * Prompt assembly from context manifest.
 * Structures the final prompt from selected context elements.
 */

import type { ContextManifest } from "../pipeline/manifest.js";

export interface PromptSection {
  role: "system" | "context" | "history" | "tools" | "knowledge" | "query";
  content: string;
  tokenEstimate: number;
}

export interface AssembledPrompt {
  systemPrompt: string;
  contextBlock: string;
  totalTokens: number;
  sections: PromptSection[];
}

export class PromptSchema {
  /**
   * Assemble a full prompt from a context manifest and resolved content.
   */
  assemble(
    manifest: ContextManifest,
    resolvedContent: Map<string, string>,
    query: string,
    systemInstructions?: string
  ): AssembledPrompt {
    const sections: PromptSection[] = [];
    let totalTokens = 0;

    // System instructions
    const systemContent =
      systemInstructions ??
      "You are a helpful assistant with access to structured context. Use the provided context to give accurate, well-grounded responses.";
    const systemTokens = Math.ceil(systemContent.length / 4);
    sections.push({
      role: "system",
      content: systemContent,
      tokenEstimate: systemTokens,
    });
    totalTokens += systemTokens;

    // Group selected items by category
    const grouped = this.groupByCategory(manifest, resolvedContent);

    // Add memory context
    if (grouped.memory.length > 0) {
      const memoryBlock = this.formatSection(
        "Relevant Memory",
        grouped.memory
      );
      const tokens = Math.ceil(memoryBlock.length / 4);
      sections.push({
        role: "context",
        content: memoryBlock,
        tokenEstimate: tokens,
      });
      totalTokens += tokens;
    }

    // Add tool definitions
    if (grouped.tools.length > 0) {
      const toolsBlock = this.formatSection(
        "Available Tools",
        grouped.tools
      );
      const tokens = Math.ceil(toolsBlock.length / 4);
      sections.push({
        role: "tools",
        content: toolsBlock,
        tokenEstimate: tokens,
      });
      totalTokens += tokens;
    }

    // Add knowledge context
    if (grouped.knowledge.length > 0) {
      const knowledgeBlock = this.formatSection(
        "Knowledge Context",
        grouped.knowledge
      );
      const tokens = Math.ceil(knowledgeBlock.length / 4);
      sections.push({
        role: "knowledge",
        content: knowledgeBlock,
        tokenEstimate: tokens,
      });
      totalTokens += tokens;
    }

    // Add history
    if (grouped.history.length > 0) {
      const historyBlock = this.formatSection(
        "Conversation History",
        grouped.history
      );
      const tokens = Math.ceil(historyBlock.length / 4);
      sections.push({
        role: "history",
        content: historyBlock,
        tokenEstimate: tokens,
      });
      totalTokens += tokens;
    }

    // Add query
    const queryTokens = Math.ceil(query.length / 4);
    sections.push({
      role: "query",
      content: query,
      tokenEstimate: queryTokens,
    });
    totalTokens += queryTokens;

    // Build final prompt blocks
    const contextBlock = sections
      .filter((s) => s.role !== "system" && s.role !== "query")
      .map((s) => s.content)
      .join("\n\n---\n\n");

    return {
      systemPrompt: systemContent,
      contextBlock,
      totalTokens,
      sections,
    };
  }

  private groupByCategory(
    manifest: ContextManifest,
    resolvedContent: Map<string, string>
  ): Record<string, Array<{ path: string; content: string; score: number }>> {
    const groups: Record<
      string,
      Array<{ path: string; content: string; score: number }>
    > = {
      memory: [],
      tools: [],
      knowledge: [],
      history: [],
    };

    for (const item of manifest.selected) {
      const content = resolvedContent.get(item.path) ?? "";
      const category = this.categorize(item.path);
      groups[category]?.push({
        path: item.path,
        content,
        score: item.relevanceScore,
      });
    }

    return groups;
  }

  private categorize(path: string): string {
    if (path.includes("/memory/")) return "memory";
    if (path.includes("/tools/")) return "tools";
    if (path.includes("/knowledge/")) return "knowledge";
    if (path.includes("/history/")) return "history";
    return "knowledge";
  }

  private formatSection(
    title: string,
    items: Array<{ path: string; content: string; score: number }>
  ): string {
    const header = `## ${title}\n`;
    const body = items
      .sort((a, b) => b.score - a.score)
      .map(
        (item) =>
          `### ${item.path} (relevance: ${item.score.toFixed(2)})\n${item.content}`
      )
      .join("\n\n");
    return header + body;
  }
}
