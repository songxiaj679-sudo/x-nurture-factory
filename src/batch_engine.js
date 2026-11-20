const { checkAndEnforceQuotaSync, recordExtraProxyKb } = require('./iproyal');
require('dotenv').config();

const {
  canAuditSearchIndex,
  isNewAccountHold,
  isPureFactoryAccount,
  searchLangForAccount,
  fromSearchClearsAccount,
  nextClearedAuditDecision,
  accountAgeDays,
} = require('./search_audit_policy');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');
const {
  db,
  updateAccountState,
  updateAccountData,
  getAccount,
  getAccountsByLifecycleStatuses,
  withAccountLock,
} = require('./firestore');
const {
  ACCOUNT_STATUS_GROUPS,
  getAccountLifecycleStatus,
  normalizeAccountStatus,
} = require('./account_state');
const {
  getPersistentProfileDir,
  slimProfileDir,
  ensureFarmingDisplay98,
  purgeProfileDirCompletely,
  extractKeepCookies,
  preCheckAccountWithoutBrowser,
  getUltraSavingBrowserArgs,
  enableSmartBandwidthSaver,
  attachApiHealthSniffer,
  verifyAccountStatusFast,
  inspectUserFromExternalView,
  X_WEB_BEARER
} = require('./status_checker');
const { getDeviceProfile, applyDeviceProfile, readStoredUserAgent, resolveExitCountry, isSetupForeignAccount } = require('./browser_config');
const { getResidentialProxy, getResidentialProxyForAccount, attachTrafficMeter } = require('./iproyal');
const {
  ensureAccountPersonality,
  generateAIContentViaGemini,
  hasEnglishInBio,
  generateNewBioFromPostContextViaGemini
} = require('./persona_engine');
const { randInt, humanSleep, humanIdleMouseMove, humanClickSelector, humanClickElement, humanScroll, humanNavigate, humanTyping } = require('./human_actions');

function logSys(msg) {
  try {
    const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(11, 19);
    fs.appendFileSync('/tmp/x_farming_live.log', '[' + now + '] ' + String(msg) + '\n', 'utf8');
  } catch (e) {}
  const ts = new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' });
  console.log(`[${ts}] ${msg}`);
}

function getNextJstActiveTime(waitHours) {
  const jitterHours = waitHours + (Math.random() * 2.2 - 0.5);
  const target = new Date(Date.now() + jitterHours * 3600 * 1000);
  const jstHourStr = target.toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: false });
  const jstHour = parseInt(jstHourStr, 10);
  if (jstHour >= 0 && jstHour <= 6) {
    const addHours = (7 - jstHour) + Math.random() * 2.5;
    return new Date(target.getTime() + addHours * 3600 * 1000);
  }
  return target;
}

function resolveProxy(token, account) {
  return getResidentialProxyForAccount(token, account);
}

function bioUiCoolingDown(accountData) {
  const raw = accountData && accountData.bioUiAttemptAt;
  if (!raw) return false;
  const ms = raw.toDate ? raw.toDate().getTime() : new Date(raw).getTime();
  return Number.isFinite(ms) && Date.now() - ms < 7 * 24 * 3600 * 1000;
}

// 養殖中は /settings/profile の保存ボタンだけで自己紹介を変える。生年月日経由と update_profile.json は使わない。
async function updateAccountBioOnly(page, newBio) {
  const cleanBio = String(newBio || '').trim().slice(0, 160);
  if (!cleanBio) return { ok: false, error: 'empty_bio' };

  await humanNavigate(page, 'https://x.com/settings/profile');
  await new Promise(r => setTimeout(r, 2800));

  const passwordWall = await page.$('input[type="password"], input[name="current_password"], input[name="password"]').catch(() => null);
  if (passwordWall) {
    await humanNavigate(page, 'https://x.com/home').catch(() => {});
    return { ok: false, error: 'password_wall' };
  }

  const filled = await page.waitForSelector('textarea[name="description"]', { timeout: 8000 })
    .then(() => true).catch(() => false);
  if (!filled) {
    await humanNavigate(page, 'https://x.com/home').catch(() => {});
    return { ok: false, error: 'profile_editor_missing' };
  }

  await page.evaluate(val => {
    const inp = document.querySelector('textarea[name="description"]');
    if (!inp) return;
    inp.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(inp, '');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inp, val);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, cleanBio).catch(() => {});
  await new Promise(r => setTimeout(r, 250));

  const saveBtn = await page.$('[data-testid="Profile_Save_Button"]').catch(() => null);
  if (!saveBtn) {
    await humanNavigate(page, 'https://x.com/home').catch(() => {});
    return { ok: false, error: 'save_button_missing' };
  }
  await page.evaluate(() => {
    const button = document.querySelector('[data-testid="Profile_Save_Button"]');
    if (button) button.click();
  }).catch(() => {});
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="Profile_Save_Button"]'),
    { timeout: 12000 }
  ).catch(() => {});
  await new Promise(r => setTimeout(r, 3500));
  await humanNavigate(page, 'https://x.com/home').catch(() => {});
  return { ok: true, method: 'ui', bio: cleanBio };
}

function getMaturityStage(accountData) {
  const cycles = accountData.farmingCycles || 0;
  const isPure = !!(accountData.isNewborn || accountData.originType === 'pure_jp' || accountData.originType === 'pure_en');
  const originTag = accountData.originType === 'pure_en' ? '多国籍EN純正' : '純国産';
  let ageDays = 0;
  const baseDate = accountData.createdAt || accountData.initializedAt;
  if (baseDate) {
    const ms = baseDate.toDate ? baseDate.toDate().getTime() : new Date(baseDate).getTime();
    if (!isNaN(ms)) ageDays = Math.max(0, (Date.now() - ms) / (86400 * 1000));
  }
  // ファクトリー作成アカウントの21日シャドウバン解除プログラム:
  // ・Day 0〜7 (または10サイクル未満): Stage 1 (他人への突撃リプ・フォロー完全封印、15秒精読＋独り言ポストのみ)
  // ・Day 7〜14 (または20サイクル未満): Stage 2 (低確率の共感交流＋滞在時間蓄積)
  // ・Day 14〜21+: Stage 3 (最新検索 f=live インデックス開通監査フェーズ)
  if (isPure) {
    if (ageDays < 7.0 || cycles < 10) {
      return { stage: 1, isPure: true, ageDays: Number(ageDays.toFixed(1)), label: `Stage1(Day0-7):${originTag}・無菌精読＆独り言期` };
    }
    if (ageDays < 14.0 || cycles < 20) {
      return { stage: 2, isPure: true, ageDays: Number(ageDays.toFixed(1)), label: `Stage2(Day7-14):${originTag}・信頼スコア熟成期` };
    }
    return { stage: 3, isPure: true, ageDays: Number(ageDays.toFixed(1)), label: `Stage3(Day14-21+):${originTag}・検索インデックス開通期` };
  }
  // 外部登録アカウント(imported)は既にアカウント年齢があるため、初期3サイクルのみStage1保護
  if (cycles < 3) {
    return { stage: 1, isPure: false, ageDays: Number(ageDays.toFixed(1)), label: 'Stage1:初期ウォームアップ期' };
  }
  if (cycles < 12) {
    return { stage: 2, isPure: false, ageDays: Number(ageDays.toFixed(1)), label: 'Stage2:双方向リプライ信頼構築期' };
  }
  return { stage: 3, isPure: false, ageDays: Number(ageDays.toFixed(1)), label: 'Stage3:最新検索(Latest)インデックス開通期' };
}

async function spaGoto(page, url, cleanUsername = '') {
  await humanNavigate(page, url, cleanUsername);
}

