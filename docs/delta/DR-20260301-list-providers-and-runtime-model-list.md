# delta-request

## Delta ID
- DR-20260301-list-providers-and-runtime-model-list

## 目的
- Provider列挙APIを `listProviderModels()` から `listProviders()` へ置き換える。
- `listModels(options?)` で providerごとのモデル一覧API取得を優先し、未指定時は `.env` > 環境変数で設定解決する。

## 変更対象（In Scope）
- 対象1: 公開APIから `listProviderModels` を廃止し、`listProviders` を追加する。
- 対象2: `listModels(options?)` の option解決を `直接指定 > .env > 環境変数` に統一し、各providerでモデル一覧API（`GET {baseUrl}/models`）取得を試行する。
- 対象3: `listModels(options?)` が `API_KEY` / `BASE_URL`（既存の `apiKey` / `baseUrl` 含む）を受け取り解決に使えるようにする。
- 対象4: 型定義・テスト・README/チュートリアル/spec/architecture/plan/overview を最小差分で更新する。

## 非対象（Out of Scope）
- 非対象1: Provider追加、Runner/Safety/MCP/Skills の挙動変更。
- 非対象2: `getModel` の入出力契約変更。
- 非対象3: `/models` 以外のprovider固有モデル一覧エンドポイント対応（例: `/api/tags`）の追加。

## 差分仕様
- DS-01:
  - Given: 利用者が対応Provider一覧を取得したい
  - When: `listProviders()` を呼ぶ
  - Then: 対応Provider名配列を返す
- DS-02:
  - Given: 利用者が `getProvider("<provider>").listModels(options?)` を呼ぶ
  - When: `baseUrl/apiKey`（または `BASE_URL/API_KEY`）を直接指定する
  - Then: 直接指定を優先して `GET {baseUrl}/models` を試行する
- DS-03:
  - Given: `listModels` の options未指定または一部未指定
  - When: 設定解決を行う
  - Then: `.env` > 環境変数 の順で `baseUrl/apiKey/model(s)/timeout` を解決する
- DS-04:
  - Given: モデル一覧APIが失敗または空配列を返す
  - When: `listModels` がフォールバック判定する
  - Then: 既存の `configured/default/environment_dependent` 解決へフォールバックする

## 受入条件（Acceptance Criteria）
- AC-01: `listProviderModels` が公開API/型から除去され、`listProviders(): ProviderName[]` が利用できる。
- AC-02: `listProviders()` は `openai/ollama/lmstudio/gemini/anthropic/openrouter` を返す。
- AC-03: すべてのProviderで `listModels()` が `GET {baseUrl}/models` を試行し、成功時 `resolution=runtime_api` を返す。
- AC-04: `listModels()` は `API_KEY` / `BASE_URL`（または `apiKey` / `baseUrl`）直接指定を受け取り、優先的に解決できる。
- AC-05: options未指定時、`.env` > 環境変数の優先順で解決される。
- AC-06: 失敗時フォールバック（`configured/default/environment_dependent`）が維持される。
- AC-07: `npm test` が通る。

## 制約
- 制約1: 変更は Provider関連実装/型/テスト/ドキュメントに限定する。
- 制約2: ACに紐づかないリファクタや命名変更を行わない。

## 未確定事項
- Q-01: `listProviderModels` の互換エイリアスを残さず完全廃止する方針で進める（今回の要求に従う）。

# delta-apply

## Delta ID
- DR-20260301-list-providers-and-runtime-model-list

## 実行ステータス
- APPLIED

## 変更ファイル
- src/providers.ts
- src/types.ts
- test/providers.test.ts
- README.md
- README.ja.md
- tutorials/en/getting-started.md
- tutorials/ja/getting-started.md
- docs/spec.md
- docs/architecture.md
- docs/OVERVIEW.md
- docs/plan.md

## 適用内容（AC対応）
- AC-01:
  - 変更: `listProviderModels` を削除し、`listProviders(): ProviderName[]` を追加。関連型（`ListProviderModelsOptions`/`ProviderModelCatalog`）を削除。
  - 根拠: `src/providers.ts`, `src/types.ts`, `test/providers.test.ts`
