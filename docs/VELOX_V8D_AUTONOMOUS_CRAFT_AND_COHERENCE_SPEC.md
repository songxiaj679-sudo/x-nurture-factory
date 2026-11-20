# VELOX V8-D: Autonomous Readability Craft, Retarget Isolation & Coherence Critic Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、HQ の `targetUrl` はログ・レスポンス・ドキュメントへ出力しない。
- 明示指示がない限り `git commit` / `git push` は行わない。
- UI 言語（`checkIsEn()` / `currentLang` / `uiLang` / cookie `velox_lang` / `resolveUiLang()`）と、投稿・返信本文の言語（`aiTargetLang` / `outputLang` / `replyLanguage()`）を混ぜない。
- 廃止表現（7名、合議制、凍結リスクゼロ、バズ保証、98.4%、9割、月100時間、3.2倍、3.4倍、シャドウバン）を UI や API 文言に戻さない。
- `X_MEDIA_WRITE_ENABLED` は変更しない。
- 他の pm2 アプリは停止・削除しない（再起動対象は `x-shop` のみ）。

### 触ってはいけない本番データ・非変更領域

- 待機中の `@VeloxSystemsHQ` 予約ジョブ（`2026-11-20T13:25:25.413Z` 作成、`pending`、`topicRing: ring1_craft`）を上書きしない。検証で `prepareNextPost` を呼ばない。
- 停止済み `USR-MVUPC3CT-CFD4` に停止メールを再送しない。
- 受信メンション経路（`inbound_mentions`、Phase 1 / Phase 2 自動送信、`composeInboundReply()`）、V8-C 外向け返信承認キュー（`outbound_reply_candidates`）、`src/llm_router.js` の `usableScores()` 既存互換、`src/velox_master_core.js` の `decideNextPostMission()` 本体、`src/visual_card.js` のカードデザインは無変更とする。

## 1. 脱・VELOX AI 構文：自律的な読みやすさ設計

`src/editorial_archetypes.js` の `archetypePromptLines()` から、毎回同じ記号を強制する指定（`×` / `○`、`Before:` / `After:`、`①②③`、`1. 2. 3.`）を外す。不自然な翻訳調を生んでいた「なぜ後者が持つかを平易に1〜2行」も削除する。

代わりに、短い段落、対比、短い列挙、矢印、問いかけ、会話のような言い換えから、内容に合う形を選び、直近投稿と同じ見た目を避ける指示を置く。

`src/next_post_draft.js` の Critic 採点文から、特定記号を例にして点数を寄せる文言を外す。4軸のキーと合格線（合計 72、`strangerClarity >= 14`、`scrollStopHook >= 12`、60未満は拒否、60–71は修復後のみ `criticDegraded`）は維持する。

## 2. 首尾一貫性の減点

禁止語リストは足さない。Critic の減点基準に次を書く。

- 1行目の主語が結びまで続いているか。
- 説明のない自社仕様へ飛んでいないか。
- 結びが直前の例と矛盾していないか。

## 3. 未投稿書き直しの隔離

`retargetNextPendingJob()` の書き直しブロックで、`decideNextPostMission()` を `prepareNextPost()` と同じ引数で呼ぶ。関数本体は変えない。

外部テーマ（`isolateLpContext: true`）では `focusPlaybook` を空にし、`isolateLpContext: true` を `draftNextPostWithMeta()` と `planVisualCard()` に渡す。製品ブリッジでは従来どおりプレイブックを残す。

保存時に `topicRing`、`masterMission`、`masterPhase`、`selectedTopicDomain` を書く。`earlyBodyRewriteAt` がある予約、手動固定、投稿5分以内は対象外のまま。

## 4. 長い micro_punch

`auditReadability()` は、日本語110字未満・英語180字未満の `micro_punch` を従来どおり合格にする。それ以上は他形式と同じ `missing_hook_break` / `dense_wall_of_text` を適用する。`enforceReadability === true` のときだけ呼ぶ条件は変えない。

## 5. 検証

固定記号を直接アサートしている既存テストは、自律選択の方針へ合わせる。追加テストで、プロンプト、Critic、書き直し経路の接続、長短 `micro_punch` を確認する。

`node --check`、インライン script の `vm.Script`、エミュレーター以外の全スイート、隔離テストの単体再実行、`x-shop` のみ再起動、`127.0.0.1:3001` の curl を通す。HQ の pending 予約は未変更のまま確認する。`prepareNextPost` は呼ばない。

`@VeloxSystemsV4` の外部テーマで、本番予約へ書かずにオフライン試作を2本出す。
