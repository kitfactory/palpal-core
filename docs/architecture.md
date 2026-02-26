# architecture.md（必ず書く：最新版）
#1.アーキテクチャ概要（構成要素と責務）
- 本SDKは OpenAI Agents SDK（TypeScript）の互換Facadeとして動作し、既存I/Fを維持しつつ安全機能を最小追加する。
- 追加機能は `MCP実行ゲート` `Skillローダー` `SafetyAgent` `Compat Model Provider` に限定する。
- 公開I/Fは既存呼び出し形を優先し、拡張設定は `extensions` 名前空間に集約する。

#2.concept のレイヤー構造との対応表
（テキスト図示）
```text
[SDK Facade] -> [Orchestration] -> [Safety]
                    |                |
                    v                v
           [Tool Integration] -> [Model Provider]
                    |
                    v
               [Audit/Config]
```

| conceptレイヤー | 対応コンポーネント | 主な責務 |
|---|---|---|
| SDK Facade層 | `Agent`, `run`, `createRunner`, `tool`, `hostedMcpTool` | Agents SDK互換I/F提供、拡張設定受付 |
| Orchestration層 | `AgentRunner` | Agent実行編成、ツール実行順序管理 |
| Safety層 | `SafetyGate`, `ApprovalController` | Go/No-Go判定、承認制御、中断再開制御 |
| Tool Integration層 | `McpGateway`, `SkillRegistry`, `SkillMetadataExtractor` | MCP登録/内省、SKILL.md変換、Skillメタ情報抽出、Skill内省Tool化 |
| Model Provider層 | `CompatModelProvider` | OpenAI互換Chat Completions差異吸収 |
| Audit/Config層 | `PolicyStore`, `ExecutionLogStore` | ポリシー読込、監査ログ保存 |

#3.インターフェース設計（Interface）
### UI/APP境界（ユースケース単位）
#### UC-1: 既存Agents SDK呼び出し形でMCPを安全実行
| 操作/API | 役割 | 入力（型/主要フィールド/値範囲） | 出力（型/主要フィールド） | 例外（発生条件） |
|---|---|---|---|---|
| `createRunner(options)` | Runner生成（SafetyAgent注入） | `options.safetyAgent: SafetyAgent`（必須）、`options.policyStore?`、`options.approvalStore?` | `AgentRunner` | `AGENTS-E-RUNNER-CONFIG`（Orchestration層/必須依存不足） |
| `runner.run(agent, input, options?)` | 互換実行API | `agent: AgentLike`、`input: string \| Array<InputItem>`、`options.extensions.policyProfile?: "strict" \| "balanced" \| "fast"` | `Promise<RunResult>`（`output_text`, `tool_calls`, `usage`, `interruptions?`, `extensions?`） | `AGENTS-E-GATE-DENIED`（Safety層/危険操作拒否）、`AGENTS-E-MCP-UNREACHABLE`（Tool Integration層/MCP接続不可） |
| `createGuardrailsTemplate(options?)` | Guardrails責務テンプレート生成 | `inputRules?`, `outputRules?`, `toolRules?` | `AgentGuardrails` | `AGENTS-E-GUARDRAIL-DENIED`（実行時に違反時） |
| `hostedMcpTool(server, opts?)` | MCPツール登録 | `server.url: https`、`opts.requireApproval?: boolean`（既定true） | `Tool`（Agents SDK互換） | `AGENTS-E-MCP-SCHEMA`（Tool Integration層/スキーマ不正） |

