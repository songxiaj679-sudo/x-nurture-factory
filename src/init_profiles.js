require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
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
  normalizeAccountStatus,
  getAccountLifecycleStatus,
} = require('./account_state');
const { waitForFirstmailXCode, fetchLatestCodeViaImapOnce } = require('./email_firstmail');
const {
  X_WEB_BEARER,
  getPersistentProfileDir,
  slimProfileDir,
  ensureFarmingDisplay98,
  purgeProfileDirCompletely,
  extractKeepCookies,
  preCheckAccountWithoutBrowser,
  getUltraSavingBrowserArgs,
  enableSmartBandwidthSaver,
  allowImagesForProfileUpload,
  attachApiHealthSniffer,
  verifyAccountStatusFast,
  inspectPageDomRestrictions
} = require('./status_checker');
const { getDeviceProfile, applyDeviceProfile, resolveAccountLocaleConfig, isSetupForeignAccount, resolveExitCountry } = require('./browser_config');
const { checkAndEnforceQuotaSync, recordExtraProxyKb, getResidentialProxy, getResidentialProxyForAccount, attachTrafficMeter } = require('./iproyal');
const { generateUniquePersonaProfileViaGemini } = require('./persona_engine');
const { enrollTwoFactorAuthOnPage } = require('./totp_helper');
const { humanSleep, humanIdleMouseMove, humanClickSelector, humanClickElement, humanScroll, humanNavigate, humanTyping } = require('./human_actions');

const TMP_DIR = path.join(__dirname, '../tmp_images');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const usedNamesSet = new Set();

// 管理画面からいつでもリアルタイム閲覧できるようファイルにもライブ出力
const INIT_LIVE_LOG_FILE = '/tmp/x_init_live.log';
try {
  if (!fs.existsSync(INIT_LIVE_LOG_FILE) || fs.statSync(INIT_LIVE_LOG_FILE).size > 500 * 1024) {
    fs.writeFileSync(INIT_LIVE_LOG_FILE, '', 'utf8');
  }
} catch (e) {}
const _origInitLog = console.log.bind(console);
const _origInitErr = console.error.bind(console);
function _writeInitLiveLog(prefix, args) {
  try {
    const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(11, 19);
    const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    const cleanMsg = msg.replace(/^\[\d{1,2}:\d{2}:\d{2}\]\s*/, '');
    fs.appendFileSync(INIT_LIVE_LOG_FILE, `[${now}] ${prefix}${cleanMsg}\n`, 'utf8');
  } catch (e) {}
}
console.log = (...args) => { _origInitLog(...args); if (!process.env.NO_INTERNAL_LIVE_LOG) _writeInitLiveLog('', args); };
console.error = (...args) => { _origInitErr(...args); _writeInitLiveLog('⚠️ ', args); };


function resolveProxyForAccount(token, account) {
  return getResidentialProxyForAccount(token, account);
}

async function robustGoto(page, url) {
  await humanNavigate(page, url);
}


async function setInputValueClean(page, selector, text) {
  const el = await page.waitForSelector(selector, { timeout: 6000 }).catch(() => null);
  if (!el) return false;
  await page.evaluate((sel, val) => {
    const inp = document.querySelector(sel);
    if (!inp) return;
    inp.focus();
    const proto = inp.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(inp, '');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inp, val);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, text || '').catch(() => {});
  await new Promise(r => setTimeout(r, 250));
  return true;
}

// パスワード確認画面 (Confirm your password) を全言語UIで確実に突破するヘルパー
async function unlockAccountInfoPassword(page, password) {
  if (!password) return false;
  const pwSelector = 'input[type="password"], input[name="current_password"], input[name="password"]';
  const pwInput = await page.waitForSelector(pwSelector, { timeout: 4500 }).catch(() => null);
  if (!pwInput) return false;

  console.log('    🔑 パスワード確認画面 (Confirm your password) を検知しました。入力して突破します...');
  await pwInput.click().catch(() => {});
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, pwSelector).catch(() => {});

  await pwInput.type(password, { delay: 50 });
  await new Promise(r => setTimeout(r, 600));

  // 青い Confirm ボタンを言語問わずクリック (data-testid または 設定ペイン内のボタン)
  const clickedConfirm = await page.evaluate(() => {
    const testBtn = document.querySelector('[data-testid="settingsDetailSave"], [data-testid="ocfEnterPasswordNextLink"], button[type="submit"]');
    if (testBtn && !testBtn.disabled) { testBtn.click(); return true; }

    const pwEl = document.querySelector('input[type="password"], input[name="current_password"], input[name="password"]');
    const container = pwEl ? (pwEl.closest('main') || pwEl.closest('section') || document.body) : document.body;
    const btns = Array.from(container.querySelectorAll('button, [role="button"]')).filter(b => {
      if (b.disabled) return false;
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const tid = (b.getAttribute('data-testid') || '').toLowerCase();
      if (tid.includes('back') || aria.includes('back') || aria.includes('戻る')) return false;
      const rect = b.getBoundingClientRect();
      return rect.width > 40 && rect.height > 24;
    });
    if (btns.length > 0) {
      btns[btns.length - 1].click();
      return true;
    }
    return false;
  }).catch(() => false);

  if (!clickedConfirm) {
    await page.keyboard.press('Enter');
  }

  // パスワード欄が消えて Account information 項目が出るまで待機
  const unlocked = await page.waitForFunction(
    () => !document.querySelector('input[type="password"], input[name="current_password"]'),
    { timeout: 8000 }
  ).then(() => true).catch(() => false);
  await new Promise(r => setTimeout(r, 2500));
  if (unlocked) {
    console.log('    🔓 パスワード確認を突破しました！');
    return true;
  } else {
    console.log('    ⚠️ パスワード確認画面を突破できませんでした（パスワード不一致または通信遅延）');
    return false;
  }
}

