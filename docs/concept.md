# concept.md（必ず書く：最新版）
#1.概要（Overview）（先頭固定）
- 作るもの（What）：OpenAI Agents SDK（TypeScript）の上に載せる、安全重視の非破壊ラッパーSDK（npmライブラリとして提供）
- 解決すること（Why）：Agents SDKの既存I/Fをできるだけ維持したまま、MCP/Skills/SafetyAgent/Chat Completions互換を単一の実行ハーネスに追加し、移行コストと安全制御の実装負担を減らす
- できること（主要機能の要約）：Agents SDK互換I/F、MCP実行前ゲート、SKILL.mdのFunction Tool化、Skillメタ情報（概要/サンプル/仕様）の取得、Go/No-Go判定Agent、OpenAI互換Chat Completionsプロバイダ切替
- 使いどころ（When/Where）：Agents SDKを使う業務エージェント基盤で、外部ツール実行の安全性とモデル互換性が同時に必要なとき
- 成果物（Outputs）：統一Runner API、安全承認フロー、ツール実行ログ、互換プロバイダ設定
- 前提（Assumptions）：TypeScript/Node.js環境、Agents SDKを採用、MCPサーバーへ接続可能、互換LLM（Ollama等）はOpenAI互換エンドポイントを提供

#2.ユーザーの困りごと（Pain）
- MCPとFunction Toolで安全制御の実装ポイントが分かれ、実装と運用が複雑になる
- 既存Agents SDK利用コードを崩さずに拡張したいが、I/F差分が大きいと移行コストが高くなる
- SKILL.mdをそのままAgents SDKに組み込む仕組みがなく、手作業でツール化する必要がある
- OpenAI以外のChat Completions互換モデルを安定運用するための吸収層が不足している
- 危険操作の抑止を人手確認と自動判定で統一したいが、標準機能だけでは運用設計が分断される
- SafetyGateが判定する際に、対象Agentが使うSkill/MCP/Toolの文脈情報が不足すると誤判定しやすい
- 人間承認が必要になった後、入力して実行を継続する標準手順がないと運用が止まりやすい

#3.ターゲットと前提環境（詳細）
- ターゲット：Agents SDKで業務エージェントを構築する開発者、運用責任者、社内基盤チーム
- 前提環境：Node.js 20+、TypeScript、OpenAI Agents SDK（TS）、MCPサーバー接続、外部LLM APIへのネットワーク到達性
- 運用前提：高リスク操作は非破壊優先で停止可能、人間承認を挿入可能、監査ログを保管可能

#4.採用する技術スタック（採用理由つき）
- 言語/実行環境：TypeScript + Node.js（Agents SDKとの親和性が高く、型安全で拡張しやすい）
- 配布/公開：npm package（既存Node.jsプロジェクトへ導入しやすく、バージョン管理を標準化できる）
- エージェント基盤：OpenAI Agents SDK（MCP連携、Tool Guardrails、Model抽象化を活用できる）
- 入力/スキーマ：Zod + JSON Schema（Tool引数検証と互換プロバイダ連携を統一できる）
- MCP連携：MCPクライアント + hostedMcpTool（MCP利用を標準化し承認フックを入れられる）
- 互換モデル接続：Custom ModelProvider（Ollama / LM Studio / Google Gemini / Anthropic / OpenRouter を含む差異を吸収できる）

#5.機能一覧（Features）
| ID | 機能 | 解決するPain | 対応UC |
|---|---|---|---|
| F-1 | Agents SDK互換Facade I/F（既存呼び出し形を維持） | I/F差分による移行コスト | UC-1, UC-2, UC-3 |
| F-2 | Provider抽象化（OpenAI/Compat） | 互換モデル吸収層不足 | UC-3 |
| F-3 | MCP実行ゲート（承認フロー統合） | 安全制御の分断 | UC-1, UC-4 |
| F-4 | Skillローダー（SKILL.md -> Function Tool/子Agent） | Skill手作業ツール化 | UC-2 |
| F-5 | Skillメタ情報API（概要/サンプル/入出力仕様） | Skill内容の可視化不足 | UC-2 |
| F-6 | SafetyAgent（Go/No-Go判定） | 危険操作抑止の統一不足 | UC-1, UC-4 |
| F-7 | 実行ポリシープロファイル（Strict/Balanced/Fast） | 運用設定の複雑さ | UC-4 |
| F-8 | Agent Capability Extraction（Agent.toolsから判定文脈を自動抽出） | Gate判定の文脈不足 | UC-1, UC-4 |
| F-9 | Human-in-the-loop継続実行（承認入力と再開） | 承認後の継続手順不足 | UC-4 |

#6.ユースケース（Use Cases）
| ID | 主体 | 目的 | 前提 | 主要手順（最小操作） | 成功条件 | 例外/制約 |
|---|---|---|---|---|---|---|
| UC-1 | 開発者 | 既存Agents SDKコードの呼び出し形を保ったままMCPツールを安全に実行する | MCPサーバー登録済み、SafetyAgentを注入したRunner作成済み | 1) 既存に近いI/FでMCPを登録 2) Runnerで実行要求 3) SafetyAgentがAgentからSkill/Tool/MCP情報を抽出して判定 4) 承認後に実行 | 既存呼び出し形を大きく変えずに安全実行できる | GateがNo-Goの場合は実行不可 |
| UC-2 | 開発者 | Skillを追加してAgentから呼び出す | SKILL.mdが所定ディレクトリに配置済み | 1) Skillを読み込み 2) 概要/サンプル/仕様を取得 3) Tool一覧へ自動登録 4) Agent実行で呼び出し | SkillがFunction Toolまたは子Agentとして実行可能になり、呼び出し前に仕様確認できる | SKILL.md不正時は登録失敗し原因を返す |
| UC-3 | 開発者 | OpenAI以外の互換モデルで同一フローを実行する | Compatプロバイダ設定済み | 1) Providerをcompatに指定 2) モデル名を設定 3) 実行 | 同一Runner APIで実行結果を取得できる | 互換API差異が吸収不能な場合は明示エラー |
| UC-4 | 運用責任者 | 安全ポリシーを運用し監査する | 実行ログ保存が有効 | 1) プロファイル選択 2) 実行履歴を確認 3) 承認要求へ応答 4) 実行を再開 5) ブロック理由を確認 | 承認/拒否/実行の判断履歴を追跡し、承認後に継続実行できる | ログ保存無効時は監査情報が限定される |

