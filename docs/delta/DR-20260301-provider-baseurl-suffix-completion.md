# delta-request

## Delta ID
- DR-20260301-provider-baseurl-suffix-completion

## 目的
- 利用者が `.env` / 環境変数 / options で指定した `baseUrl` に provider必須サフィックスが無い場合、自動補完して OpenAI互換エンドポイントに到達しやすくする。

## 変更対象（In Scope）
- 対象1: Providerごとの `baseUrl` 解決処理でサフィックス補完を追加する。
- 対象2: `getModel` と `listModels` の両方で同一補完ルールを適用する。
- 対象3: サフィックス補完の単体テストを追加する（Anthropic/Gemini/OpenRouterを含む）。
- 対象4: spec/architecture/README/overview/plan を最小差分で更新する。

## 非対象（Out of Scope）
- 非対象1: Provider追加、Runner/Safety/MCP/Skills の変更。
- 非対象2: `/chat/completions` や `/models` のパス仕様変更。
- 非対象3: URLバリデーション強化やエラー型追加。

## 差分仕様
- DS-01:
  - Given: 利用者が provider の `baseUrl` をサフィックスなしで指定する（例: `https://api.anthropic.com`）
  - When: `getProvider(provider).getModel()` または `.listModels()` が baseUrl を解決する
  - Then: provider既定サフィックス（例: `/v1`）を補完して利用する
- DS-02:
  - Given: 利用者が既にサフィックス込みの `baseUrl` を指定する
  - When: baseUrl を解決する
  - Then: 重複補完しない
- DS-03:
  - Given: options 直接指定 / `.env` / 環境変数のいずれの経路
  - When: baseUrl を解決する
  - Then: 解決順は維持（直接指定 > .env > 環境変数）し、採用値に対して補完を適用する

## 受入条件（Acceptance Criteria）
- AC-01: `getModel` で Anthropic の `baseUrl` がサフィックス無し指定時に `/v1` が補完される。
- AC-02: `listModels` で Gemini の `baseUrl` がサフィックス無し指定時に `/v1beta/openai` が補完される。
- AC-03: `listModels` で OpenRouter の `baseUrl` がサフィックス無し指定時に `/api/v1` が補完される。
- AC-04: 既にサフィックスありの `baseUrl` には重複補完しない。
- AC-05: `npm test` が通る。

## 制約
- 制約1: 変更は Provider実装/テスト/ドキュメントに限定する。
- 制約2: 既存公開APIシグネチャは変更しない。

## 未確定事項
- Q-01: 末尾クエリや特殊URLの高度正規化は今回対象外とする。

# delta-apply

## Delta ID
- DR-20260301-provider-baseurl-suffix-completion

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
  - 変更: `getModel` の baseUrl解決に providerサフィックス補完を適用し、Anthropic の `/v1` 補完を実装。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-02:
  - 変更: `listModels` の baseUrl解決に同補完を適用し、Gemini の `/v1beta/openai` 補完を実装。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-03:
  - 変更: OpenRouter の `/api/v1` 補完を実装。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-04:
  - 変更: 既存サフィックスあり時は重複補完しない判定を実装。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-05:
  - 変更: 回帰テストを含む `npm test` を実行し成功を確認。
  - 根拠: テスト実行ログ

## 非対象維持の確認
- Out of Scope への変更なし: Yes
- もし No の場合の理由:

## verify 依頼メモ
- 検証してほしい観点: provider別サフィックス補完、重複補完なし、`getModel/listModels` 両経路適用。

# delta-verify

## Delta ID
- DR-20260301-provider-baseurl-suffix-completion

## 検証結果（AC単位）
| AC | 結果(PASS/FAIL) | 根拠 |
|---|---|---|
| AC-01 | PASS | `getModel appends provider suffix when anthropic baseUrl does not include /v1` がPASS。 |
| AC-02 | PASS | `provider listModels appends gemini /v1beta/openai suffix when missing` がPASS。 |
| AC-03 | PASS | `provider listModels appends openrouter /api/v1 suffix when missing` がPASS。 |
| AC-04 | PASS | `provider listModels does not duplicate suffix when baseUrl already includes provider suffix` がPASS。 |
| AC-05 | PASS | `npm test` 全件PASS。 |

## スコープ逸脱チェック
- Out of Scope 変更の有無: No
- 逸脱内容:

## 不整合/回帰リスク
- R-01: 補完ロジックは provider既定URLの pathname を基準にするため、特殊なカスタムパスを意図した場合は明示的に完全URL指定が必要。

## 判定
- Overall: PASS

## FAIL時の最小修正指示
- なし

# delta-archive

## Delta ID
- DR-20260301-provider-baseurl-suffix-completion

## クローズ判定
- verify結果: PASS
- archive可否: 可

## 確定内容
- 目的: Provider `baseUrl` の不足サフィックスを自動補完し、OpenAI互換エンドポイント到達性を向上した。
- 変更対象: Provider実装、Providerテスト、spec/architecture/README/overview/plan。
- 非対象: Provider追加、エンドポイント仕様変更、URL高度正規化。

## 実装記録
- 変更ファイル: `src/providers.ts`, `test/providers.test.ts`, `docs/spec.md`, `docs/architecture.md`, `README.md`, `README.ja.md`, `docs/OVERVIEW.md`, `docs/plan.md`
- AC達成状況: AC-01〜AC-05 達成

## 検証記録
- verify要約: Anthropic/Gemini/OpenRouter の補完と重複補完なしをテストで固定し、全体回帰テストを通過。
- 主要な根拠: `npm test` PASS。

## 未解決事項
- なし

## 次のdeltaへの引き継ぎ（任意）
- Seed-01: provider別に補完可否を明示設定できるオプションが必要なら別deltaで追加する。
