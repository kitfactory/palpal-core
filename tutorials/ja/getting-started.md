# チュートリアル（日本語）

このチュートリアルでは、`SafetyAgent + MCP + Skills + Guardrails + Human approval` を1本で動かします。

## 1. インストール

```bash
npm install pal-core
```

## 2. Provider を選ぶ

```ts
import { getProvider } from "pal-core";

const model = getProvider("ollama").getModel("gpt-oss-20b");
```

## 3. Skills を読み込み Tool 化する

```ts
import { loadSkills, toTools, toIntrospectionTools } from "pal-core";

const skills = await loadSkills({ dir: "./skills", mode: "function_tool" });
const skillTools = toTools(skills);
const skillInfoTools = toIntrospectionTools(skills); // skill.list / skill.describe
```

## 4. MCP Tool を追加する

```ts
import { hostedMcpTool } from "pal-core";

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

## 5. SafetyAgent + guardrails で防御する

```ts
import { Agent, SafetyAgent, createRunner } from "pal-core";

const runner = createRunner({
  safetyAgent: new SafetyAgent(async (_agent, request) => {
    if (request.tool_kind === "mcp") {
      return { decision: "needs_human", reason: "MCP は承認必須", risk_level: 4 };
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
        allow: !inputText.includes("機密データを送信"),
        reason: "機密データ送信は禁止"
      })
    ],
    tool: [
      ({ requestedToolCall }) => ({
        allow: requestedToolCall?.toolName !== "skill.delete_all",
        reason: "危険なskillは禁止"
      })
    ]
  }
});
```

## 6. 実行 -> 承認 -> 再開

```ts
const interrupted = await runner.run(agent, "README を要約して", {
  extensions: {
    toolCalls: [
      { toolName: "skill.summarize", args: { path: "README.md" } },
      { toolName: mcpTool.name, args: { toolName: "read_file", args: { path: "README.md" } } }
    ]
  }
});

if (interrupted.interruptions?.length) {
  const pending = await runner.getPendingApprovals(interrupted.run_id);
  const token = await runner.submitApproval(pending[0].approval_id, "approve", "確認済み");
  const resumed = await runner.resumeRun(interrupted.run_id, token.token);
  console.log(resumed.output_text);
}
```

## 7. 使い分けの目安

- `SafetyAgent`: MCP/Skills 実行可否の主判定
- `guardrails`: 入力/ツール/出力の禁止ルールを短く定義
- `needs_human`: 高リスク処理のみ人間に確認
