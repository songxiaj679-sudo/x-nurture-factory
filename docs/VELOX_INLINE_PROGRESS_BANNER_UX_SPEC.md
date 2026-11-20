# GROK 実装仕様書：モーダルを閉じても画面上で進捗が分かるインライン進捗パネル（`#jobsLiveProgressCard` ＋ リロード自動復元）

作成日: 2026-11-19  
対象リポジトリ: `/home/songxiaj679/x-nurture-factory`  
目的:  
現在 `/dashboard` では投稿生成の進行状況がポップアップモーダル（`#aiCouncilModalOverlay`）中心のため、**「モーダルを閉じた後、今なにが進んでいるのか／何%なのか画面上で分からなくなる」** 問題を解消する。  
**`#secJobs`（「投稿スケジュール・履歴」内の「`⏳ 次の予約投稿`」直上）** に VeloxPost デザイン調和のインライン進捗カードを常時同期表示し、**モーダルを閉じても・画面をリロード（`F5`）しても** ライブ進捗がそのまま画面上で追えるようにする。

---

## 🔍 現状コードで確認された課題

1. **`#jobsContainer` 周辺にインライン進捗カードが存在しない（`views/dashboard_view.html` L388-410）**:
   - `✨ 別案にする`（`reThinkSinglePost`）や `自動運用を開始する` を押してモーダルを閉じたあと、`⏳ 次の予約投稿` の場所には古い予約文が出たままになり、裏で動いているか／何%か／あとどれくらいか画面上で見えなくなる。
2. **`#launchMsg`（L378）が静的テキストのまま止まる（L3300-3349）**:
   - `#secStep3` 上部の `#launchMsg` には「次の1投稿を書いています。閉じても続きます…」と固定文言しか出ず、段階進捗・パーセンテージ・経過秒数が更新されない。
3. **初期読み込み時に実行中ジョブを復元しない（L6181-6185）**:
   - `GET /api/autopilot/launch-status` をページ初期化時に呼ばないため、裏で生成が走っている状態でリロードすると画面から進行表示が消えてしまう。
4. **モーダル再開時にタイマーとログがリセットされる（`openAiCouncilConsole` L2850-2903）**:
   - `aiConsoleStartTime = Date.now()` と `logContainer.innerHTML = ''` が毎回走り、一度閉じたあとに再度詳細を開くと経過時間が `0秒` に戻り過去のログも消える。

---

## ⚠️ 絶対厳守ルール（`/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1〜5 準拠）

1. **ライト SaaS デザイン調和（セクション3）**:
   - インライン進捗カード `#jobsLiveProgressCard` は明るい SaaS 配色（例: `background: linear-gradient(135deg, #EFF6FF 0%, #FFFFFF 100%)`、`border: 1.5px solid #BFDBFE`、`#0F172A` 見出し、`#475569` 本文、`#2563EB` プログレスバー、完了時はエメラルド、失敗時はローズ）とし、暗い黒/濃紺ブロックは使わない。
2. **日英完全分離（セクション1）**:
   - すべての表示文言（タイトル・ステップ名・経過時間 `秒` / `s`・ボタン `詳細ログを開く` / `Open detailed logs`・`閉じる（画面上で状況を見る）` / `Close & Track on Page`）は `checkIsEn()` と `I18N.ja` / `I18N.en` で厳格に分ける。
3. **既存 VM サンドボックステスト保護（`tests/dashboard_language.test.js` L205-253）**:
   - `startPollingLaunchStatus` / `finishLaunchConsole` はテストで単体抽出（`vm.runInContext`）して呼ばれる。新たに追加するグローバル関数・DOM要素を呼ぶ際は必ず **`if (typeof updateInlineLaunchUi === 'function')`** や **`if (!el) return;`** のガードを入れ、単体テスト環境（`document.getElementById` やヘルパが最小限のモック状態）で例外を出さないこと。

---

## 実装仕様（`views/dashboard_view.html` 中心）

### 1. HTML 配置: `#secJobs` の「`⏳ 次の予約投稿`」直上にインライン進捗カードを配置（L403 直前）

`views/dashboard_view.html` L402-405（`<div class="card-header ...">` と `<div id="jobsContainer">` の間）に、初期非表示のコンテナを1つ置く：

