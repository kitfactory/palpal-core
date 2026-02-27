import { promises as fs } from "node:fs";
import path from "node:path";
import {
  Agent,
  SafetyAgent,
  createRunner,
  hostedMcpTool
} from "palpal-core";

async function main() {
  const workspaceDir = path.resolve(process.cwd(), "tmp/mcp-fs-sample");
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(path.join(workspaceDir, "README.md"), "initial\n", "utf8");

  const capabilities = [
    { name: "list_dir", description: "List files in a directory", risk_level: 2 },
    { name: "read_file", description: "Read file content", risk_level: 3 },
    { name: "write_file", description: "Write file content", risk_level: 5 }
  ] as const;

  const filesystemMcpTool = hostedMcpTool(
    {
      id: "filesystem-local",
      url: "local://filesystem",
      listTools: async () => [...capabilities],
      callTool: async (toolName, args) => {
        switch (toolName) {
          case "list_dir": {
            const target = resolveSafePath(workspaceDir, String(args.path ?? "."));
            const entries = await fs.readdir(target, { withFileTypes: true });
            return entries.map((entry) => ({
              name: entry.name,
              kind: entry.isDirectory() ? "dir" : "file"
            }));
          }
          case "read_file": {
            const target = resolveSafePath(workspaceDir, String(args.path ?? ""));
            return await fs.readFile(target, "utf8");
          }
          case "write_file": {
            const target = resolveSafePath(workspaceDir, String(args.path ?? ""));
            const content = String(args.content ?? "");
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, content, "utf8");
            return { ok: true, path: path.relative(workspaceDir, target) };
          }
          default:
            throw new Error(`Unknown MCP tool: ${toolName}`);
        }
      }
    },
    {
      name: "mcp.filesystem",
      description: "Local filesystem MCP example",
      capabilities: [...capabilities]
    }
  );

  const safetyAgent = new SafetyAgent(async (_agent, request) => {
    if (request.tool_kind === "mcp" && request.args.toolName === "write_file") {
      return {
        decision: "needs_human",
        reason: "write_file must be approved by a human reviewer",
        risk_level: 5,
        policy_ref: "balanced"
      };
    }
    return {
      decision: "allow",
      reason: "read-only MCP operation",
      risk_level: 2,
      policy_ref: "balanced"
    };
  });

  const runner = createRunner({ safetyAgent });
  const agent = new Agent({
    name: "filesystem-safety-agent",
    instructions: "Use filesystem MCP safely.",
    tools: [filesystemMcpTool]
  });

  const interrupted = await runner.run(agent, "Read then update README.md safely", {
    extensions: {
      toolCalls: [
        {
          toolName: filesystemMcpTool.name,
          args: { toolName: "read_file", args: { path: "README.md" } }
        },
        {
          toolName: filesystemMcpTool.name,
          args: {
            toolName: "write_file",
            args: { path: "README.md", content: "updated by approved MCP call\n" }
          }
        }
      ]
    }
  });

  console.log("interrupted:", interrupted.output_text);
  console.log("executed tool calls before approval:", interrupted.tool_calls.length);

  const pending = await runner.getPendingApprovals(interrupted.run_id);
  const resumed = await runner.approveAndResume(interrupted.run_id, pending[0].approval_id, {
    comment: "approved for sample"
  });

  const finalText = await fs.readFile(path.join(workspaceDir, "README.md"), "utf8");
  console.log("resumed:", resumed.output_text);
  console.log("total tool calls:", resumed.tool_calls.length);
  console.log("final README.md:", JSON.stringify(finalText));
}

function resolveSafePath(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(root)) {
    throw new Error("Path escape is not allowed.");
  }
  return target;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