#### UC-2: Skill追加と呼び出し
| 操作/API | 役割 | 入力（型/主要フィールド/値範囲） | 出力（型/主要フィールド） | 例外（発生条件） |
|---|---|---|---|---|
| `loadSkills(options)` | SKILL.md読込 | `dir: string`（必須、既存ディレクトリ）、`mode: "function_tool" \| "child_agent"` | `Promise<array<Skill>>` | `AGENTS-E-SKILL-PARSE`（Tool Integration層/Markdown解析失敗） |
| `listSkills(skills)` | Skill概要一覧取得（MCP `tools/list`相当） | `skills: array<Skill>` | `Promise<array<SkillSummary>>`（`skill_id`, `name`, `overview`, `tags`） | `AGENTS-E-SKILL-NOT-LOADED`（Tool Integration層/入力Skill未読込） |
| `describeSkill(skills, skillId, detailLevel?)` | Skill詳細取得（MCP `tools/call`相当の説明系） | `skills: array<Skill>`、`skillId: string`、`detailLevel?: "summary" \| "full"` | `Promise<SkillManifest>`（`overview`, `usage_examples`, `input_schema`, `constraints`） | `AGENTS-E-SKILL-NOT-FOUND`（Tool Integration層/Skill未登録） |
| `toTools(skills)` | SkillをTool化 | `skills: array<Skill>` | `Array<Tool>` | `AGENTS-E-SKILL-SCHEMA`（Tool Integration層/引数定義不正） |
| `toIntrospectionTools(skills)` | Skill内省をToolとして公開 | `skills: array<Skill>` | `Array<Tool>`（`skill.list`, `skill.describe`） | `AGENTS-E-SKILL-SCHEMA`（Tool Integration層/Tool定義不正） |

#### UC-3: Compat Providerで実行
| 操作/API | 役割 | 入力（型/主要フィールド/値範囲） | 出力（型/主要フィールド） | 例外（発生条件） |
|---|---|---|---|---|
| `getProvider(providerName?)` | Providerハンドル取得 | `providerName?: "openai" \| "ollama" \| "lmstudio" \| "gemini" \| "anthropic" \| "openrouter"`（未指定時は`AGENTS_MODEL_PROVIDER`） | `ProviderHandle` | `AGENTS-E-PROVIDER-CONFIG`（Model Provider層/設定不足） |
| `provider.getModel(modelName?)` | 実行モデル取得 | `modelName?: string`（未指定時はProvider既定の環境変数） | `Model` | `AGENTS-E-PROVIDER-CONFIG`（Model Provider層/MODEL未解決） |
| `run(...)` | 互換モデル実行 | `agent.model` に `provider.getModel(...)` を設定 | `Promise<RunResult>` | `AGENTS-E-COMPAT-UNSUPPORTED`（Model Provider層/互換差異吸収不可） |

#### UC-4: ポリシー運用と監査
| 操作/API | 役割 | 入力（型/主要フィールド/値範囲） | 出力（型/主要フィールド） | 例外（発生条件） |
|---|---|---|---|---|
| `setPolicyProfile(profile)` | 実行ポリシー更新 | `profile.name: "strict" \| "balanced" \| "fast"` | `void` | `AGENTS-E-POLICY-INVALID`（Audit/Config層/定義外プロファイル） |
| `getPendingApprovals(runId?)` | 人間判断待ち一覧取得 | `runId?: string` | `Promise<array<HumanApprovalRequest>>` | `AGENTS-E-APPROVAL-NOT-FOUND`（Safety層/該当なし） |
| `submitApproval(approvalId, decision)` | 承認入力 | `approvalId: string`、`decision: "approve" \| "deny"`、`comment?: string` | `Promise<ResumeToken>` | `AGENTS-E-APPROVAL-INVALID`（Safety層/状態不正） |
| `resumeRun(runId, token)` | 中断実行の再開 | `runId: string`、`token: string`、`options.extensions.resume?: ResumeOptions` | `Promise<RunResult>` | `AGENTS-E-RESUME-TOKEN`（Safety層/期限切れ・不一致） |
| `approveAndResume(runId, approvalId, options?)` | 承認と再開の1段実行 | `runId: string`、`approvalId: string`、`options.decision?: "approve"\|"deny"`、`options.comment?: string` | `Promise<RunResult>` | `AGENTS-E-APPROVAL-INVALID`、`AGENTS-E-RESUME-TOKEN` |
| `getExecutionLogs(query)` | 監査ログ取得 | `query.runId?: string`、`query.since?: ISO8601` | `Promise<Array<ExecutionLog>>` | `AGENTS-E-LOG-STORE`（Audit/Config層/保存先障害） |

### 外部I/F（API単位）
#### API: OpenAI Agents SDK
| メソッド | 役割 | 入力（型/主要フィールド/値範囲） | 出力（型/主要フィールド） | 例外（発生条件） |
|---|---|---|---|---|
| `Agent(...)` | Agent定義 | `name: string`、`instructions: string`、`tools: array<Tool>` | `Agent` | SDK標準例外 |
| `run(agent, input, options?)` | 実行 | SDK標準 | SDK標準 | SDK標準例外 |

