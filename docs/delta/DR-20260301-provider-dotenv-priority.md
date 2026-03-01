# delta-request

## Delta ID
- DR-20260301-provider-dotenv-priority

## 目的
- Provider設定解決に `.env` を追加し、優先順を `直接指定 > .env > 環境変数` に統一する。

## 変更対象（In Scope）
- 対象1: Provider設定解決ロジックに `.env` 読み込みを追加する。
- 対象2: `getProvider` / `getModel` / `listModels` / `listProviderModels` の設定解決順を統一する。
- 対象3: 優先順を検証する単体テストを追加する。
- 対象4: spec/architecture/README を最小差分で更新する。

## 非対象（Out of Scope）
- 非対象1: `.env` 以外の設定ファイル（`.env.local` 等）対応。
- 非対象2: Provider追加や実行フロー（Runner/Safety/MCP/Skills）変更。
- 非対象3: `getModel` / `listModels` の返却型仕様変更。

## 差分仕様
- DS-01:
  - Given: 直接指定がある
  - When: Provider設定を解決する
  - Then: 直接指定を優先する
- DS-02:
  - Given: 直接指定がなく、`.env` と環境変数の両方に値がある
  - When: Provider設定を解決する
  - Then: `.env` の値を採用する
- DS-03:
  - Given: 直接指定と`.env`がなく、環境変数のみ値がある
  - When: Provider設定を解決する
  - Then: 環境変数を採用する

## 受入条件（Acceptance Criteria）
- AC-01: `getProvider()` は provider未指定時に `AGENTS_MODEL_PROVIDER` を `.env` 優先で解決できる。
- AC-02: `getModel` は `modelName` 直接指定 > `.env` > 環境変数で解決できる。
- AC-03: `listModels` は override > `.env` > 環境変数で `baseUrl` / `apiKey` / `model(s)` / `timeout` を解決できる。
- AC-04: `listProviderModels` は provider別override未指定時に `.env` > 環境変数で動作する。
- AC-05: `npm test` が通る。

## 制約
- 制約1: 変更は Provider関連実装/型/テスト/ドキュメントに限定する。
- 制約2: `.env` 読み込み失敗時は既存挙動（環境変数ベース）へフォールバックする。

## 未確定事項
- Q-01: `.env` のコメントやクォートの高度解釈は必要最小限とし、厳密互換は別deltaで扱う。

# delta-apply

## Delta ID
- DR-20260301-provider-dotenv-priority

## 実行ステータス
- APPLIED

## 変更ファイル
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
  - 変更: `getProvider()` の provider 解決に `.env` を追加し、`AGENTS_MODEL_PROVIDER` を `.env` 優先で参照。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-02:
  - 変更: `getModel` の `model/baseUrl/apiKey/timeout/openrouter headers` 解決を `直接指定 > .env > 環境変数` に統一。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-03:
  - 変更: `listModels` の options override 適用と `.env` 優先解決を実装。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-04:
  - 変更: `listProviderModels` の provider別処理で `.env` > 環境変数 を適用（override未指定時）。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-05:
  - 変更: 優先順テストを追加し、全体テストを通過。
  - 根拠: `test/providers.test.ts`

## 非対象維持の確認
- Out of Scope への変更なし: Yes
- もし No の場合の理由:

## verify 依頼メモ
- 検証してほしい観点: 優先順 `直接指定 > .env > 環境変数` が `getProvider/getModel/listModels/listProviderModels` で成立していること。

# delta-verify

## Delta ID
- DR-20260301-provider-dotenv-priority

## 検証結果（AC単位）
| AC | 結果(PASS/FAIL) | 根拠 |
|---|---|---|
| AC-01 | PASS | `getProvider uses .env before process.env when provider is omitted` がPASS。 |
| AC-02 | PASS | `getModel resolves with precedence direct > .env > process.env` がPASS。 |
| AC-03 | PASS | `provider listModels resolves with precedence direct > .env > process.env` がPASS。 |
| AC-04 | PASS | `listProviderModels` 既存/追加テストで `.env` 優先動作を確認。 |
| AC-05 | PASS | `npm test` 全件PASS。 |

## スコープ逸脱チェック
- Out of Scope 変更の有無: No
- 逸脱内容:

## 不整合/回帰リスク
- R-01: `.env` パーサは簡易実装のため、複雑な展開構文（変数展開等）は非対応。

## 判定
- Overall: PASS

## FAIL時の最小修正指示
- なし

# delta-archive

## Delta ID
- DR-20260301-provider-dotenv-priority

## クローズ判定
- verify結果: PASS
- archive可否: 可

## 確定内容
- 目的: Provider設定解決に `.env` を組み込み、優先順を `直接指定 > .env > 環境変数` へ統一した。
- 変更対象: Provider実装、Providerテスト、関連ドキュメント。
- 非対象: `.env.local` 等の追加ファイル対応、Provider追加、実行フロー変更。

## 実装記録
- 変更ファイル: `src/providers.ts`, `test/providers.test.ts`, `docs/spec.md`, `docs/architecture.md`, `docs/OVERVIEW.md`, `docs/plan.md`, `README.md`, `README.ja.md`
- AC達成状況: AC-01〜AC-05 達成

## 検証記録
- verify要約: 優先順テストを追加し、全体回帰テストを通過。
- 主要な根拠: `npm test` PASS。

## 未解決事項
- なし

## 次のdeltaへの引き継ぎ（任意）
- Seed-01: `.env.local` や `dotenv-expand` 相当の高度解釈が必要なら別deltaで対応する。
