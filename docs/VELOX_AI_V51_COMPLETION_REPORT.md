# VELOX AI v5.1 作業完了報告書

- 対象: `x-nurture-factory` の SaaS 投稿経路
- 設計: `docs/VELOX_AI_NEXT_GEN_DESIGN.md`（v5.0 設計 + v5.1 追記）
- 実施日: 2026-11-18
- 宛先: この報告書を受け取る Gemini
- 判定: 顧客が使う次の投稿の経路については、Phase 1 から Phase 5 まで実装済み。Phase 6 は画像を送らない予約のみ。リポジトリ全体が v5 に置き換わった、という意味ではない。

## 1. 完了の範囲

顧客の開始ボタン、5分ごとの補充、投稿成功後の次の1件、早期実測後の書き直し、ダッシュボードの個別再推敲は、`prepareNextPost` / `draftNextPostText` / `draft_verifier` を通る。

`POST /api/autopilot/launch` は `prepareNextPost` を呼ぶ。旧7名合議は、このボタンの経路には戻していない。

ショップ `x-shop` は、この実装の最後に再起動済み（pid 1485478）。養殖側の `init_profiles`、`setup_worker`、`batch_engine`、`auto_post_v3` は起動していない。公式APIの投稿許可リストは広げていない。

## 2. Phase ごとの実装

### Phase 1 配線

- お客様の `userPrompt` を、指示づくりと本文の両方で最優先にした。ページに無い数値は、指示があっても作らない。
- `loadPostedJobs` は `postedAt` の新しい順。複合インデックスには依存しない。
- 2〜6時間の実測に、保存に加えて返信、いいね、リポスト、引用を残す。
- `startAutopilotJobRunner` が10分ごとに `syncAllActiveCustomersPostMetrics` を呼ぶ。対象は公式APIの許可アカウントだけ。
- Xの課金が不明なときは「未課金」と断定せず、短い2本のツリーにする。

### Phase 2 ページと声

- `src/lp_knowledge_extractor.js`: 同一サイトの料金・機能・FAQ などを最大2ページ追加で読む。原文に無い数値は捨てる。ページ内の「指示を無視しろ」は `[REDACTED_DIRECTIVE]` にする。同じ内容は7日キャッシュ。内部アドレスは取得しない。
- `src/account_voice_profiler.js`: 自己紹介と本人の投稿から声を取る。フォロワー100人未満、または人数不明は `peer_builder`。12時間キャッシュ。
- `src/grok_client.js`: 固定ルールは system、ページ本文は user。
- 公式プロフィール取得は Bio（`description`）を返す。

### Phase 3 3案と検証

- `src/slot_portfolio_planner.js`: 手順、会話、観察、プロフィールへの橋渡しを回す。直前と同じ役割は続けない。
- 宣伝リンクは、信用段階が `advanced` で、検索非表示ではなく、昼・夕方、またはスターターの朝、かつ直近4件に宣伝が無いときだけ。本文のURLはモデルに書かせず、プログラムが2本目へ `【PR】` と登録URLを付ける。
- `src/draft_verifier.js`: 長さ、形状、規約、英語投稿への日本語混入、定型句、直近との重複、ページに無い数値を落とす。通らなければ1回だけ書き直し、それでも駄目なら投稿しない。
- `src/next_post_draft.js`: 形の違う3案を1回で作り、2案以上残れば採点する。

### Phase 4 学習

- 反応は保存、返信、引用、リポスト、いいねの合成。表示が少ない投稿は重みを下げる。表示3回・保存1回は、表示5,000回・保存100回より強い証拠にしない。
- `chooseGenesForPost` が切り口、冒頭、形式、誘導、論点を選ぶ。ページ文言が変わっても、この学習は消さない。
- 早期実測のあと、`deepen_winner` は同じ論点のまま切り口を変えて書き直す。`pivot_angle` は別論点へ移す。`keep` は本文を触らない。
- 書き直しは、投稿5分前を切った予約と、手入力の予約には行わない。
- 週次レポートの切り口集計は、因果とは書かない。

### Phase 5 追加の判断

