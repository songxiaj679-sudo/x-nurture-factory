# VELOX V8-C.4: Outbound Reply Drop Diagnostics Logging Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 秘密情報、`.env`、トークン、顧客メール、アカウント名、ハンドル、投稿・返信本文、`weakness`、URL はログ・レスポンス・ドキュメントへ一切出力しない。
- 明示指示なく `git commit` / `git push` しない。
- UI 言語（`checkIsEn()` / `uiLang` 等）と本文言語（`aiTargetLang` / `outputLang` / `replyLanguage()`）を混ぜない。
- 廃止表現を UI や API 文言に戻さない。`X_MEDIA_WRITE_ENABLED` は変更しない。再起動対象は `x-shop` のみ。

### 非変更・保護領域（厳守）

- 合格点・安全基準・保存条件は一切変更しない（`passesOutboundSafety()`、`scoreOutboundReply()`、`classifyOutboundCritic()` の合否・採用条件は完全維持）。
- 待機中の 2 件の予約ジョブを上書きしない。
  - `@VeloxSystemsHQ`: `job_next_dacb20d2-f697-42cf-835f-102281c95457` は投稿済み。次の待機 `job_next_b5948bf1-9843-464b-ad2f-b84243901969`（07:38 JST 予定）を `pending` のまま保護する。
  - `@VeloxSystemsV4`: `job_next_48460d9f-1920-42c3-863d-1c3781e88fb2`（08:32 JST 予定）を `pending` のまま保護する。
- 本番アカウントへの `prepareNextPost` は呼ばない。停止済み `USR-MVUPC3CT-CFD4` に停止メールを再送しない。
- 通常投稿パイプライン（`next_post_draft.js` / `editorial_archetypes.js` / `bandit_optimization_engine.js` / `customer_post_state.js` / `visual_card.js`）および受信メンション経路は無変更とする。

## 1. 不採用 1 行診断ログ（`src/outbound_reply_queue.js`）

`buildOutboundCandidate()` 内で候補を不採用（`null` 返却）とする直前に、`[Outbound Drop]` で 1 行だけ標準ログを出す。本文・アカウント識別子・ハンドル・URL・`weakness`・秘密情報は含めない。

`ungrounded_number`、`internal_jargon`、`ng_topic` は、コロン以降の本文・数値・話題を捨て、コード名だけを出す。

### 1.1 Safety 不採用（初回、および書き直し後）

```text
[Outbound Drop] stage=safety reasons=<comma_separated_codes> repaired=<0|1>
```

`reasons` は `passesOutboundSafety()` の `reasons` に、compliance の `issues[].code`（例: `claim_needs_evidence`、`incentivized_engagement`）を重複除去して足す。合否は従来の `reasons` 配列だけで決める。`complianceCodes` はログ専用で、`ok` の計算には使わない。

### 1.2 Critic 不採用

スコアがあるとき:

```text
[Outbound Drop] stage=critic action=<action> score=<score> hook=<hook> save=<save> clear=<clear> craft=<craft> degraded=<0|1> repaired=<0|1>
```

軸またはスコアが数値でないとき:

```text
[Outbound Drop] stage=critic action=rescore score=na hook=na save=na clear=na craft=na degraded=0 repaired=<0|1>
```

初回の `action === 'repair'` は書き直しへ進む途中であり、不採用ではない。`[Outbound Drop]` は出さない。`stats.critic` を加算して `null` を返す直前だけ出す。

## 2. 検証

- `tests/v8c4_outbound_drop_diagnostics.test.js` を追加する。
  - safety の初回と書き直し後で、compliance の code と `repaired=0|1` が 1 行に出る。本文・アカウント名・URL・`weakness` は出ない。
  - critic の `discard` と軸欠け `rescore` で、action・score・4 軸・degraded・repaired が 1 行に出る。本文と `weakness` は出ない。
  - `pending_approval` / `held` / `repair` の途中 / `stats.safety` / `stats.critic` の既存挙動は変わらない。
- `node --check src/outbound_reply_queue.js`
- 変更していない `views/funnel_index.html` と `views/dashboard_view.html` のインライン script を `vm.Script` で確認する。
- `grep -L "FIRESTORE_EMULATOR_HOST" tests/*.test.js | xargs node --test --test-concurrency=1 --test-force-exit`
- `x-shop` のみ再起動し、`/` 200、`/?lang=en` 200、`/dashboard` 302、未認証の visual-card / weekly-report / outbound-replies は 401。
- 待機予約 2 件が `pending` のままであることを確認する。`prepareNextPost` は呼ばない。