#### API: MCP Server
| メソッド | 役割 | 入力（型/主要フィールド/値範囲） | 出力（型/主要フィールド） | 例外（発生条件） |
|---|---|---|---|---|
| `tools/list` | 機能内省 | `serverId: string` | `array<McpCapability>` | `AGENTS-E-MCP-UNREACHABLE`（MCP接続不可） |
| `tools/call` | ツール実行 | `toolName: string`、`args: object` | `ToolResult` | `AGENTS-E-MCP-EXEC`（MCP実行失敗） |

### 内部I/F（クラス単位）
#### Class: AgentRunner
##### Method: run
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| agent | `AgentLike` | 実行対象Agent | OpenAI `Agent`互換オブジェクト | 必須 |
| input | `string \| array<InputItem>` | ユーザー入力 | 1件以上 | 必須 |
| options | `RunOptions` | 実行設定 | `options.extensions`のみ拡張許可 | 任意 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| runResult | `Promise<RunResult>` | `output_text`, `messages`, `tool_calls`, `usage`, `interruptions?`, `extensions?` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-GATE-DENIED` | Safety層 | Gate判定がdeny |
| `AGENTS-E-RUNNER` | Orchestration層 | 実行計画生成失敗 |

##### Method: runStream
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| agent | `AgentLike` | 実行対象Agent | `run`と同一 | 必須 |
| input | `string \| array<InputItem>` | ユーザー入力 | `run`と同一 | 必須 |
| options | `RunOptions` | 実行設定 | `stream=true` | 任意 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| events | `AsyncIterable<RunEvent>` | `type`, `delta`, `tool_call`, `final_output` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-STREAM` | Orchestration層 | ストリーム中断 |

#### Class: SkillRegistry
##### Method: loadFromDirectory
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| dir | `string` | Skill探索パス | 存在するディレクトリ | 必須 |
| mode | `"function_tool" \| "child_agent"` | 変換方式 | 既定`function_tool` | 任意 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| skills | `Promise<array<Skill>>` | `descriptor`, `manifest`, `source_path` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-SKILL-PARSE` | Tool Integration層 | SKILL.md解析失敗 |

##### Method: listSkills
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| skills | `array<Skill>` | 参照対象Skill集合 | `loadFromDirectory` の返却値 | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| summaries | `Promise<array<SkillSummary>>` | `skill_id`, `name`, `overview`, `tags` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-SKILL-NOT-LOADED` | Tool Integration層 | Skill未読込 |

##### Method: describeSkill
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| skills | `array<Skill>` | 参照対象Skill集合 | `loadFromDirectory` の返却値 | 必須 |
| skillId | `string` | 参照対象Skill ID | 登録済みID | 必須 |
| detailLevel | `"summary" \| "full"` | 返却粒度 | 既定`summary` | 任意 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| manifest | `Promise<SkillManifest>` | `overview`, `usage_examples`, `constraints`, `input_schema` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-SKILL-NOT-FOUND` | Tool Integration層 | Skill ID未登録 |

##### Method: toTools
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| skills | `array<Skill>` | Tool化対象 | `loadFromDirectory` の返却値 | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| tools | `array<Tool>` | `name`, `description`, `parameters`, `execute` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-SKILL-SCHEMA` | Tool Integration層 | Tool引数定義不正 |

##### Method: toIntrospectionTools
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| skills | `array<Skill>` | 内省対象 | `loadFromDirectory` の返却値 | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| tools | `array<Tool>` | `skill.list`, `skill.describe` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-SKILL-SCHEMA` | Tool Integration層 | Tool定義不正 |

#### Class: SafetyGate
##### Method: evaluate
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| agent | `AgentLike` | 判定対象Agent | `tools` を参照可能であること | 必須 |
| request | `ToolCallRequest` | 判定対象呼び出し | `tool_kind`は`mcp/function/skill` | 必須 |
| context | `GateContext` | 判定文脈 | `policyProfile`必須（能力文脈はagentから抽出） | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| decision | `Promise<GateDecision>` | `decision`, `risk_level`, `reason`, `approval_id?` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-GATE-EVAL` | Safety層 | SafetyAgent応答不正 |
| `AGENTS-E-AGENT-CAPABILITY-RESOLVE` | Safety層 | AgentからSkill/MCP/Tool能力を抽出できない |