// 💡 スクショ完全準拠＆全外国語UI対応：パスワード突破 -> 国設定(日本) -> 言語設定(日本語)
async function setJapaneseAndCountry(page, password) {
  console.log('  🇯🇵 言語と国の設定を行います (全外国語UI＆パスワード突破対応)...');
  try {
    // -------------------------------------------------------------------------
    // Step 1: Account information (/settings/your_twitter_data/account) を開いてパスワードロックを解除
    // -------------------------------------------------------------------------
    await page.goto('https://x.com/settings/your_twitter_data/account', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    await unlockAccountInfoPassword(page, password);

    // -------------------------------------------------------------------------
    // Step 2: Country (/settings/country) へ移動し、ISOコード "jp" で日本を選択
    // -------------------------------------------------------------------------
    const clickedCountryLink = await page.evaluate(() => {
      const link = document.querySelector('a[href="/settings/country"], a[href*="/settings/country"]');
      if (link) { link.click(); return true; }
      return false;
    }).catch(() => false);

    if (!clickedCountryLink) {
      await page.goto('https://x.com/settings/country', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 3000));
    await unlockAccountInfoPassword(page, password);

    // <select> が出現するまでしっかり待つ
    const hasSelect = await page.waitForSelector('select', { timeout: 10000 }).catch(() => null);
    if (!hasSelect) {
      // まだ /settings/country に入っていなければもう一度直接遷移
      await page.goto('https://x.com/settings/country', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3500));
      await unlockAccountInfoPassword(page, password);
      await page.waitForSelector('select', { timeout: 8000 }).catch(() => null);
    }

    // 全外国語対応で「日本 (value="jp" または 各言語の日本表記)」を特定
    const countryInfo = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      for (const sel of selects) {
        const opts = Array.from(sel.options || []);
        if (opts.length < 10) continue; // 国リストは200件以上ある
        const currentOpt = opts[sel.selectedIndex] || { value: sel.value, text: '' };
        const jpRegex = /^(japan|日本|japón|japão|japon|giappone|япония|일본|japonya|jepang|jepun|nhật bản|ญี่ปุ่น|اليابان)$/i;
        const jpOpt = opts.find(o => o.value.toLowerCase() === 'jp') ||
                      opts.find(o => jpRegex.test((o.text || '').trim()) || (o.text || '').includes('日本') || (o.text || '').includes('Japan'));
        if (jpOpt) {
          return {
            found: true,
            alreadyJp: (sel.value.toLowerCase() === 'jp' || sel.value === jpOpt.value),
            currentText: currentOpt.text || sel.value,
            jpValue: jpOpt.value,
            jpText: jpOpt.text
          };
        }
      }
      return { found: false };
    }).catch(() => ({ found: false }));

    if (countryInfo.found) {
      if (countryInfo.alreadyJp) {
        console.log(`  🗾 国設定は既に日本 (${countryInfo.jpText}) になっています`);
      } else {
        console.log(`  🌍 国設定を [${countryInfo.currentText}] -> [${countryInfo.jpText} (val:${countryInfo.jpValue})] に変更します...`);
        // Puppeteer標準のselectとReact用ネイティブSetterの両方で確実にイベント発火
        await page.select('select', countryInfo.jpValue).catch(() => {});
        await page.evaluate((val) => {
          const sel = document.querySelector('select');
          if (!sel) return;
          sel.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
          if (setter) setter.call(sel, val);
          else sel.value = val;
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }, countryInfo.jpValue).catch(() => {});

        await new Promise(r => setTimeout(r, 2000));

        // 確認ポップアップ（「同意して続ける / Change / Agree / 変更」等）を言語問わず最大2段階クリック
        for (let step = 0; step < 2; step++) {
          const clickedConfirm = await page.evaluate(() => {
            // 1. data-testid で特定（全言語共通）
            const byTestId = document.querySelector('[data-testid="confirmationSheetConfirm"], [data-testid="settingsDetailSave"], [role="dialog"] button[data-testid]');
            if (byTestId && !byTestId.disabled) { byTestId.click(); return 'testid:' + (byTestId.getAttribute('data-testid') || ''); }

            // 2. ダイアログまたは設定右ペイン内のアクションボタンをクリック（全言語対応）
            const words = ['同意', '変更', '保存', '続行', 'agree', 'change', 'save', 'continue', 'confirm', 'continuar', 'cambiar', 'guardar', 'accepter', 'ändern', 'сохранить', 'изменить'];
            const allBtns = Array.from(document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="button"], main section button, main section [role="button"], main button, main [role="button"]'));
            for (const b of allBtns) {
              if (b.disabled) continue;
              const tid = (b.getAttribute('data-testid') || '').toLowerCase();
              const aria = (b.getAttribute('aria-label') || '').toLowerCase();
              if (tid.includes('back') || tid.includes('cancel') || aria.includes('back') || aria.includes('戻る')) continue;
              const text = (b.innerText || '').trim().toLowerCase();
              if (words.some(w => text.includes(w)) || b.closest('[role="dialog"]')) {
                b.click();
                return 'btn:' + text.slice(0, 20);
              }
            }
            return null;
          }).catch(() => null);

          if (clickedConfirm) {
            console.log(`    👉 国変更の確認ボタン (${clickedConfirm}) をクリックしました`);
            await new Promise(r => setTimeout(r, 2500));
          }
        }
        console.log('  ✅ 国を日本(Japan)に変更しました！');
      }
    } else {
      console.log('  ⚠️ 国の選択肢に日本が見つかりませんでした (現在のURL: ' + page.url() + ')');
    }

    // -------------------------------------------------------------------------
    // Step 3: 表示言語設定 (/settings/language および /settings/languages) を日本語(ja)に変更
    // -------------------------------------------------------------------------
    await page.goto('https://x.com/settings/language', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    await unlockAccountInfoPassword(page, password);

    const hasLangSelect = await page.$('select').catch(() => null);
    if (hasLangSelect) {
      await page.select('select', 'ja').catch(() => {});
      await page.evaluate(() => {
        const sel = document.querySelector('select');
        if (!sel) return;
        const opt = Array.from(sel.options).find(o => o.value.toLowerCase() === 'ja' || (o.text || '').includes('日本語') || (o.text || '').includes('Japanese'));
        const targetVal = opt ? opt.value : 'ja';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
        if (setter) setter.call(sel, targetVal);
        else sel.value = targetVal;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 1200));

      // 言語に依存しない [data-testid="settingsDetailSave"] を最優先でクリック
      const langSaved = await page.evaluate(() => {
        const saveBtn = document.querySelector('[data-testid="settingsDetailSave"], button[type="submit"]');
        if (saveBtn && !saveBtn.disabled) { saveBtn.click(); return true; }
        const btns = Array.from(document.querySelectorAll('main button, main [role="button"]')).filter(b => {
          if (b.disabled) return false;
          const tid = (b.getAttribute('data-testid') || '').toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          return !tid.includes('back') && !aria.includes('back') && (b.innerText || '').trim().length > 0;
        });
        if (btns.length > 0) { btns[btns.length - 1].click(); return true; }
        return false;
      }).catch(() => false);

      if (langSaved) {
        await new Promise(r => setTimeout(r, 3000));
        console.log('  🗣️ UI経由で表示言語を『日本語 (ja)』に保存しました！');
      }
    }

    // Step 4: パスワード認証突破後の特権セッション状態で内部 settings.json API でも言語(ja)・国(jp)・東京TZを確定同期
    await page.evaluate(async (bearer) => {
      try {
        const ct0 = (document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/) || [])[1];
        if (!ct0) return;
        await fetch('https://x.com/i/api/1.1/account/settings.json', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'authorization': 'Bearer ' + decodeURIComponent(bearer),
            'x-csrf-token': ct0,
            'x-twitter-active-user': 'yes',
            'x-twitter-auth-type': 'OAuth2Session',
            'content-type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            lang: 'ja',
            country: 'jp',
            tz: 'Asia/Tokyo',
            sleep_time_enabled: 'false',
            display_sensitive_media: 'false'
          }).toString()
        });
      } catch (e) {}
    }, X_WEB_BEARER).catch(() => {});

    await page.setCookie(
      { name: 'lang', value: 'ja', domain: '.x.com', path: '/' },
      { name: 'lang', value: 'ja', domain: 'x.com', path: '/' }
    ).catch(() => {});

    console.log('  ✅ ローカライズ完了 (国: 日本 / 言語: 日本語)');
  } catch (e) {
    console.log('  ⚠️ ローカライズ設定を一部スキップ: ' + e.message);
  }
}

async function resetInterests(page) {
  console.log(`  ⚙ 興味関心のリセット＆センシティブフラグ完全解除（サジェストバン防止）を実行します...`);
  try {
    // 1. 「表示するコンテンツ (/settings/content_you_see)」のセンシティブ表示チェックをOFFにする（チェッカー精度確保＆健全クラスタ維持）
    await page.goto('https://x.com/settings/content_you_see', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2200));
    await page.evaluate(() => {
      const cb = document.querySelectorAll('input[type="checkbox"]');
      if (cb.length > 0 && cb[0].checked) cb[0].click();
    }).catch(() => {});

    // 2. 「あなたのポスト (/settings/your_tweets)」の「センシティブな内容を含むものとしてマークする」を確実にOFFにする（Search Suggestion Ban の最大原因を除去）
    await page.goto('https://x.com/settings/your_tweets', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2200));
    const unmarkedSensitive = await page.evaluate(() => {
      const cbs = document.querySelectorAll('input[type="checkbox"]');
      let fixed = false;
      cbs.forEach(cb => {
        if (cb.checked) { cb.click(); fixed = true; }
      });
      return fixed;
    }).catch(() => false);
    if (unmarkedSensitive) {
      console.log('    🛡️ [サジェストバン原因除去] 「ポストするメディアをセンシティブとしてマークする」をOFFに解除しました！');
    }

    // 3. 汚染された興味関心トピックを全解除
    await page.goto('https://x.com/settings/your_twitter_data/twitter_interests', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    const unchecked = await page.evaluate(() => {
      let count = 0;
      document.querySelectorAll('input[type="checkbox"]').forEach(b => { if (b.checked) { b.click(); count++; } });
      return count;
    }).catch(() => 0);
    console.log(`  ✅ ${unchecked}件の興味関心を消去 ＆ センシティブ設定を健全化しました`);
  } catch (e) {
    console.log(`  ⚠️ 興味関心リセットスキップ`);
  }
}

