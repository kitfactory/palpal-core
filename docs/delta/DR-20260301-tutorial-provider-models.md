# delta-request

## Delta ID
- DR-20260301-tutorial-provider-models

## 目的
- チュートリアル（英語/日本語）に Provider モデル一覧取得APIの最新仕様を反映する。

## 変更対象（In Scope）
- 対象1: `tutorials/en/getting-started.md` に `listModels`/`listProviderModels` の利用例を追加する。
- 対象2: `tutorials/ja/getting-started.md` に同内容を日本語で追加する。
- 対象3: 設定解決順 `直接指定 > .env > 環境変数` を明記する。

## 非対象（Out of Scope）
- 非対象1: 実装コード（`src/**`）の変更。
- 非対象2: README/spec/architecture の追加変更。
- 非対象3: サンプルコード（`tutorials/samples/**`）の変更。

## 差分仕様
- DS-01:
  - Given: 利用者がチュートリアルを読む
  - When: Provider関連章を確認する
  - Then: `listModels` / `listProviderModels` の使い方と返却形式（`providers`/`byProvider`）を理解できる
- DS-02:
  - Given: 利用者が設定優先順を確認したい
  - When: 追加記載を確認する
  - Then: `直接指定 > .env > 環境変数` の順で解決されることがわかる

## 受入条件（Acceptance Criteria）
- AC-01: 英語チュートリアルに `listModels` / `listProviderModels` の記載がある。
- AC-02: 日本語チュートリアルに同等内容の記載がある。
- AC-03: 両言語で設定優先順が記載されている。
- AC-04: `node scripts/validate_delta_links.js --dir .` が通る。

## 制約
- 制約1: 既存チュートリアル構成を崩さず追記のみで対応する。
- 制約2: 記述内容は現在実装済みAPIと一致させる。

## 未確定事項
- Q-01: なし

# delta-apply

## Delta ID
- DR-20260301-tutorial-provider-models

## 実行ステータス
- APPLIED

## 変更ファイル
- tutorials/en/getting-started.md
- tutorials/ja/getting-started.md

## 適用内容（AC対応）
- AC-01:
  - 変更: 英語チュートリアルに `listModels` / `listProviderModels` と `providers/byProvider` 利用例を追記。
  - 根拠: `tutorials/en/getting-started.md`
- AC-02:
  - 変更: 日本語チュートリアルに同等の利用例を追記。
  - 根拠: `tutorials/ja/getting-started.md`
- AC-03:
  - 変更: 両言語に設定優先順 `direct options > .env > process.env` / `直接指定 > .env > 環境変数` を追記。
  - 根拠: `tutorials/en/getting-started.md`, `tutorials/ja/getting-started.md`
- AC-04:
  - 変更: Deltaリンク整合を確認できる状態にした（plan反映と併せてverifyで実施）。
  - 根拠: `docs/plan.md`

## 非対象維持の確認
- Out of Scope への変更なし: Yes
- もし No の場合の理由:

## verify 依頼メモ
- 検証してほしい観点: チュートリアル記述が現行API（`listProviderModels` の戻り値と優先順）と一致していること。

# delta-verify

## Delta ID
- DR-20260301-tutorial-provider-models

## 検証結果（AC単位）
| AC | 結果(PASS/FAIL) | 根拠 |
|---|---|---|
| AC-01 | PASS | 英語チュートリアルに `listModels/listProviderModels` と `providers/byProvider` を追記済み。 |
| AC-02 | PASS | 日本語チュートリアルに同等記載を追記済み。 |
| AC-03 | PASS | 両言語で優先順を明記済み。 |
| AC-04 | PASS | `node scripts/validate_delta_links.js --dir .` が PASS。 |

## スコープ逸脱チェック
- Out of Scope 変更の有無: No
- 逸脱内容:

## 不整合/回帰リスク
- R-01: なし（ドキュメント変更のみ）。

## 判定
- Overall: PASS

## FAIL時の最小修正指示
- なし

# delta-archive

## Delta ID
- DR-20260301-tutorial-provider-models

## クローズ判定
- verify結果: PASS
- archive可否: 可

## 確定内容
- 目的: チュートリアルのProviderモデル一覧取得手順を最新I/Fへ更新した。
- 変更対象: 英語/日本語チュートリアル。
- 非対象: 実装コード・サンプルコード・他文書の追加変更。

## 実装記録
- 変更ファイル: `tutorials/en/getting-started.md`, `tutorials/ja/getting-started.md`
- AC達成状況: AC-01〜AC-04 達成

## 検証記録
- verify要約: チュートリアル追記内容と優先順記載を確認し、deltaリンク整合を通過。
- 主要な根拠: `node scripts/validate_delta_links.js --dir .` PASS。

## 未解決事項
- なし

## 次のdeltaへの引き継ぎ（任意）
- Seed-01: `tutorials/samples/**` にもモデル一覧取得サンプルを追加する場合は別deltaで対応する。