#### Class: ApprovalController
##### Method: createApprovalRequest
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| runId | `string` | 実行ID | 1..128 | 必須 |
| gateDecision | `GateDecision` | Gate判定結果 | `decision=needs_human` | 必須 |
| prompt | `string` | 人間向け確認文 | 1..2000 | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| request | `Promise<HumanApprovalRequest>` | `approval_id`, `required_action`, `prompt`, `status` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-APPROVAL-INVALID` | Safety層 | 入力不備・状態不整合 |

##### Method: submitDecision
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| approvalId | `string` | 承認要求ID | 1..128 | 必須 |
| decision | `"approve" \| "deny"` | 人間判断 | 列挙値のみ | 必須 |
| comment | `string` | 判断理由 | 0..2000 | 任意 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| token | `Promise<ResumeToken>` | `token`, `run_id`, `expires_at`, `status` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-APPROVAL-NOT-FOUND` | Safety層 | 承認要求未存在 |
| `AGENTS-E-APPROVAL-INVALID` | Safety層 | 二重入力・状態不整合 |

#### Class: McpGateway
##### Method: register
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| config | `McpServerConfig` | MCP接続設定 | `url`はhttps推奨 | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| handle | `Promise<McpServerHandle>` | `server_id`, `capabilities` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-MCP-UNREACHABLE` | Tool Integration層 | サーバー到達不能 |

##### Method: introspect
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| serverId | `string` | 内省対象 | 1..128、登録済みID | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| capabilities | `Promise<array<McpCapability>>` | `name`, `description`, `schema` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-MCP-SCHEMA` | Tool Integration層 | スキーマ変換失敗 |

#### Class: CompatModelProvider
##### Method: createModel
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| modelName | `string` | 利用モデル名 | 1..128 | 必須 |
| config | `CompatModelConfig` | 接続設定 | `baseUrl`必須、`timeoutMs`1000..120000 | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| model | `Model` | `responses.create`互換呼び出し |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-COMPAT-UNSUPPORTED` | Model Provider層 | function calling仕様差異 |

#### Class: SkillMetadataExtractor
##### Method: extractManifest
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| descriptor | `SkillDescriptor` | 抽出対象Skill | `input_schema`必須 | 必須 |
| sourceText | `string` | SKILL.md本文 | 1文字以上 | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| manifest | `SkillManifest` | `overview`, `usage_examples`, `constraints`, `tags` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-SKILL-PARSE` | Tool Integration層 | 概要/例抽出失敗 |

##### Method: buildIntrospectionTools
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| manifests | `array<SkillManifest>` | Skill仕様一覧 | 要素型必須 | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| tools | `array<Tool>` | `skill.list`, `skill.describe` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `AGENTS-E-SKILL-SCHEMA` | Tool Integration層 | Tool定義不正 |

#### 依存先I/F（最小契約）
| 依存先 | 最小メソッド | 目的 |
|---|---|---|
| `PolicyStore` | `getProfile(name)`, `setProfile(profile)` | 実行ポリシー管理 |
| `ExecutionLogStore` | `append(log)`, `query(filter)` | 監査ログ永続化 |
| `ApprovalStore` | `create(req)`, `get(id)`, `update(id, status)` | 人間承認要求管理 |
| `SafetyAgent` | `evaluate(agent, request, policy)` | Go/No-Go判定 |
| `McpClient` | `listTools()`, `callTool(name, args)` | MCP連携 |
| `AgentsSdkAdapter` | `createAgent(def)`, `run(agent, input, opts)` | OpenAI Agents SDK橋渡し |