#7.Goals（Goalのみ／ユースケース紐づけ必須）
- G-1: MCP実行を非破壊優先で統制できる（対応：UC-1）
- G-2: Skill追加を最小手順で運用できる（対応：UC-2）
- G-3: モデル提供元を切り替えても同一実行体験を維持する（対応：UC-3）
- G-4: Agents SDKからの移行時にI/F差分を最小化する（対応：UC-1, UC-2, UC-3）
- G-5: Skill呼び出し前に概要とサンプルを取得できる（対応：UC-2）
- G-6: 安全判断の根拠を運用者が追跡できる（対応：UC-4）
- G-7: Gate判定時にAgent文脈（MCP/Skill/Tool情報）を利用できる（対応：UC-1, UC-4）
- G-8: 人間承認の入力後に中断実行を再開できる（対応：UC-4）

#8.基本レイヤー構造（Layering）
| レイヤー | 役割 | 主な処理/データ流れ |
|---|---|---|
| SDK Facade層 | 利用者向け互換I/F提供 | Agents SDKの主要呼び出し形を維持しつつ拡張オプションを受け取りRunnerへ委譲 |
| Orchestration層 | Agent実行の編成 | Tools解決、Provider選択、実行コンテキスト生成 |
| Safety層 | Go/No-Go判定と承認制御 | Tool呼び出し要求をSafetyAgentへ渡し、許可/拒否を返す |
| Tool Integration層 | MCP/Skill/Function Toolの統合 | MCP introspection、Skill変換、Skillメタ情報抽出、Tool schema正規化 |
| Model Provider層 | LLM API差異吸収 | OpenAI/Compat実装へ推論要求を中継し共通レスポンスへ変換 |
| Audit/Config層 | ポリシーと履歴管理 | プロファイル読込、承認結果、実行イベント、中断再開トークンを保存 |

#9.主要データクラス（Key Data Classes / Entities）
| データクラス | 主要属性（不要属性なし） | 用途（対応UC/Feature） |
|---|---|---|
| InterfaceCompatConfig | compat_level, enabled_extensions, strict_mode | UC-1/UC-2/UC-3, F-1 |
| ProviderConfig | provider_type, base_url, model, api_key_ref | UC-3, F-2 |
| SkillDescriptor | skill_id, source_path, mode(function_tool/child_agent), input_schema, output_schema | UC-2, F-4/F-5 |
| SkillManifest | skill_id, overview, usage_examples, constraints, tags | UC-2, F-5 |
| AgentCapabilitySnapshot | agent_id, tools, skills, mcp_capabilities, derived_at | UC-1/UC-4, F-8 |
| HumanApprovalRequest | approval_id, run_id, reason, required_action, prompt, status | UC-4, F-9 |
| ResumeToken | token, run_id, expires_at, status | UC-4, F-9 |
| ToolCallRequest | tool_name, tool_kind(mcp/function/skill), args, user_intent | UC-1, F-3/F-6 |
| GateDecision | decision(allow/deny/needs_human), reason, risk_level, approval_id | UC-1/UC-4, F-3/F-6/F-9 |
| PolicyProfile | profile_name, approval_mode, allowed_tool_scopes | UC-4, F-7 |
| ExecutionLog | run_id, tool_call_id, decision, approver, timestamp | UC-4, F-3/F-7/F-9 |

#10.機能部品の実装順序（Implementation Order）
1. Agents SDK互換Facade I/Fと互換モード設定（compat config）を実装する
2. Runner基盤とProvider抽象I/Fを実装し、OpenAIプロバイダを接続する
3. SafetyAgentと承認フローを実装し、MCP実行前ゲートを成立させる
4. MCP統合（登録・introspection・実行）を実装する
5. Skillローダー（SKILL.md解析とFunction Tool化）を実装する
6. Skillメタ情報API（概要/サンプル/仕様取得）を実装する
7. Agent能力の自動抽出（Agent.tools起点）とSafetyGate連携を実装する
8. Human-in-the-loop継続実行（承認入力/再開）を実装する
9. Compat用Custom ModelProvider（Ollama/LM Studio想定）を実装する
10. ポリシープロファイルと監査ログを実装し、運用時の追跡性を完成させる

#11.用語集（Glossary）
- Runner：利用者が呼び出す統一実行エントリポイント
- 互換Facade：Agents SDKのI/Fに寄せたまま拡張機能を有効化する公開I/F層
- Compat Provider：OpenAI互換Chat Completions APIに接続するためのプロバイダ実装
- Skill：`SKILL.md`で記述される拡張可能な実行単位
- Skill Manifest：Skillの概要・サンプル・制約をまとめた参照情報
- Agent Capability Snapshot：SafetyAgentがAgentから抽出したTool/Skill/MCP文脈
- Resume Token：人間承認後に中断実行を再開するためのトークン
- SafetyAgent：Tool実行可否をGo/No-Goで判定する軽量エージェント
- Non-destructive：危険操作を既定で抑止し、必要時のみ承認して進める運用方針