// 【高信頼スコア受動シグナル】タイムライン精読＋スレッド15秒滞在＋ブックマーク＋通知既読化
async function performHighTrustPassiveSignals(page) {
  logSys("  👀 [受動信頼シグナル蓄積] 広告・スパムを除外し、健全な日本語ポストのみを選別して15秒精読(Dwell Time)します...");
  await humanScroll(page, 2, 4);

  // 広告(Promoted)・外部URL・ハッシュタグ過多・外国語ポストを除外し、純粋な日本語ポストだけに絞る
  const hasSafeTarget = await page.evaluate(() => {
    document.querySelectorAll('[data-safe-passive]').forEach(el => el.removeAttribute('data-safe-passive'));
    const arts = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const safeList = [];
    for (const art of arts) {
      const fullTxt = art.innerText || '';
      if (/プロモーション|Promoted|広告/i.test(fullTxt)) continue;
      if (!art.querySelector('a time')) continue;
      const textEl = art.querySelector('[data-testid="tweetText"]');
      const bodyTxt = textEl ? (textEl.innerText || '').trim() : '';
      if (bodyTxt.length < 8) continue;
      // ひらがな・カタカナが含まれている日本語ポストのみ対象
      if (!/[ぁ-んァ-ヶ]/.test(bodyTxt)) continue;
      // URLやハッシュタグだらけのスパムを除外
      if (/https?:\/\//i.test(bodyTxt) || (bodyTxt.match(/[#＃]/g) || []).length >= 2) continue;
      safeList.push(art);
    }
    if (safeList.length === 0) return false;
    const picked = safeList[Math.floor(Math.random() * Math.min(safeList.length, 4))];
    picked.setAttribute('data-safe-passive', '1');
    return true;
  }).catch(() => false);

  if (hasSafeTarget) {
    if (Math.random() < 0.40) {
      await humanClickSelector(page, 'article[data-safe-passive="1"] [data-testid="bookmark"]', 3000);
      await humanSleep(600, 1400);
    }
    if (Math.random() < 0.45) {
      await humanClickSelector(page, 'article[data-safe-passive="1"] [data-testid="like"]', 3000);
      await humanSleep(700, 1500);
    }
    const clickedThread = await humanClickSelector(page, 'article[data-safe-passive="1"] a time', 3500);
    if (clickedThread) {
      const dwellMs = randInt(11000, 17000);
      await humanSleep(Math.floor(dwellMs / 2), Math.floor(dwellMs / 2) + 1200);
      await humanScroll(page, 1, 2);
      await humanSleep(Math.floor(dwellMs / 3), Math.floor(dwellMs / 2));
      await humanNavigate(page, 'https://x.com/home');
    }
  }
}

// アクションA（最優先）: 自分の投稿へのリプライに1件だけ返信する（双方向会話の成立＝最大スコア）
async function tryReplyToIncomingMentionOnce(page, token, accountData, cleanUsername) {
  const myLower = String(cleanUsername || '').replace(/^@/, '').trim().toLowerCase();
  const repliedHistory = Array.isArray(accountData.repliedMentions) ? [...accountData.repliedMentions] : [];
  if (!myLower) return { acted: false, repliedHistory };

  logSys("  🔔 [通知既読＆メンション確認] 届いているリプライがあるか確認中 (自己リプライ厳禁)...");
  await spaGoto(page, 'https://x.com/notifications/mentions');
  await new Promise(r => setTimeout(r, 2800));

  const targetMention = await page.evaluate((myHandle, historyList) => {
    const historySet = new Set(historyList || []);
    document.querySelectorAll('[data-human-mention]').forEach(el => el.removeAttribute('data-human-mention'));
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));

    for (const art of articles) {
      const userEl = art.querySelector('[data-testid="User-Name"]');
      if (!userEl) continue;

      let authorHandle = '';
      const links = Array.from(userEl.querySelectorAll('a[href^="/"]'));
      for (const a of links) {
        const href = (a.getAttribute('href') || '').split('?')[0].replace(/^\/+/, '');
        if (href && !href.includes('/') && href.toLowerCase() !== 'home') {
          authorHandle = href.toLowerCase();
          break;
        }
      }
      if (!authorHandle) {
        const m = (userEl.innerText || '').match(/@([A-Za-z0-9_]{1,20})/);
        if (m) authorHandle = m[1].toLowerCase();
      }

      if (!authorHandle || authorHandle === myHandle) continue;

      const textEl = art.querySelector('[data-testid="tweetText"]');
      const txt = textEl ? (textEl.innerText || '').trim() : '';
      if (txt.length < 2) continue;

      const sigKey = `${authorHandle}:${txt.slice(0, 24)}`;
      if (historySet.has(sigKey)) continue;

      if (art.querySelector('[data-testid="reply"]')) {
        art.setAttribute('data-human-mention', '1');
        return { authorHandle, txt, sigKey };
      }
    }
    return null;
  }, myLower, repliedHistory).catch(() => null);

  if (targetMention && targetMention.authorHandle.toLowerCase() !== myLower) {
    await humanClickSelector(page, 'article[data-human-mention="1"] [data-testid="like"]', 3500);
    await humanSleep(600, 1300);
    await humanClickSelector(page, 'article[data-human-mention="1"] [data-testid="reply"]', 4500);
  }

  if (!targetMention || targetMention.authorHandle.toLowerCase() === myLower) {
    await page.keyboard.press('Escape').catch(() => {});
    return { acted: false, repliedHistory };
  }

  await new Promise(r => setTimeout(r, 1800));
  const replyBox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 6000 }).catch(() => null);
  if (replyBox) {
    try {
      const replyBackText = await generateAIContentViaGemini(token, accountData, 'reply_back', targetMention.txt, '@' + targetMention.authorHandle);
      await humanTyping(page, replyBackText);
      await new Promise(r => setTimeout(r, 1200));
      await humanSleep(500, 1200);
      const clickedBtn = await humanClickSelector(page, '[data-testid="tweetButton"]:not([aria-disabled="true"]), [data-testid="tweetButtonInline"]:not([aria-disabled="true"])', 5000);
      if (!clickedBtn) {
        await page.keyboard.down('Control');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Control');
      }
      await new Promise(r => setTimeout(r, 3200));
      logSys(`     -> ✅ [1サイクル1アクション完了: リプライ返し] @${targetMention.authorHandle} へ返信: "${replyBackText}"`);
      repliedHistory.push(targetMention.sigKey);
      return { acted: true, repliedHistory: repliedHistory.slice(-60) };
    } catch (e) {
      await page.keyboard.press('Escape').catch(() => {});
    }
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  return { acted: false, repliedHistory };
}