### 型定義（入出力/DTOの主要フィールド）
| 型 | 主要フィールド（値範囲/制約） | 用途 |
|---|---|---|
| `RunOptions` | `extensions?: AgentExtensionsOptions`, `stream?: boolean` | 実行オプション |
| `AgentRunnerOptions` | `safetyAgent: SafetyAgent`, `policyStore?`, `approvalStore?` | Runner生成設定 |
| `ProviderName` | `"openai" \| "ollama" \| "lmstudio" \| "gemini" \| "anthropic" \| "openrouter"` | Provider識別子 |
| `ProviderHandle` | `name: ProviderName`, `getModel(modelName?: string): Model` | Provider抽象ハンドル |
| `AgentExtensionsOptions` | `policyProfile?: "strict"\|"balanced"\|"fast"`, `requireHumanApproval?: boolean`, `resume?: ResumeOptions`, `toolCalls?: array<RequestedToolCall>`, `maxTurns?: number` | 追加安全オプション |
| `RunResult` | `run_id: string`, `output_text: string`, `messages: array<InputItem>`, `tool_calls: array<ToolCallResult>`, `usage: UsageStats`, `interruptions?: array<HumanApprovalRequest>`, `extensions?: object` | 実行結果 |
| `ResumeOptions` | `token: string`, `human_response?: string` | 中断実行再開入力 |
| `Skill` | `descriptor: SkillDescriptor`, `manifest: SkillManifest`, `source_path: string` | Skill実体 |
| `SkillDescriptor` | `skill_id: string`, `mode: "function_tool"\|"child_agent"`, `input_schema: JsonSchema`, `output_schema?: JsonSchema` | Skill定義 |
| `SkillSummary` | `skill_id: string`, `name: string`, `overview: string`, `tags: array<string>` | Skill概要一覧 |
| `SkillManifest` | `skill_id: string`, `overview: string`, `usage_examples: array<SkillExample>`, `constraints: array<string>` | Skill仕様参照 |
| `SkillExample` | `title: string`, `input: object`, `expected_output?: object` | Skillサンプル |
| `AgentCapabilitySnapshot` | `agent_name: string`, `tool_names: array<string>`, `skill_ids: array<string>`, `mcp_capabilities: array<McpCapabilitySummary>` | Agentから抽出したGate判定文脈 |
| `McpCapabilitySummary` | `name: string`, `description: string`, `risk_level: 1..5` | MCP能力概要 |
| `ToolCallRequest` | `tool_name: string`, `tool_kind: "mcp"\|"function"\|"skill"`, `args: object`, `user_intent: string` | Safety判定入力 |
| `GateDecision` | `decision: "allow"\|"deny"\|"needs_human"`, `risk_level: 1..5`, `reason: string`, `approval_id?: string` | Safety判定結果 |
| `HumanApprovalRequest` | `approval_id: string`, `run_id: string`, `required_action: string`, `prompt: string`, `status: "pending"\|"approved"\|"denied"` | 人間判断要求 |
| `ResumeToken` | `token: string`, `run_id: string`, `expires_at: ISO8601`, `status: "active"\|"used"\|"expired"` | 再開トークン |
| `ExecutionLog` | `run_id: string`, `tool_call_id: string`, `decision: string`, `timestamp: ISO8601` | 監査ログ |
※List/Arrayの要素型は `array<T>` で明記する。

#4.主要フロー設計（成功/失敗）
| フロー | 成功条件 | 失敗条件 | 例外時の動作 |
|---|---|---|---|
| MCP実行フロー | Gateがallow/needs_human+承認済みでMCP実行成功 | Gate deny、MCP接続失敗 | denyは即停止、接続失敗は`AGENTS-E-MCP-UNREACHABLE`を返却 |
| Skill実行フロー | SKILL.md読込・メタ情報抽出・Tool化成功 | パース失敗、スキーマ不整合、Skill未登録参照 | `AGENTS-E-SKILL-*`を返却し該当Skillのみ無効化 |
| 承認継続フロー | 承認入力が保存されresume tokenで再開成功 | 承認要求未存在、トークン期限切れ | `AGENTS-E-APPROVAL-*` または `AGENTS-E-RESUME-TOKEN` |
| Compat実行フロー | 互換APIで推論成功 | 互換差異吸収不可、タイムアウト | `AGENTS-E-COMPAT-UNSUPPORTED`または`AGENTS-E-PROVIDER-CONFIG` |
| 監査ログフロー | 主要イベントが保存され追跡可能 | 保存先障害 | 実行は継続、警告ログと`AGENTS-E-LOG-STORE`を記録 |