```html
<div id="jobsLiveProgressCard" style="display:none;" class="mb-4 p-4 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/90 via-white to-white shadow-2xs space-y-2.5" aria-live="polite">
  <!-- JS renderInlineLaunchProgress() で動的に描画 -->
</div>
```
（※ 空コンテナのため静的未翻訳日本語が増えず `dashboard_language.test.js` の静的テキスト網羅検査と競合しない。）

---

### 2. JS 状態管理 ＆ インライン進捗描画ヘルパの追加（L2848 付近）

1. **共有状態変数を追加**:
   - `let latestLaunchStatus = null;`
   - `let activeLaunchOriginMs = null;`（サーバーの `elapsedSec` から `Date.now() - (st.elapsedSec * 1000)` で逆算維持）
   - `let inlineLaunchTicker = null;`（`status === 'running'` の間 1000ms ごとに経過秒数バッジだけを滑らかに更新。`completed` / `error` で停止）

2. **`renderInlineLaunchProgress(state)` を新設**:
   - `state`（`status`: `'running' | 'completed' | 'error' | 'idle'`）に応じて、`#jobsLiveProgressCard` と `#launchMsg` の両方を更新する：
   - **`status === 'running'` のとき**:
     - `#jobsLiveProgressCard` を `display: block` で表示：
       - **上段**: 左に稼働ドット（青/緑パルス）＋ 状態バッジ（JA `準備中` / EN `WORKING`）＋ **現在のステップ見出し**（例: `st.stepTitle`）、右に **進捗率（`60%` / `74%` ...）**・**経過秒数バッジ（`42秒` / `42s`）**・**`ログ詳細を見る` ボタン**（`onclick="reopenAiCouncilModal()"`）。
       - **プログレスバー**: `launchStepPercent(st.currentStep)` の幅（最低 `8%`）を `#2563EB` 系グラデーションで描画。
       - **5段階ミニステップ一覧**（現在位置がひと目で分かるコンパクト列）:
         - JA: `1. アカウント読込` / `2. 切り口整理` / `3. 複数案作成` / `4. 品質審査` / `5. 予約反映`
         - EN: `1. Read` / `2. Angle` / `3. Draft` / `4. Review` / `5. Reserve`
         - 現在の `st.currentStep` に応じてステップ番号（1〜5）をアクティブ強調（例: `account/page/slot`→1, `draft/draft_brief`→2, `draft_candidates`→3, `draft_critic/draft_repair`→4, `saving`→5）し、完了済みの段階は落ち着いた青/緑チェックに、未到達はグレーにする。
       - **説明文**: `st.stepDetail`（`elapsedSec >= 90` のときは「品質を優先して丁寧に推敲しています（完了まであと少し）。このまま他の操作を続けても裏で完了します。」/ EN同等の誠実文言）。
     - `#launchMsg`（`#secStep3` 内）も、`status === 'running'` の間は **「進行中 74%（42秒）：次の1投稿を複数案で作成しています — 進捗を見る」** のような1行リアルタイム表示へ同期する（クリックで `#jobsLiveProgressCard` へスムーズスクロールまたは詳細モーダルを開く）。
   - **`status === 'completed'` のとき**:
     - `#jobsLiveProgressCard` を爽やかなエメラルド枠（`border-emerald-200 bg-emerald-50/70`）で表示：
       - `✅ 次の1投稿を予約しました`（EN: `✅ The next post is scheduled`）＋ 時刻/根拠の要点 ＋ **`ログ詳細`** ＋ 閉じるボタン `×`（`onclick="dismissInlineLaunchCard()"`）。
       - すぐ下の `loadJobs()` で更新された `⏳ 次の予約投稿` カードが直下に現れるので結果が一目瞭然になる。
   - **`status === 'error'` のとき**:
     - `#jobsLiveProgressCard` をローズ枠（`border-rose-200 bg-rose-50/70`）で表示：
       - `⚠️ 次の1投稿に失敗しました（いまの予約はそのまま残ります）` ＋ **`×`** ボタン。

---

### 3. モーダル開閉 ＆ ページ初期読み込み時の自動同期（`openAiCouncilConsole` / `reopenAiCouncilModal` / `closeAiCouncilConsole` / `syncBackgroundLaunchProgress`）

