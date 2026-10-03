import { createRequire } from "node:module";
import { createAndroperatorLogger } from "../adapters/logger.js";
import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { createSessionDefaults } from "./session.js";
import { getMcpTools } from "./tools/index.js";

const require = createRequire(import.meta.url);

function createServerInfo(): { name: string; version: string } {
  const pkg = require("../../package.json") as { version?: string };
  return {
    name: "androperator",
    version: pkg.version ?? "0.0.0",
  };
}

export function createMcpServer(): Server {
  const logger = createAndroperatorLogger({ outputFormat: "json" }).child({
    event: "mcp.server",
  });
  const session = createSessionDefaults();
  const tools = getMcpTools(logger, session);
  const toolsByName = new Map(tools.map(tool => [tool.name, tool]));
  const server = new Server(createServerInfo(), {
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    // The rule matches tool dispatch by name, not a network request. The stdio MCP server dispatches the same validated device contracts as the local CLI.
    // nosemgrep: mcp-ssrf-typescript
    const tool = toolsByName.get(request.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }

    // The rule matches tool dispatch by name, not a network request. The stdio MCP server dispatches the same validated device contracts as the local CLI.
    // nosemgrep: mcp-ssrf-typescript
    return await tool.handler((request.params.arguments ?? {}) as Record<string, unknown>);
  });

  return server;
}

export async function runMcpStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  let shutdownRequested = false;
  const shutdown = async (exitCode?: number) => {
    if (shutdownRequested) {
      return;
    }
    shutdownRequested = true;
    try {
      await server.close();
    } finally {
      if (exitCode !== undefined) {
        process.exit(exitCode);
      }
    }
  };

  transport.onerror = (error) => {
    process.stderr.write(`[androperator:mcp] transport error: ${error.message}\n`);
    void shutdown(1);
  };
  transport.onclose = () => {
    resolveClosed();
  };

  await server.connect(transport);
  process.once("SIGINT", () => {
    void shutdown(0);
  });
  process.once("SIGTERM", () => {
    void shutdown(0);
  });

  await closed;
  await shutdown();
}