#5.データ設計（永続化・整合性・マイグレーション）
| データ | 永続化 | 整合性 | マイグレーション |
|---|---|---|---|
| PolicyProfile | `PolicyStore`（既定: ファイル or メモリ） | `name`一意、定義済み値のみ | プロファイル追加時に後方互換キーを維持 |
| SkillDescriptor | 起動時ロード（永続化なし） | `skill_id`一意、input schema必須 | SKILL.md構文更新時にバージョン判定 |
| SkillManifest | 起動時生成（キャッシュ可） | `skill_id`に1対1、exampleは型整合必須 | メタ項目追加はoptionalのみ許可 |
| AgentCapabilitySnapshot | 実行時生成（永続化なし） | `agent.tools` と1対1で抽出可能 | 抽出項目追加はoptionalのみ許可 |
| HumanApprovalRequest | `ApprovalStore`（既定: append + status更新） | `approval_id`一意、状態遷移は`pending->approved/denied`のみ | 状態追加は後方互換で列挙拡張 |
| ResumeToken | `ApprovalStore`または専用Store | `token`一意、1回使用制約 | TTL変更は互換設定で吸収 |
| ExecutionLog | `ExecutionLogStore`（既定: append-only） | `run_id + tool_call_id`で重複禁止 | フィールド追加は後方互換（optional追加のみ） |

#6.設定：場所／キー／既定値
| 項目 | 場所 | キー | 既定値 |
|---|---|---|---|
| Model Provider選択 | 実行オプション/環境変数 | `AGENTS_MODEL_PROVIDER` | `openai` |
| OpenAI API Key | 環境変数 | `OPENAI_API_KEY` | なし |
| OpenAI Base URL | 環境変数 | `OPENAI_BASE_URL` | `https://api.openai.com/v1` |
| OpenAI Model | 環境変数 | `AGENTS_OPENAI_MODEL` | `gpt-4.1-mini` |
| Ollama Base URL | 環境変数 | `AGENTS_OLLAMA_BASE_URL` | `http://127.0.0.1:11434/v1` |
| Ollama API Key | 環境変数 | `AGENTS_OLLAMA_API_KEY` | `ollama` |
| Ollama Model | 環境変数 | `AGENTS_OLLAMA_MODEL` | なし |
| LM Studio Base URL | 環境変数 | `AGENTS_LMSTUDIO_BASE_URL` | `http://127.0.0.1:1234/v1` |
| LM Studio API Key | 環境変数 | `AGENTS_LMSTUDIO_API_KEY` | `lmstudio` |
| LM Studio Model | 環境変数 | `AGENTS_LMSTUDIO_MODEL` | なし |
| Gemini API Key | 環境変数 | `AGENTS_GEMINI_API_KEY` | なし |
| Gemini Base URL | 環境変数 | `AGENTS_GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Gemini Model | 環境変数 | `AGENTS_GEMINI_MODEL` | `gemini-2.0-flash` |
| Anthropic API Key | 環境変数 | `AGENTS_ANTHROPIC_API_KEY` | なし |
| Anthropic Base URL | 環境変数 | `AGENTS_ANTHROPIC_BASE_URL` | `https://api.anthropic.com/v1` |
| Anthropic Model | 環境変数 | `AGENTS_ANTHROPIC_MODEL` | なし |
| OpenRouter API Key | 環境変数 | `AGENTS_OPENROUTER_API_KEY` | なし |
| OpenRouter Base URL | 環境変数 | `AGENTS_OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` |
| OpenRouter Model | 環境変数 | `AGENTS_OPENROUTER_MODEL` | なし |
| OpenRouter HTTP Referer | 環境変数 | `AGENTS_OPENROUTER_HTTP_REFERER` | なし |
| OpenRouter App Name | 環境変数 | `AGENTS_OPENROUTER_X_TITLE` | なし |
| Policy Profile | 実行オプション | `extensions.policyProfile` | `balanced` |
| Require Approval | 実行オプション | `extensions.requireHumanApproval` | `false`（Gate判定に従う） |
| Resume Token TTL | 初期化オプション/環境変数 | `AGENTS_RESUME_TOKEN_TTL_SEC` | `900` |
| Request Timeout | 初期化オプション/環境変数 | `AGENTS_REQUEST_TIMEOUT_MS` | `60000` |
| Log Level | 環境変数 | `AGENTS_LOG_LEVEL` | `info` |

