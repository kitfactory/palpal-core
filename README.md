# palpal-core

`palpal-core` is a high-safety, OpenAI Agents SDK-compatible npm library for TypeScript.
It keeps the familiar Agents SDK style while adding practical runtime safety controls for MCP, Skills, and tool execution.

## Positioning

- OpenAI Agents SDK-compatible interface with minimal migration cost
- Safety-first execution model (`SafetyAgent + Guardrails + Approval flow`)
- Designed to make MCP/Skills easier to defend before execution

## What problems it solves

In many current agent stacks:

- MCP/tool safety checks are inconsistent or ad-hoc
- Skills (`SKILL.md`) are hard to expose as executable tools
- Human approval flows (`pause -> resume`) are fragmented
- Chat Completions compatible backends are not unified

`palpal-core` addresses this with a single execution layer:
`SafetyAgent + Guardrails + Approval flow`.

## Design highlights

- Agents SDK-like interface:
  - `new Agent(...)`
  - `run(agent, input, options?)`
  - `tool(...)`, `hostedMcpTool(...)`
- `SafetyAgent`:
  - derives Skills/MCP/Tools from the `Agent` at `runner.run(...)`
  - fail-closed Go/No-Go/needs_human decision
- `ModelSafetyAgent`:
  - accepts a model + rubric (bullet-string rules)
  - evaluates tool/skill/MCP context from the target `Agent`
  - returns stable structured decision (`allow|deny|needs_human`)
  - defaults to `includeUserIntent: false` (raw user input is excluded)
- MCP approval policy:
  - `hostedMcpTool(..., { requireApproval: true })` forces `needs_human` before execution
- General guardrails (OpenAI Agents SDK style) are also supported:
  - `agent.guardrails.input/tool/output`
  - independent deny path in addition to `SafetyAgent`
- Skills:
  - `loadSkills(...) -> Skill[]`
  - `toTools(skills)` for function-tool conversion
  - `listSkills` / `describeSkill` / `toIntrospectionTools`
- Providers:
  - `getProvider("ollama").getModel("gpt-oss-20b")`
  - OpenAI / Ollama / LM Studio / Gemini / Anthropic / OpenRouter

## Install

```bash
npm install palpal-core
```

## Minimal example

```ts
import {
  Agent,
  SafetyAgent,
  createRunner,
  tool,
  getProvider
} from "palpal-core";

const runner = createRunner({
  safetyAgent: new SafetyAgent(async (_agent, request) => {
    if (request.tool_kind === "mcp") {
      return { decision: "needs_human", reason: "MCP review required", risk_level: 4 };
    }
    return { decision: "allow", reason: "safe", risk_level: 1 };
  })
});

const agent = new Agent({
  name: "assistant",
  instructions: "be helpful",
  model: getProvider("ollama").getModel("gpt-oss-20b"),
  tools: [
    tool({
      name: "echo",
      description: "echo text",
      execute: async (args) => args
    })
  ],
  guardrails: {
    input: [
      ({ inputText }) => ({
        allow: !inputText.includes("forbidden"),
        reason: "forbidden input"
      })
    ]
  }
});

const result = await runner.run(agent, "hello", {
  extensions: {
    toolCalls: [{ toolName: "echo", args: { text: "hello" } }]
  }
});
```

## Why MCP/Skills are easier to defend

- `SafetyAgent` evaluates with capability snapshot derived from the actual `Agent`
- guardrails are split by stage (`input/tool/output`) for concise policy rules
- `needs_human` supports explicit approval and safe resume

## Docs

- Japanese README: [README.ja.md](./README.ja.md)
- Japanese tutorial: [tutorials/ja/getting-started.md](./tutorials/ja/getting-started.md)
- English tutorial: [tutorials/en/getting-started.md](./tutorials/en/getting-started.md)
- Filesystem MCP + SafetyAgent sample: [tutorials/samples/filesystem-mcp-safety.ts](./tutorials/samples/filesystem-mcp-safety.ts)
- ModelSafetyAgent sample: [tutorials/samples/model-safety-agent.ts](./tutorials/samples/model-safety-agent.ts)

