require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { hasXaiKey, completeText } = require('./grok_client');
const {
  db,
  updateAccountState,
  getAccountsByLifecycleStatuses,
  updateAccountData,
} = require('./firestore');
const {
  getAccountLifecycleStatus,
} = require('./account_state');
const {
  getPersistentProfileDir,
  slimProfileDir,
  ensureFarmingDisplay98,
  extractKeepCookies,
  getUltraSavingBrowserArgs,
  enableSmartBandwidthSaver,
  attachApiHealthSniffer,
  verifyAccountStatusFast
} = require('./status_checker');
const { getDeviceProfile, applyDeviceProfile, readStoredUserAgent } = require('./browser_config');
const { checkAndEnforceQuotaSync, getResidentialProxyForAccount } = require('./iproyal');
const { humanSleep, humanScroll, humanNavigate, humanTyping, humanClickSelector } = require('./human_actions');
const { sanitizePostOrReplyText } = require('./official_api_client');

const NATURAL_REPLIES = [
  'めっちゃわかります！今日も一日お疲れ様です😊',
  '素敵ですね✨ なんだかほっこりしました！',
  'それすごく共感します…！いい気分転換になりますよね🍵',
  'お疲れ様です！無理せずマイペースにいきましょう〜🙌',
  'わかります！ちょっとした日常のこういう瞬間いいですよね✨',
  'なるほど〜！確かにそう考えると納得です😊',
  'いいですね！私も最近気になってました👀✨'
];

async function generateNaturalReply(targetTweetText) {
  if (!targetTweetText || targetTweetText.length < 4) {
    return NATURAL_REPLIES[Math.floor(Math.random() * NATURAL_REPLIES.length)];
  }
  try {
    const prompt = `あなたは、X(Twitter)上で有益なB2B情報（経営、マーケティング、業務効率化など）を発信している「業界のプロ（専門家）」として振る舞ってください。
以下のX(旧Twitter)の投稿（あなたが見込み客だと感じた相手の投稿）に対して、売り込み臭くなく、専門家としての【的確なアドバイス】や【共感と知見】を込めたリプライを1つだけ出力してください。
条件：
・長さは50〜80文字程度。
・相手が「この人は有益だ、プロフィールを見てみよう」と思うような知性を感じさせること。
・絵文字は1個まで、宣伝やURLは一切含めない。
・「〜ですね」「〜ですよ」のような自然なトーンで。
・【最重要・文字数注記の絶対禁止】文章末尾や文頭に「（80文字）」「文字数: 〇」などの文字数カウントや注記、前置き、解説は絶対に出力に含めないこと。返信本文のみを出力すること。

投稿: "${targetTweetText}"`;
    if (!hasXaiKey()) throw new Error('NO_XAI_KEY');
    let txt = (await completeText({ tier: 'quality', prompt })).text.trim();
    txt = sanitizePostOrReplyText(txt);
    if (txt && txt.length >= 20 && txt.length <= 100) return txt;
  } catch (e) {}
  return NATURAL_REPLIES[Math.floor(Math.random() * NATURAL_REPLIES.length)];
}