#7.依存と拡張点（Extensibility）
| 依存 | 目的 | 拡張点 |
|---|---|---|
| OpenAI Agents SDK | 基本Agent実行機能 | Adapter差し替えで将来SDK更新に追従 |
| MCP Client | 外部ツール利用 | 接続方式（stdio/http/ws）の追加 |
| SafetyAgent Model | 安全判定 | 判定プロンプト/モデル入れ替え |
| Model Provider | 推論実行 | OpenAI/Ollama/LM Studio/Gemini/Anthropic/OpenRouter以外の互換先追加 |
| Store実装 | 設定/監査保存 | Redis/DB/File実装へ置換 |

#7.5.依存関係（DI）
（テキスト図示）
```text
AgentRunner -> AgentsSdkAdapter
AgentRunner -> SafetyGate
AgentRunner -> ApprovalController
AgentRunner -> McpGateway
AgentRunner -> SkillRegistry
AgentRunner -> SkillMetadataExtractor
AgentRunner -> ExecutionLogStore
SafetyGate -> SafetyAgent
ApprovalController -> ApprovalStore
McpGateway -> McpClient
CompatModelProvider -> HttpClient
```

| クラス | コンストラクタDI（依存先） | 目的 |
|---|---|---|
| `AgentRunner` | `AgentsSdkAdapter`, `SafetyGate`, `ApprovalController`, `McpGateway`, `SkillRegistry`, `SkillMetadataExtractor`, `ExecutionLogStore`, `PolicyStore` | 実行オーケストレーション |
| `SafetyGate` | `SafetyAgent`, `PolicyStore` | 安全判定（Agent能力の自動抽出を含む） |
| `ApprovalController` | `ApprovalStore`, `ExecutionLogStore` | 人間承認と再開制御 |
| `McpGateway` | `McpClient` | MCP統合 |
| `SkillRegistry` | `FileSystem`, `MarkdownParser`, `SchemaValidator` | Skill読込/変換 |
| `SkillMetadataExtractor` | `MarkdownParser`, `SchemaValidator` | Skill概要/サンプル/制約抽出 |
| `CompatModelProvider` | `HttpClient` | 互換API呼び出し |

#8.エラーハンドリング設計（冪等性/リトライ/タイムアウト/部分失敗）
| 事象 | 発生場所 | 発生原因 | 方針 | 備考 |
|---|---|---|---|---|
| MCP一時障害 | Tool Integration層 | ネットワーク瞬断 | 2回まで指数バックオフ再試行 | 非破壊操作のみ再試行 |
| Gate判定失敗 | Safety層 | SafetyAgent応答欠落 | fail-closed（deny扱い） | 安全優先 |
| Gate文脈不足 | Safety層 | AgentからSkill/MCP/Tool能力を抽出できない | `AGENTS-E-AGENT-CAPABILITY-RESOLVE`で停止 | Agent定義（tools）を見直す |
| 承認入力不整合 | Safety層 | approval_id不正/状態競合 | `AGENTS-E-APPROVAL-*`を返却 | 二重承認を禁止 |
| 再開トークン不正 | Safety層 | 期限切れ/run不一致 | `AGENTS-E-RESUME-TOKEN`を返却 | 再承認要求へ戻す |
| Compat API timeout | Model Provider層 | 遅延/過負荷 | `timeoutMs`超過で中断、1回再試行 | stream時は再試行なし |
| Skill一部不正 | Tool Integration層 | SKILL.mdのschema不整合 | 部分失敗許容、正常Skillのみ登録 | 起動は継続 |
| ログ保存失敗 | Audit/Config層 | 永続化先障害 | 実行継続、警告出力、メモリ退避 | 監査欠落を明示 |

#9.セキュリティ設計（秘密情報・最小権限・ログ方針）
| 観点 | 方針 |
|---|---|
| 秘密情報 | APIキーは環境変数参照のみ、ログ出力禁止 |
| 最小権限 | MCPは許可スコープをプロファイルで限定、既定deny寄り |
| 非破壊性 | Gate fail時はdeny、明示承認がある場合のみ実行 |
| ログ方針 | 引数は機密マスキングして保存、判断理由のみ平文保存 |

#10.観測性（ログ/診断：doctor/status/debug）
| 種別 | 内容 | 出力先 |
|---|---|---|
| `status` | Provider種別、Policy、登録Tool数 | アプリログ/診断API |
| `debug` | Gate入力要約、判定結果、承認要求ID、MCP応答時間 | debugログ |
| `doctor` | 設定不足、MCP接続、Compat疎通の検査結果 | 診断API |