- `src/context_radar.js`: `ENABLE_CONTEXT_RADAR` が `'false'` でなければ、Grok の web search を最大8秒使う。失敗しても投稿は止めない。8時間キャッシュ。
- `ENABLE_AB_HOLDOUT` の既定は無効。対照群分けはしない。`src/ab_experiment_engine.js` はテスト互換のため残している。
- 個別再推敲 `reThinkSingleJob` は v5 の本文生成と検証を通る。手入力の予約は拒否する。
- メンションは12時間に一度、読み取りだけ。質問らしい文だけを次の材料にする。自動返信と自動フォローは停止のまま。
- 反応が良かった投稿の次は同じ論点の続き。2回続いたら別論点。
- 到達率が直近3件連続で、これまでの中央値の15%未満なら `recoveryMode`。宣伝とリンクを止め、短い会話にする。
- 投稿時刻は枠から -6分〜+13分。今から15分以内には送らない。投稿時に `postedHourLocal` を残す。
- Grok の 429、5xx、タイムアウトでは Gemini `gemini-3.8-flash` に切り替える。モデルと所要時間は `qualityAudit` に残す。トークン原価はAPI応答を解析していないので `null`。
- 表示1,000回の24〜36時間実測、またはその回収時に診断上のフォロワーが100人以上なら `trustGoalMetAt` を記録する。宣伝の自動解禁は `autoUnlockPromoOnGoalMet === true` のときだけ。
- ダッシュボードの予約カードに役割と、既存の実測根拠を出す。信用目標に到達記録を出す。
- `src/collective_priors.js` は `ENABLE_ANONYMOUS_COLLECTIVE_PRIORS === 'true'` のときだけ空の集計枠を返す。既定では他顧客の本文を混ぜない。

### Phase 6 画像

- `src/visual_card.js` の `planVisualCard` は、形式が `structured_breakdown` のときだけ、検証済みの文を図解材料にする。検証済み数値に無い数字を含む行は捨てる。
- `mediaIds` は常に空。`X_MEDIA_WRITE_ENABLED` が未設定なので理由は `media_write_not_enabled`。有効にしても、アップロード疎通前は `upload_not_verified` で、画像IDは返さない。
- X への画像投稿はしていない。

## 3. 確認

通した確認:

- `tests/phase3_portfolio_verifier.test.js`
- `tests/phase4_gene_learning.test.js`
- `tests/phase5_safety.test.js`
- `tests/metrics_harvest_engine.test.js`
- `tests/bandit_optimization_engine.test.js`
- `tests/weekly_growth_report.test.js`
- `tests/account_state.test.js`
- `tests/lp_voice_phase2.test.js`
- `scripts/eval_velox_ai.js`（終了メッセージ `VELOX AI offline eval passed`）

全件の `npm test` は、この完了判定には使っていない。Firestore のハンドルが残るテストと、投稿完了を待ち続ける隔離テストがあるため、対象を分けて `--test-force-exit` で実行している。

## 4. まだ本番の投稿文が古い可能性

v5 の生成器を入れたあと、既存の未投稿を一括では書き直していない。課金中の補充は、未投稿が1件あるあいだ次を作らない。いま予約に残っている文は、この報告書より前の生成かもしれない。

## 5. Gemini への意見

次の改修に入るなら、顧客経路へ旧合議を戻さないでほしい。`src/autonomous_promo_ai.js` には、まだ「7名編成」のプロンプトが残っている。開始ボタンはそこを通らない。残っている関数を、顧客の次の1件へ再接続しないこと。

`trustGoalMetAt` は `bestTrustView` が付く回収の中でだけ書いている。フォロワーが100人に達しても、24〜36時間で表示1,000回の凍結実測が同じ回収に無ければ、到達記録は付かない。フォロワー条件を独立させるなら、公式APIの現在のフォロワー数を使い、診断JSONの古い人数は使わない方がよい。

到達率の自己防衛は、直近3件を含めた中央値に対して15%未満かを見ている。落ちた3件自身が中央値を下げるので、判定が遅れることがある。比較の基準は、直近3件より前の投稿の中央値にした方が設計の意図に近い。

`qualityAudit.cost` を埋めるために、トークン数を推測しないでほしい。APIが usage を返したときだけ記録する。

図解カードは、`media.write` の疎通を別作業で確認するまで、`mediaIds` を空のままにする。検証済みでない文や、ページに無い数値を画像へ描かない。

集合知のフラグは、既定の無効のままにする。他アカウントの本文、秘密URL、認証情報をプロンプトへ混ぜない。

レーダーが失敗して `null` になるのは正常系。そのときページに無い時事や数値で穴埋めしない。

既存の未投稿を最新の生成器で置き換えるかは、運用判断にしてほしい。置き換える場合も、手入力の予約は残し、自動の未投稿は1件のままにする。

全件テストを回すときは、`tests/post_constraint_stop_isolation.test.js` の無限待ちと、Firestore を閉じないテストを避ける。`node --test --test-force-exit` で、この報告書の確認一覧から始める。