async function deleteAllOldTweets(page, username) {
  const cleanUser = String(username || '').replace(/^@/, '').trim();
  const targetHandle = '@' + cleanUser.toLowerCase();
  console.log(`  🗑 2. @${cleanUser} の過去ポスト・返信・リポストを残り0件になるまで徹底削除します...`);

  // Step A: 内部API経由で取得できる過去ツイート・リポストを先行して高速削除
  try {
    const apiDeleted = await page.evaluate(async (bearer, screenName) => {
      try {
        const ct0 = (document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/) || [])[1];
        if (!ct0 || !screenName) return 0;
        const headers = {
          'authorization': 'Bearer ' + decodeURIComponent(bearer),
          'x-csrf-token': ct0,
          'x-twitter-active-user': 'yes',
          'x-twitter-auth-type': 'OAuth2Session',
          'content-type': 'application/x-www-form-urlencoded'
        };
        let totalApiDel = 0;
        for (let round = 0; round < 5; round++) {
          const r = await fetch(`https://x.com/i/api/1.1/statuses/user_timeline.json?screen_name=${encodeURIComponent(screenName)}&count=200&include_rts=true&exclude_replies=false`, {
            method: 'GET',
            credentials: 'include',
            headers
          });
          if (!r.ok) break;
          const items = await r.json();
          if (!Array.isArray(items) || items.length === 0) break;
          let delInRound = 0;
          for (const item of items) {
            const idStr = item && item.id_str;
            if (!idStr) continue;
            const endpoint = item.retweeted
              ? `https://x.com/i/api/1.1/statuses/unretweet/${idStr}.json`
              : `https://x.com/i/api/1.1/statuses/destroy/${idStr}.json`;
            const dr = await fetch(endpoint, {
              method: 'POST',
              credentials: 'include',
              headers,
              body: new URLSearchParams({ id: idStr }).toString()
            }).catch(() => null);
            if (dr && dr.ok) {
              delInRound++;
              totalApiDel++;
            }
            await new Promise(res => setTimeout(res, 180));
          }
          if (delInRound === 0) break;
        }
        return totalApiDel;
      } catch (e) {
        return 0;
      }
    }, X_WEB_BEARER, cleanUser).catch(() => 0);

    if (apiDeleted > 0) {
      console.log(`    ⚡ [API先行一掃] 内部API経由で ${apiDeleted}件 の過去ポストを高速削除しました`);
    }
  } catch (e) {}

  // Step B: UI上で「返信・全ポスト (with_replies)」と「通常ポスト」の両タブを0件になるまで徹底走査
  let grandTotalDeleted = 0;
  for (const tab of ['with_replies', '']) {
    const tabName = tab ? '返信・全ポスト' : '通常ポスト';
    const url = tab ? `https://x.com/${cleanUser}/${tab}` : `https://x.com/${cleanUser}`;
    let tabDeleted = 0;

    // 多いアカウントでも途中で終わらないよう最大15パスまで反復（0件確認できたら即終了）
    for (let pass = 1; pass <= 3; pass++) {
      await robustGoto(page, url);
      await page.waitForSelector('article[data-testid="tweet"], [data-testid="emptyState"]', { timeout: 7000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      let delInPass = 0;
      let emptyScrolls = 0;

      for (let step = 0; step < 45; step++) {
        if (grandTotalDeleted >= 30) break;
        // エラー再試行ボタンや空状態ボタンがあればクリック
        await page.evaluate(() => {
          const emptyBtn = document.querySelector('[data-testid="empty_state_button_text"]');
          if (emptyBtn) emptyBtn.click();
          const retryBtns = Array.from(document.querySelectorAll('[role="button"], button'));
          const retry = retryBtns.find(b => /やりなおす|再試行|retry|try again|intentar/i.test((b.innerText || '').trim()));
          if (retry) retry.click();
        }).catch(() => {});

        // 画面上のツイートを上から順に検査（他人の親ツイートはDOMから物理削除して下の自分の返信を露出させる）
        const action = await page.evaluate((handle, cleanH) => {
          const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
          if (articles.length === 0) return { type: 'no_articles' };

          for (const art of articles) {
            // 1. リポスト解除ボタン(緑)がある場合は最優先でクリック
            const unrt = art.querySelector('[data-testid="unretweet"]');
            if (unrt) {
              art.setAttribute('data-active-del', '1');
              unrt.scrollIntoView({ block: 'center' });
              unrt.click();
              return { type: 'unretweet' };
            }

            // 2. 投稿者ハンドルを確認
            const uEl = art.querySelector('[data-testid="User-Name"]');
            const uTxt = uEl ? (uEl.innerText || '').toLowerCase() : '';
            const links = Array.from(art.querySelectorAll('a[href]')).map(a => (a.getAttribute('href') || '').toLowerCase());
            const isMine = (handle !== '@' && (uTxt.includes(handle) || links.includes('/' + cleanH)));

            if (!isMine) {
              // 返信スレッド内の他人の元ツイートはDOMから除去し、画面が埋まってスクロールが止まるのを防ぐ
              art.remove();
              return { type: 'removed_foreign' };
            }

            // 3. 自分のツイートの三点メニュー (caret) を開く
            const caret = art.querySelector('[data-testid="caret"]');
            if (!caret) {
              art.remove();
              return { type: 'removed_no_caret' };
            }

            art.setAttribute('data-active-del', '1');
            caret.scrollIntoView({ block: 'center' });
            caret.click();
            return { type: 'caret_opened' };
          }
          return { type: 'no_articles' };
        }, targetHandle, cleanUser.toLowerCase()).catch(() => ({ type: 'error' }));

        if (action.type === 'removed_foreign' || action.type === 'removed_no_caret') {
          await new Promise(r => setTimeout(r, 120));
          continue;
        }

        if (action.type === 'unretweet') {
          await new Promise(r => setTimeout(r, 650));
          const confirmedUnrt = await page.evaluate(() => {
            const c = document.querySelector('[data-testid="unretweetConfirm"], [role="menuitem"]');
            if (c) { c.click(); return true; }
            return false;
          }).catch(() => false);
          await page.evaluate(() => {
            const el = document.querySelector('article[data-active-del="1"]');
            if (el) el.remove();
          }).catch(() => {});
          if (confirmedUnrt) {
            delInPass++; tabDeleted++; grandTotalDeleted++; emptyScrolls = 0;
            if (grandTotalDeleted % 5 === 0 || grandTotalDeleted === 1) {
              console.log(`    🗑️ [${tabName}] リポスト解除・削除進行中... (累計: ${grandTotalDeleted}件)`);
            }
          }
          await new Promise(r => setTimeout(r, 1100));
          continue;
        }

        if (action.type === 'caret_opened') {
          await new Promise(r => setTimeout(r, 650));
          const clickedDeleteMenu = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
            if (items.length === 0) return false;
            const delRegex = /削除|delete|eliminar|supprimer|löschen|удалить|حذف|xóa|hapus|sil|excluir|删除|刪除|삭제/i;
            const target = items.find(el => {
              const txt = (el.innerText || '').trim();
              if (delRegex.test(txt)) return true;
              const span = el.querySelector('span') || el;
              const color = window.getComputedStyle(span).color;
              return color === 'rgb(244, 33, 46)' || color === 'rgb(249, 24, 128)';
            });
            if (target) {
              target.click();
              return true;
            }
            return false;
          }).catch(() => false);

          if (!clickedDeleteMenu) {
            // メニュー内に削除が無い場合（他人のポスト等）は閉じてDOMから除外し、同じ要素で止まらないようにする
            await page.keyboard.press('Escape').catch(() => {});
            await new Promise(r => setTimeout(r, 300));
            await page.evaluate(() => {
              const el = document.querySelector('article[data-active-del="1"]');
              if (el) el.remove();
            }).catch(() => {});
            continue;
          }

          await new Promise(r => setTimeout(r, 650));
          const confirmedDel = await page.evaluate(() => {
            const btn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
            if (btn) { btn.click(); return true; }
            return false;
          }).catch(() => false);

          await page.evaluate(() => {
            const el = document.querySelector('article[data-active-del="1"]');
            if (el) el.remove();
          }).catch(() => {});

          if (confirmedDel) {
            delInPass++; tabDeleted++; grandTotalDeleted++; emptyScrolls = 0;
            if (grandTotalDeleted % 5 === 0 || grandTotalDeleted === 1) {
              console.log(`    🗑️ [${tabName}] ポスト削除進行中... (累計: ${grandTotalDeleted}件)`);
            }
            await new Promise(r => setTimeout(r, 1200));
          } else {
            await page.keyboard.press('Escape').catch(() => {});
            await new Promise(r => setTimeout(r, 400));
          }
          continue;
        }

        // 画面上に記事が見つからない場合はスクロールして追加読み込みを待つ
        emptyScrolls++;
        if (emptyScrolls >= 5) break;
        await page.evaluate((s) => window.scrollBy(0, s * 950), emptyScrolls).catch(() => {});
        await new Promise(r => setTimeout(r, 1800));
      }

      // このパスで1件も削除対象が出なければ（既に0件なら）このタブのループを完了
      if (delInPass === 0) break;
      console.log(`    🔄 [${tabName}] パス#${pass} で ${delInPass}件 削除しました。取りこぼしがないか再走査します...`);
    }
  }
  console.log(`  ✅ 2. 過去ポスト・返信・リポストの完全清掃が完了しました (合計削除: ${grandTotalDeleted}件)`);
}

