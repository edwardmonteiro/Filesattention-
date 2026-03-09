/**
 * Mount any MCP server as an AFS module.
 * Tools from the MCP server become AFS executable nodes.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AFSNode, ReadResult, Resolver } from "../afs/resolver.js";
import { createMetadata } from "../afs/metadata.js";
import type { VirtualFileSystem } from "../afs/vfs.js";

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export class MCPResolver implements Resolver {
  name: string;
  private client: Client;
  private transport: StdioClientTransport;
  private tools: MCPTool[] = [];
  private connected: boolean = false;

  constructor(name: string, config: MCPServerConfig) {
    this.name = name;
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env as Record<string, string> | undefined,
    });
    this.client = new Client(
      { name: `afs-${name}`, version: "0.1.0" },
      { capabilities: {} }
    );
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
    this.connected = true;

    // Discover tools
    const result = await this.client.listTools();
    this.tools = result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }

  async list(relativePath: string): Promise<AFSNode[]> {
    return this.tools.map((tool) => ({
      path: `/${tool.name}`,
      type: "executable" as const,
      metadata: createMetadata({
        author: "system",
        provenance: `mcp:${this.name}`,
        tags: ["tool", "mcp"],
      }),
      resolver: this.name,
    }));
  }

  async read(relativePath: string): Promise<ReadResult> {
    const toolName = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;
    const tool = this.tools.find((t) => t.name === toolName);

    if (!tool) throw new Error(`Tool not found: ${toolName}`);

    const content = JSON.stringify(
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      null,
      2
    );

    return {
      content,
      metadata: createMetadata({
        author: "system",
        provenance: `mcp:${this.name}`,
        tags: ["tool", "mcp"],
      }),
    };
  }

  async write(): Promise<void> {
    throw new Error("MCP tools are read-only");
  }

  async search(query: string): Promise<AFSNode[]> {
    const lowerQuery = query.toLowerCase();
    return this.tools
      .filter(
        (t) =>
          t.name.toLowerCase().includes(lowerQuery) ||
          (t.description?.toLowerCase().includes(lowerQuery) ?? false)
      )
      .map((tool) => ({
        path: `/${tool.name}`,
        type: "executable" as const,
        metadata: createMetadata({
          author: "system",
          provenance: `mcp:${this.name}`,
          tags: ["tool", "mcp"],
        }),
        resolver: this.name,
      }));
  }

  async exec(
    relativePath: string,
    args?: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.connected) throw new Error("MCP client not connected");

    const toolName = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;

    const result = await this.client.callTool({
      name: toolName,
      arguments: args ?? {},
    });

    return result;
  }

  async exists(relativePath: string): Promise<boolean> {
    const toolName = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;
    return this.tools.some((t) => t.name === toolName);
  }
}

/**
 * Mount an MCP server into the AFS.
 */
export async function mountMCP(
  vfs: VirtualFileSystem,
  mountPoint: string,
  config: MCPServerConfig
): Promise<MCPResolver> {
  const name = mountPoint.replace(/\//g, "-").replace(/^-/, "");
  const resolver = new MCPResolver(name, config);
  await resolver.connect();
  vfs.mount(mountPoint, resolver);
  return resolver;
}
