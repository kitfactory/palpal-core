import assert from "node:assert/strict";
import test from "node:test";
import {
  Agent,
  AgentsError,
  SafetyAgent,
  Tool,
  createGuardrailsTemplate,
  createRunner,
  hostedMcpTool,
  tool
} from "../src/index";

test("runner denies tool call when SafetyAgent returns deny", async () => {
  const denyAgent = new SafetyAgent((_agent, request) => {
    if (request.tool_name === "danger") {
      return {
        decision: "deny",
        reason: "danger is blocked",
        risk_level: 5
      };
    }
    return {
      decision: "allow",
      reason: "ok",
      risk_level: 1
    };
  });

  const runner = createRunner({ safetyAgent: denyAgent });
  const dangerTool = tool({
    name: "danger",
    description: "dangerous tool",
    execute: async () => ({ blocked: false })
  });
  const agent = new Agent({
    name: "test-agent",
    instructions: "test",
    tools: [dangerTool]
  });

  await assert.rejects(
    () =>
      runner.run(agent, "run danger", {
        extensions: {
          toolCalls: [{ toolName: "danger", args: {} }]
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgentsError);
      assert.equal(error.code, "AGENTS-E-GATE-DENIED");
      return true;
    }
  );
});

test("guardrails deny input before SafetyAgent evaluation", async () => {
  const runner = createRunner({
    safetyAgent: SafetyAgent.allowAll()
  });
  const agent = new Agent({
    name: "guardrail-agent",
    instructions: "guard",
    tools: [],
    guardrails: {
      input: [
        () => ({
          allow: false,
          reason: "blocked by input guardrail"
        })
      ]
    }
  });

  await assert.rejects(
    () => runner.run(agent, "hello"),
    (error: unknown) => {
      assert.ok(error instanceof AgentsError);
      assert.equal(error.code, "AGENTS-E-GUARDRAIL-DENIED");
      return true;
    }
  );
});

test("guardrails execute on input/tool/output stages", async () => {
  const stages: string[] = [];
  const runner = createRunner({
    safetyAgent: SafetyAgent.allowAll()
  });
  const echoTool = tool({
    name: "echo",
    description: "echo",
    execute: async (args) => args
  });

  const agent = new Agent({
    name: "guardrail-stages",
    instructions: "guard",
    tools: [echoTool],
    guardrails: {
      input: [
        () => {
          stages.push("input");
          return { allow: true };
        }
      ],
      tool: [
        () => {
          stages.push("tool");
          return { allow: true };
        }
      ],
      output: [
        () => {
          stages.push("output");
          return { allow: true };
        }
      ]
    }
  });

  const result = await runner.run(agent, "hi", {
    extensions: {
      toolCalls: [{ toolName: "echo", args: { text: "hi" } }]
    }
  });

  assert.equal(result.tool_calls.length, 1);
  assert.deepEqual(stages, ["input", "tool", "output"]);
});

test("guardrail template enforces static input/output while SafetyAgent owns tool decision", async () => {
  const echoTool = tool({
    name: "echo",
    description: "echo",
    execute: async (args) => ({ echoed: args.text ?? "" })
  });

  const denyToolSafety = new SafetyAgent((_agent, request) => {
    if (request.tool_name === "echo") {
      return {
        decision: "deny",
        reason: "tool blocked by safety",
        risk_level: 5
      };
    }
    return {
      decision: "allow",
      reason: "safe",
      risk_level: 1
    };
  });

  const runner = createRunner({ safetyAgent: denyToolSafety });
  const agent = new Agent({
    name: "template-agent",
    instructions: "test",
    tools: [echoTool],
    guardrails: createGuardrailsTemplate({
      inputRules: [
        {
          denyWhen: (text) => text.includes("forbidden-input"),
          reason: "input blocked"
        }
      ],
      outputRules: [
        {
          denyWhen: (text) => text.includes("forbidden-output"),
          reason: "output blocked"
        }
      ]
    })
  });

  await assert.rejects(
    () => runner.run(agent, "forbidden-input"),
    (error: unknown) => {
      assert.ok(error instanceof AgentsError);
      assert.equal(error.code, "AGENTS-E-GUARDRAIL-DENIED");
      return true;
    }
  );

  await assert.rejects(
    () =>
      runner.run(agent, "normal-input", {
        extensions: {
          toolCalls: [{ toolName: "echo", args: { text: "hello" } }]
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgentsError);
      assert.equal(error.code, "AGENTS-E-GATE-DENIED");
      return true;
    }
  );
});

test("run processes model planned tool calls without extensions.toolCalls", async () => {
  let generateCount = 0;
  const plannedModel = {
    provider: "ollama" as const,
    name: "mock-model",
    baseUrl: "http://localhost:11434/v1",
    timeoutMs: 60_000,
    async generate() {
      generateCount += 1;
      if (generateCount === 1) {
        return {
          toolCalls: [{ toolName: "echo", args: { text: "auto" } }]
        };
      }
      return {
        outputText: "done"
      };
    }
  };

  const runner = createRunner({ safetyAgent: SafetyAgent.allowAll() });
  const echoTool = tool({
    name: "echo",
    description: "echo",
    execute: async (args) => ({ echoed: args.text ?? "" })
  });

  const agent = new Agent({
    name: "model-loop-agent",
    instructions: "use tools",
    model: plannedModel,
    tools: [echoTool]
  });

  const result = await runner.run(agent, "auto tool call");
  assert.equal(result.tool_calls.length, 1);
  assert.equal(result.output_text, "done");
  assert.equal(generateCount, 2);
});

test("SafetyAgent invalid structured output is fail-closed", async () => {
  const runner = createRunner({
    safetyAgent: new SafetyAgent(() => ({
      decision: "allow",
      reason: "invalid risk",
      risk_level: 9
    }))
  });
  const echoTool = tool({
    name: "echo",
    description: "echo",
    execute: async (args) => args
  });
  const agent = new Agent({
    name: "invalid-safety-output",
    instructions: "test",
    tools: [echoTool]
  });

  await assert.rejects(
    () =>
      runner.run(agent, "hello", {
        extensions: {
          toolCalls: [{ toolName: "echo", args: { text: "hello" } }]
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgentsError);
      assert.equal(error.code, "AGENTS-E-GATE-EVAL");
      return true;
    }
  );
});

test("SafetyAgent runtime error is fail-closed", async () => {
  const runner = createRunner({
    safetyAgent: new SafetyAgent(() => {
      throw new Error("unexpected");
    })
  });
  const echoTool = tool({
    name: "echo",
    description: "echo",
    execute: async (args) => args
  });
  const agent = new Agent({
    name: "safety-runtime-error",
    instructions: "test",
    tools: [echoTool]
  });

  await assert.rejects(
    () =>
      runner.run(agent, "hello", {
        extensions: {
          toolCalls: [{ toolName: "echo", args: { text: "hello" } }]
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgentsError);
      assert.equal(error.code, "AGENTS-E-GATE-EVAL");
      return true;
    }
  );
});

test("runner pauses and resumes with approval", async () => {
  const safety = new SafetyAgent((_agent, request) => {
    if (request.tool_kind === "mcp") {
      return {
        decision: "needs_human",
        reason: "mcp needs review",
        risk_level: 4
      };
    }
    return {
      decision: "allow",
      reason: "safe",
      risk_level: 1
    };
  });
  const runner = createRunner({ safetyAgent: safety });

  const mcpTool = hostedMcpTool(
    {
      id: "fs",
      url: "http://localhost:10000",
      callTool: async (toolName, args) => ({
        toolName,
        args
      })
    },
    {
      capabilities: [
        {
          name: "read_file",
          description: "read file content",
          risk_level: 3
        }
      ]
    }
  );

  const agent = new Agent({
    name: "mcp-agent",
    instructions: "use mcp",
    tools: [mcpTool]
  });

  const interrupted = await runner.run(agent, "read file", {
    extensions: {
      toolCalls: [
        {
          toolName: mcpTool.name,
          args: {
            toolName: "read_file",
            args: { path: "README.md" }
          }
        }
      ]
    }
  });

  assert.equal(interrupted.interruptions?.length, 1);
  const pending = await runner.getPendingApprovals(interrupted.run_id);
  assert.equal(pending.length, 1);

  const resumeToken = await runner.submitApproval(pending[0].approval_id, "approve");
  const resumed = await runner.resumeRun(interrupted.run_id, resumeToken.token);

  assert.equal(resumed.tool_calls.length, 1);
  assert.match(resumed.output_text, /Executed 1 tool call/);
});

test("approveAndResume completes suspended run in one step", async () => {
  const safety = new SafetyAgent((_agent, request) => {
    if (request.tool_kind === "mcp") {
      return {
        decision: "needs_human",
        reason: "approval required",
        risk_level: 4
      };
    }
    return {
      decision: "allow",
      reason: "safe",
      risk_level: 1
    };
  });
  const runner = createRunner({ safetyAgent: safety });
  const mcpTool = hostedMcpTool(
    {
      id: "workspace",
      url: "http://localhost:4100",
      callTool: async (toolName, args) => ({ toolName, args })
    },
    {
      capabilities: [{ name: "read_file", description: "read file", risk_level: 3 }]
    }
  );

  const agent = new Agent({
    name: "approve-and-resume",
    instructions: "use mcp",
    tools: [mcpTool]
  });

  const interrupted = await runner.run(agent, "read", {
    extensions: {
      toolCalls: [{ toolName: mcpTool.name, args: { toolName: "read_file", args: {} } }]
    }
  });
  const pending = await runner.getPendingApprovals(interrupted.run_id);
  const resumed = await runner.approveAndResume(interrupted.run_id, pending[0].approval_id, {
    comment: "approved"
  });

  assert.equal(resumed.tool_calls.length, 1);
});

test("approval double-send is rejected", async () => {
  const safety = new SafetyAgent((_agent, request) => {
    if (request.tool_kind === "mcp") {
      return {
        decision: "needs_human",
        reason: "approval required",
        risk_level: 4
      };
    }
    return {
      decision: "allow",
      reason: "safe",
      risk_level: 1
    };
  });
  const runner = createRunner({ safetyAgent: safety });
  const mcpTool = hostedMcpTool({
    id: "workspace",
    url: "http://localhost:4101",
    callTool: async () => ({ ok: true })
  });
  const agent = new Agent({
    name: "double-send",
    instructions: "test",
    tools: [mcpTool]
  });

  const interrupted = await runner.run(agent, "read", {
    extensions: {
      toolCalls: [{ toolName: mcpTool.name, args: { toolName: "read_file", args: {} } }]
    }
  });
  const pending = await runner.getPendingApprovals(interrupted.run_id);
  await runner.approveAndResume(interrupted.run_id, pending[0].approval_id);

  await assert.rejects(
    () => runner.approveAndResume(interrupted.run_id, pending[0].approval_id),
    (error: unknown) => {
      assert.ok(error instanceof AgentsError);
      assert.equal(error.code, "AGENTS-E-APPROVAL-INVALID");
      return true;
    }
  );
});

test("expired resume token is rejected", async () => {
  const safety = new SafetyAgent((_agent, request) => {
    if (request.tool_kind === "mcp") {
      return {
        decision: "needs_human",
        reason: "approval required",
        risk_level: 4
      };
    }
    return {
      decision: "allow",
      reason: "safe",
      risk_level: 1
    };
  });
  const runner = createRunner({
    safetyAgent: safety,
    resumeTokenTtlSec: 0
  });
  const mcpTool = hostedMcpTool({
    id: "workspace",
    url: "http://localhost:4102",
    callTool: async () => ({ ok: true })
  });
  const agent = new Agent({
    name: "expired-token",
    instructions: "test",
    tools: [mcpTool]
  });

  const interrupted = await runner.run(agent, "read", {
    extensions: {
      toolCalls: [{ toolName: mcpTool.name, args: { toolName: "read_file", args: {} } }]
    }
  });
  const pending = await runner.getPendingApprovals(interrupted.run_id);
  const token = await runner.submitApproval(pending[0].approval_id, "approve");

  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(
    () => runner.resumeRun(interrupted.run_id, token.token),
    (error: unknown) => {
      assert.ok(error instanceof AgentsError);
      assert.equal(error.code, "AGENTS-E-RESUME-TOKEN");
      return true;
    }
  );
});

test("SafetyAgent receives capability snapshot derived from Agent tools", async () => {
  let capturedSkillIds: string[] = [];
  let capturedMcpNames: string[] = [];

  const safety = new SafetyAgent((_agent, request) => {
    capturedSkillIds = request.capability_snapshot?.skill_ids ?? [];
    capturedMcpNames =
      request.capability_snapshot?.mcp_capabilities.map((item) => item.name) ?? [];
    return {
      decision: "allow",
      reason: "ok",
      risk_level: 1
    };
  });

  const runner = createRunner({ safetyAgent: safety });
  const skillTool: Tool = {
    name: "skill.writer",
    description: "writer skill",
    kind: "skill",
    metadata: { skill_id: "writer" },
    execute: async () => ({ ok: true })
  };
  const mcpTool = hostedMcpTool(
    {
      id: "docs",
      url: "http://localhost:20000",
      callTool: async () => ({ ok: true })
    },
    {
      capabilities: [
        { name: "search_docs", description: "search docs", risk_level: 2 }
      ]
    }
  );

  const agent = new Agent({
    name: "cap-agent",
    instructions: "cap",
    tools: [skillTool, mcpTool]
  });

  await runner.run(agent, "call skill", {
    extensions: {
      toolCalls: [{ toolName: "skill.writer", args: {} }]
    }
  });

  assert.deepEqual(capturedSkillIds, ["writer"]);
  assert.deepEqual(capturedMcpNames, ["search_docs"]);
});

test("SafetyAgent receives enriched tool catalog context", async () => {
  let capturedTargetName = "";
  let capturedCatalogKinds: string[] = [];
  let capturedSkillOverview = "";
  let capturedMcpRisk = 0;

  const safety = new SafetyAgent((_agent, request) => {
    capturedTargetName = request.target_tool?.name ?? "";
    capturedCatalogKinds = (request.tool_catalog ?? []).map((tool) => tool.kind);
    const skillTool = request.tool_catalog?.find((tool) => tool.name === "skill.editor");
    capturedSkillOverview = skillTool?.skill?.overview ?? "";
    const mcpTool = request.tool_catalog?.find((tool) => tool.kind === "mcp");
    capturedMcpRisk = mcpTool?.mcp_capabilities?.[0]?.risk_level ?? 0;
    return {
      decision: "allow",
      reason: "ok",
      risk_level: 1
    };
  });

  const runner = createRunner({ safetyAgent: safety });
  const fnTool = tool({
    name: "echo",
    description: "echo",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" }
      }
    },
    execute: async (args) => args
  });
  const skillTool: Tool = {
    name: "skill.editor",
    description: "editor skill",
    kind: "skill",
    metadata: {
      skill_id: "editor",
      skill_overview: "Edit markdown safely",
      skill_constraints: ["no secrets"],
      skill_tags: ["editing", "markdown"]
    },
    execute: async () => ({ ok: true })
  };
  const mcpTool = hostedMcpTool(
    {
      id: "workspace",
      url: "http://localhost:3001",
      callTool: async () => ({ ok: true })
    },
    {
      capabilities: [{ name: "read_file", description: "read file", risk_level: 3 }]
    }
  );

  const agent = new Agent({
    name: "context-agent",
    instructions: "test context",
    tools: [fnTool, skillTool, mcpTool]
  });

  await runner.run(agent, "call echo", {
    extensions: {
      toolCalls: [{ toolName: "echo", args: { text: "hello" } }]
    }
  });

  assert.equal(capturedTargetName, "echo");
  assert.deepEqual(capturedCatalogKinds.sort(), ["function", "mcp", "skill"]);
  assert.equal(capturedSkillOverview, "Edit markdown safely");
  assert.equal(capturedMcpRisk, 3);
});

test("e2e flow: skill + mcp + human approval + resume", async () => {
  const safety = new SafetyAgent((_agent, request) => {
    if (request.tool_kind === "mcp") {
      return {
        decision: "needs_human",
        reason: "mcp approval required",
        risk_level: 4
      };
    }
    return {
      decision: "allow",
      reason: "safe",
      risk_level: 1
    };
  });

  const runner = createRunner({ safetyAgent: safety });
  const skillTool: Tool = {
    name: "skill.summarize",
    description: "summarize skill",
    kind: "skill",
    metadata: { skill_id: "summarize" },
    execute: async (args) => ({ summarized: args.text ?? "" })
  };
  const mcpTool = hostedMcpTool(
    {
      id: "fs",
      url: "http://localhost:3000",
      callTool: async (toolName, args) => ({ toolName, args })
    },
    {
      capabilities: [
        { name: "write_file", description: "write file", risk_level: 4 }
      ]
    }
  );

  const agent = new Agent({
    name: "all-in-one",
    instructions: "run all",
    tools: [skillTool, mcpTool]
  });

  const interrupted = await runner.run(agent, "execute all", {
    extensions: {
      toolCalls: [
        { toolName: "skill.summarize", args: { text: "hello" } },
        {
          toolName: mcpTool.name,
          args: { toolName: "write_file", args: { path: "a.txt", content: "x" } }
        }
      ]
    }
  });

  assert.equal(interrupted.tool_calls.length, 1);
  assert.equal(interrupted.interruptions?.length, 1);

  const pending = await runner.getPendingApprovals(interrupted.run_id);
  assert.equal(pending.length, 1);
  const token = await runner.submitApproval(pending[0].approval_id, "approve");
  const resumed = await runner.resumeRun(interrupted.run_id, token.token);
  assert.equal(resumed.tool_calls.length, 2);
});