// アクションB: 仲間アカウントまたは国内趣味ポストへ1回だけ共感リプライを送る
async function performSingleOutboundReply(page, token, accountData, peerAccounts, cleanUsername, isHighScoreBooster = false) {
  const attr = ensureAccountPersonality(token, accountData);
  const hobbies = attr.hobbies || ['カフェ', '映画'];
  const hobbyWord = hobbies[Math.floor(Math.random() * hobbies.length)];

  const myLower = String(cleanUsername || '').replace(/^@/, '').trim().toLowerCase();
  const validPeers = peerAccounts.filter(u => u && u.replace(/^@/, '').toLowerCase() !== myLower);

  let searchUrl = `https://x.com/search?q=${encodeURIComponent(hobbyWord + ' lang:ja -filter:links -filter:replies')}&f=live`;
  let assistedPeerHandle = null;
  // 完成在庫(isHighScoreBooster=true)の場合は80%の確率で養殖中の弱いアカウントへ救出リプライを送る
  const peerProb = isHighScoreBooster ? 0.80 : 0.25;
  if (validPeers.length > 0 && Math.random() < peerProb) {
    // リストの先頭（最も支援を必要としている養殖アカウント）を優先ピック
    const pickIdx = isHighScoreBooster ? Math.floor(Math.random() * Math.min(3, validPeers.length)) : Math.floor(Math.random() * validPeers.length);
    const peer = validPeers[pickIdx];
    assistedPeerHandle = peer;
    searchUrl = `https://x.com/${peer}`;
    if (isHighScoreBooster) {
      logSys(`  🤝 [高スコア先輩による救出Boost] 完成アカウント(@${cleanUsername})から養殖中アカウント(@${peer})へ信頼スコア譲渡リプライを送ります...`);
    } else {
      logSys(`  💬 [単発メインアクション: 健全ピア交流] 優良アカウント (@${peer}) の投稿へ1件だけ共感リプライを送ります...`);
    }
  } else {
    logSys(`  💬 [単発メインアクション: 一般日本人グラフ接続] 検索開通済みの一般日本語ポスト（「${hobbyWord}」）へ共感リプライを送りPageRankを吸収します...`);
  }

  await spaGoto(page, searchUrl);
  await page.evaluate(() => window.scrollBy({ top: 280, behavior: 'smooth' })).catch(() => {});
  await new Promise(r => setTimeout(r, 2500));

  // TweepCredのFF比(フォロー過多)ペナルティを防ぐため、フォローは初期(cycles < 3)かつ低確率のみに制限
  if ((accountData.farmingCycles || 0) >= 10 && (accountData.farmingCycles || 0) <= 18 && Math.random() < 0.12) {
    await humanClickSelector(page, '[data-testid$="-follow"]', 3000);
    await humanSleep(900, 1800);
  }

  const targetTweetInfo = await page.evaluate((myHandle) => {
    if (location.pathname.toLowerCase() === '/' + myHandle) return null;
    document.querySelectorAll('[data-human-out]').forEach(el => el.removeAttribute('data-human-out'));
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    for (const art of articles) {
      const userEl = art.querySelector('[data-testid="User-Name"]');
      if (!userEl) continue;

      let authorHandle = '';
      const links = Array.from(userEl.querySelectorAll('a[href^="/"]'));
      for (const a of links) {
        const href = (a.getAttribute('href') || '').split('?')[0].replace(/^\/+/, '');
        if (href && !href.includes('/') && href.toLowerCase() !== 'home') {
          authorHandle = href.toLowerCase();
          break;
        }
      }
      if (!authorHandle) {
        const m = (userEl.innerText || '').match(/@([A-Za-z0-9_]{1,20})/);
        if (m) authorHandle = m[1].toLowerCase();
      }
      if (!authorHandle || authorHandle === myHandle) continue;

      const textEl = art.querySelector('[data-testid="tweetText"]');
      const txt = textEl ? (textEl.innerText || '').trim() : '';
      if (txt.length < 10) continue;

      if (art.querySelector('[data-testid="reply"]')) {
        art.setAttribute('data-human-out', '1');
        return { authorHandle, txt };
      }
    }
    return null;
  }, myLower).catch(() => null);

  if (targetTweetInfo && targetTweetInfo.authorHandle !== myLower) {
    await humanClickSelector(page, 'article[data-human-out="1"] [data-testid="like"]', 3500);
    await humanSleep(600, 1400);
    await humanClickSelector(page, 'article[data-human-out="1"] [data-testid="reply"]', 4500);
  }

  if (targetTweetInfo && targetTweetInfo.authorHandle !== myLower) {
    await new Promise(r => setTimeout(r, 1800));
    const replyBox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 6000 }).catch(() => null);
    if (replyBox) {
      try {
        const replyContent = await generateAIContentViaGemini(token, accountData, 'reply_out', targetTweetInfo.txt, '@' + targetTweetInfo.authorHandle);
        await humanTyping(page, replyContent);
        await new Promise(r => setTimeout(r, 1200));
        await humanSleep(500, 1200);
      const clickedBtn = await humanClickSelector(page, '[data-testid="tweetButton"]:not([aria-disabled="true"]), [data-testid="tweetButtonInline"]:not([aria-disabled="true"])', 5000);
      if (!clickedBtn) {
        await page.keyboard.down('Control');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Control');
      }
        await new Promise(r => setTimeout(r, 3200));
        logSys(`     -> ✅ [1サイクル1アクション完了: 共感リプライ] @${targetTweetInfo.authorHandle} へ送信: "${replyContent}"`);
        return true;
      } catch (e) {
        await page.keyboard.press('Escape').catch(() => {});
      }
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  return false;
}

// アクションC: Gemini完全生成の日常ツイートを1回だけ投稿する
async function performSingleGeminiTweet(page, token, accountData, options = {}) {
  const cycles = accountData.farmingCycles || 0;
  const attachHarmlessImage = !options.plainText && (cycles % 3 === 1);
  logSys(`  ✍️ [単発メインアクション: Gemini日常ツイート] 固有DNAと過去履歴をもとに1件だけつぶやきます ${attachHarmlessImage ? '(🖼️ 健全メディア評価用の無害ユニーク画像添付)' : '(純テキスト)'}...`);
  const lastTweetText = accountData.lastTweetText || '';
  const recentTweets = Array.isArray(accountData.recentTweets) ? [...accountData.recentTweets] : (lastTweetText ? [lastTweetText] : []);
  try {
    let rawTweet = await generateAIContentViaGemini(token, { ...accountData, recentTweets }, 'tweet');
    // ハッシュタグ・URL・メンション等のスパム減点要素を完全排除
    const tweetText = String(rawTweet || '').replace(/https?:\/\/\S+/gi, '').replace(/#[\w一-龠ぁ-んァ-ヶー]+/g, '').trim();

    await spaGoto(page, 'https://x.com/compose/post');
    let textbox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 9000 }).catch(() => null);
    if (!textbox) {
      await spaGoto(page, 'https://x.com/home');
      await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
        if (btn) btn.click();
      }).catch(() => {});
      textbox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 9000 }).catch(() => null);
    }
    if (textbox) {
      await page.evaluate(el => el.focus(), textbox).catch(() => {});
      await textbox.click().catch(() => {});
      await new Promise(r => setTimeout(r, 500));
      await humanTyping(page, tweetText);
      await new Promise(r => setTimeout(r, 1200));

      // 3サイクルに1回、無害なオリジナルJPEG画像をCanvas生成してDataTransferで添付（SearchBan解除促進）
      if (attachHarmlessImage) {
        await page.evaluate(() => {
          try {
            const inp = document.querySelector('input[type="file"][data-testid="fileInput"], input[type="file"]');
            if (!inp) return;
            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = 420;
            const ctx = canvas.getContext('2d');
            const h1 = Math.floor(Math.random() * 360);
            const h2 = (h1 + 35 + Math.floor(Math.random() * 45)) % 360;
            const g = ctx.createLinearGradient(0, 0, 640, 420);
            g.addColorStop(0, `hsl(${h1}, 40%, 72%)`);
            g.addColorStop(1, `hsl(${h2}, 45%, 52%)`);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 640, 420);
            for (let i = 0; i < 5; i++) {
              ctx.beginPath();
              ctx.arc(Math.random() * 640, Math.random() * 420, 40 + Math.random() * 90, 0, Math.PI * 2);
              ctx.fillStyle = `hsla(${(h1 + i * 25) % 360}, 55%, 85%, 0.22)`;
              ctx.fill();
            }
            const dataUrl = canvas.toDataURL('image/jpeg', 0.91);
            const bin = atob(dataUrl.split(',')[1]);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const file = new File([bytes], 'daily_snap.jpg', { type: 'image/jpeg', lastModified: Date.now() });
            const dt = new DataTransfer();
            dt.items.add(file);
            inp.files = dt.files;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (e) {}
        }).catch(() => {});
        await new Promise(r => setTimeout(r, 2500));
      }

      await humanSleep(500, 1200);
      const clickedBtn = await humanClickSelector(page, '[data-testid="tweetButton"]:not([aria-disabled="true"]), [data-testid="tweetButtonInline"]:not([aria-disabled="true"])', 5000);
      if (!clickedBtn) {
        await page.keyboard.down('Control');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Control');
      }
      await new Promise(r => setTimeout(r, 4200));
      logSys(`     -> ✅ [1サイクル1アクション完了: 日常ツイート] "${tweetText}"`);
      recentTweets.push(tweetText);
      return { posted: true, tweetText, recentTweets: recentTweets.slice(-15) };
    }
  } catch (e) {
    logSys(`     -> ⚠️ Gemini生成スキップ: ${e.message}`);
  }
  return { posted: false, tweetText: lastTweetText, recentTweets: recentTweets.slice(-15) };
}

