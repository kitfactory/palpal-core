# delta-request

## Delta ID
- DR-20260301-provider-model-list-doc-sync

## 目的
- 直近のProviderモデル一覧API変更（`listProviders`/サフィックス補完/短時間タイムアウト/`runtimeApiFailure`）をREADME等の利用者向け文書へ完全反映する。

## 変更対象（In Scope）
- 対象1: README/README.ja に `runtimeApiFailure` の実利用確認例を追記する。
- 対象2: 英日チュートリアル（2.1節）にサフィックス補完・タイムアウト・失敗理由確認の説明を追記する。
- 対象3: `docs/architecture.md` のAPI表で `provider.listModels` 出力説明に `runtimeApiFailure` を反映する。
- 対象4: `docs/OVERVIEW.md` / `docs/plan.md` に本deltaの記録を追加する。

## 非対象（Out of Scope）
- 非対象1: TypeScript実装/テストの変更。
- 非対象2: 仕様追加やAPIシグネチャ変更。
- 非対象3: `docs/delta` 過去履歴の書き換え。

## 差分仕様
- DS-01:
  - Given: 利用者がREADME/チュートリアルを見る
  - When: Providerモデル一覧APIの使い方を確認する
  - Then: サフィックス補完・タイムアウト優先順・`runtimeApiFailure` の扱いが分かる
- DS-02:
  - Given: 利用者が architecture のAPI一覧を見る
  - When: `provider.listModels` 出力を読む
  - Then: フォールバック時に失敗理由が返ることが分かる

## 受入条件（Acceptance Criteria）
- AC-01: README（英日）に `runtimeApiFailure` の確認例がある。
- AC-02: tutorials（英日）2.1節にサフィックス補完/タイムアウト/失敗理由の説明がある。
- AC-03: architecture の `provider.listModels` 出力説明に `runtimeApiFailure` が反映されている。
- AC-04: `node scripts/validate_delta_links.js --dir .` が通る。

## 制約
- 制約1: 変更は文書ファイルのみに限定する。
- 制約2: 既存文書の意味を壊さない最小追記とする。

## 未確定事項
- Q-01: なし

# delta-apply

## Delta ID
- DR-20260301-provider-model-list-doc-sync

## 実行ステータス
- APPLIED

## 変更ファイル
- README.md
- README.ja.md
- tutorials/en/getting-started.md
- tutorials/ja/getting-started.md
- docs/architecture.md
- docs/OVERVIEW.md
- docs/plan.md

## 適用内容（AC対応）
- AC-01:
  - 変更: README（英日）に `runtimeApiFailure` の確認例を追記。
  - 根拠: `README.md`, `README.ja.md`
- AC-02:
  - 変更: 英日チュートリアル2.1節にサフィックス補完/タイムアウト/失敗理由確認を追記。
  - 根拠: `tutorials/en/getting-started.md`, `tutorials/ja/getting-started.md`
- AC-03:
  - 変更: architecture の `provider.listModels` 出力説明へ `runtimeApiFailure` を追記。
  - 根拠: `docs/architecture.md`
- AC-04:
  - 変更: `docs/OVERVIEW.md` / `docs/plan.md` を更新し、deltaリンク整合対象を反映。
  - 根拠: `docs/OVERVIEW.md`, `docs/plan.md`

## 非対象維持の確認
- Out of Scope への変更なし: Yes
- もし No の場合の理由:

## verify 依頼メモ
- 検証してほしい観点: README/チュートリアルの利用説明同期、architecture表記同期、deltaリンク整合。

# delta-verify

## Delta ID
- DR-20260301-provider-model-list-doc-sync

## 検証結果（AC単位）
| AC | 結果(PASS/FAIL) | 根拠 |
|---|---|---|
| AC-01 | PASS | README（英日）に `runtimeApiFailure` の確認例を追加。 |
| AC-02 | PASS | tutorials（英日）2.1節へサフィックス補完/タイムアウト/失敗理由説明を追記。 |
| AC-03 | PASS | `docs/architecture.md` の `provider.listModels` 出力説明に `runtimeApiFailure` を反映。 |
| AC-04 | PASS | `node scripts/validate_delta_links.js --dir .` がPASS。 |

## スコープ逸脱チェック
- Out of Scope 変更の有無: No
- 逸脱内容:

## 不整合/回帰リスク
- R-01: 文書同期のみのため実装回帰リスクは低いが、将来仕様変更時にREADME/チュートリアルの同時更新を忘れると再不整合が発生する。

## 判定
- Overall: PASS

## FAIL時の最小修正指示
- なし

# delta-archive

## Delta ID
- DR-20260301-provider-model-list-doc-sync

## クローズ判定
- verify結果: PASS
- archive可否: 可

## 確定内容
- 目的: Providerモデル一覧APIに関する最新仕様を利用者向け文書へ同期した。
- 変更対象: README/README.ja/tutorials/en/tutorials/ja/architecture/overview/plan。
- 非対象: 実装・型・テストの変更。

## 実装記録
- 変更ファイル: `README.md`, `README.ja.md`, `tutorials/en/getting-started.md`, `tutorials/ja/getting-started.md`, `docs/architecture.md`, `docs/OVERVIEW.md`, `docs/plan.md`
- AC達成状況: AC-01〜AC-04 達成

## 検証記録
- verify要約: 文書差分を確認し、deltaリンク整合チェックを通過。
- 主要な根拠: `node scripts/validate_delta_links.js --dir .` PASS。

## 未解決事項
- なし

## 次のdeltaへの引き継ぎ（任意）
- Seed-01: README の provider設定例を `.env` セットアップ手順として別節で整理するdeltaを検討する。
