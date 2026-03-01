# delta-request

## Delta ID
- DR-20260301-provider-model-list-overrides

## 目的
- `listProviderModels` でプロバイダーごとにカテゴライズしたモデル情報を取得できるようにする。
- `listProviderModels` / `listModels` にプロバイダー別 `baseURL` / `apiKey` などのオプション引数を追加し、未指定時は環境変数を使う。

## 変更対象（In Scope）
- 対象1: Providerモデル一覧APIの型定義を拡張（オプション引数、カテゴライズ返却）。
- 対象2: `listProviderModels` にプロバイダー別 override オプションを追加する。
- 対象3: `ProviderHandle.listModels` に override オプションを追加する。
- 対象4: 単体テストを追加し、既存テストを更新する。
- 対象5: spec/architecture/README を最小差分で更新する。

## 非対象（Out of Scope）
- 非対象1: `getModel` のシグネチャ変更。
- 非対象2: Provider追加やRunner/Safety/MCP/Skillsの挙動変更。
- 非対象3: 既存のモデル呼び出し（`/chat/completions`）仕様変更。

## 差分仕様
- DS-01:
  - Given: 利用者が `listProviderModels()` を呼ぶ
  - When: 戻り値を受け取る
  - Then: プロバイダー別に参照できるカテゴライズ情報（map）を含む
- DS-02:
  - Given: 利用者が `listProviderModels({ overrides })` を呼ぶ
  - When: `baseURL` / `apiKey` / `model(s)` などの override を渡す
  - Then: 指定Providerは override を優先し、未指定Providerは環境変数ベースで解決する
- DS-03:
  - Given: 利用者が `getProvider("ollama").listModels(options)` を呼ぶ
  - When: options が指定される
  - Then: options 優先でモデル一覧解決・API呼び出しを行う

## 受入条件（Acceptance Criteria）
- AC-01: `listProviderModels()` は `providers` と `byProvider` を返却する。
- AC-02: `listProviderModels({ providers: ["ollama"], overrides: {...} })` で対象Providerのみ取得できる。
- AC-03: `overrides` で渡した `baseURL`/`apiKey` が API 呼び出しに反映される。
- AC-04: override 未指定時は従来どおり環境変数ベースで動作する。
- AC-05: `npm test` が通る。

## 制約
- 制約1: 変更は Provider関連API/型/テスト/関連ドキュメントに限定する。
- 制約2: 既存の `listModels` fallback方針（runtime_api -> configured/default/environment_dependent）は維持する。

## 未確定事項
- Q-01: `overrides` の `headers` を公開するか（今回は `baseURL/apiKey/model/models/timeoutMs` に限定）。

# delta-apply

## Delta ID
- DR-20260301-provider-model-list-overrides

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
  - 変更: `listProviderModels()` の戻り値を `{ providers, byProvider }` に拡張。
  - 根拠: `src/types.ts`, `src/providers.ts`, `test/providers.test.ts`
- AC-02:
  - 変更: `listProviderModels(options?)` に `providers` フィルタを追加し、対象Providerのみ取得可能にした。
  - 根拠: `src/types.ts`, `src/providers.ts`, `test/providers.test.ts`
- AC-03:
  - 変更: `options.overrides.<provider>.baseUrl/apiKey` が `GET {baseURL}/models` 呼び出しへ反映されるようにした。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-04:
  - 変更: override未指定時は環境変数（および既定値）で解決する処理を維持。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-05:
  - 変更: テスト更新・追加を実施し、全体回帰を確認可能にした。
  - 根拠: `test/providers.test.ts`

## 非対象維持の確認
- Out of Scope への変更なし: Yes
- もし No の場合の理由:

## verify 依頼メモ
- 検証してほしい観点: `listProviderModels` のカテゴリ返却、provider別override反映、環境変数fallback維持。

# delta-verify

## Delta ID
- DR-20260301-provider-model-list-overrides

## 検証結果（AC単位）
| AC | 結果(PASS/FAIL) | 根拠 |
|---|---|---|
| AC-01 | PASS | `listProviderModels` が `providers` と `byProvider` を返すテストが通過。 |
| AC-02 | PASS | `providers: ["ollama"]` 指定時に単一Providerのみ返すテストが通過。 |
| AC-03 | PASS | overrideした `baseUrl`/`apiKey` が呼び出しURL/Authorizationヘッダへ反映されるテストが通過。 |
| AC-04 | PASS | override未指定の既存ケースで環境変数ベース動作が維持されていることを確認。 |
| AC-05 | PASS | `npm test` 全件PASS。 |

## スコープ逸脱チェック
- Out of Scope 変更の有無: No
- 逸脱内容:

## 不整合/回帰リスク
- R-01: `listProviderModels` の戻り値が配列からオブジェクトへ変更されたため、既存利用側は追従が必要。

## 判定
- Overall: PASS

## FAIL時の最小修正指示
- なし

# delta-archive

## Delta ID
- DR-20260301-provider-model-list-overrides

## クローズ判定
- verify結果: PASS
- archive可否: 可

## 確定内容
- 目的: Providerモデル一覧取得をプロバイダー別カテゴリで扱いやすくし、provider別override入力に対応した。
- 変更対象: Provider型/API/テスト/関連ドキュメント。
- 非対象: `getModel`シグネチャ変更、Provider追加、Runner/Safety/MCP/Skills変更。

## 実装記録
- 変更ファイル: `src/types.ts`, `src/providers.ts`, `test/providers.test.ts`, `docs/spec.md`, `docs/architecture.md`, `docs/OVERVIEW.md`, `docs/plan.md`, `README.md`, `README.ja.md`
- AC達成状況: AC-01〜AC-05 達成

## 検証記録
- verify要約: カテゴリ返却・override反映・fallback維持をテストで検証し、全体回帰を通過。
- 主要な根拠: `npm test` PASS。

## 未解決事項
- なし

## 次のdeltaへの引き継ぎ（任意）
- Seed-01: 既存利用者向けに `listProviderModels().providers` への移行ガイドを追加するdeltaを検討する。
