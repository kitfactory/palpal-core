import assert from "node:assert/strict";
import test from "node:test";
import {
  Agent,
  ApprovalController,
  AgentsError,
  McpGateway,
  SafetyAgent,
  createRunner,
  getProvider
} from "../src/index";

test("error categories are stable for major failure paths", async () => {
  const oldApiKey = process.env.OPENAI_API_KEY;
  const oldModel = process.env.AGENTS_OPENAI_MODEL;
  delete process.env.OPENAI_API_KEY;
  process.env.AGENTS_OPENAI_MODEL = "gpt-4.1-mini";

  assert.throws(() => getProvider("openai").getModel(), (error: unknown) => {
    assert.ok(error instanceof AgentsError);
    assert.equal(error.code, "AGENTS-E-PROVIDER-CONFIG");
    assert.equal(error.category, "provider");
    return true;
  });
  process.env.OPENAI_API_KEY = oldApiKey;
  process.env.AGENTS_OPENAI_MODEL = oldModel;

  const safetyDenyRunner = createRunner({
    safetyAgent: new SafetyAgent(() => ({
      decision: "deny",
      reason: "blocked",
      risk_level: 5
    }))
  });
  const noToolAgent = new Agent({
    name: "deny-agent",
    instructions: "deny",
    tools: []
  });

  await assert.rejects(
    () =>
      safetyDenyRunner.run(noToolAgent, "deny", {
        extensions: {
          toolCalls: [{ toolName: "missing-tool", args: {} }]
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgentsError);
      assert.equal(error.code, "AGENTS-E-SKILL-NOT-FOUND");
      assert.equal(error.category, "skills");
      return true;
    }
  );

  const mcpGateway = new McpGateway();
  await assert.rejects(
    () => mcpGateway.introspect("missing-server"),
    (error: unknown) => {
      assert.ok(error instanceof AgentsError);
      assert.equal(error.code, "AGENTS-E-MCP-UNREACHABLE");
      assert.equal(error.category, "mcp");
      return true;
    }
  );

  const deniedRunner = createRunner({
    safetyAgent: new SafetyAgent(() => ({
      decision: "deny",
      reason: "danger",
      risk_level: 5
    }))
  });
  const deniedAgent = new Agent({
    name: "danger-agent",
    instructions: "danger",
    tools: [
      {
        name: "echo",
        description: "echo",
        kind: "function",
        execute: async (args) => args
      }
    ]
  });
  await assert.rejects(
    () =>
      deniedRunner.run(deniedAgent, "go", {
        extensions: { toolCalls: [{ toolName: "echo", args: { text: "x" } }] }
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgentsError);
      assert.equal(error.code, "AGENTS-E-GATE-DENIED");
      assert.equal(error.category, "safety");
      return true;
    }
  );

  assert.throws(
    () => new ApprovalController().consumeResumeToken("run-x", "token-x"),
    (error: unknown) => {
      assert.ok(error instanceof AgentsError);
      assert.equal(error.code, "AGENTS-E-RESUME-TOKEN");
      assert.equal(error.category, "approval");
      return true;
    }
  );
});
