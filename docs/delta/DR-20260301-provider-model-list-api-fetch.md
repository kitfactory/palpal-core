# delta-request

## Delta ID
- DR-20260301-provider-model-list-api-fetch

## 目的
- `ollama`/`lmstudio` で `baseURL`（必要時はAPIキー）が解決できる場合、モデル一覧APIを呼んで返却する。

## 変更対象（In Scope）
- 対象1: Providerモデル一覧APIの取得ロジックを `ollama`/`lmstudio` 向けに追加する。
- 対象2: `listModels` / `listProviderModels` のI/Fを実行時API取得に対応させる。
- 対象3: 追加テスト（API成功時・fallback時）を実装する。
- 対象4: spec/architecture の契約を最小差分で更新する。

## 非対象（Out of Scope）
- 非対象1: `getModel` の実行モデル解決ロジック変更。
- 非対象2: OpenAI/Gemini/Anthropic/OpenRouter へのモデル一覧API実装追加。
- 非対象3: Runner/Safety/MCP/Skills の挙動変更。

## 差分仕様
- DS-01:
  - Given: Provider が `ollama` または `lmstudio`
  - When: `listModels()` を呼ぶ
  - Then: 解決済み `baseURL` に対してモデル一覧APIを呼ぶ
- DS-02:
  - Given: `ollama`/`lmstudio` のモデル一覧API呼び出しが成功
  - When: レスポンスを解析する
  - Then: API由来モデル一覧を返却する
- DS-03:
  - Given: `ollama`/`lmstudio` のモデル一覧API呼び出しが失敗
  - When: `listModels()` を呼ぶ
  - Then: 既存の環境変数ベース解決（configured/default/environment_dependent）へフォールバックする

## 受入条件（Acceptance Criteria）
- AC-01: `getProvider("ollama").listModels()` は `baseURL` 解決時にモデル一覧APIを呼ぶ。
- AC-02: `getProvider("lmstudio").listModels()` は `baseURL` 解決時にモデル一覧APIを呼ぶ。
- AC-03: API成功時は `resolution=runtime_api` で API 返却モデル一覧を返す。
- AC-04: API失敗時でも例外で中断せず、既存fallback解決で返せる。
- AC-05: 既存テストを壊さず、追加テストを含めて `npm test` が通る。

## 制約
- 制約1: 変更は Provider API/型/テスト/関連ドキュメントのみに限定する。
- 制約2: 既存の環境変数規約（`AGENTS_OLLAMA_*`, `AGENTS_LMSTUDIO_*`）を維持する。

## 未確定事項
- Q-01: `ollama` のモデル一覧取得に `/v1/models` と `/api/tags` の両対応が必要か（今回は OpenAI互換 `/models` を優先する）。

# delta-apply

## Delta ID
- DR-20260301-provider-model-list-api-fetch

## 実行ステータス
- APPLIED

## 変更ファイル
- src/types.ts
- src/providers.ts
- test/providers.test.ts
- docs/spec.md
- docs/architecture.md
- docs/OVERVIEW.md
- docs/plan.md
- README.md
- README.ja.md

## 適用内容（AC対応）
- AC-01:
  - 変更: `ollama` の `listModels()` 呼び出し時に `GET {baseURL}/models` を実行するロジックを追加。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-02:
  - 変更: `lmstudio` の `listModels()` 呼び出し時に `GET {baseURL}/models` を実行するロジックを追加。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-03:
  - 変更: API成功時は `resolution: "runtime_api"` と APIモデル一覧を返すように実装。
  - 根拠: `src/types.ts`, `src/providers.ts`, `test/providers.test.ts`
- AC-04:
  - 変更: API失敗時は `configured/default/environment_dependent` へフォールバックする実装を追加。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-05:
  - 変更: 非同期API化（`listModels(): Promise<...>`, `listProviderModels(): Promise<...>`）と回帰テスト調整を実施。
  - 根拠: `src/types.ts`, `src/providers.ts`, `test/providers.test.ts`

## 非対象維持の確認
- Out of Scope への変更なし: Yes
- もし No の場合の理由:

## verify 依頼メモ
- 検証してほしい観点: `ollama/lmstudio` でAPI呼び出しが行われること、API失敗時fallbackが維持されること、既存テスト回帰がないこと。

# delta-verify

## Delta ID
- DR-20260301-provider-model-list-api-fetch

## 検証結果（AC単位）
| AC | 結果(PASS/FAIL) | 根拠 |
|---|---|---|
| AC-01 | PASS | `test/providers.test.ts` の `ollama` ケースで `/v1/models` 呼び出しを検証し通過。 |
| AC-02 | PASS | `test/providers.test.ts` の `lmstudio` ケースで API 成功時の一覧返却を検証し通過。 |
| AC-03 | PASS | API成功時に `resolution=runtime_api` を返すテストが通過。 |
| AC-04 | PASS | API失敗時に `configured/environment_dependent` へフォールバックするテストが通過。 |
| AC-05 | PASS | `npm test` 全件PASS。 |

## スコープ逸脱チェック
- Out of Scope 変更の有無: No
- 逸脱内容:

## 不整合/回帰リスク
- R-01: `ollama` の非OpenAI互換エンドポイント（`/api/tags`）への切替は未対応（Out of Scope）。

## 判定
- Overall: PASS

## FAIL時の最小修正指示
- なし

# delta-archive

## Delta ID
- DR-20260301-provider-model-list-api-fetch

## クローズ判定
- verify結果: PASS
- archive可否: 可

## 確定内容
- 目的: `ollama/lmstudio` の `listModels` が baseURL 解決時に実モデル一覧APIを参照できるようにした。
- 変更対象: Provider型定義、Provider実装、Providerテスト、関連ドキュメント。
- 非対象: 他Providerのモデル一覧API追加、`getModel` 挙動変更、Runner/Safety/MCP/Skills変更。

## 実装記録
- 変更ファイル: `src/types.ts`, `src/providers.ts`, `test/providers.test.ts`, `docs/spec.md`, `docs/architecture.md`, `docs/OVERVIEW.md`, `docs/plan.md`, `README.md`, `README.ja.md`
- AC達成状況: AC-01〜AC-05 すべて達成

## 検証記録
- verify要約: `ollama/lmstudio` のAPI参照、成功時 `runtime_api`、失敗時fallback、回帰テストを確認。
- 主要な根拠: `npm test` 全件PASS。

## 未解決事項
- なし

## 次のdeltaへの引き継ぎ（任意）
- Seed-01: `ollama` の `/api/tags` 互換対応が必要なら別deltaで追加する。