async function launchCheckerBrowser(cand) {
  const candProxy = getResidentialProxyForAccount(cand.token, cand);
  const candUa = readStoredUserAgent(cand) || getDeviceProfile(cand.token, '', cand).userAgent;
  ensureFarmingDisplay98();
  const checkerBrowser = await puppeteer.launch({
    headless: false,
    env: { ...process.env, DISPLAY: ':98' },
    args: [
      ...getUltraSavingBrowserArgs(candProxy),
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,800'
    ],
    ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=IdleDetection'],
    protocolTimeout: 50000
  });
  const checkPage = await checkerBrowser.newPage();
  checkPage.setDefaultNavigationTimeout(28000);
  if (candProxy && candProxy.user && candProxy.pass) {
    await checkPage.authenticate({ username: candProxy.user, password: candProxy.pass }).catch(() => {});
  }
  await enableSmartBandwidthSaver(checkPage, true);
  await applyDeviceProfile(checkPage, cand.token, candUa, cand);
  return { checkerBrowser, checkPage };
}

async function auditShadowbanSafely(cleanUsername, checkerPoolObjs = [], lastTweetText = '', account = null, options = {}) {
  if (account && !options.skipAgeGate && !canAuditSearchIndex(account)) {
    logSys(`  🌱 [検索監査ゲート] 生後 ${accountAgeDays(account).toFixed(1)} 日のため、純正アカウントは21日未満の検索監査をスキップします`);
    return { cleared: false, level: 'audit_not_due' };
  }
  const poolCandidates = Array.isArray(checkerPoolObjs)
    ? checkerPoolObjs
        .filter(c => c && c.authToken && String(c.userId || '').toLowerCase() !== String(cleanUsername || '').toLowerCase())
        .map(c => ({
          token: c.authToken.trim(),
          userId: c.userId || 'pool_account',
          ct0: c.ct0 || null,
          userAgent: c.userAgent || '',
          source: c.source || '',
          originType: c.originType || '',
          signupCountry: c.signupCountry || '',
          country: c.country || '',
          proxy: c.proxy || null,
          savedCookies: Array.isArray(c.savedCookies) ? c.savedCookies : [],
          source: '養殖プール'
        }))
    : [];

  for (let i = poolCandidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [poolCandidates[i], poolCandidates[j]] = [poolCandidates[j], poolCandidates[i]];
  }

  const checkerFile = path.join(__dirname, "../checkers.txt");
  if (fs.existsSync(checkerFile)) {
    const fileLines = fs.readFileSync(checkerFile, "utf8")
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => /^[a-fA-F0-9]{40}$/.test(l));
    for (let i = fileLines.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [fileLines[i], fileLines[j]] = [fileLines[j], fileLines[i]];
    }
    for (const ft of fileLines) {
      if (!poolCandidates.some(p => p.token === ft)) {
        poolCandidates.push({ token: ft, userId: 'checkers_txt', ct0: null, savedCookies: [], source: 'checkers.txt' });
      }
    }
  }

  if (poolCandidates.length === 0) {
    logSys("  ℹ️ 検索監査に使える他アカウントが存在しないため、次回に持ち越します。");
    return { cleared: false, level: 'no_checker' };
  }

  const searchLang = searchLangForAccount(account);
  const foreignFromHitClears = fromSearchClearsAccount(account);
  const rawQuery = "from:" + cleanUsername;
  let sawValidChecker = false;

  for (const cand of poolCandidates.slice(0, 3)) {
    let checkerBrowser = null;
    try {
      logSys(`  🔍 [最新検索(Latest)監査] ${cand.source}からランダム選出 (@${cand.userId}) で [${rawQuery}] の f=live 掲載を、そのアカウント自身の出口で監査中...`);
      const openedChecker = await launchCheckerBrowser(cand);
      checkerBrowser = openedChecker.checkerBrowser;
      const checkPage = openedChecker.checkPage;

      const cookies = [
        { name: "auth_token", value: cand.token, domain: ".x.com", path: "/", secure: true },
        { name: "auth_token", value: cand.token, domain: ".twitter.com", path: "/", secure: true },
        { name: "lang", value: searchLang, domain: ".x.com", path: "/" }
      ];
      if (cand.ct0) {
        cookies.push({ name: "ct0", value: cand.ct0, domain: ".x.com", path: "/", secure: true });
      }
      if (Array.isArray(cand.savedCookies)) {
        for (const sc of cand.savedCookies) {
          if (sc && sc.name && sc.value && sc.name !== "auth_token" && (!cand.ct0 || sc.name !== "ct0")) {
            cookies.push(sc);
          }
        }
      }
      await checkPage.setCookie(...cookies);

      const searchUrl = "https://x.com/search?q=" + encodeURIComponent(rawQuery) + "&f=live";
      const opened = await checkPage.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 28000 }).then(() => true).catch(() => false);
      if (!opened) {
        logSys(`     -> ⚠️ チェッカー (@${cand.userId}) の検索画面がプロキシ遅延で開きませんでした。未確定として次のチェッカーへ進みます`);
        continue;
      }

      const handleLower = String(cleanUsername || '').toLowerCase();
      const verdictHandle = await checkPage.waitForFunction((handle) => {
        const href = location.href;
        if (href.includes("/login") || href.includes("/i/flow/login") || href.includes("/account/access") || location.pathname === "/") return "login";
        if (document.querySelector('[data-testid="loginButton"], [data-testid="signupButton"]')) return "login";
        const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
        if (articles.some(article => (article.innerText || "").toLowerCase().includes(handle))) return "hit";
        const text = (document.body.innerText || "").replace(/\s+/g, "").toLowerCase();
        if (document.querySelector('[data-testid="emptyState"]') || text.includes("検索結果はありません") || text.includes("noresultsfor")) return "empty";
        return false;
      }, { timeout: 25000 }, handleLower).then(handle => handle.jsonValue()).catch(() => "timeout");

      if (verdictHandle !== "hit" && verdictHandle !== "empty") {
        logSys(`     -> ⚠️ チェッカー (@${cand.userId}) は [${verdictHandle}] のため未確定です。未掲載には数えません`);
        continue;
      }
      sawValidChecker = true;

      if (verdictHandle === "empty") {
        return { cleared: false, level: 'from_miss' };
      }

      const cleanPhrase = String(lastTweetText || '').replace(/[。、！？!?\s]/g, '').slice(0, 12);
      if (cleanPhrase.length >= 6) {
        const kwQuery = `"${cleanPhrase}" lang:${searchLang}`;
        const kwUrl = "https://x.com/search?q=" + encodeURIComponent(kwQuery) + "&f=live";
        await checkPage.goto(kwUrl, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 4000));
        const hitKw = await checkPage.evaluate((handle) => {
          const arts = Array.from(document.querySelectorAll("article[data-testid=\"tweet\"]"));
          return arts.some(a => (a.innerText || '').toLowerCase().includes(handle.toLowerCase()));
        }, cleanUsername).catch(() => false);
        if (hitKw) {
          logSys(`  🌟 [完全開通確認] キーワード検索（lang:${searchLang}）の『最新(f=live)』掲載も確認しました`);
          return { cleared: true, level: 'latest_keyword_verified' };
        }
        if (foreignFromHitClears) {
          logSys(`  🌟 [from:掲載で解除] lang:${searchLang} のキーワードには未反映ですが、from: 検索には出ているため解除とします`);
          return { cleared: true, level: 'from_search_verified' };
        }
        logSys("  ⏳ [熟成継続] from:検索には出ましたが、一般キーワード検索(f=live)にはまだ未反映のため養殖を継続します");
        return { cleared: false, level: 'from_only_warming' };
      }

      if (foreignFromHitClears) {
        logSys('  🌟 [from:掲載で解除] キーワードにできる本文が短いため、from: 検索の掲載を解除条件にします');
        return { cleared: true, level: 'from_search_verified' };
      }
      return { cleared: false, level: 'warming_need_tweet' };
    } catch (e) {
      logSys(`     -> ⚠️ チェッカー (@${cand.userId}) の監査ブラウザを開けませんでした。未確定として次へ進みます`);
    } finally {
      if (checkerBrowser) await checkerBrowser.close().catch(() => {});
    }
  }
  if (!sawValidChecker) return { cleared: false, level: 'checker_unavailable' };
  return { cleared: false, level: 'from_miss' };
}