async function cleanOldFollowings(page, username) {
  console.log("  👥 3. 既存の海外フォローを人間ペースで全整理します...");
  await robustGoto(page, `https://x.com/${username}/following`);
  let unfollowed = 0;
  for (let i = 0; i < 45; i++) {
    if (unfollowed > 0 && unfollowed % 12 === 0) {
      await humanSleep(6000, 10000);
    }
    const hasBtn = await page.$('[data-testid$="-unfollow"]').catch(() => null);
    if (!hasBtn) {
      await page.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' })).catch(() => {});
      await humanSleep(1200, 2000);
      const retryBtn = await page.$('[data-testid$="-unfollow"]').catch(() => null);
      if (!retryBtn) break;
    }
    const clicked = await humanClickSelector(page, '[data-testid$="-unfollow"]', 3500);
    if (!clicked) break;
    await humanSleep(650, 1300);
    const conf = await humanClickSelector(page, '[data-testid="confirmationSheetConfirm"]', 3500);
    if (!conf) break;
    unfollowed++;
    await humanSleep(1500, 2800);
  }
  console.log(`  ✅ 海外フォロー整理完了 (${unfollowed}件解除)`);
}

// 取得した画像をブラウザ内Canvasで微細トリミング＆色調シフトして再エンコード（画像ハッシュの完全ユニーク化）
async function downloadAndUniquifyImage(page, w, h, filepath) {
  function fetchUrlFollowRedirects(urlStr, maxRedirects = 5) {
    return new Promise((resolve) => {
      if (maxRedirects <= 0) return resolve(null);
      const client = urlStr.startsWith('https') ? https : require('http');
      const req = client.get(urlStr, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, urlStr).href;
          res.resume();
          return resolve(fetchUrlFollowRedirects(nextUrl, maxRedirects - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          // JPEG (FF D8) または PNG (89 50) のマジックバイトを確認
          if (buf.length > 2000 && ((buf[0] === 0xff && buf[1] === 0xd8) || (buf[0] === 0x89 && buf[1] === 0x50))) {
            resolve(buf);
          } else {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }

  let validRawBuf = null;
  const sources = [
    `https://picsum.photos/${w + 16}/${h + 16}?random=${Math.random()}`,
    `https://loremflickr.com/${w + 16}/${h + 16}/nature,cafe,sky?lock=${Math.floor(Math.random() * 9999)}`
  ];
  for (const srcUrl of sources) {
    validRawBuf = await fetchUrlFollowRedirects(srcUrl, 5);
    if (validRawBuf) break;
  }

  try {
    if (page) {
      const b64In = validRawBuf ? validRawBuf.toString('base64') : '';
      const b64Out = await page.evaluate(async (rawB64, targetW, targetH) => {
        return await new Promise((resolve) => {
          const drawFallback = () => {
            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            const hue1 = Math.floor(Math.random() * 360);
            const hue2 = (hue1 + 40 + Math.floor(Math.random() * 60)) % 360;
            const grad = ctx.createLinearGradient(0, 0, targetW, targetH);
            grad.addColorStop(0, `hsl(${hue1}, 45%, 65%)`);
            grad.addColorStop(1, `hsl(${hue2}, 50%, 45%)`);
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, targetW, targetH);
            for (let i = 0; i < 6; i++) {
              ctx.beginPath();
              ctx.arc(Math.random() * targetW, Math.random() * targetH, (Math.random() * 0.25 + 0.1) * Math.min(targetW, targetH), 0, Math.PI * 2);
              ctx.fillStyle = `hsla(${(hue1 + i * 30) % 360}, 60%, 80%, 0.18)`;
              ctx.fill();
            }
            const dataUrl = canvas.toDataURL('image/jpeg', Number((0.89 + Math.random() * 0.07).toFixed(2)));
            resolve(dataUrl.split(',')[1] || null);
          };

          if (!rawB64) return drawFallback();

          const img = new Image();
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = targetW;
              canvas.height = targetH;
              const ctx = canvas.getContext('2d');
              const ox = Math.floor(Math.random() * 10) + 2;
              const oy = Math.floor(Math.random() * 10) + 2;
              ctx.filter = `contrast(${97 + Math.floor(Math.random() * 6)}%) brightness(${98 + Math.floor(Math.random() * 5)}%)`;
              ctx.drawImage(img, ox, oy, targetW, targetH, 0, 0, targetW, targetH);
              const p = ctx.getImageData(0, 0, 2, 2);
              p.data[0] = (p.data[0] + Math.floor(Math.random() * 7) + 1) % 256;
              ctx.putImageData(p, 0, 0);
              const dataUrl = canvas.toDataURL('image/jpeg', Number((0.89 + Math.random() * 0.07).toFixed(2)));
              resolve(dataUrl.split(',')[1] || null);
            } catch (e) {
              drawFallback();
            }
          };
          img.onerror = () => drawFallback();
          img.src = 'data:image/jpeg;base64,' + rawB64;
        });
      }, b64In, w, h).catch(() => null);

      if (b64Out) {
        fs.writeFileSync(filepath, Buffer.from(b64Out, 'base64'));
        return filepath;
      }
    }
    if (validRawBuf) {
      fs.writeFileSync(filepath, validRawBuf);
    }
  } catch (e) {}
  return filepath;
}

async function updateProfileAndImages(page, cleanUsername, persona, iconPath, headerPath, docId, password = '', isPureJp = false) {
  console.log(`  📝 4. [生年月日裏ルート] アカウント情報 -> 生年月日からプロフィール＆画像を安全に適用します (名前: ${persona.name})...`);

  // Step 1: アカウント情報 (/settings/your_twitter_data/account) または 生年月日 (/settings/birthdate) へ移動
  await page.goto("https://x.com/settings/your_twitter_data/account", { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2200));
  if (password) {
    await unlockAccountInfoPassword(page, password);
  }

  // アカウント情報内の「生年月日 (/settings/birthdate または /settings/your_twitter_data/age)」をクリック
  const clickedBirthRow = await page.evaluate(() => {
    const link = document.querySelector('a[href="/settings/birthdate"], a[href*="/settings/birthdate"], a[href*="/settings/your_twitter_data/age"]');
    if (link) { link.click(); return true; }
    const cells = Array.from(document.querySelectorAll('a, div[role="tab"], div[data-testid="pivot"], span'));
    const bEl = cells.find(el => /生年月日|Birth date|Fecha de nacimiento/i.test((el.innerText || '').trim()));
    if (bEl) {
      const a = bEl.closest('a') || bEl;
      a.click();
      return true;
    }
    return false;
  }).catch(() => false);

  if (!clickedBirthRow) {
    await page.goto("https://x.com/settings/birthdate", { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
  }
  await new Promise(r => setTimeout(r, 2500));
  if (password) {
    await unlockAccountInfoPassword(page, password);
  }

  // Step 2: 生年月日画面にある「プロフィール (a[href="/settings/profile"])」リンクをクリックして裏ルートからプロフィール編集モーダルを開く
  const openedViaBirthdate = await page.evaluate(() => {
    const profLink = document.querySelector('a[href="/settings/profile"], a[href*="/settings/profile"]');
    if (profLink) {
      profLink.click();
      return true;
    }
    const links = Array.from(document.querySelectorAll('main a, [role="dialog"] a, span[role="link"]'));
    const target = links.find(el => /プロフィール|profile|perfil/i.test((el.innerText || '').trim()));
    if (target) {
      target.click();
      return true;
    }
    return false;
  }).catch(() => false);

  if (openedViaBirthdate) {
    console.log("  🔓 [生年月日裏ルート成功] 生年月日画面のリンクからプロフィール編集モーダルを開きました！");
    await new Promise(r => setTimeout(r, 3000));
  } else {
    console.log("  ℹ️ 生年月日リンクが見つからなかったため、/settings/profile へ遷移します...");
    await robustGoto(page, "https://x.com/settings/profile");
    await new Promise(r => setTimeout(r, 2800));
  }

  // モーダルの入力欄が出現するまで待機
  await page.waitForSelector('input[name="displayName"], textarea[name="description"]', { timeout: 8000 }).catch(() => null);

  // Step 3: ヘッダー画像とアイコン画像を DataTransfer + File API でブラウザ内から直接セット (uploadFileエラーゼロ)
  async function uploadAndApplyImageViaDataTransfer(inputIndex, filePath, label) {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1000) {
      console.log(`  ⚠️ ${label} ファイルが存在しないかサイズ不足のためスキップします`);
      return false;
    }
    const b64Data = fs.readFileSync(filePath).toString('base64');
    console.log(`  📸 ${label} を適用中 (サイズ: ${Math.round(fs.statSync(filePath).size / 1024)}KB)...`);

    const injected = await page.evaluate((idx, b64) => {
      const inputs = Array.from(document.querySelectorAll('input[type="file"][data-testid="fileInput"], [role="dialog"] input[type="file"], input[type="file"]'));
      if (inputs.length === 0) return { ok: false, count: 0 };
      const target = inputs.length >= 2 ? inputs[idx] : inputs[0];
      if (!target) return { ok: false, count: inputs.length };

      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], idx === 0 ? 'header.jpg' : 'avatar.jpg', { type: 'image/jpeg', lastModified: Date.now() });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.files = dt.files;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, count: inputs.length };
    }, inputIndex, b64Data).catch(e => ({ ok: false, err: e.message }));

    if (!injected || !injected.ok) {
      console.log(`  ⚠️ ${label} の file input 注入失敗 (検出input数: ${injected ? injected.count : 0})`);
      return false;
    }

    const appBtn = await page.waitForSelector('[data-testid="applyButton"]', { timeout: 8000 }).catch(() => null);
    if (appBtn) {
      await new Promise(r => setTimeout(r, 900));
      await page.evaluate(() => {
        const b = document.querySelector('[data-testid="applyButton"]');
        if (b) b.click();
      }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('[data-testid="applyButton"]'), { timeout: 6000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
      console.log(`    ✅ ${label} のトリミング適用完了`);
      return true;
    } else {
      console.log(`    ℹ️ ${label} のトリミング画面が出なかったため次へ進みます`);
      return false;
    }
  }

  // 1枚目: ヘッダー画像 (index 0)、2枚目: アイコン画像 (index 1)
  await uploadAndApplyImageViaDataTransfer(0, headerPath, "1/2: ヘッダー画像");
  await uploadAndApplyImageViaDataTransfer(1, iconPath, "2/2: アイコン画像");

  // Step 4: 表示名・自己紹介・場所を入力 (純国産は作成時に名前設定済みのため名前変更をスキップ)
  if (!isPureJp) {
    await setInputValueClean(page, 'input[name="displayName"]', persona.name);
  } else {
    const existingDispName = await page.evaluate(() => {
      const inp = document.querySelector('input[name="displayName"]');
      return inp && inp.value ? inp.value.trim() : '';
    }).catch(() => '');
    // Geminiタイムアウト等でローマ字名(Yuki Ikeda等)のままだった場合は日本語ペルソナ名へ更新する
    if (existingDispName && !/^[A-Za-z0-9_\s.-]+$/.test(existingDispName)) {
      persona.name = existingDispName;
      console.log(`  🇯🇵 [純国産保護] X上の現在の日本語名 (${persona.name}) をそのまま維持します (表示名の変更スキップ)`);
    } else {
      await setInputValueClean(page, 'input[name="displayName"]', persona.name);
      console.log(`  🇯🇵 [ローマ字名補正] X上の初期名がローマ字 (${existingDispName}) だったため、日本語名 (${persona.name}) を適用しました`);
    }
  }
  await setInputValueClean(page, 'textarea[name="description"]', persona.bio);
  await setInputValueClean(page, 'input[name="location"]', persona.location || '日本');
  const hasUrlInput = await page.$('input[name="url"]').catch(() => null);
  if (hasUrlInput) {
    await setInputValueClean(page, 'input[name="url"]', '');
  }

  // Step 5: 「保存 (Profile_Save_Button)」をクリックしてアップロード完了までしっかり待機
  const saveBtn = await page.$('[data-testid="Profile_Save_Button"]').catch(() => null);
  if (saveBtn) {
    await page.evaluate(() => {
      const b = document.querySelector('[data-testid="Profile_Save_Button"]');
      if (b) b.click();
    }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector('[data-testid="Profile_Save_Button"]'), { timeout: 12000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3500));
  }

  // Step 6: UI保存で反映しきれなかった項目がある時のみ、内部APIでスマート補完（二重アップロードによるボット判定を防止）
  const curCookies = await page.cookies().catch(() => []);
  const curCt0 = curCookies.find(c => c.name === 'ct0')?.value || '';
  if (curCt0) {
    const iconB64 = (fs.existsSync(iconPath) && fs.statSync(iconPath).size > 1000) ? fs.readFileSync(iconPath).toString('base64') : '';
    const headerB64 = (fs.existsSync(headerPath) && fs.statSync(headerPath).size > 1000) ? fs.readFileSync(headerPath).toString('base64') : '';

    const apiRes = await page.evaluate(async (bearer, csrf, pName, pBio, pLoc, iB64, hB64) => {
      const headers = {
        'authorization': `Bearer ${bearer}`,
        'x-csrf-token': csrf,
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'content-type': 'application/x-www-form-urlencoded'
      };
      const out = { profile: 'SKIP(UI済)', icon: 'SKIP(UI済)', banner: 'SKIP(UI済)' };
      let currentUser = null;
      try {
        const vr = await fetch('https://x.com/i/api/1.1/account/verify_credentials.json?skip_status=true&include_entities=false', {
          method: 'GET', credentials: 'include', headers
        });
        if (vr.ok) currentUser = await vr.json();
      } catch (e) {}

      const needBio = false;
      const needIcon = !currentUser || currentUser.default_profile_image === true;
      const needBanner = !currentUser || !currentUser.profile_banner_url;

      if (needBio) {
        try {
          const r1 = await fetch('https://x.com/i/api/1.1/account/update_profile.json', {
            method: 'POST', credentials: 'include', headers,
            body: new URLSearchParams(pName ? { name: pName, description: pBio, location: pLoc, url: '' } : { description: pBio, location: pLoc, url: '' }).toString()
          });
          out.profile = r1.status;
        } catch (e) {}
      }

      if (needIcon && iB64) {
        await new Promise(r => setTimeout(r, 1800));
        try {
          const r2 = await fetch('https://x.com/i/api/1.1/account/update_profile_image.json', {
            method: 'POST', credentials: 'include', headers,
            body: new URLSearchParams({ image: iB64, include_entities: 'true', skip_status: 'true' }).toString()
          });
          out.icon = r2.status;
        } catch (e) {}
      }

      if (needBanner && hB64) {
        await new Promise(r => setTimeout(r, 1800));
        try {
          const r3 = await fetch('https://x.com/i/api/1.1/account/update_profile_banner.json', {
            method: 'POST', credentials: 'include', headers,
            body: new URLSearchParams({ banner: hB64 }).toString()
          });
          out.banner = r3.status;
        } catch (e) {}
      }
      return out;
    }, X_WEB_BEARER, curCt0, isPureJp ? '' : persona.name, persona.bio, persona.location || '日本', iconB64, headerB64).catch(() => ({}));

    console.log(`  ✅ プロフィール＆画像の保存確認が完了しました (Profile=${apiRes.profile}, Icon=${apiRes.icon}, Header=${apiRes.banner})`);
  } else {
    console.log("  ✅ プロフィール＆画像の保存が完了しました");
  }

  await humanSleep(1500, 2800);
  const midDomCheck = await inspectPageDomRestrictions(page);
  if (midDomCheck !== 'ok') {
    const midSt = midDomCheck === 'app_lock' ? 'app_lock' : (midDomCheck === 'robot' ? 'robot' : 'unavailable');
    console.log(`🚨 【プロフィール変更中に制限検知 -> 即中断】 @${cleanUsername} は [${midDomCheck}] のため次のアカウントへ進みます`);
    if (docId) await updateAccountState(docId, midSt, { errorReason: `init_mid_${midDomCheck}` });
    return false;
  }
}

async function processAccount(docId, account) {
  checkAndEnforceQuotaSync('init_profiles');
  const token = (account.authToken || '').trim();
  if (!token) return;
  const isRehabReset = (account.status === 'reset');
  const localeCfg = resolveAccountLocaleConfig(account);
  const proxy = resolveProxyForAccount(token, account);
  const isPureNewborn = !!(account.isNewborn || account.originType === 'pure_jp' || account.originType === 'pure_en');
  const isPureEnOrigin = isPureNewborn && (account.originType === 'pure_en' || localeCfg.country !== 'jp');
  const isPureJpNewborn = isPureNewborn;
  const keepForeignLocale = isSetupForeignAccount(account);
  const devProf = getDeviceProfile(token, account.deviceProfile && account.deviceProfile.userAgent || account.userAgent || '', account);
  const macChromeUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const fixedUA = (account.userAgent && !account.userAgent.includes('Firefox/') && !account.userAgent.includes('Chrome/131.0.0.0'))
    ? account.userAgent
    : devProf.userAgent;
  const fixedDeviceProfile = getDeviceProfile(token, fixedUA, account);
  let cleanUsername = (account.userId || '').replace(/^@/, '').trim();

  const freshSnap = await getAccount(docId).catch(() => null);
  if (freshSnap && freshSnap.exists) {
    const freshData = freshSnap.data() || {};
    const freshLifecycle = normalizeAccountStatus(freshData.lifecycleStatus || freshData.status);
    if (['nurturing', 'healthy', 'posting_ready'].includes(freshLifecycle)) {
      console.log(`\n⏭️ [二重INIT防止] @${freshData.userId || cleanUsername || docId} は既に初期設定完了済み (${freshData.status || freshLifecycle}) のためスキップします`);
      return;
    }
    if (freshData.twoFactorKey && !account.twoFactorKey) {
      account.twoFactorKey = freshData.twoFactorKey;
    }
    if (freshData.profileInitialized) {
      account.profileInitialized = true;
    }
    if (freshData.userId && !cleanUsername) {
      cleanUsername = String(freshData.userId).replace(/^@/, '').trim();
    }
  }

  const originTagLabel = !isPureNewborn
    ? '🌍 外部仕入れ (imported)'
    : (isPureEnOrigin ? `🌐 多国籍EN純正 (pure_en / ${localeCfg.country.toUpperCase()} / ${localeCfg.locale})` : '🇯🇵 日本純正 (pure_jp / ja-JP)');
  console.log(`\n=============================================`);
  console.log(`🛠 [初回初期設定 (${originTagLabel})] 開始: @${cleanUsername || docId}`);

  const canonicalUa = fixedDeviceProfile.userAgent;
  fixedDeviceProfile.userAgent = canonicalUa;
  await updateAccountData(docId, {
    userAgent: canonicalUa,
    deviceProfile: fixedDeviceProfile,
    proxy: proxy || null,
  }, { allowUserAgentReplace: true });
  // 純作成アカウント(pure_jp / pure_en)はNode.jsのTLS指紋でauth_tokenを傷つけないよう事前API直叩きをスキップし、ブラウザに直接任せる
  const nodePreCheck = isPureNewborn
    ? { ok: true, verifiedByApi: false, status: 'ok', username: cleanUsername, ct0: account.ct0 || null, tweetsCount: 0, followingCount: 0 }
    : await preCheckAccountWithoutBrowser(token, proxy, canonicalUa, account.savedCookies);
  if (nodePreCheck.username) cleanUsername = nodePreCheck.username;
  if (!nodePreCheck.ok) {
    const isHardFrozen = /frozen|64|63|suspended|withheld/i.test(String(nodePreCheck.reason || ''));
    const failCnt = (account.initTokenFailCount || 0) + 1;
    if (!isHardFrozen && nodePreCheck.status === 'unavailable' && failCnt < 3) {
      const newProxy = getResidentialProxy(token + '_retry' + failCnt + '_' + Date.now(), { country: resolveExitCountry(account) });
      console.log(`⚠️ [偽トークン切れ保護 (${failCnt}/3回目)] @${cleanUsername || docId} (${nodePreCheck.reason}) -> 凍結ではなく通信/セッション一時未同期の可能性があるため、プロキシを更新して10分後に再試行します`);
      await updateAccountState(docId, 'standby', {
        ...(cleanUsername ? { userId: cleanUsername } : {}),
        proxy: newProxy,
        initTokenFailCount: failCnt,
        initReadyAt: new Date(Date.now() + 10 * 60 * 1000),
        errorReason: `再試行待機(${failCnt}/3): ${nodePreCheck.reason}`
      });
      return;
    }
    console.log(`🚨 【事前API監査で確定中断】 @${cleanUsername || docId} -> [${nodePreCheck.reason}]`);
    await updateAccountState(docId, nodePreCheck.status, {
      ...(cleanUsername ? { userId: cleanUsername } : {}),
      errorReason: nodePreCheck.reason
    });
    return;
  }

  const tokenHash = crypto.createHash('md5').update(token).digest('hex');
  const userDir = getPersistentProfileDir(token);
  await updateAccountData(docId, { profileDir: userDir });
  const iconPath = path.join(TMP_DIR, `icon_${tokenHash}.jpg`);
  const headerPath = path.join(TMP_DIR, `header_${tokenHash}.jpg`);

  let browser = null, trafficMeter = null;
  try {
    ensureFarmingDisplay98();
    const vncLikeArgs = getUltraSavingBrowserArgs(proxy).filter(a =>
      !a.includes('--disable-webgl') &&
      !a.includes('--disable-3d-apis') &&
      !a.includes('--blink-settings=imagesEnabled=false')
    );
    const vpW = (fixedDeviceProfile && fixedDeviceProfile.viewport && fixedDeviceProfile.viewport.width) || 1920;
    const vpH = (fixedDeviceProfile && fixedDeviceProfile.viewport && fixedDeviceProfile.viewport.height) || 1080;
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
      protocolTimeout: 60000
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(32000);
    if (attachTrafficMeter) { try { trafficMeter = await attachTrafficMeter(page); } catch (e) {} }
    const cdpClient = await enableSmartBandwidthSaver(page, true);
    const snifferState = attachApiHealthSniffer(page);
    if (proxy && proxy.user && proxy.pass) await page.authenticate({ username: proxy.user, password: proxy.pass });

    await applyDeviceProfile(page, token, fixedDeviceProfile.userAgent, account);

    const initCookies = [
      { name: 'auth_token', value: token, domain: '.x.com', path: '/', secure: true },
      { name: 'auth_token', value: token, domain: '.twitter.com', path: '/', secure: true },
      { name: 'lang', value: localeCfg.langCookie, domain: '.x.com', path: '/' }
    ];
    if (nodePreCheck.ct0) initCookies.push({ name: 'ct0', value: nodePreCheck.ct0, domain: '.x.com', path: '/', secure: true });
    if (Array.isArray(account.savedCookies)) {
      for (const sc of account.savedCookies) {
        if (sc && sc.name && sc.value && sc.name !== "auth_token" && (!nodePreCheck.ct0 || sc.name !== "ct0")) initCookies.push(sc);
      }
    }
    await page.setCookie(...initCookies);

    const preCheck = await verifyAccountStatusFast(page, cleanUsername, snifferState, 'https://x.com/home');
    if (preCheck.username && preCheck.username !== 'home') cleanUsername = preCheck.username;
    if (!preCheck.ok) {
      const savedCookiesNow = await extractKeepCookies(page);
      const isHardFrozen = /frozen|64|63|suspended|withheld/i.test(String(preCheck.reason || ''));
      const failCnt = (account.initTokenFailCount || 0) + 1;
      if (!isHardFrozen && preCheck.status === 'unavailable' && failCnt < 3) {
        const newProxy = getResidentialProxy(token + '_bretry' + failCnt + '_' + Date.now(), { country: resolveExitCountry(account) });
        console.log(`⚠️ [偽トークン切れ保護 (${failCnt}/3回目)] @${cleanUsername || docId} (${preCheck.reason}) -> プロキシ遅延または未描画の可能性があるため、プロキシを切り替え10分後に再試行します`);
        await updateAccountState(docId, 'standby', {
          ...(cleanUsername ? { userId: cleanUsername } : {}),
          ...(savedCookiesNow.length > 0 ? { savedCookies: savedCookiesNow } : {}),
          proxy: newProxy,
          initTokenFailCount: failCnt,
          initReadyAt: new Date(Date.now() + 10 * 60 * 1000),
          errorReason: `再試行待機(${failCnt}/3): ${preCheck.reason}`
        });
        return;
      }
      console.log(`🚨 【ブラウザ監査で確定中断】 @${cleanUsername || docId} -> [${preCheck.reason}]`);
      await updateAccountState(docId, preCheck.status, {
        ...(cleanUsername ? { userId: cleanUsername } : {}),
        ...(savedCookiesNow.length > 0 ? { savedCookies: savedCookiesNow } : {}),
        errorReason: preCheck.reason
      });
      return;
    }

    await updateAccountState(docId, 'init_pending', { userId: cleanUsername, proxy: proxy || null });
    let persona;
      const inheritedHasJapanese = /[\u3040-\u30ff\u3400-\u9fff]/.test(`${account.name || ''}${account.bio || ''}${account.location || ''}`);
      if (isPureNewborn && account.bio && account.attributes && !(keepForeignLocale && inheritedHasJapanese)) {
        persona = {
          name: account.name || cleanUsername,
          bio: account.bio,
          location: account.location || (account.attributes && account.attributes.location) || (keepForeignLocale ? localeCfg.country.toUpperCase() : '日本'),
          attributes: account.attributes,
          tweet: ''
        };
        console.log(`  🧬 [純作成ペルソナ引継] 作成時に生成されたペルソナ (名前: ${persona.name} / 地域: ${persona.location}) をそのまま引き継ぎます`);
      } else {
        persona = await generateUniquePersonaProfileViaGemini(token, usedNamesSet, keepForeignLocale ? account : {});
        if (!keepForeignLocale && isPureNewborn && account.name && /[\u3040-\u30ff\u3400-\u9fff]/.test(account.name)) {
          persona.name = account.name;
        }
      }
    const preservedForeignLocation = account.location || (account.attributes && account.attributes.location) || localeCfg.country.toUpperCase();
    if (isPureNewborn || keepForeignLocale) {
      if (keepForeignLocale) {
        console.log(`  🌐 [外国SETUP維持] 国・言語の設定画面はスキップします (${localeCfg.country.toUpperCase()} / ${localeCfg.locale})`);
      } else {
        console.log('  🇯🇵 [純国産バイパス] 作成時に日本国・日本語UIが確定済みのため、設定画面でのパスワード再入力をスキップしてロックを防ぎます');
      }
      await humanSleep(2000, 3200);
    } else {
      await setJapaneseAndCountry(page, account.password);
      console.log('  ⏳ 乗っ取り判定を避けるため、意図的に待機します...'); await new Promise(r => setTimeout(r, 6000 + Math.random() * 4000));
      await resetInterests(page);
      console.log('  ⏳ 乗っ取り判定を避けるため、意図的に待機します...'); await new Promise(r => setTimeout(r, 6000 + Math.random() * 4000));
    }

    if (!isRehabReset) {
      if (account.profileInitialized) {
        console.log('  ⏭️ [プロフ二重変更防止] 既に初回プロフィール＆画像は適用済みのため、画像再アップロードをスキップして2FAへ進みます');
      } else {
        await allowImagesForProfileUpload(page, cdpClient);
        await downloadAndUniquifyImage(page, 400, 400, iconPath);
        await downloadAndUniquifyImage(page, 1500, 500, headerPath);
        const profOk = await updateProfileAndImages(page, cleanUsername, persona, iconPath, headerPath, docId, account.password || '', !keepForeignLocale && (isPureJpNewborn || account.originType === 'pure_jp'));
        if (profOk === false) return;
        await updateAccountData(docId, {
          profileInitialized: true,
          name: persona.name,
          bio: persona.bio,
          location: persona.location || (keepForeignLocale ? preservedForeignLocation : '日本'),
          attributes: persona.attributes,
          updatedAt: new Date()
        }).catch(() => {});
      }
    }

    const knownTweets = nodePreCheck.tweetsCount ?? preCheck.tweetsCount;
    const knownFollowing = nodePreCheck.followingCount ?? preCheck.followingCount;

    // 【2FA厳密判定】既にデータに twoFactorKey が存在する場合は2FA設定処理を100%スキップ
    const existing2FA = String(account.twoFactorKey || '').trim();
    const isSetupOrigin = String(account.source || '') === 'setup_worker';
    if (existing2FA.length >= 4) {
      console.log(`  🔐 [2FAスキップ] 既に2FAシード (${existing2FA.slice(0, 4)}...) が登録されているため、2FA付与処理はスキップします`);
    } else if (!isSetupOrigin) {
      console.log(`  🔐 [2FA対象外] @${cleanUsername} は SETUP 作成アカウントではないため、2FAは付けません`);
    } else if (account.password && !account.email) {
      console.log(`  ⚠️ [2FA見送り] @${cleanUsername} に確認メールの宛先が無いため、2FAは登録できません`);
    } else if (account.password) {
      if (cdpClient) {
          try {
          await cdpClient.send('Network.setBlockedURLs', {
            urls: ['*://video.twimg.com/*', '*://*.pscp.tv/*', '*.mp4*', '*.m3u8*', '*.m4s*']
          });
        } catch (e) {}
        }
        const enrolled2FA = await enrollTwoFactorAuthOnPage(page, account.password, account.email || '', account.emailPassword || '');
      if (enrolled2FA && enrolled2FA.ok && enrolled2FA.twoFactorKey) {
        account.twoFactorKey = enrolled2FA.twoFactorKey;
        await updateAccountData(docId, {
          twoFactorKey: enrolled2FA.twoFactorKey,
          ...(enrolled2FA.backupCode ? { backupCode: enrolled2FA.backupCode } : {})
        });
      } else if (enrolled2FA && enrolled2FA.reason === 'already_enabled') {
        console.log(`  ℹ️ [2FA既存] @${cleanUsername} は認証アプリが既に有効です。シードは画面から再取得できないため、保存済みの鍵が無いまま養殖へ進みます`);
      } else {
        const nextRetry = (account.twoFactorRetryCount || 0) + 1;
        const waitMin = Math.min(180, 20 * nextRetry);
        const savedCookiesRetry = await extractKeepCookies(page);
        const reason = enrolled2FA && enrolled2FA.reason ? enrolled2FA.reason : 'two_factor_incomplete';
        console.log(`  ⏳ [2FA再試行予約 ${nextRetry}回目] @${cleanUsername} の2FAが未完了 (${reason}) のため、養殖へは進めず ${waitMin} 分後にINITだけやり直します`);
        await updateAccountState(docId, 'standby', {
          twoFactorRetryCount: nextRetry,
          errorReason: reason,
          initReadyAt: new Date(Date.now() + waitMin * 60 * 1000),
          ...(savedCookiesRetry.length > 0 ? { savedCookies: savedCookiesRetry } : {})
        });
        return;
      }
    }

    if (isPureJpNewborn || account.originType === 'pure_jp') {
            console.log("  🇯🇵 [純国産・即凍結防止ソフトINIT] 作成直後のスパム検知を防ぐため、初回INITではプロフィール＆2FA定着に専念し、最後に省エネモードで10秒だけホーム画面を確認します...");
      await enableSmartBandwidthSaver(page).catch(() => {});
      await Promise.race([
        (async () => {
          await robustGoto(page, "https://x.com/home").catch(() => {});
          await humanSleep(3000, 4500);
          await humanScroll(page, 1, 2).catch(() => {});
          await humanIdleMouseMove(page).catch(() => {});
          await humanSleep(2500, 4000);
        })(),
        new Promise(r => setTimeout(r, 15000))
      ]);
    } else {
      if (cleanUsername && !cleanUsername.startsWith('pending_')) {
        if (knownTweets === 0) {
          console.log("  ⚡ 2. 既存ツイート数が 0件 のため、削除ページへの移動をスキップして通信量を節約します");
        } else {
          await deleteAllOldTweets(page, cleanUsername);
        }
      }
      if (!isRehabReset) {
        if (knownFollowing === 0) {
          console.log("  ⚡ 3. 既存フォロー数が 0件 のため、フォロー一覧への移動をスキップして通信量を節約します");
        } else {
          await cleanOldFollowings(page, cleanUsername);
        }
      }
    }

    if (!(isPureJpNewborn || account.originType === 'pure_jp')) {
      console.log("  ✍️ 5. 初回の日常ツイートを人間タイピングで投稿します...");
    await robustGoto(page, "https://x.com/compose/post");
    let tb = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 9000 }).catch(() => null);
    if (!tb) {
      await robustGoto(page, "https://x.com/home");
      await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
        if (btn) btn.click();
      }).catch(() => {});
      tb = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 9000 }).catch(() => null);
    }
    if (tb) {
      await page.evaluate(el => el.focus(), tb).catch(() => {});
      await tb.click().catch(() => {});
      await new Promise(r => setTimeout(r, 500));
      await humanTyping(page, persona.tweet);
      await new Promise(r => setTimeout(r, 1200));
      await humanSleep(500, 1100);
      const clickedInitTweet = await humanClickSelector(page, '[data-testid="tweetButton"]:not([aria-disabled="true"]), [data-testid="tweetButtonInline"]:not([aria-disabled="true"])', 5000);
      if (!clickedInitTweet) {
        await page.keyboard.down('Control');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Control');
      }
      await new Promise(r => setTimeout(r, 3500));
      console.log(`  ✅ 初回投稿完了: "${persona.tweet}"`);
    }
    }

    const savedCookies = await extractKeepCookies(page);
    const ct0 = savedCookies.find(c => c.name === 'ct0')?.value || null;

    if (snifferState && snifferState.status !== 'ok') {
      const st = snifferState.status === 'robot' ? 'robot' : 'unavailable';
      await updateAccountState(docId, st, { savedCookies, errorReason: `${snifferState.status}(${snifferState.detail})` });
      return;
    }

    const isPureFinal = isPureNewborn;
    const finalOriginType = isPureEnOrigin ? 'pure_en' : (isPureFinal ? 'pure_jp' : 'imported');
    const firstWaitHours = isPureFinal ? (18.0 + Math.random() * 12.0) : (12.0 + Math.random() * 8.0);
    await updateAccountState(docId, 'farming', {
      userId: cleanUsername,
      errorReason: null,
      farmingCycles: 0,
      originType: finalOriginType,
      signupCountry: account.signupCountry || localeCfg.country,
      signupLocale: account.signupLocale || localeCfg.locale,
      country: account.country || localeCfg.country,
      language: account.language || localeCfg.locale.split('-')[0],
      searchIndexLevel: 'warming',
      farmingStage: isPureFinal ? 1 : 2,
      nextActionAt: new Date(Date.now() + firstWaitHours * 3600 * 1000),
      name: persona.name,
      bio: persona.bio,
      location: persona.location || (keepForeignLocale ? preservedForeignLocation : '日本'),
      attributes: persona.attributes,
      lastTweetText: isPureFinal ? '' : (persona.tweet || ''),
      recentTweets: (!isPureFinal && persona.tweet) ? [persona.tweet] : [],
      ...(ct0 ? { ct0 } : {}),
      savedCookies,
      initializedAt: new Date()
    });
    console.log(`🎉 @${cleanUsername} (${persona.name} / ${finalOriginType}) の初期設定が完了しました！（🌱 自動養殖中へ移行）`);
  } catch (error) {
    console.log(`🚨 一時例外 (@${cleanUsername || docId}): ${error.message}`);
    const isFrozen = /frozen|withheld|logged_out/i.test(error.message);
    const isRobot = /robot|326/i.test(error.message);
    const nextSt = isFrozen ? 'unavailable' : (isRobot ? 'robot' : 'standby');
    await updateAccountState(docId, nextSt, { errorReason: error.message.slice(0, 80) });
  } finally {
    if (trafficMeter && trafficMeter.finalizeAndLog) { try { trafficMeter.finalizeAndLog('@' + (cleanUsername || docId)); } catch (e) {} }
    if (browser) await browser.close().catch(() => {});
    try { slimProfileDir(userDir); } catch (e) {}
    try { if (fs.existsSync(iconPath)) fs.unlinkSync(iconPath); } catch (e) {}
    try { if (fs.existsSync(headerPath)) fs.unlinkSync(headerPath); } catch (e) {}
  }
}

