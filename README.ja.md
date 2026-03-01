# palpal-core (日本語)

`palpal-core` は、安全性を重視した OpenAI Agents SDK 互換（TypeScript）の npm ライブラリです。
Agents SDK の使い勝手を保ちながら、MCP / Skills / Tool 実行の実運用向け安全制御を追加します。

## 位置づけ

- OpenAI Agents SDK 互換I/Fを維持し、移行コストを最小化
- `SafetyAgent + Guardrails + Approval flow` による Safety-first 実行モデル
- MCP / Skills を「実行前」に防御しやすい設計

## 何を解決するか

現在のエージェント実装では、次の課題が起きやすいです。

- MCP/Tools の実行前安全判定が実装依存になりやすい
- Skills (`SKILL.md`) をそのまま実行可能な Tool として扱いにくい
- 人間承認が必要な処理の「中断 -> 再開」制御が分散しやすい
- Chat Completions 互換モデル（Ollama など）を統一I/Fで扱いにくい

`palpal-core` はこれを、`SafetyAgent + Guardrails + Approval flow` で最小差分に統合します。

## 設計のポイント

- Agents SDK 互換I/F:
  - `new Agent(...)`
  - `run(agent, input, options?)`
  - `tool(...)`, `hostedMcpTool(...)`
- SafetyAgent:
  - `runner.run(agent, ...)` 時に `Agent` から Skills/MCP/Tools を自動抽出
  - Go/No-Go/needs_human を fail-closed で判定
- ModelSafetyAgent:
  - model + rubric（箇条書き文字列）で判定器を構成
  - 対象 `Agent` の tool/skill/MCP 文脈を入力に含める
  - 構造化出力（`allow|deny|needs_human`）で安定判定
  - 既定は `includeUserIntent: false`（生のユーザー入力は含めない）
- OpenAI Agents SDK の一般ガードレール併用:
  - `agent.guardrails.input/tool/output` を追加
  - `SafetyAgent` とは独立に deny できる二重防御
- Skills:
  - `loadSkills(...) -> Skill[]`
  - `toTools(skills)` で function tools 化
  - `listSkills` / `describeSkill` / `toIntrospectionTools`
- Provider:
  - `getProvider("ollama").getModel("gpt-oss-20b")`
  - `listProviders()` -> `ProviderName[]`
  - `await getProvider("ollama").listModels({ baseUrl, apiKey })`
  - `await getProvider("openai").listModels({ BASE_URL, API_KEY })`
  - 設定解決順: `直接指定 > .env > 環境変数`
  - `baseUrl` に provider必須サフィックスが無い場合は自動補完（`/v1`, `/v1beta/openai`, `/api/v1` など）
  - モデル一覧タイムアウト解決順: `直接指定 > AGENTS_MODEL_LIST_TIMEOUT_MS > AGENTS_REQUEST_TIMEOUT_MS > 2000ms`
  - `/models` 到達失敗時: `configured` -> `default` -> `environment_dependent` の順でフォールバック
  - フォールバック返却には `runtimeApiFailure`（`code/message/status/statusText`）を含める
  - OpenAI / Ollama / LM Studio / Gemini / Anthropic / OpenRouter

モデル一覧の診断例:

```ts
const modelList = await getProvider("anthropic").listModels({
  baseUrl: "https://api.anthropic.com", // サフィックス(/v1)は自動補完
  apiKey: process.env.AGENTS_ANTHROPIC_API_KEY
});

if (modelList.resolution !== "runtime_api") {
  console.warn(modelList.runtimeApiFailure);
  // { code: "http_error" | "timeout" | ..., message, status?, statusText? }
}
```

## インストール

```bash
npm install palpal-core
```

## 最小例

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

## MCP/Skills を防御しやすい理由

- SafetyAgent は実行対象 `Agent` から能力情報を自動取得するため、判定コンテキストの漏れを減らせる
- Guardrails を入力/ツール/出力で分離でき、禁止条件を短く保てる
- `needs_human` の承認トークンで、中断処理を安全に再開できる

## チュートリアル

- 日本語: [tutorials/ja/getting-started.md](./tutorials/ja/getting-started.md)
- 英語: [tutorials/en/getting-started.md](./tutorials/en/getting-started.md)
- Filesystem MCP + SafetyAgent サンプル: [tutorials/samples/filesystem-mcp-safety.ts](./tutorials/samples/filesystem-mcp-safety.ts)
- ModelSafetyAgent サンプル: [tutorials/samples/model-safety-agent.ts](./tutorials/samples/model-safety-agent.ts)
