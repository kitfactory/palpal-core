import { ensure } from "./errors";
import { JsonObject, McpCapabilitySummary, Tool } from "./types";

export interface FunctionToolDefinition {
  name: string;
  description: string;
  parameters?: JsonObject;
  execute(args: JsonObject): Promise<unknown> | unknown;
}

export interface HostedMcpServer {
  id?: string;
  url: string;
  listTools?: () => Promise<McpCapabilitySummary[]>;
  callTool(toolName: string, args: JsonObject): Promise<unknown> | unknown;
}

export interface HostedMcpToolOptions {
  name?: string;
  description?: string;
  requireApproval?: boolean;
  capabilities?: McpCapabilitySummary[];
}

export function tool(definition: FunctionToolDefinition): Tool {
  ensure(definition.name?.trim(), "AGENTS-E-SKILL-SCHEMA", "Tool name is required.");
  ensure(
    definition.description?.trim(),
    "AGENTS-E-SKILL-SCHEMA",
    "Tool description is required."
  );

  return {
    name: definition.name,
    description: definition.description,
    kind: "function",
    parameters: definition.parameters,
    execute: async (args) => definition.execute(args)
  };
}

export function hostedMcpTool(server: HostedMcpServer, options?: HostedMcpToolOptions): Tool {
  ensure(server.url?.trim(), "AGENTS-E-MCP-UNREACHABLE", "MCP server url is required.");

  const name = options?.name ?? `mcp.${server.id ?? "server"}`;
  const description = options?.description ?? `MCP bridge for ${server.url}`;
  const metadata: Record<string, unknown> = {
    server_id: server.id ?? server.url,
    server_url: server.url,
    require_approval: options?.requireApproval ?? true,
    capabilities: options?.capabilities ?? []
  };

  return {
    name,
    description,
    kind: "mcp",
    parameters: {
      type: "object",
      properties: {
        toolName: { type: "string" },
        args: { type: "object" }
      },
      required: ["toolName"]
    },
    metadata,
    execute: async (args) => {
      const toolName = typeof args.toolName === "string" ? args.toolName : "";
      const toolArgs = isJsonObject(args.args) ? args.args : {};
      ensure(toolName, "AGENTS-E-MCP-EXEC", "toolName is required for MCP tool execution.");
      return server.callTool(toolName, toolArgs);
    }
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return true;
}
