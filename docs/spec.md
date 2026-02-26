# Agents互換SDK 仕様（最新版）
本書は本SDKの仕様を Given/When/Done と ERR/MSG ID で定義する。

## 要件一覧
| ID | 要件 | 関連UC |
|---|---|---|
| REQ-0001 | Provider選択は環境変数から解決できる | UC-3 |
| REQ-0002 | OpenAI利用時は OpenAI 用 API Key / Base URL / Model を解決できる | UC-3 |
| REQ-0003 | Ollama / LM Studio 利用時は各 Provider 用 Base URL / Model を解決できる | UC-3 |
| REQ-0004 | Gemini / Anthropic / OpenRouter 利用時は各 Provider 用 API Key / Base URL / Model を解決できる | UC-3 |
| REQ-0005 | 設定不足・形式不正を検出し、エラーID付きで返せる | UC-3, UC-4 |
| REQ-0006 | `run` / `resumeRun` の戻り値は `RunResult` で、`interruptions` と `extensions` を optional で持てる | UC-1, UC-4 |
| REQ-0007 | 承認と再開は `approveAndResume` の1段APIでも実行できる | UC-4 |

## [AGENTS-0001] Provider選択
Given: 実行時に Provider が未指定または指定済み
When: `getProvider(providerName?)` を呼ぶ
Done: `providerName` 優先、未指定時は `AGENTS_MODEL_PROVIDER`、未設定時は `openai` を採用する

## [AGENTS-0002] OpenAI 設定解決
Given: Provider が `openai`
When: `provider.getModel(modelName?)` を呼ぶ
Done: `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `AGENTS_OPENAI_MODEL`（または引数）でモデルを構成する

## [AGENTS-0003] Ollama / LM Studio 設定解決
Given: Provider が `ollama` または `lmstudio`
When: `provider.getModel(modelName?)` を呼ぶ
Done: 各 Provider の Base URL / Model を解決し、必要に応じて Provider固有API Key 既定値を使う

## [AGENTS-0004] Gemini / Anthropic / OpenRouter 設定解決
Given: Provider が `gemini` / `anthropic` / `openrouter`
When: `provider.getModel(modelName?)` を呼ぶ
Done: API Key / Base URL / Model を解決する。OpenRouter は `AGENTS_OPENROUTER_HTTP_REFERER` / `AGENTS_OPENROUTER_X_TITLE` を追加ヘッダとして扱う

## [AGENTS-0005] 設定検証
Given: Provider 設定解決の実行時
When: 必須キー不足またはURL/型不正がある
Done: `ERR-AGENTS-*` を返す

## [AGENTS-0006] RunResult 戻り型拡張
Given: `run` または `resumeRun` の呼び出し
When: 実行完了または承認待ち中断
Done: 返却型は `RunResult` で、`interruptions?: HumanApprovalRequest[]` と `extensions?: object` を含められる

## [AGENTS-0007] 承認->再開 1段API
Given: 実行が `needs_human` で中断し、`approval_id` が取得できている
When: `approveAndResume(runId, approvalId, options?)` を呼ぶ
Done: `submitApproval` + `resumeRun` を内部で連結し、`RunResult` を返す

## Provider環境変数
| Provider | API Key | Base URL | Model | 追加キー |
|---|---|---|---|---|
| openai | `OPENAI_API_KEY` | `OPENAI_BASE_URL`（既定: `https://api.openai.com/v1`） | `AGENTS_OPENAI_MODEL`（既定: `gpt-4.1-mini`） | - |
| ollama | `AGENTS_OLLAMA_API_KEY`（既定: `ollama`） | `AGENTS_OLLAMA_BASE_URL`（既定: `http://127.0.0.1:11434/v1`） | `AGENTS_OLLAMA_MODEL` | - |
| lmstudio | `AGENTS_LMSTUDIO_API_KEY`（既定: `lmstudio`） | `AGENTS_LMSTUDIO_BASE_URL`（既定: `http://127.0.0.1:1234/v1`） | `AGENTS_LMSTUDIO_MODEL` | - |
| gemini | `AGENTS_GEMINI_API_KEY` | `AGENTS_GEMINI_BASE_URL`（既定: `https://generativelanguage.googleapis.com/v1beta/openai`） | `AGENTS_GEMINI_MODEL`（既定: `gemini-2.0-flash`） | - |
| anthropic | `AGENTS_ANTHROPIC_API_KEY` | `AGENTS_ANTHROPIC_BASE_URL`（既定: `https://api.anthropic.com/v1`） | `AGENTS_ANTHROPIC_MODEL` | - |
| openrouter | `AGENTS_OPENROUTER_API_KEY` | `AGENTS_OPENROUTER_BASE_URL`（既定: `https://openrouter.ai/api/v1`） | `AGENTS_OPENROUTER_MODEL` | `AGENTS_OPENROUTER_HTTP_REFERER`, `AGENTS_OPENROUTER_X_TITLE` |

## 共通環境変数
| キー | 用途 | 既定値 |
|---|---|---|
| `AGENTS_MODEL_PROVIDER` | Provider選択 | `openai` |
| `AGENTS_REQUEST_TIMEOUT_MS` | リクエストタイムアウト | `60000` |

## ERR-ID
| ID | 条件 | 説明 |
|---|---|---|
| ERR-AGENTS-0001 | Provider名が不正 | `AGENTS_MODEL_PROVIDER` または引数の値が未対応 |
| ERR-AGENTS-0002 | OpenAI API Key不足 | `OPENAI_API_KEY` 未設定 |
| ERR-AGENTS-0003 | OpenAI Base URL不正 | URL形式不正 |
| ERR-AGENTS-0004 | Ollama/LM Studio Model不足 | 各Model環境変数未設定 |
| ERR-AGENTS-0005 | Ollama/LM Studio Base URL不正 | URL形式不正 |
| ERR-AGENTS-0006 | Gemini/Anthropic/OpenRouter API Key不足 | 必須API Key未設定 |
| ERR-AGENTS-0007 | Gemini/Anthropic/OpenRouter Model不足 | 必須Model未設定 |
| ERR-AGENTS-0008 | Gemini/Anthropic/OpenRouter Base URL不正 | URL形式不正 |
| ERR-AGENTS-0009 | 設定検証失敗 | 値範囲/型の検証に失敗 |
| ERR-AGENTS-0010 | RunResult形式不整合 | `run`/`resumeRun` の返却が `RunResult` 契約を満たさない |
| ERR-AGENTS-0011 | 承認再開API失敗 | `approveAndResume` 実行中に承認状態不整合またはトークン不正が発生 |

## MSG-ID
| ID | メッセージ概要 |
|---|---|
| MSG-AGENTS-0001 | Provider指定が不正 |
| MSG-AGENTS-0002 | OpenAI API Key不足 |
| MSG-AGENTS-0003 | OpenAI Base URL不正 |
| MSG-AGENTS-0004 | Ollama/LM Studio Model不足 |
| MSG-AGENTS-0005 | Ollama/LM Studio Base URL不正 |
| MSG-AGENTS-0006 | Gemini/Anthropic/OpenRouter API Key不足 |
| MSG-AGENTS-0007 | Gemini/Anthropic/OpenRouter Model不足 |
| MSG-AGENTS-0008 | Gemini/Anthropic/OpenRouter Base URL不正 |
| MSG-AGENTS-0009 | 設定検証失敗 |
| MSG-AGENTS-0010 | RunResult形式不整合 |
| MSG-AGENTS-0011 | 承認再開API失敗 |