1. **`btnAiCouncilDismiss` と `aiCouncilFootNote` の表現改善（L1157-1160, L2879-2883）**:
   - `aiCouncilBadgeText` / `aiCouncilHeadingText` / `aiCouncilFootNote` を `openAiCouncilConsole` 内で必ず `isEn` に合わせて設定する。
   - ボタン文字:
     - JA: `閉じる（画面上で状況を見る）`
     - EN: `Close (keep progress on page)`
   - フッター文言:
     - JA: `閉じても「投稿スケジュール・履歴」欄の上部にリアルタイム進捗が出続けます。`
     - EN: `Live progress stays visible above Scheduled Posts even after closing.`

2. **`closeAiCouncilConsole()`（L2905-2921）**:
   - モーダルを閉じた直後、現在実行中の状態（`latestLaunchStatus && latestLaunchStatus.status === 'running'`）があれば `#jobsLiveProgressCard` が確実に表示されている状態を保ち（必要なら `scrollIntoView({ behavior: 'smooth', block: 'nearest' })`）、ポーリング `aiConsolePoller` は止めずに継続する。

3. **`reopenAiCouncilModal()`（新設）**:
   - 「`ログ詳細を見る`」ボタンから呼ばれたとき：
     - モーダルを開くが、`latestLaunchStatus` に合わせて `aiConsoleStartTime` を実稼働開始時刻（`activeLaunchOriginMs`）から復元する（**`0秒` にリセットしない**）。
     - `latestLaunchStatus.logs` をすべて `appendAiLog` で再描画し、現在の `pct` / `stepTitle` / `stepDetail` を即反映する。
     - まだ `running` ならタイマーとポーリングも継続する（二重インターバルにならないよう `if (!aiConsolePoller) startPollingLaunchStatus()`）。

4. **`syncBackgroundLaunchProgress()`（初期ロード時自動同期）**:
   - `views/dashboard_view.html` L6181-6185 の初期ロード直後（`setTimeout(..., 800)` 内）に `syncBackgroundLaunchProgress()` を追加実行する（`typeof syncBackgroundLaunchProgress === 'function'` チェック）。
   - `GET /api/autopilot/launch-status` を1回呼び出し、`data.ok && data.status === 'running'` なら：
     - `latestLaunchStatus = data`、`activeLaunchOriginMs = Date.now() - ((data.elapsedSec || 0) * 1000)` をセット。
     - モーダルは強制オープンせず、**インラインの `#jobsLiveProgressCard` と `#launchMsg` だけ** を即表示し、`startPollingLaunchStatus()` を開始する！
     - これにより、モーダルを閉じたあと別ページに行ったり `F5` リロードしても、そのまま画面上でリアルタイム進捗が見え続ける。

5. **`startPollingLaunchStatus()` & `finishLaunchConsole()` の安全ガード（L2979-3085）**:
   - すべての新規ヘルパ呼び出し（`updateInlineLaunchFromStatus` 等）を `if (typeof ... === 'function')` で保護し、かつ `document.getElementById('jobsLiveProgressCard')` が無い VM テスト環境でも一切エラーを出さないこと。

---

## テスト・検証要件

1. **テスト追加（`tests/launch_progress_and_uilang.test.js` および/または `tests/dashboard_language.test.js`）**:
   - `views/dashboard_view.html` に `#jobsLiveProgressCard`（`#secJobs` 内・`#jobsContainer` 直前）、`reopenAiCouncilModal`、`syncBackgroundLaunchProgress`、`renderInlineLaunchProgress` が存在すること。
   - インライン進捗カードが `checkIsEn()` により日英両対応（`ログ詳細を見る` / `View detailed logs` 等）であり、`#launchMsg` や `tests/dashboard_language.test.js` 既存の VM 単体テスト（`error` 時など）が引き続き100%通ること。
   - リロード復元関数 `syncBackgroundLaunchProgress` が `/api/autopilot/launch-status` の `status: 'running'` を受け取ったときモーダルを強制表示せずインライン進捗カードとポーリングを開始することを VM/ユニット検証する。
2. **必須検証コマンド（最終編集後すべて実行）**:
   - 編集した全 `.js` テストファイルへの `node --check`
   - `views/dashboard_view.html` および `views/funnel_index.html` の全実行 `<script>` への `vm.Script` 構文チェック
   - 全20テストスイート（`node --test --test-force-exit`）の 0 fail / 0 skip 成功
   - `pm2 startOrRestart ecosystem.config.js --only x-shop --update-env && pm2 save` 実行後、2秒待って `GET /` (200)・`GET /?lang=en` (200)・`GET /dashboard` (302) 確認
