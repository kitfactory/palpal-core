# pal-core (日本語)

`pal-core` は、OpenAI Agents SDK (TypeScript) の呼び出し感を保ちながら、実運用で不足しやすい安全制御を補う npm ライブラリです。

## 何を解決するか

現在のエージェント実装では、次の課題が起きやすいです。

- MCP/Tools の実行前安全判定が実装依存になりやすい
- Skills (`SKILL.md`) をそのまま実行可能な Tool として扱いにくい
- 人間承認が必要な処理の「中断 -> 再開」制御が分散しやすい
- Chat Completions 互換モデル（Ollama など）を統一I/Fで扱いにくい

`pal-core` はこれを、`SafetyAgent + Guardrails + Approval flow` で最小差分に統合します。

## 設計のポイント

- Agents SDK 互換I/F:
  - `new Agent(...)`
  - `run(agent, input, options?)`
  - `tool(...)`, `hostedMcpTool(...)`
- SafetyAgent:
  - `runner.run(agent, ...)` 時に `Agent` から Skills/MCP/Tools を自動抽出
  - Go/No-Go/needs_human を fail-closed で判定
- OpenAI Agents SDK の一般ガードレール併用:
  - `agent.guardrails.input/tool/output` を追加
  - `SafetyAgent` とは独立に deny できる二重防御
- Skills:
  - `loadSkills(...) -> Skill[]`
  - `toTools(skills)` で function tools 化
  - `listSkills` / `describeSkill` / `toIntrospectionTools`
- Provider:
  - `getProvider("ollama").getModel("gpt-oss-20b")`
  - OpenAI / Ollama / LM Studio / Gemini / Anthropic / OpenRouter

## インストール

```bash
npm install pal-core
```

## 最小例

```ts
import {
  Agent,
  SafetyAgent,
  createRunner,
  tool,
  getProvider
} from "pal-core";

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

## MCP/Skills を防御しやすい理由

- SafetyAgent は実行対象 `Agent` から能力情報を自動取得するため、判定コンテキストの漏れを減らせる
- Guardrails を入力/ツール/出力で分離でき、禁止条件を短く保てる
- `needs_human` の承認トークンで、中断処理を安全に再開できる

## チュートリアル

- 日本語: [tutorials/ja/getting-started.md](./tutorials/ja/getting-started.md)
- 英語: [tutorials/en/getting-started.md](./tutorials/en/getting-started.md)