const LOCK_FILE_PATH = '/tmp/x_init_worker.lock';

function acquireSingleInstanceLock() {
  try {
    if (fs.existsSync(LOCK_FILE_PATH)) {
      const oldPid = parseInt(fs.readFileSync(LOCK_FILE_PATH, 'utf8').trim(), 10);
      if (oldPid && oldPid !== process.pid) {
        try {
          process.kill(oldPid, 0);
          console.log(`ℹ️ 既に初期設定ワーカー (PID: ${oldPid}) が稼働中です。新しく追加されたアカウントは稼働中のワーカーが自動で引き継いで処理します。`);
          return false;
        } catch (e) {
          // プロセスが存在しない場合は古いロックを上書き
        }
      }
    }
    fs.writeFileSync(LOCK_FILE_PATH, String(process.pid), 'utf8');
    const cleanUp = () => {
      try {
        if (fs.existsSync(LOCK_FILE_PATH) && fs.readFileSync(LOCK_FILE_PATH, 'utf8').trim() === String(process.pid)) {
          fs.unlinkSync(LOCK_FILE_PATH);
        }
      } catch (e) {}
    };
    process.on('exit', cleanUp);
    process.on('SIGINT', () => { cleanUp(); process.exit(0); });
    process.on('SIGTERM', () => { cleanUp(); process.exit(0); });
    return true;
  } catch (e) {
    return true;
  }
}