// 養殖中(farming) および シャドウバン解除後(cleared) の両方を共通で厳密確認＆メンテナンスするコア関数
async function processFarmingAccount(docId, accountData, peerAccounts = [], checkerPoolObjs = []) {
  checkAndEnforceQuotaSync('batch_engine');
  const token = (accountData.authToken || '').trim();
  let cleanUsername = (accountData.userId || '').replace(/^@/, '').trim();
  if (!token) return;

  const isClearedMaintenance = getAccountLifecycleStatus(accountData) === 'healthy';
  const cycles = accountData.farmingCycles || 0;
  const maturity = getMaturityStage(accountData);
  const proxy = resolveProxy(token, accountData);
  const storedUa = readStoredUserAgent(accountData);
  const devProf = getDeviceProfile(token, storedUa, accountData);
  const userAgent = storedUa || devProf.userAgent;
  const enrichedAttr = ensureAccountPersonality(token, accountData);

  logSys(`\n==================================================`);
  if (isClearedMaintenance) {
    logSys(`🛡️ [シャドウバン解除後・鮮度維持メンテナンス] @${cleanUsername || docId}`);
  } else {
    logSys(`🌱 [高信頼1アクション養殖 Cycle #${cycles + 1} | ${maturity.label} (経過${maturity.ageDays}日)] @${cleanUsername || docId}`);
  }
  logSys(`🧬 [固有DNA:${enrichedAttr.personaId}] ${enrichedAttr.location} / ${enrichedAttr.age} / ${enrichedAttr.job}`);
  logSys(`==================================================`);

  const farmingPatch = {
    proxy: proxy || null,
    attributes: enrichedAttr,
    farmingStage: maturity.stage,
    maturityDays: maturity.ageDays
  };
  if (!storedUa) {
    farmingPatch.userAgent = userAgent;
    farmingPatch.deviceProfile = { ...devProf, userAgent };
  }
  await updateAccountData(docId, farmingPatch, storedUa ? {} : { allowUserAgentReplace: true });

  const nodePreCheck = await preCheckAccountWithoutBrowser(token, proxy, userAgent, accountData.savedCookies);
  if (nodePreCheck.username) cleanUsername = nodePreCheck.username;
  if (!nodePreCheck.ok) {
    logSys(`🚨 【ブラウザ起動前に即中断】 @${cleanUsername || docId} は [${nodePreCheck.reason}] のため隔離します`);
    await updateAccountState(docId, nodePreCheck.status, {
      errorReason: nodePreCheck.reason,
    });
    return;
  }

  if (!isClearedMaintenance && isNewAccountHold(accountData)) {
    const postedAt = accountData.lastPlainPostAt;
    const postedMs = postedAt ? (postedAt.toDate ? postedAt.toDate().getTime() : new Date(postedAt).getTime()) : NaN;
    if (Number.isFinite(postedMs) && Date.now() - postedMs < 24 * 3600 * 1000) {
      const nextActionAt = new Date(postedMs + 24 * 3600 * 1000);
      logSys(`  ⏸️ [新垢待機] @${cleanUsername} は24時間以内に原文を投稿済みのため、いいねやリプライはせず次の投稿まで待ちます`);
      await updateAccountData(docId, { nextActionAt }).catch(() => {});
      return;
    }
  }

  if (!isClearedMaintenance && !isPureFactoryAccount(accountData) && canAuditSearchIndex(accountData) && cleanUsername && !cleanUsername.startsWith('pending_') &&
      (accountData.lastTweetText || nodePreCheck.tweetsCount > 0)) {
    const earlyAudit = await auditShadowbanSafely(cleanUsername, checkerPoolObjs, accountData.lastTweetText, accountData);
    if (earlyAudit.cleared) {
      logSys(`🎉 【最新検索(f=live)掲載確認】 @${cleanUsername} が検索にヒットしました (${earlyAudit.level})！「🟢 完成・在庫 (cleared)」へ即時昇格します！`);
      await updateAccountState(docId, 'cleared', {
        searchIndexLevel: earlyAudit.level,
        errorReason: null,
        ...(Array.isArray(accountData.savedCookies) ? { savedCookies: accountData.savedCookies } : {}),
        nextActionAt: getNextJstActiveTime(22),
        shadowbanResolvedAt: new Date()
      });
      return;
    }
  }

  const userDir = getPersistentProfileDir(token);
  await updateAccountData(docId, { profileDir: userDir });
  const browserArgs = getUltraSavingBrowserArgs(proxy);
  let browser = null;
  let trafficMeter = null;

  try {
    ensureFarmingDisplay98();
      const vncLikeArgs = browserArgs.filter(a =>
        !a.includes('--disable-webgl') &&
        !a.includes('--disable-3d-apis') &&
        !a.includes('--blink-settings=imagesEnabled=false')
      );
      const vpW = (devProf && devProf.viewport && devProf.viewport.width) || 1920;
      const vpH = (devProf && devProf.viewport && devProf.viewport.height) || 1080;
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
        protocolTimeout: 50000
      });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(35000);

    if (attachTrafficMeter) {
      try { trafficMeter = await attachTrafficMeter(page); } catch (e) {}
    }

    await enableSmartBandwidthSaver(page, true);
    const snifferState = attachApiHealthSniffer(page);

    if (proxy && proxy.user && proxy.pass) {
      await page.authenticate({ username: proxy.user, password: proxy.pass });
    }

    await applyDeviceProfile(page, token, userAgent, accountData);

    const isEnOrigin = isSetupForeignAccount(accountData);
    const cookiesToSet = [
      { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true },
      { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true },
      { name: 'lang', value: isEnOrigin ? 'en' : 'ja', domain: '.x.com', path: '/' }
    ];
    if (nodePreCheck.ct0) {
      cookiesToSet.push({ name: 'ct0', value: nodePreCheck.ct0, domain: '.x.com', path: '/', secure: true });
    }
    if (Array.isArray(accountData.savedCookies)) {
      for (const sc of accountData.savedCookies) {
        if (sc && sc.name && sc.value && sc.name !== "auth_token" && (!nodePreCheck.ct0 || sc.name !== "ct0")) cookiesToSet.push(sc);
      }
    }
    await page.setCookie(...cookiesToSet);

    // 【必須1】INIT・養殖・解除後すべてでトップページ落ち(無効トークン)・凍結を100%厳密確認
    const preCheck = await verifyAccountStatusFast(page, cleanUsername, snifferState, 'https://x.com/home');
    if (preCheck.username && preCheck.username !== 'home') cleanUsername = preCheck.username;
    if (!preCheck.ok) {
      const savedCookiesNow = await extractKeepCookies(page);
      const isHardFrozen = /frozen|64|63|suspended|withheld/i.test(String(preCheck.reason || ''));
      const isRobotLock = /robot|326|access|app_lock/i.test(String(preCheck.status || '')) || /robot|326|app_lock/i.test(String(preCheck.reason || ''));

      // 凍結やロボットロックは確定的な制限のため即座に隔離
      if (isHardFrozen || isRobotLock) {
        logSys(`🚨 【確定制限検知で即隔離】 @${cleanUsername} は [${preCheck.reason}] のため [${preCheck.status}] へ隔離します`);
        await updateAccountState(docId, preCheck.status, {
          ...(cleanUsername ? { userId: cleanUsername } : {}),
          ...(savedCookiesNow.length > 0 ? { savedCookies: savedCookiesNow } : {}),
          errorReason: preCheck.reason
        });
        return;
      }

      // トークン失効疑惑またはプロキシタイムアウトの場合：住宅プロキシの遅延・未描画による誤爆を最大3回まで救済保護
      const currentStatus = accountData.status || (isClearedMaintenance ? 'cleared' : 'farming');
      const failCnt = (accountData.farmingTokenFailCount || 0) + 1;
      if (failCnt < 3) {
        const country = resolveExitCountry(accountData);
        const newProxy = getResidentialProxy(token + '_fretry' + failCnt + '_' + Date.now(), { country });
        logSys(`⚠️ 【偽トークン切れ・通信遅延保護 (${failCnt}/3回目)】 @${cleanUsername} (${preCheck.reason}) -> プロキシ遅延・未描画の疑いがあるため、回線を切り替え15分後に再試行します (ステータスは ${currentStatus} を維持)`);
        await updateAccountState(docId, currentStatus, {
          ...(cleanUsername ? { userId: cleanUsername } : {}),
          ...(savedCookiesNow.length > 0 ? { savedCookies: savedCookiesNow } : {}),
          proxy: newProxy,
          farmingTokenFailCount: failCnt,
          nextActionAt: new Date(Date.now() + 15 * 60 * 1000)
        });
        return;
      }

      // 3回連続で失敗し、かつ確定的なトークン失効の場合のみ隔離
      logSys(`🚨 【3回連続通信/セッション失敗で隔離】 @${cleanUsername} は [${preCheck.reason}] のため [unavailable] へ隔離します`);
      await updateAccountState(docId, 'unavailable', {
        ...(cleanUsername ? { userId: cleanUsername } : {}),
        ...(savedCookiesNow.length > 0 ? { savedCookies: savedCookiesNow } : {}),
        errorReason: preCheck.reason
      });
      return;
    }

    // preCheckが成功した場合、もし過去のリトライカウントがあればリセット
    if (accountData.farmingTokenFailCount && accountData.farmingTokenFailCount > 0) {
      const curSt = accountData.status || (isClearedMaintenance ? 'cleared' : 'farming');
      await updateAccountState(docId, curSt, { farmingTokenFailCount: 0 });
    }

    // ---------------------------------------------------------
    // 📝 【BIO文脈リファクタリング】BIOに英語が含まれていた場合、投稿Postの文脈から新しい日本語BIOを生成して文章だけ変更
    // ---------------------------------------------------------
    const currentBioCandidate = (preCheck && typeof preCheck.description === 'string' && preCheck.description.trim())
      ? preCheck.description.trim()
      : String(accountData.bio || '').trim();
    const quietPureFarming = !isClearedMaintenance && isPureFactoryAccount(accountData);

    if (quietPureFarming) {
      logSys(`  ⏸️ [新垢待機] @${cleanUsername} は設定画面を開かず、原文投稿だけを行います`);
    } else if (!isEnOrigin && hasEnglishInBio(currentBioCandidate) && bioUiCoolingDown(accountData)) {
      logSys(`  ⏸️ [BIO更新見送り] @${cleanUsername} は直近7日以内にプロフィール編集を試したため、再編集しません`);
    } else if (!isEnOrigin && hasEnglishInBio(currentBioCandidate)) {
      logSys(`  🔍 [BIO英語混入検知] @${cleanUsername} の自己紹介に英語が検出されました: "${currentBioCandidate}"`);
      try {
        const postSnippets = (Array.isArray(accountData.recentTweets) && accountData.recentTweets.length > 0)
          ? accountData.recentTweets
          : (accountData.lastTweetText ? [accountData.lastTweetText] : []);

        const newJapaneseBio = await generateNewBioFromPostContextViaGemini(token, accountData, postSnippets, currentBioCandidate);
        if (newJapaneseBio && newJapaneseBio !== currentBioCandidate) {
          logSys(`  ✨ [新日本語BIO生成] 投稿Postの文脈から新BIOを作成しました:\n     "${newJapaneseBio}"`);
          accountData.bioUiAttemptAt = new Date();
          await updateAccountData(docId, { bioUiAttemptAt: accountData.bioUiAttemptAt }).catch(() => {});
          const bioUpdateRes = await updateAccountBioOnly(page, newJapaneseBio);
          if (bioUpdateRes && bioUpdateRes.ok) {
            logSys(`  ✅ [BIO更新完了] @${cleanUsername} のBIOの文章だけを更新しました (${bioUpdateRes.method})！`);
            await updateAccountData(docId, {
              bio: newJapaneseBio,
              bioRefreshedFromPostsAt: new Date(),
              updatedAt: new Date()
            }).catch(() => {});
            accountData.bio = newJapaneseBio;
          } else {
            logSys(`  ⚠️ [BIO画面保存を見送り] @${cleanUsername}: ${bioUpdateRes ? bioUpdateRes.error : 'unknown'}`);
          }
        }
      } catch (errBio) {
        logSys(`  ⚠️ [BIO自動更新エラー] @${cleanUsername}: ${errBio.message}`);
      }
    }

    // ---------------------------------------------------------
    // 🟢 A. シャドウバン解除後 (status === 'cleared') の定期健康診断＆再シャドウバン防止メンテナンス
    // ---------------------------------------------------------
    if (isClearedMaintenance) {
      await performHighTrustPassiveSignals(page);

      let tweetText = accountData.lastTweetText || '';
      let recentTweets = Array.isArray(accountData.recentTweets) ? [...accountData.recentTweets] : [];

      // まず届いているリプライがあれば返信、なければ40%の確率でたまに日常ツイートをしてアクティブ状態を維持
      const mentionRes = await tryReplyToIncomingMentionOnce(page, token, accountData, cleanUsername);
      if (!mentionRes.acted && Math.random() < 0.40) {
        const twRes = await performSingleGeminiTweet(page, token, accountData);
        tweetText = twRes.tweetText;
        recentTweets = twRes.recentTweets;
      }

      // 解除後も再度シャドウバンになっていないか f=live で監査
      const reAudit = await auditShadowbanSafely(cleanUsername, checkerPoolObjs, tweetText, accountData, { skipAgeGate: true });
      const savedCookies = await extractKeepCookies(page);
      const decision = nextClearedAuditDecision(accountData, reAudit);

      if (decision.demote) {
        logSys(`⚠️ 【再シャドウバン検知】 @${cleanUsername} は from: 検索が ${decision.fromMissStreak} 回続けて空のため、「🌱 自動養殖中 (farming)」へ戻します`);
        await updateAccountState(docId, 'farming', {
          searchIndexLevel: 're_warming',
          fromMissStreak: decision.fromMissStreak,
          lastTweetText: tweetText,
          recentTweets,
          repliedMentions: mentionRes.repliedHistory,
          nextActionAt: getNextJstActiveTime(8),
          savedCookies
        });
      } else {
        const nextMaintAt = getNextJstActiveTime(12 + Math.floor(Math.random() * 6));
        if (reAudit.level === 'from_miss') {
          logSys(`⏳ 【from:空振り ${decision.fromMissStreak}/2】 @${cleanUsername} は1回だけでは降格しません`);
        } else {
          logSys(`✅ 【解除後メンテナンス完了】 @${cleanUsername} は検索監査 ${reAudit.level} のため完成在庫を維持します。次回メンテ: ${nextMaintAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
        }
        await updateAccountState(docId, 'cleared', {
          searchIndexLevel: decision.searchIndexLevel,
          fromMissStreak: decision.fromMissStreak,
          lastTweetText: tweetText,
          recentTweets,
          repliedMentions: mentionRes.repliedHistory,
          lastFarmedAt: new Date(),
          nextActionAt: nextMaintAt,
          savedCookies
        });
      }
      return;
    }

    // ---------------------------------------------------------
    // 🌱 B. 養殖中 (status === 'farming') の「受動精読＋1サイクル1メインアクション」フロー
    // 検索監査は養殖ブラウザを開く前に、チェッカー自身の出口で済ませている。
    // ---------------------------------------------------------

      // 2FAはINITで保存できたアカウントだけが養殖に入る。養殖中に設定画面は開かない。

      // 純正の504時間未満、および504時間経過後の判定周は、原文1件だけにする。
    if (quietPureFarming) {
      const twRes = await performSingleGeminiTweet(page, token, accountData, { plainText: true });
      const tweetText = twRes.tweetText || accountData.lastTweetText || '';
      const recentTweets = twRes.recentTweets || (tweetText ? [tweetText] : []);
      const savedCookies = await extractKeepCookies(page);
      if (canAuditSearchIndex(accountData) && twRes.posted && tweetText) {
        const freshAudit = await auditShadowbanSafely(cleanUsername, checkerPoolObjs, tweetText, accountData);
        if (freshAudit.cleared) {
          logSys(`🎉 【最新検索(f=live)掲載確認】 @${cleanUsername} の新しい投稿が検索にヒットしました (${freshAudit.level})！「🟢 完成・在庫 (cleared)」へ即時昇格します！`);
          await updateAccountState(docId, 'cleared', {
            searchIndexLevel: freshAudit.level,
            errorReason: null,
            lastTweetText: tweetText,
            recentTweets,
            lastPlainPostAt: new Date(),
            savedCookies,
            nextActionAt: getNextJstActiveTime(22),
            shadowbanResolvedAt: new Date()
          });
          return;
        }
        logSys(`  ⏳ [新投稿の検索未確認] @${cleanUsername} は ${freshAudit.level} のため、解除前の古い投稿では判定せず養殖を続けます`);
      }
      const newCycles = cycles + 1;
      const nextActionAt = new Date(Date.now() + (24 + Math.random() * 2) * 3600 * 1000);
      logSys(`⏳ [新垢の原文1件] Cycle #${newCycles} 完了。次回（${nextActionAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}）までいいねとリプライはしません。`);
      await updateAccountData(docId, {
        farmingCycles: newCycles,
        farmingStage: maturity.stage,
        maturityDays: maturity.ageDays,
        lastTweetText: tweetText,
        recentTweets,
        ...(twRes.posted ? { lastPlainPostAt: new Date() } : {}),
        lastFarmedAt: new Date(),
        nextActionAt,
        savedCookies,
        errorReason: null,
        updatedAt: new Date()
      });
      return;
    }

      // 1. まず必ず受動テレメトリ（スクロール・スレッド15秒精読・ブックマーク）で人間の閲覧スコアを稼ぐ
    await performHighTrustPassiveSignals(page);

    let tweetText = accountData.lastTweetText || '';
    let recentTweets = Array.isArray(accountData.recentTweets) ? [...accountData.recentTweets] : (tweetText ? [tweetText] : []);
    let updatedRepliedMentions = Array.isArray(accountData.repliedMentions) ? accountData.repliedMentions : [];
    let mainActionDone = false;

    // 2. メインアクション選択（1回の稼働につき1アクションのみ実行！）
    // 最優先(A): 自分の投稿にリプライが来ていれば「リプライ返し」1回のみで終了
    const mentionRes = await tryReplyToIncomingMentionOnce(page, token, accountData, cleanUsername);
    updatedRepliedMentions = mentionRes.repliedHistory;
    if (mentionRes.acted) {
      mainActionDone = true;
    }

    // 次点(B): Stage 2以降で、65%の確率で「他者への共感リプライ1回のみ」を実行
    if (!mainActionDone && maturity.stage >= 2 && Math.random() < (maturity.isPure ? 0.25 : 0.45)) {
      const outOk = await performSingleOutboundReply(page, token, accountData, peerAccounts, cleanUsername);
      if (outOk) mainActionDone = true;
    }

    // 次点(C): リプライを行わなかったサイクル（またはStage 1）では「日常ツイート1回のみ」を実行
    if (!mainActionDone) {
      const twRes = await performSingleGeminiTweet(page, token, accountData);
      tweetText = twRes.tweetText;
      recentTweets = twRes.recentTweets;

      // 新規作成等で初回ツイート直後にまだBIOに英語が残っていた場合、最新ツイートの文脈を加えて日本語BIOに更新
      if (!isEnOrigin && hasEnglishInBio(accountData.bio || '') && !bioUiCoolingDown(accountData)) {
        try {
          const freshTweets = recentTweets.length > 0 ? recentTweets : [tweetText];
          const newBioAfterTweet = await generateNewBioFromPostContextViaGemini(token, accountData, freshTweets, accountData.bio || '');
          if (newBioAfterTweet && newBioAfterTweet !== accountData.bio) {
            logSys(`  ✨ [最新Post後BIO更新] 投稿したツイートを反映して新日本語BIOを作成:\n     "${newBioAfterTweet}"`);
            accountData.bioUiAttemptAt = new Date();
            await updateAccountData(docId, { bioUiAttemptAt: accountData.bioUiAttemptAt }).catch(() => {});
            const bRes = await updateAccountBioOnly(page, newBioAfterTweet);
            if (bRes && bRes.ok) {
              logSys(`  ✅ [BIO更新完了] @${cleanUsername} のBIOの文章だけを更新しました！`);
              accountData.bio = newBioAfterTweet;
            }
          }
        } catch (eTwBio) {}
      }
    }

    const savedCookies = await extractKeepCookies(page);
    const newCycles = cycles + 1;
    const waitHours = maturity.stage === 1 ? (8 + Math.floor(Math.random() * 4)) : (7 + Math.floor(Math.random() * 4));
    const nextActionAt = getNextJstActiveTime(waitHours);

    logSys(`⏳ 養殖Cycle #${newCycles} (1サイクル1アクション厳守) 完了。次回（${nextActionAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}）まで寝かせます。`);
    const latestSnap = await getAccount(docId).catch(() => null);
      if (latestSnap && latestSnap.exists &&
          ['sold', 'posting_ready'].includes(getAccountLifecycleStatus(latestSnap.data()))) {
        console.log(`  ⏭️ [出荷済み保護] @${cleanUsername || docId} は既に [${latestSnap.data().status}] に移行済みのため、定期処理による上書きをスキップします`);
        return;
      }
      await updateAccountData(docId, {
      farmingCycles: newCycles,
      farmingStage: maturity.stage,
      maturityDays: maturity.ageDays,
      lastTweetText: tweetText,
      recentTweets,
      repliedMentions: updatedRepliedMentions,
      ...(accountData.bio ? { bio: accountData.bio } : {}),
      lastFarmedAt: new Date(),
      nextActionAt,
      savedCookies,
      errorReason: null,
      updatedAt: new Date()
    });

  } catch (error) {
    logSys(`❌ 定期処理中の一時エラー (@${cleanUsername}): ${error.message}`);
  } finally {
    if (trafficMeter && trafficMeter.finalizeAndLog) {
      try {
        const _origLog = console.log;
        // [Fixed console.log recursion]
        trafficMeter.finalizeAndLog('@' + (cleanUsername || docId));
        console.log = _origLog;
      } catch (e) {}
    }
    if (browser) await browser.close().catch(() => {});
    try { slimProfileDir(userDir); } catch (e) {}
  }
}

function acquireBatchLock(lockFile) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try {
      fd = fs.openSync(lockFile, 'wx', 0o600);
      fs.writeFileSync(fd, `${process.pid}\n`, 'utf8');
      fs.closeSync(fd);
      return true;
    } catch (error) {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (closeError) {}
      }
      if (error.code !== 'EEXIST') throw error;

      let existingPid = 0;
      try {
        existingPid = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10) || 0;
      } catch (readError) {
        if (readError.code !== 'ENOENT') throw readError;
      }
      if (existingPid > 0) {
        try {
          process.kill(existingPid, 0);
          return false;
        } catch (processError) {
          if (processError.code !== 'ESRCH') return false;
        }
      } else {
        try {
          if (Date.now() - fs.statSync(lockFile).mtimeMs < 10000) return false;
        } catch (statError) {
          if (statError.code !== 'ENOENT') throw statError;
        }
      }
      try {
        fs.unlinkSync(lockFile);
      } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      }
    }
  }
  return false;
}

