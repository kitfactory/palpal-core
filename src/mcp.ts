import { createId, ensure } from "./errors";
import { JsonObject, McpCapabilitySummary } from "./types";
import { HostedMcpServer } from "./tools";

export interface McpServerConfig extends HostedMcpServer {
  server_id?: string;
}

export interface McpServerHandle {
  server_id: string;
  capabilities: McpCapabilitySummary[];
}

export class McpGateway {
  private readonly servers = new Map<string, McpServerConfig>();

  public async register(config: McpServerConfig): Promise<McpServerHandle> {
    ensure(config.url, "AGENTS-E-MCP-UNREACHABLE", "MCP server url is required.");
    const serverId = config.server_id ?? config.id ?? createId("mcp");
    this.servers.set(serverId, config);

    const capabilities = await this.introspect(serverId).catch(() => []);
    return {
      server_id: serverId,
      capabilities
    };
  }

  public async introspect(serverId: string): Promise<McpCapabilitySummary[]> {
    const server = this.servers.get(serverId);
    ensure(server, "AGENTS-E-MCP-UNREACHABLE", `MCP server is not registered: ${serverId}`);
    if (!server.listTools) {
      return [];
    }
    const capabilities = await server.listTools();
    ensure(Array.isArray(capabilities), "AGENTS-E-MCP-SCHEMA", "MCP tools/list must return an array.");
    return capabilities;
  }

  public async call(
    serverId: string,
    toolName: string,
    args: JsonObject
  ): Promise<unknown> {
    const server = this.servers.get(serverId);
    ensure(server, "AGENTS-E-MCP-UNREACHABLE", `MCP server is not registered: ${serverId}`);
    ensure(toolName, "AGENTS-E-MCP-EXEC", "toolName is required.");
    return server.callTool(toolName, args);
  }
}
