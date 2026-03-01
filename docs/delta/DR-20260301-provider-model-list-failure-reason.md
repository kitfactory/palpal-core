# delta-request

## Delta ID
- DR-20260301-provider-model-list-failure-reason

## 目的
- `listModels` が runtime API 取得に失敗してフォールバックした場合、呼び出し側へ失敗理由を返せるようにする。

## 変更対象（In Scope）
- 対象1: `ProviderModelList` に runtime API 失敗理由の構造を追加する。
- 対象2: `listModels` で `/models` 取得失敗時に理由を構造化して返す。
- 対象3: 失敗理由（HTTP/timeout など）の単体テストを追加する。
- 対象4: spec/architecture/README/overview/plan を最小差分で更新する。

## 非対象（Out of Scope）
- 非対象1: `getModel` の例外仕様変更。
- 非対象2: Provider追加、Runner/Safety/MCP/Skills の変更。
- 非対象3: 失敗時に例外を投げる仕様への変更（今回は返却値に理由を含める）。

## 差分仕様
- DS-01:
  - Given: `listModels` が `GET {baseURL}/models` で non-2xx を受ける
  - When: フォールバック結果を返す
  - Then: `runtimeApiFailure.code = "http_error"` を含める
- DS-02:
  - Given: `listModels` が timeout で失敗する
  - When: フォールバック結果を返す
  - Then: `runtimeApiFailure.code = "timeout"` を含める
- DS-03:
  - Given: `listModels` が runtime API 成功でモデル一覧を得る
  - When: `resolution = "runtime_api"` を返す
  - Then: `runtimeApiFailure` は含めない

## 受入条件（Acceptance Criteria）
- AC-01: `ProviderModelList` に `runtimeApiFailure?: ProviderModelListFailure` が追加される。
- AC-02: non-2xx 失敗時に `runtimeApiFailure.code = "http_error"` が返る。
- AC-03: timeout 失敗時に `runtimeApiFailure.code = "timeout"` が返る。
- AC-04: runtime API 成功時は `runtimeApiFailure` を返さない。
- AC-05: `npm test` が通る。

## 制約
- 制約1: 既存 `resolution` 値集合は変更しない。
- 制約2: 変更は Provider実装/型/テスト/ドキュメントに限定する。

## 未確定事項
- Q-01: failure reason の公開フィールド最小集合（code/message/status/statusText）で開始し、追加は別deltaで扱う。

# delta-apply

## Delta ID
- DR-20260301-provider-model-list-failure-reason

## 実行ステータス
- APPLIED

## 変更ファイル
- src/types.ts
- src/providers.ts
- test/providers.test.ts
- docs/spec.md
- docs/architecture.md
- README.md
- README.ja.md
- docs/OVERVIEW.md
- docs/plan.md

## 適用内容（AC対応）
- AC-01:
  - 変更: `ProviderModelList` に `runtimeApiFailure?: ProviderModelListFailure` を追加し、failure型を新設。
  - 根拠: `src/types.ts`
- AC-02:
  - 変更: non-2xx 時に `runtimeApiFailure.code = "http_error"` を返す実装を追加。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-03:
  - 変更: timeout 時に `runtimeApiFailure.code = "timeout"` を返す実装と検証テストを追加。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-04:
  - 変更: runtime API 成功時は `runtimeApiFailure` を返さない挙動を検証。
  - 根拠: `test/providers.test.ts`
- AC-05:
  - 変更: `npm test` を実行し回帰を確認。
  - 根拠: テスト実行ログ

## 非対象維持の確認
- Out of Scope への変更なし: Yes
- もし No の場合の理由:

## verify 依頼メモ
- 検証してほしい観点: fallback時 failure reason 返却、成功時 failure reason 非返却、既存挙動回帰なし。

# delta-verify

## Delta ID
- DR-20260301-provider-model-list-failure-reason

## 検証結果（AC単位）
| AC | 結果(PASS/FAIL) | 根拠 |
|---|---|---|
| AC-01 | PASS | `src/types.ts` で `runtimeApiFailure` と failure型を追加。 |
| AC-02 | PASS | `provider listModels calls ollama models API...` で `http_error` と status=503 を確認。 |
| AC-03 | PASS | `provider listModels returns timeout failure reason when request aborts` がPASS。 |
| AC-04 | PASS | `provider listModels returns runtime_api values for ollama when API succeeds` で `runtimeApiFailure` 未設定を確認。 |
| AC-05 | PASS | `npm test` 全件PASS。 |

## スコープ逸脱チェック
- Out of Scope 変更の有無: No
- 逸脱内容:

## 不整合/回帰リスク
- R-01: `runtimeApiFailure` は optional 追加のため後方互換だが、利用側で厳密な等価比較をしている場合は期待値更新が必要。

## 判定
- Overall: PASS

## FAIL時の最小修正指示
- なし

# delta-archive

## Delta ID
- DR-20260301-provider-model-list-failure-reason

## クローズ判定
- verify結果: PASS
- archive可否: 可

## 確定内容
- 目的: `listModels` フォールバック時に失敗理由を返し、接続不備を呼び出し側で判別可能にした。
- 変更対象: Provider型/実装/テストと関連ドキュメント。
- 非対象: 例外仕様変更、Provider追加、実行フロー変更。

## 実装記録
- 変更ファイル: `src/types.ts`, `src/providers.ts`, `test/providers.test.ts`, `docs/spec.md`, `docs/architecture.md`, `README.md`, `README.ja.md`, `docs/OVERVIEW.md`, `docs/plan.md`
- AC達成状況: AC-01〜AC-05 達成

## 検証記録
- verify要約: HTTP失敗/timeout/成功時の failure reason 挙動をテストで固定し、全体回帰テストを通過。
- 主要な根拠: `npm test` PASS。

## 未解決事項
- なし

## 次のdeltaへの引き継ぎ（任意）
- Seed-01: failure reason に request-id や provider raw error body を含める拡張が必要なら別deltaで対応する。