function releaseBatchLock(lockFile) {
  try {
    const ownerPid = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
    if (ownerPid === process.pid) fs.unlinkSync(lockFile);
  } catch (error) {
    if (error.code !== 'ENOENT') logSys(`⚠️ バッチロック解放エラー: ${error.message}`);
  }
}

async function runFarmingLoop() {
  const ignoreCooldown = process.env.FORCE_FARM === '1' || process.argv.includes('--force');
  const lockFile = '/tmp/x_batch_engine.lock';
  if (!acquireBatchLock(lockFile)) {
    let ownerPid = 'unknown';
    try { ownerPid = fs.readFileSync(lockFile, 'utf8').trim() || ownerPid; } catch (error) {}
    logSys(`ℹ️ 既に別の batch_engine プロセス (PID: ${ownerPid}) が稼働中のため待機します。`);
    return;
  }
  process.once('exit', () => releaseBatchLock(lockFile));
  logSys(`🚀 高信頼スコア特化・1サイクル1アクション養殖＆解除後メンテナンスエンジン起動 (寝かせ無視: ${ignoreCooldown ? 'ON' : 'OFF'})`);

  while (true) {
    try {
      // 10万件規模でも sold や unavailable を読み込まないよう稼働ステータスのみをクエリ取得
      const stateGroup = ACCOUNT_STATUS_GROUPS.nurtureEngineQueue.map(normalizeAccountStatus);
      const accountDocs = await getAccountsByLifecycleStatuses(stateGroup);
      const allDocs = accountDocs.map(d => ({ id: d.id, data: d.data() }));
      const allFarming = allDocs.filter(a => getAccountLifecycleStatus(a.data) === 'nurturing');
      const allCleared = allDocs.filter(a => getAccountLifecycleStatus(a.data) === 'healthy');

      const now = Date.now();
      // 汚染伝播(Shadowban Contagion)を防ぐため、育成中アカウントが参照する仲間は「解除済み(cleared / active_own)」のみに厳選
      const peerHandles = allDocs
        .filter(a => ['healthy', 'posting_ready'].includes(getAccountLifecycleStatus(a.data)))
        .map(a => a.data.userId)
        .filter(u => u && !u.startsWith('pending_'));
      // 逆に解除済み(cleared)アカウントが定期メンテで動く際は、育成中(farming)のアカウントへリプライを送って「重み150倍の双方向会話」をアシストする
      const farmingAssistHandles = allDocs
        .filter(a => getAccountLifecycleStatus(a.data) === 'nurturing' && (a.data.farmingCycles || 0) >= 1)
        .map(a => a.data.userId)
        .filter(u => u && !u.startsWith('pending_'));

      const importedCheckers = allDocs
        .filter(a => !a.data.isNewborn && a.data.originType !== 'pure_jp' && a.data.originType !== 'pure_en' && ['nurturing', 'healthy', 'posting_ready'].includes(getAccountLifecycleStatus(a.data)) && a.data.authToken);
      const fallbackAllCheckers = allDocs
        .filter(a => ['nurturing', 'healthy', 'posting_ready'].includes(getAccountLifecycleStatus(a.data)) && a.data.authToken);
      const checkerSourceDocs = importedCheckers.length > 0 ? importedCheckers : fallbackAllCheckers;
      const checkerPool = checkerSourceDocs.map(a => ({
        authToken: a.data.authToken,
        userId: a.data.userId || a.id,
        ct0: a.data.ct0 || null,
        userAgent: a.data.userAgent || (a.data.deviceProfile && a.data.deviceProfile.userAgent) || '',
        source: a.data.source || '',
        originType: a.data.originType || '',
        signupCountry: a.data.signupCountry || '',
        country: a.data.country || '',
        proxy: a.data.proxy || null,
        savedCookies: a.data.savedCookies || []
      }));

      const readyFarming = allFarming.filter(a => {
        if (ignoreCooldown || !a.data.nextActionAt) return true;
        const nextMs = a.data.nextActionAt.toDate ? a.data.nextActionAt.toDate().getTime() : new Date(a.data.nextActionAt).getTime();
        return now >= nextMs;
      });

      // シャドウバン解除後 (cleared) のアカウントも、nextActionAt を過ぎていれば定期確認＆再発防止メンテナンスを実施
      const readyClearedMaint = allCleared.filter(a => {
        if (!a.data.nextActionAt) return true;
        const nextMs = a.data.nextActionAt.toDate ? a.data.nextActionAt.toDate().getTime() : new Date(a.data.nextActionAt).getTime();
        return now >= nextMs;
      });

      const readyQueue = [...readyFarming, ...readyClearedMaint];

      if (readyQueue.length === 0) {
        logSys(`⏳ 養殖対象(${allFarming.length}件) / 完成在庫メンテ(${allCleared.length}件) はすべて待機期間中です。5分後に再確認します...`);
        await new Promise(r => setTimeout(r, 300000));
        continue;
      }

      logSys(`📋 今回稼働キュー: 養殖 ${readyFarming.length}件 ＋ 解除後メンテ ${readyClearedMaint.length}件`);
      for (const item of readyQueue) {
        const otherCheckers = checkerPool.filter(c => c.authToken !== item.data.authToken);
        const targetPeers = getAccountLifecycleStatus(item.data) === 'healthy' && farmingAssistHandles.length > 0
          ? farmingAssistHandles
          : peerHandles;
        const lockRes = await withAccountLock(item.id, `batch_${process.pid}`, 20 * 60 * 1000, async () => {
          await processFarmingAccount(item.id, item.data, targetPeers, otherCheckers);
        });
        if (!lockRes.acquired) {
          logSys(`🔒 アカウント [${item.data.userId || item.id}] は現在ロック中（他プロセスが処理中）のためスキップします`);
        }
        await new Promise(r => setTimeout(r, 4000));
      }

      if (ignoreCooldown) {
        logSys("✅ 即時定期処理（--force）の1周処理が完了しました！");
        process.exit(0);
      }
    } catch (e) {
      logSys(`⚠️ ループエラー: ${e.message}`);
      await new Promise(r => setTimeout(r, 30000));
    }
  }
}

if (require.main === module) {
  runFarmingLoop().catch(err => {
    console.error('[Batch Engine] 養殖ループを開始できません:', err);
    process.exit(1);
  });
}

module.exports = { processFarmingAccount };
