import { Agent, SafetyAgent, createRunner, hostedMcpTool, run, tool } from "../src/index";

const echoTool = tool({
  name: "echo",
  description: "echo input",
  execute: async (args) => args
});

const mcpTool = hostedMcpTool({
  url: "http://localhost:11434/v1",
  callTool: async (toolName, args) => ({ toolName, args })
});

const agent = new Agent({
  name: "compat-agent",
  instructions: "compat test",
  tools: [echoTool, mcpTool]
});

void run(agent, "hello");

const runner = createRunner({
  safetyAgent: new SafetyAgent(() => ({
    decision: "allow",
    reason: "ok",
    risk_level: 1
  }))
});

void runner.run(agent, "hello", {
  extensions: {
    toolCalls: [{ toolName: "echo", args: { message: "hi" } }]
  }
});
