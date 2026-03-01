# Tutorial (English)

This tutorial combines `SafetyAgent + MCP + Skills + Guardrails + Human approval` in one flow.

## 1. Install

```bash
npm install palpal-core
```

## 2. Pick a provider

```ts
import { getProvider } from "palpal-core";

const model = getProvider("ollama").getModel("gpt-oss-20b");
```

## 2.1 Inspect providers and model lists

```ts
import { getProvider, listProviders } from "palpal-core";

const providers = listProviders();
console.log(providers); // ["openai", "ollama", ...]

const openaiModels = await getProvider("openai").listModels({
  BASE_URL: process.env.OPENAI_BASE_URL,
  API_KEY: process.env.OPENAI_API_KEY
});
console.log(openaiModels.models);

const ollamaModels = await getProvider("ollama").listModels({
  baseUrl: "http://127.0.0.1:11434/v1",
  apiKey: "ollama"
});
console.log(ollamaModels.models);
```

Configuration precedence is:
`direct options > .env > process.env`.

`baseUrl` suffixes are auto-completed per provider when missing
(for example: Anthropic `/v1`, Gemini `/v1beta/openai`, OpenRouter `/api/v1`).

Model-list timeout precedence is:
`direct timeout > AGENTS_MODEL_LIST_TIMEOUT_MS > AGENTS_REQUEST_TIMEOUT_MS > 2000ms`.

If model-list API access fails, `listModels` falls back to
`configured -> default -> environment_dependent` and sets `runtimeApiFailure`:

```ts
if (openaiModels.resolution !== "runtime_api") {
  console.log(openaiModels.runtimeApiFailure);
}
```

## 3. Load Skills and convert to tools

```ts
import { loadSkills, toTools, toIntrospectionTools } from "palpal-core";

const skills = await loadSkills({ dir: "./skills", mode: "function_tool" });
const skillTools = toTools(skills);
const skillInfoTools = toIntrospectionTools(skills); // skill.list / skill.describe
```

## 4. Add MCP tool

```ts
import { hostedMcpTool } from "palpal-core";

const mcpTool = hostedMcpTool(
  {
    id: "workspace",
    url: "http://127.0.0.1:8080",
    callTool: async (toolName, args) => ({ toolName, args })
  },
  {
    capabilities: [{ name: "read_file", description: "Read file", risk_level: 3 }]
  }
);
```

## 5. Defend with SafetyAgent + guardrails

```ts
import { Agent, SafetyAgent, createRunner } from "palpal-core";

const runner = createRunner({
  safetyAgent: new SafetyAgent(async (_agent, request) => {
    if (request.tool_kind === "mcp") {
      return { decision: "needs_human", reason: "MCP requires approval", risk_level: 4 };
    }
    return { decision: "allow", reason: "safe", risk_level: 1 };
  })
});

const agent = new Agent({
  name: "all-in-one",
  instructions: "Use tools safely.",
  model,
  tools: [...skillTools, ...skillInfoTools, mcpTool],
  guardrails: {
    input: [
      ({ inputText }) => ({
        allow: !inputText.includes("send secret"),
        reason: "secret exfiltration is blocked"
      })
    ],
    tool: [
      ({ requestedToolCall }) => ({
        allow: requestedToolCall?.toolName !== "skill.delete_all",
        reason: "dangerous skill is blocked"
      })
    ]
  }
});
```

## 6. Run -> approve -> resume

```ts
const interrupted = await runner.run(agent, "Summarize README", {
  extensions: {
    toolCalls: [
      { toolName: "skill.summarize", args: { path: "README.md" } },
      { toolName: mcpTool.name, args: { toolName: "read_file", args: { path: "README.md" } } }
    ]
  }
});

if (interrupted.interruptions?.length) {
  const pending = await runner.getPendingApprovals(interrupted.run_id);
  const token = await runner.submitApproval(pending[0].approval_id, "approve", "Reviewed");
  const resumed = await runner.resumeRun(interrupted.run_id, token.token);
  console.log(resumed.output_text);
}
```

## 7. Practical split of responsibilities

- `SafetyAgent`: primary Go/No-Go for MCP/Skills/tool execution
- `guardrails`: simple stage-based block rules (`input/tool/output`)
- `needs_human`: explicit human review only for risky operations

## 8. Filesystem MCP sample

For a concrete, runnable sample of `SafetyAgent` stopping a risky MCP call (`write_file`)
and resuming only after approval, see:

- [`tutorials/samples/filesystem-mcp-safety.ts`](../samples/filesystem-mcp-safety.ts)

## 9. ModelSafetyAgent sample

For model-based safety evaluation with rubric rules and structured decisions, see:

- [`tutorials/samples/model-safety-agent.ts`](../samples/model-safety-agent.ts)

`ModelSafetyAgent` defaults to `includeUserIntent: false`, so raw user input text is not included
in the safety-judge prompt unless explicitly enabled.
