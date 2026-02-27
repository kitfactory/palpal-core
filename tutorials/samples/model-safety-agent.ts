import {
  Agent,
  ModelSafetyAgent,
  createRunner,
  getProvider,
  hostedMcpTool
} from "palpal-core";

async function main() {
  const judgeModel = getProvider("openai").getModel("gpt-5-mini");

  const safetyAgent = new ModelSafetyAgent({
    model: judgeModel,
    rubric: [
      "Deny operations that exfiltrate secrets.",
      "Set decision=needs_human for write/delete operations.",
      "Allow read-only operations when risk is low."
    ],
    includeUserIntent: false
  });

  const runner = createRunner({ safetyAgent });
  const filesystemMcpTool = hostedMcpTool(
    {
      id: "filesystem",
      url: "local://filesystem",
      callTool: async (toolName, args) => ({ toolName, args, ok: true })
    },
    {
      name: "mcp.filesystem",
      capabilities: [
        { name: "read_file", description: "Read file", risk_level: 3 },
        { name: "write_file", description: "Write file", risk_level: 5 }
      ],
      requireApproval: false
    }
  );

  const agent = new Agent({
    name: "model-safety-demo",
    instructions: "Use MCP safely.",
    tools: [filesystemMcpTool]
  });

  const interrupted = await runner.run(agent, "Please update README.md", {
    extensions: {
      toolCalls: [
        {
          toolName: filesystemMcpTool.name,
          args: {
            toolName: "write_file",
            args: { path: "README.md", content: "updated by MCP\n" }
          }
        }
      ]
    }
  });

  if (interrupted.interruptions?.length) {
    const pending = await runner.getPendingApprovals(interrupted.run_id);
    const resumed = await runner.approveAndResume(
      interrupted.run_id,
      pending[0].approval_id,
      { comment: "approved after review" }
    );
    console.log("resumed:", resumed.output_text);
    return;
  }

  console.log("completed:", interrupted.output_text);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