async function fetchStandbyDocsFromDb(attemptCounts, inProgressIds) {
  const lifecycleQueue = ACCOUNT_STATUS_GROUPS.initializationQueue.map(normalizeAccountStatus);
  const docs = await getAccountsByLifecycleStatuses(lifecycleQueue, { limit: 60 });
  const list = [];
  for (const doc of docs) {
    if (inProgressIds.has(doc.id)) continue;
    const d = doc.data() || {};
    if (lifecycleQueue.includes(getAccountLifecycleStatus(d))) {
      const nowMs = Date.now();
      const readyMs = d.initReadyAt && d.initReadyAt.toDate ? d.initReadyAt.toDate().getTime() : 0;
      const createdMs = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().getTime() : 0;
      // 純国産の新規作成アカウントは作成後最低15分間寝かせてから初期設定を開始する
      if (d.isNewborn && ((readyMs > nowMs) || (!readyMs && createdMs > 0 && (nowMs - createdMs) < 15 * 60 * 1000))) {
        continue;
      }
      const tries = attemptCounts.get(doc.id) || 0;
      if (tries < 2) {
        list.push(doc);
      }
    }
  }
  // プロキシ帯域保護のため、ファクトリー新規作成アカウント(pure_jp / pure_en / isNewborn)を最優先で先頭に並べる
  list.sort((a, b) => {
    const da = a.data() || {};
    const db = b.data() || {};
    const aPure = (da.originType === 'pure_jp' || da.originType === 'pure_en' || da.isNewborn) ? 1 : 0;
    const bPure = (db.originType === 'pure_jp' || db.originType === 'pure_en' || db.isNewborn) ? 1 : 0;
    return bPure - aPure;
  });
  return list;
}

