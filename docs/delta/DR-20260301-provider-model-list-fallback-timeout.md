# delta-request

## Delta ID
- DR-20260301-provider-model-list-fallback-timeout

## 目的
- Providerモデル一覧APIに到達できない場合の返却値を仕様として明確化する。
- `listModels` のモデル一覧APIタイムアウト既定値を短めにして、失敗時フォールバックへ早く戻す。

## 変更対象（In Scope）
- 対象1: `listModels` のタイムアウト解決にモデル一覧専用既定値を導入する（短め）。
- 対象2: API未到達時の返却値（`configured/default/environment_dependent`）を仕様書へ明記する。
- 対象3: API未到達時の返却値とタイムアウト解決順を検証する単体テストを追加する。
- 対象4: 仕様/設計/README/overview/plan を最小差分で更新する。

## 非対象（Out of Scope）
- 非対象1: Provider追加、`getModel` 契約変更、Runner/Safety/MCP/Skills 変更。
- 非対象2: `/models` 以外のProvider固有一覧エンドポイント追加。
- 非対象3: `ProviderModelList` 型への新規フィールド追加（例: failure_reason）。

## 差分仕様
- DS-01:
  - Given: `listModels(options?)` 呼び出し時に `timeoutMs`/`TIMEOUT_MS` 指定がある
  - When: タイムアウトを解決する
  - Then: 直接指定を最優先で使用する
- DS-02:
  - Given: `listModels` で直接指定がない
  - When: タイムアウトを解決する
  - Then: `AGENTS_MODEL_LIST_TIMEOUT_MS` > `AGENTS_REQUEST_TIMEOUT_MS` > 既定短時間 の順で解決する
- DS-03:
  - Given: モデル一覧APIが timeout / network error / non-2xx / 無効payload / 空配列
  - When: `listModels` が判定する
  - Then: `configured`（設定モデルあり）または `default`（既定モデルあり）または `environment_dependent`（どちらもなし）を返す

## 受入条件（Acceptance Criteria）
- AC-01: `listModels` のタイムアウト既定値が短時間（2秒）である。
- AC-02: `listModels` のタイムアウト解決順が `direct > AGENTS_MODEL_LIST_TIMEOUT_MS > AGENTS_REQUEST_TIMEOUT_MS > default(2000ms)` になる。
- AC-03: API未到達時、設定モデルがあれば `resolution=configured` で返る。
- AC-04: API未到達時、設定モデルがなく既定モデルがあれば `resolution=default` で返る。
- AC-05: API未到達時、設定モデル・既定モデルともなければ `resolution=environment_dependent` で `models=[]` を返る。
- AC-06: `npm test` が通る。

## 制約
- 制約1: 変更は Provider実装/型/テスト/ドキュメントに限定する。
- 制約2: 既存の `ProviderModelListResolution` 値集合は変更しない。

## 未確定事項
- Q-01: 将来、timeout理由を型で返す必要があれば別deltaで扱う。

# delta-apply

## Delta ID
- DR-20260301-provider-model-list-fallback-timeout

## 実行ステータス
- APPLIED

## 変更ファイル
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
  - 変更: `listModels` の既定タイムアウトを `2000ms` に更新。
  - 根拠: `src/providers.ts`
- AC-02:
  - 変更: `listModels` のタイムアウト解決順を `direct > AGENTS_MODEL_LIST_TIMEOUT_MS > AGENTS_REQUEST_TIMEOUT_MS > 2000ms` に実装。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-03:
  - 変更: API未到達時の `configured` フォールバック検証を維持（既存LMStudioテスト）。
  - 根拠: `test/providers.test.ts`
- AC-04:
  - 変更: API未到達時の `default` フォールバック検証（OpenAI）を追加。
  - 根拠: `test/providers.test.ts`
- AC-05:
  - 変更: API未到達時の `environment_dependent` フォールバック検証（Anthropic）を追加。
  - 根拠: `test/providers.test.ts`
- AC-06:
  - 変更: 回帰テストを実行し成功を確認。
  - 根拠: `npm test` 実行結果

## 非対象維持の確認
- Out of Scope への変更なし: Yes
- もし No の場合の理由:

## verify 依頼メモ
- 検証してほしい観点: タイムアウト優先順、API未到達時の返却値仕様（configured/default/environment_dependent）の成立。

# delta-verify

## Delta ID
- DR-20260301-provider-model-list-fallback-timeout

## 検証結果（AC単位）
| AC | 結果(PASS/FAIL) | 根拠 |
|---|---|---|
| AC-01 | PASS | `test/providers.test.ts` の timeout検証テストで既定2秒相当の挙動を確認。 |
| AC-02 | PASS | `provider listModels timeout precedence ...` テストで優先順を確認。 |
| AC-03 | PASS | `provider listModels falls back to configured values for lmstudio when API fails` がPASS。 |
| AC-04 | PASS | `provider listModels falls back to default when API is unreachable and provider has default model` がPASS。 |
| AC-05 | PASS | `provider listModels falls back to environment_dependent when API is unreachable and no configured/default model exists` がPASS。 |
| AC-06 | PASS | `npm test` 全件PASS。 |

## スコープ逸脱チェック
- Out of Scope 変更の有無: No
- 逸脱内容:

## 不整合/回帰リスク
- R-01: `listModels` 既定タイムアウト短縮により、応答遅延が大きい環境では `runtime_api` 取得が失敗しフォールバックしやすくなる。

## 判定
- Overall: PASS

## FAIL時の最小修正指示
- なし

# delta-archive

## Delta ID
- DR-20260301-provider-model-list-fallback-timeout

## クローズ判定
- verify結果: PASS
- archive可否: 可

## 確定内容
- 目的: モデル一覧API未到達時の返却値仕様を明文化し、`listModels` のタイムアウト既定値を短時間化した。
- 変更対象: Provider実装、Providerテスト、spec/architecture/README/overview/plan。
- 非対象: Provider追加、型拡張、固有エンドポイント追加。

## 実装記録
- 変更ファイル: `src/providers.ts`, `test/providers.test.ts`, `docs/spec.md`, `docs/architecture.md`, `README.md`, `README.ja.md`, `docs/OVERVIEW.md`, `docs/plan.md`
- AC達成状況: AC-01〜AC-06 達成

## 検証記録
- verify要約: タイムアウト優先順・API未到達時フォールバック値を単体テストで検証し、全体回帰テストを通過。
- 主要な根拠: `npm test` PASS。

## 未解決事項
- なし

## 次のdeltaへの引き継ぎ（任意）
- Seed-01: Providerごとに最適な一覧取得タイムアウト/再試行戦略を分離調整するdeltaを検討する。
