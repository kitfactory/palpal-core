# delta-request

## Delta ID
- DR-20260301-provider-model-list

## 目的
- Providerごとの利用可能モデル一覧をAPIから取得できるようにする。
- Ollama/LM Studioは環境依存であることを返却でき、設定済みならその値をモデル一覧として返せるようにする。

## 変更対象（In Scope）
- 対象1: Provider公開APIに「モデル一覧取得」機能を追加する。
- 対象2: Ollama/LM Studio向けに、環境変数設定値ベースでモデル一覧を解決する。
- 対象3: Providerモデル一覧APIの単体テストを追加する。
- 対象4: 仕様文書（spec/architecture）へ最小差分で反映する。

## 非対象（Out of Scope）
- 非対象1: 実際の外部Provider APIへ接続してモデル一覧を動的取得する実装。
- 非対象2: Runner/Safety/MCP/Skillsの実行フロー変更。
- 非対象3: 既存`getModel`の挙動変更。

## 差分仕様
- DS-01:
  - Given: 利用者がProvider名を指定してモデル一覧を取得する。
  - When: 新設APIを呼ぶ。
  - Then: 対応Providerごとのモデル一覧と解決状態を返す。
- DS-02:
  - Given: Providerが`ollama`または`lmstudio`で、モデル設定が未定義。
  - When: 新設APIを呼ぶ。
  - Then: モデル一覧は空配列で、環境依存（`environment_dependent`）として返す。
- DS-03:
  - Given: Providerが`ollama`または`lmstudio`で、環境変数にモデル設定がある。
  - When: 新設APIを呼ぶ。
  - Then: 設定済みモデル値をモデル一覧として返す。

## 受入条件（Acceptance Criteria）
- AC-01: `getProvider("<provider>").listModels()` で単一Providerのモデル一覧が取得できる。
- AC-02: `listProviderModels()` で全対応Providerのモデル一覧が取得できる。
- AC-03: `ollama`/`lmstudio`でモデル未設定時は `resolution=environment_dependent` かつ `models=[]` を返す。
- AC-04: `ollama`/`lmstudio`でモデル設定時は `resolution=configured` で設定値を返す。
- AC-05: 追加テストが通過し、既存テストを壊さない。

## 制約
- 制約1: 変更はProvider API/型定義/テスト/関連ドキュメントに限定する。
- 制約2: 設定値の取得元は既存環境変数規約を優先し、新規設定は最小限にする。

## 未確定事項
- Q-01: `ollama`/`lmstudio`向けに複数モデル設定用の専用環境変数を追加するか（実装時に最小互換優先で判断）。

# delta-apply

## Delta ID
- DR-20260301-provider-model-list

## 実行ステータス
- APPLIED

## 変更ファイル
- src/types.ts
- src/providers.ts
- test/providers.test.ts
- docs/spec.md
- docs/architecture.md
- docs/OVERVIEW.md
- README.md
- README.ja.md

## 適用内容（AC対応）
- AC-01:
  - 変更: `ProviderHandle` に `listModels()` を追加し、`getProvider("...").listModels()` で `ProviderModelList` を返却する実装を追加。
  - 根拠: `src/types.ts`, `src/providers.ts`
- AC-02:
  - 変更: 全Providerの一覧を返す `listProviderModels()` を追加。
  - 根拠: `src/providers.ts`
- AC-03:
  - 変更: `ollama`/`lmstudio` でモデル設定がない場合 `resolution: "environment_dependent"` と空配列を返却。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-04:
  - 変更: `AGENTS_OLLAMA_MODEL(S)` / `AGENTS_LMSTUDIO_MODEL(S)` の設定値を重複排除して返却し、`resolution: "configured"` とする実装を追加。
  - 根拠: `src/providers.ts`, `test/providers.test.ts`
- AC-05:
  - 変更: Provider関連の単体テストを追加し、既存テストと併せて実行可能な状態にした。
  - 根拠: `test/providers.test.ts`

## 非対象維持の確認
- Out of Scope への変更なし: Yes
- もし No の場合の理由:

## verify 依頼メモ
- 検証してほしい観点: API追加が既存 `getModel` を壊していないこと、`ollama/lmstudio` の環境依存返却が成立していること、deltaリンク整合。

# delta-verify

## Delta ID
- DR-20260301-provider-model-list

## 検証結果（AC単位）
| AC | 結果(PASS/FAIL) | 根拠 |
|---|---|---|
| AC-01 | PASS | `test/providers.test.ts` に `getProvider(\"ollama\").listModels()` の検証を追加し通過。 |
| AC-02 | PASS | `test/providers.test.ts` に `listProviderModels()` の全Provider返却検証を追加し通過。 |
| AC-03 | PASS | `ollama` で `AGENTS_OLLAMA_MODEL(S)` 未設定時に `environment_dependent` + 空配列を返すテストが通過。 |
| AC-04 | PASS | `ollama`/`lmstudio` の設定値返却テストが通過（重複除去含む）。 |
| AC-05 | PASS | `npm test` が全件成功。`node scripts/validate_delta_links.js --dir .` も errors=0/warnings=0。 |

## スコープ逸脱チェック
- Out of Scope 変更の有無: No
- 逸脱内容:

## 不整合/回帰リスク
- R-01: 実Providerとの動的モデル同期は未実装（request時点でOut of Scope）。

## 判定
- Overall: PASS

## FAIL時の最小修正指示
- なし

# delta-archive

## Delta ID
- DR-20260301-provider-model-list

## クローズ判定
- verify結果: PASS
- archive可否: 可

## 確定内容
- 目的: Providerごとのモデル一覧をAPIで取得可能にし、`ollama`/`lmstudio` の環境依存を表現できるようにした。
- 変更対象: Provider型定義、Provider実装、Providerテスト、関連ドキュメント。
- 非対象: 実Provider APIへの動的照会、Runner/Safety/MCP/Skillsの挙動変更、`getModel`の仕様変更。

## 実装記録
- 変更ファイル: `src/types.ts`, `src/providers.ts`, `test/providers.test.ts`, `docs/spec.md`, `docs/architecture.md`, `docs/OVERVIEW.md`, `README.md`, `README.ja.md`, `docs/plan.md`
- AC達成状況: AC-01〜AC-05 すべて達成（verify PASS）

## 検証記録
- verify要約: Providerモデル一覧API追加、`ollama`/`lmstudio` の環境依存判定、全体回帰テストを確認。
- 主要な根拠: `npm test` 全件PASS、`node scripts/validate_delta_links.js --dir .` で errors=0/warnings=0。

## 未解決事項
- なし

## 次のdeltaへの引き継ぎ（任意）
- Seed-01: 必要に応じて `ollama`/`lmstudio` の実行時APIから動的にモデル一覧を取得するdeltaを分離して検討する。