// 1回のサイクルで、放置されている cleared アカウント1〜2件を動かし、farming アカウントへリプライ支援を行う
async function runClearedMentorAssistCycle(maxMentorsPerRun = 1) {
  try {
    checkAndEnforceQuotaSync('mentor_assist');
    const nowMs = Date.now();

    // 1. status === 'cleared' の完成アカウントを取得し、最終稼働(nextMentorAt または updatedAt)から18時間以上経過しているものを抽出
    const clearedDocs = await getAccountsByLifecycleStatuses(['healthy'], { limit: 50 });
    if (clearedDocs.length === 0) return 0;

    const dueMentors = clearedDocs.filter(doc => {
      const d = doc.data() || {};
      if (getAccountLifecycleStatus(d) !== 'healthy') return false;
      if (!d.authToken) return false;
      if (d.nextMentorAt && d.nextMentorAt.toDate) {
        return d.nextMentorAt.toDate().getTime() <= nowMs;
      }
      const lastUpd = d.updatedAt && d.updatedAt.toDate ? d.updatedAt.toDate().getTime() : 0;
      return (nowMs - lastUpd) >= 18 * 3600 * 1000;
    });

    if (dueMentors.length === 0) return 0;

    // 2. 手助け対象となる現在養殖中 (status === 'farming') のアカウントを取得
    const farmingDocs = await getAccountsByLifecycleStatuses(['nurturing'], { limit: 60 });
    const farmingTargets = farmingDocs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => getAccountLifecycleStatus(a) === 'nurturing' &&
        a.userId && !String(a.userId).startsWith('pending_'));

    if (farmingTargets.length === 0) return 0;

    let assistedCount = 0;
    const selectedMentors = dueMentors.slice(0, maxMentorsPerRun);

    for (const mentorDoc of selectedMentors) {
      const mentor = mentorDoc.data();
      const token = String(mentor.authToken || '').trim();
      const mentorHandle = String(mentor.userId || '').replace(/^@/, '').trim();
      const proxy = getResidentialProxyForAccount(token, mentor);
      const storedUa = readStoredUserAgent(mentor);
      const devProf = getDeviceProfile(token, storedUa, mentor);
      const fixedUA = storedUa || devProf.userAgent;
      const vpW = (devProf && devProf.viewport && devProf.viewport.width) || 1920;
      const vpH = (devProf && devProf.viewport && devProf.viewport.height) || 1080;
      const userDir = getPersistentProfileDir(token);

      // 自分以外の養殖中アカウントをランダムに1〜2件選択
      const targets = farmingTargets
        .filter(t => t.userId !== mentorHandle)
        .sort(() => Math.random() - 0.5)
        .slice(0, 2);

      if (targets.length === 0) continue;

      console.log(`\n🤝 [完成垢メンター支援] 🟢 @${mentorHandle || mentorDoc.id.slice(0, 6)} が養殖中アカウント (${targets.map(t => '@' + t.userId).join(', ')}) の手助け＆鮮度維持を開始します...`);

      let browser = null;
      try {
        ensureFarmingDisplay98();
        const vncLikeArgs = getUltraSavingBrowserArgs(proxy).filter(a =>
          !a.includes('--disable-webgl') &&
          !a.includes('--disable-3d-apis') &&
          !a.includes('--blink-settings=imagesEnabled=false')
        );
        browser = await puppeteer.launch({
          headless: false,
          env: { ...process.env, DISPLAY: ':98' },
          args: [
            ...vncLikeArgs,
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--test-type',
            `--window-size=${vpW},${vpH}`
          ],
          ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=IdleDetection'],
          userDataDir: userDir,
          protocolTimeout: 45000
        });
        const page = await browser.newPage();
        await enableSmartBandwidthSaver(page, false);
        const snifferState = attachApiHealthSniffer(page);
        if (proxy && proxy.user && proxy.pass) await page.authenticate({ username: proxy.user, password: proxy.pass });
        await applyDeviceProfile(page, token, fixedUA);

        const initCookies = [
          { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true },
          { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true },
          { name: 'lang', value: 'ja', domain: '.x.com', path: '/' }
        ];
        if (mentor.ct0) initCookies.push({ name: 'ct0', value: mentor.ct0, domain: '.x.com', path: '/', secure: true });
        if (Array.isArray(mentor.savedCookies)) {
          for (const sc of mentor.savedCookies) {
            if (sc && sc.name && sc.value && sc.name !== 'auth_token') initCookies.push(sc);
          }
        }
        await page.setCookie(...initCookies);

        // ログイン＆生存・凍結・ロボット確認（長期放置で死んでいればここで検知して在庫から自動隔離）
        const health = await verifyAccountStatusFast(page, mentorHandle, snifferState, 'https://x.com/home');
        if (!health.ok) {
          console.log(`  🚨 [完成垢の異常検知] @${mentorHandle} が [${health.status}: ${health.reason}] になっていたため、完成在庫から自動隔離します`);
          await updateAccountState(mentorDoc.id, health.status || 'unavailable', {
            errorReason: `メンター稼働時に検知: ${health.reason}`
          });
          continue;
        }

        await humanSleep(2500, 4000);
        await humanScroll(page, 1, 2);

        // Step A: 自分宛ての通知 (/notifications/mentions) を確認し、未返信のリプライがあれば返信して双方向会話を作る
        await humanNavigate(page, 'https://x.com/notifications/mentions').catch(() => {});
        await humanSleep(3000, 4500);

        // Step B: 養殖中 (farming) アカウントのプロフィールへ訪問し、最新ポストに「いいね」＋「自然なリプライ」を送信
        for (const target of targets) {
          const targetUrl = `https://x.com/${target.userId}`;
          console.log(`  👉 養殖中アカウント @${target.userId} のページへ訪問中...`);
          await humanNavigate(page, targetUrl).catch(() => {});
          await page.waitForSelector('article[data-testid="tweet"]', { timeout: 10000 }).catch(() => null);
          await humanSleep(2500, 4000);

          const hasArticle = await page.$('article[data-testid="tweet"]').catch(() => null);
          if (!hasArticle) continue;

          // 1. まず「いいね (like)」を押す
          const liked = await page.evaluate(() => {
            const art = document.querySelector('article[data-testid="tweet"]');
            if (!art) return false;
            const likeBtn = art.querySelector('[data-testid="like"]');
            if (likeBtn) { likeBtn.click(); return true; }
            return false;
          }).catch(() => false);
          if (liked) {
            console.log(`    ❤️ @${target.userId} のポストに「いいね」を送りました`);
            await humanSleep(1500, 2800);
          }

          // 2. リプライボタンを押して自然な返信を送る
          const clickedReplyIcon = await page.evaluate(() => {
            const art = document.querySelector('article[data-testid="tweet"]');
            if (!art) return false;
            const repBtn = art.querySelector('[data-testid="reply"]');
            if (repBtn) { repBtn.click(); return true; }
            return false;
          }).catch(() => false);

          if (clickedReplyIcon) {
            await humanSleep(2000, 3200);
            const tb = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 8000 }).catch(() => null);
            if (tb) {
              const replyText = await generateNaturalReply(target.lastTweetText || '');
              await page.evaluate(el => el.focus(), tb).catch(() => {});
              await tb.click().catch(() => {});
              await humanSleep(400, 800);
              await humanTyping(page, replyText);
              await humanSleep(1200, 2200);

              const sent = await humanClickSelector(page, '[data-testid="tweetButton"]:not([aria-disabled="true"]), [data-testid="tweetButtonInline"]:not([aria-disabled="true"])', 5000);
              if (!sent) {
                await page.keyboard.down('Control');
                await page.keyboard.press('Enter');
                await page.keyboard.up('Control');
              }
              await humanSleep(3500, 5000);
              console.log(`    💬 @${target.userId} へ養殖アシストリプライ完了: "${replyText}"`);
              assistedCount++;
            }
          }
        }

        // 次回のメンター稼働を 20〜32時間後に予約（長期放置を防ぎつつプロキシ通信量も節約）
        const nextWaitHours = 20 + Math.random() * 12;
        const savedCookies = await extractKeepCookies(page);
        await updateAccountData(mentorDoc.id, {
          lastMentorAt: new Date(),
          nextMentorAt: new Date(Date.now() + nextWaitHours * 3600 * 1000),
          mentorAssistCount: (mentor.mentorAssistCount || 0) + 1,
          ...(savedCookies.length > 0 ? { savedCookies } : {}),
          updatedAt: new Date()
        });
        console.log(`  ✅ 🟢 @${mentorHandle} の鮮度維持＆養殖アシスト完了（次回稼働: 約${nextWaitHours.toFixed(1)}時間後）`);
      } catch (e) {
        console.log(`  ⚠️ メンター支援例外 (@${mentorHandle}): ${e.message}`);
      } finally {
        if (browser) await browser.close().catch(() => {});
        try { slimProfileDir(userDir); } catch (e) {}
      }
    }
    return assistedCount;
  } catch (e) {
    console.error('Mentor Assist Cycle Error:', e.message);
    return 0;
  }
}

module.exports = { runClearedMentorAssistCycle };