- AC-02:
  - 変更: `listProviders` の返却値を全対応Provider名の固定配列に実装し、単体テストを追加。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-03:
  - 変更: `listModels` は全Providerで `GET {baseUrl}/models` を試行し、成功時 `runtime_api` を返すように変更。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-04:
  - 変更: `listModels` options に `BASE_URL/API_KEY`（および `MODEL/MODELS/TIMEOUT_MS`）を追加し、直接指定優先で解決する実装とテストを追加。
  - 根拠: `src/types.ts`, `src/providers.ts`, `test/providers.test.ts`
- AC-05:
  - 変更: 設定解決順（`直接指定 > .env > 環境変数`）の既存テストを維持し、`listModels` で継続成立を確認。
  - 根拠: `test/providers.test.ts`
- AC-06:
  - 変更: runtime API失敗時に `configured/default/environment_dependent` へフォールバックする既存分岐を維持。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-07:
  - 変更: 回帰テストを含む `npm test` を実行して成功を確認。
  - 根拠: テスト実行ログ

## 非対象維持の確認
- Out of Scope への変更なし: Yes
- もし No の場合の理由:

## verify 依頼メモ
- 検証してほしい観点: `listProviders` 置換、`listModels` の全Provider `/models` 試行、`API_KEY/BASE_URL` 直接指定優先、フォールバック維持。

# delta-verify

## Delta ID
- DR-20260301-list-providers-and-runtime-model-list

## 検証結果（AC単位）
| AC | 結果(PASS/FAIL) | 根拠 |
|---|---|---|
| AC-01 | PASS | `src/providers.ts` で `listProviderModels` を削除し `listProviders` を追加。`src/types.ts` から関連型を削除。 |
| AC-02 | PASS | `test/providers.test.ts` の `listProviders returns all supported providers` がPASS。 |
| AC-03 | PASS | `test/providers.test.ts` の `provider listModels tries runtime API for all supported providers` がPASS。 |
| AC-04 | PASS | `test/providers.test.ts` の `provider listModels accepts override BASE_URL/API_KEY aliases` がPASS。 |
| AC-05 | PASS | `test/providers.test.ts` の `provider listModels resolves with precedence direct > .env > process.env` がPASS。 |
| AC-06 | PASS | `ollama/lmstudio` のAPI失敗時フォールバック検証テストがPASS。 |
| AC-07 | PASS | `npm test` 全件PASS。 |

## スコープ逸脱チェック
- Out of Scope 変更の有無: No
- 逸脱内容:

## 不整合/回帰リスク
- R-01: `/models` 実API仕様がProvider固有で異なる場合、`runtime_api` 取得は失敗しフォールバックする。

## 判定
- Overall: PASS

## FAIL時の最小修正指示
- なし

# delta-archive

## Delta ID
- DR-20260301-list-providers-and-runtime-model-list

## クローズ判定
- verify結果: PASS
- archive可否: 可

## 確定内容
- 目的: Provider一覧取得APIを `listProviders` へ統一し、`listModels` を全Providerで実行時 `/models` 取得試行する仕様へ更新した。
- 変更対象: Provider実装/型/テスト、および公開ドキュメント（README/tutorial/spec/architecture/overview/plan）。
- 非対象: Provider追加、Runner/Safety/MCP/Skills変更、`/api/tags` 等の固有エンドポイント対応追加。

## 実装記録
- 変更ファイル: `src/providers.ts`, `src/types.ts`, `test/providers.test.ts`, `README.md`, `README.ja.md`, `tutorials/en/getting-started.md`, `tutorials/ja/getting-started.md`, `docs/spec.md`, `docs/architecture.md`, `docs/OVERVIEW.md`, `docs/plan.md`
- AC達成状況: AC-01〜AC-07 達成

## 検証記録
- verify要約: API置換・オプション解決・フォールバックを単体テストで検証し、全体回帰テストを通過。
- 主要な根拠: `npm test` PASS、`test/providers.test.ts` の追加/更新ケースPASS。

## 未解決事項
- なし

## 次のdeltaへの引き継ぎ（任意）
- Seed-01: Provider固有モデル一覧API（例: Anthropic専用ヘッダ、Ollama `/api/tags`）最適化が必要なら別deltaで対応する。