async function runAll() {
  if (!acquireSingleInstanceLock()) {
    process.exit(0);
  }

  const CONCURRENCY = 1;
  const attemptCounts = new Map();
  const inProgressIds = new Set();
  const queue = [];

  async function refillQueue(isInitial = false) {
    const freshDocs = await fetchStandbyDocsFromDb(attemptCounts, inProgressIds);
    const queuedIds = new Set(queue.map(d => d.id));
    let added = 0;
    for (const doc of freshDocs) {
      if (!queuedIds.has(doc.id)) {
        queue.push(doc);
        added++;
      }
    }
    if (!isInitial && added > 0) {
      console.log(`\n📥 [動的キュー補充] 稼働中に新しく追加された ${added}件 の初期設定待ちアカウントを検知し、処理キューに追加しました！(残り待機: ${queue.length}件)\n`);
    }
    return added;
  }

  await refillQueue(true);

  if (queue.length === 0) {
    console.log('✅ 現在、初期設定待ち(standby)のアカウントはありません。');
    process.exit(0);
  }

  console.log(`🚀 アカウント蘇生ファクトリーを起動します (並列枠数: ${CONCURRENCY}枠 / 動的キュー＆二重起動防止ロック仕様)...`);
  console.log(`📋 初回対象アカウント数: ${queue.length}件\n`);

  async function worker(workerId) {
    while (true) {
      if (queue.length === 0) {
        await refillQueue(false);
      }
      if (queue.length === 0) {
        // 終了直前に3秒待ってもう一度だけ新規追加がないか最終確認
        await new Promise(r => setTimeout(r, 3000));
        await refillQueue(false);
        if (queue.length === 0) break;
      }

      const doc = queue.shift();
      if (!doc) continue;

      const d = doc.data() || {};
      const label = d.userId || doc.id.slice(0, 8);
      inProgressIds.add(doc.id);
      attemptCounts.set(doc.id, (attemptCounts.get(doc.id) || 0) + 1);

      console.log(`\n[Worker #${workerId}] 処理開始: @${label}`);
      try {
        const lockRes = await withAccountLock(doc.id, `init_${process.pid}_w${workerId}`, 20 * 60 * 1000, async () => {
          await processAccount(doc.id, doc.data());
        });
        if (!lockRes.acquired) {
          console.log(`🔒 [Worker #${workerId}] @${label} は現在他プロセスが処理中のためスキップします`);
        }
      } catch (err) {
        console.error(`🚨 [Worker #${workerId}] 未捕捉エラー (@${label}):`, err.message);
      } finally {
        inProgressIds.delete(doc.id);
      }

      // 1件終わるごとにDBを再チェックし、稼働中に追加されたアカウントがあれば即座にキューへ補充
      await refillQueue(false);
    }
  }

  const workers = [];
  for (let i = 1; i <= CONCURRENCY; i++) {
    workers.push(worker(i));
  }
  await Promise.all(workers);

  console.log('🎉 全てのアカウントの初期設定処理が完了しました！');
  process.exit(0);
}

if (require.main === module) runAll();
module.exports = { processAccount, runAll };