## 例外ハンドリング方針（UI/ユースケース層）
| UC | 例外 | 表示/通知 | エラーID/コード方針 | 関連spec ERR-ID |
|---|---|---|---|---|
| UC-1 | `AGENTS-E-GATE-DENIED` | 「安全ポリシーにより実行停止」通知 | `AGENTS-E-*`固定、原因は内部ログ参照 | 未定義（spec未整備） |
| UC-1 | `AGENTS-E-AGENT-CAPABILITY-RESOLVE` | 「判定用のAgent能力情報を解決できない」通知 | Agent定義の見直しを案内 | 未定義（spec未整備） |
| UC-2 | `AGENTS-E-SKILL-PARSE` | 該当Skillを無効化して一覧表示 | Skill単位で継続可能にする | 未定義（spec未整備） |
| UC-2 | `AGENTS-E-SKILL-NOT-FOUND` | Skill一覧の再取得を案内 | ID不整合として扱い再同期を促す | 未定義（spec未整備） |
| UC-3 | `AGENTS-E-COMPAT-UNSUPPORTED` | 互換先設定見直しを案内 | Provider別コードを付与 | 未定義（spec未整備） |
| UC-4 | `AGENTS-E-APPROVAL-INVALID` | 承認入力の再実行を案内 | 承認状態競合として再同期 | 未定義（spec未整備） |
| UC-4 | `AGENTS-E-RESUME-TOKEN` | 再承認を案内 | 再開トークン再発行を要求 | 未定義（spec未整備） |
| UC-4 | `AGENTS-E-LOG-STORE` | 監査欠落警告を表示 | 実行成否と監査成否を分離表示 | 未定義（spec未整備） |

#11.テスト設計（単体/統合/E2E、モック方針）
| 種別 | 対象 | 方針 |
|---|---|---|
| 単体 | `SafetyGate`, `ApprovalController`, `SkillRegistry`, `SkillMetadataExtractor`, `CompatModelProvider` | 依存をモック化し入力境界を網羅 |
| 統合 | `AgentRunner + McpGateway + PolicyStore + ApprovalStore` | MCPテストサーバーで承認フローと再開を検証 |
| E2E | 互換I/F移行シナリオ | OpenAI SDK相当コードが小差分で動くことを検証 |

#12.配布・実行形態（インストール/更新/互換性/破壊的変更）
- 配布形態は npm ライブラリ。
- インストールは `npm install <package-name>` を想定。
- 互換性ポリシーは「既存Agents SDK呼び出し形を維持、拡張は `extensions` オプションで追加」。
- 破壊的変更はメジャーバージョンでのみ許可する。

| 比較観点 | OpenAI Agents SDK（TS） | 今回SDK（互換Facade） |
|---|---|---|
| Agent定義 | `new Agent({...})` | `new Agent({...})`を維持（追加設定は`extensions`） |
| 実行API | `run(agent, input, options?)` | 同名同形を維持（`options.extensions`を追加） |
| MCP実行前制御 | 任意実装（承認フック活用） | 既定でSafetyGateを経由、fail-closed |
| Gate判定コンテキスト | 実装依存 | `runner.run(agent, ...)`時にAgentからSkill/Tool/MCP情報を自動抽出（事前context登録不要） |
| Human-in-the-loop | 実装依存 | `getPendingApprovals()`→`approveAndResume()`（または `submitApproval()`→`resumeRun()`）で継続実行 |
| Skills対応 | ネイティブSKILL.mdなし | `loadSkills()`で `Skill[]` を取得し、`listSkills(skills)`/`describeSkill(skills, ...)`で概要・詳細を取得。`toTools(skills)`で実行Tool化可能 |
| 互換Provider | カスタム実装で対応 | `getProvider(...).getModel(...)` を標準提供し、Ollama/LM Studio/Gemini/Anthropic/OpenRouterの環境変数規約を定義 |
| 監査ログ | 実装依存 | `ExecutionLogStore`契約を標準化 |
| 移行コスト | 0（現行） | 小（import差し替え + `extensions`設定追加） |

#13.CLI：コマンド体系／引数／出力／exit code
該当なし。

