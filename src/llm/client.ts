/**
 * Anthropic API client wrapper.
 * Provides LLM operations for context engineering pipeline.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface LLMConfig {
  apiKey?: string;
  reasoningModel: string;
  summaryModel: string;
  maxRetries: number;
}

const DEFAULT_CONFIG: LLMConfig = {
  reasoningModel: "claude-sonnet-4-20250514",
  summaryModel: "claude-haiku-4-5-20251001",
  maxRetries: 3,
};

export interface CompletionOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  model?: "reasoning" | "summary";
}

export class LLMClient {
  private client: Anthropic;
  private config: LLMConfig;

  constructor(config?: Partial<LLMConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = new Anthropic({
      apiKey: this.config.apiKey,
    });
  }

  /**
   * Generate a completion using the appropriate model.
   */
  async complete(
    prompt: string,
    options: CompletionOptions = {}
  ): Promise<string> {
    const model =
      options.model === "summary"
        ? this.config.summaryModel
        : this.config.reasoningModel;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: prompt },
    ];

    const response = await this.client.messages.create({
      model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0,
      system: options.system,
      messages,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock ? textBlock.text : "";
  }

  /**
   * Summarize text using the cheap/fast model (Haiku).
   */
  async summarize(text: string, maxLength?: number): Promise<string> {
    const prompt = maxLength
      ? `Summarize the following text in at most ${maxLength} tokens. Be concise and preserve key information:\n\n${text}`
      : `Summarize the following text concisely, preserving key information:\n\n${text}`;

    return this.complete(prompt, { model: "summary", temperature: 0 });
  }

  /**
   * Extract facts from text using the cheap/fast model.
   */
  async extractFacts(text: string): Promise<string[]> {
    const prompt = `Extract atomic factual statements from the following text. Return each fact on a new line, prefixed with "- ". Only include facts that are explicitly stated:\n\n${text}`;

    const response = await this.complete(prompt, {
      model: "summary",
      temperature: 0,
    });

    return response
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim());
  }

  /**
   * Classify the task type from a query.
   */
  async classifyTask(
    query: string
  ): Promise<"code_generation" | "analysis" | "conversation" | "document_processing"> {
    const prompt = `Classify the following query into exactly one category. Respond with ONLY the category name, nothing else.

Categories:
- code_generation: Writing, debugging, or modifying code
- analysis: Analyzing data, reasoning about problems, research
- conversation: General chat, Q&A, discussion
- document_processing: Summarizing, extracting from, or transforming documents

Query: ${query}`;

    const response = await this.complete(prompt, {
      model: "summary",
      maxTokens: 50,
      temperature: 0,
    });

    const normalized = response.trim().toLowerCase().replace(/[^a-z_]/g, "");
    const valid: Array<"code_generation" | "analysis" | "conversation" | "document_processing"> = [
      "code_generation",
      "analysis",
      "conversation",
      "document_processing",
    ];
    const matched = valid.find((v) => v === normalized);
    return matched ?? "conversation";
  }

  /**
   * Check factual consistency between a claim and source context.
   */
  async checkConsistency(
    claim: string,
    context: string
  ): Promise<{ consistent: boolean; confidence: number; explanation: string }> {
    const prompt = `Given the following context, determine if the claim is factually consistent.

Context:
${context}

Claim: ${claim}

Respond in JSON format: {"consistent": true/false, "confidence": 0.0-1.0, "explanation": "..."}`;

    const response = await this.complete(prompt, {
      model: "summary",
      temperature: 0,
    });

    try {
      return JSON.parse(response);
    } catch {
      return { consistent: false, confidence: 0, explanation: "Failed to parse response" };
    }
  }
}
