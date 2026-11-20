const crypto = require('crypto');
const { waitForFirstmailXCode, fetchLatestCodeViaImapOnce } = require('./email_firstmail');

function base32ToBuffer(base32Str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(base32Str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val >= 0) bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotpCode(secretBase32, timestampMs = Date.now()) {
  const key = base32ToBuffer(secretBase32);
  if (key.length === 0) return '';
  const counter = Math.floor(timestampMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;
  return String(code).padStart(6, '0');
}

async function tryClickRetryButton(page) {
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="button"], button, [role="button"]'));
    for (const b of btns) {
      const t = (b.innerText || '').trim();
      if (/やりなおす|やり直す|再試行|再読み込み|Retry|Try again|Reload/i.test(t)) {
        b.click();
        return t;
      }
    }
    return null;
  }).catch(() => null);

  if (clicked) {
    console.log(`    🔄 [2FA-自動リトライ] 「${clicked}」ボタンをクリックしました。待機します...`);
    await new Promise(r => setTimeout(r, 3800));
    return true;
  }
  return false;
}

async function tryUnlock2FaPassword(page, password) {
  const pwInput = await page.$('input[type="password"], input[name="password"], input[name="current_password"], input[autocomplete="current-password"]').catch(() => null);
  if (!pwInput || !password) return false;

  const bodyTxt = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
        if (/Wrong password|パスワードが正しくありません|間違っています/i.test(bodyTxt)) {
          console.log('    🛑 [2FA-パスワード不一致検知] Wrong password が表示されたため、ロック防止のため連打を即時中断します');
          return false;
        }
        console.log('    🔑 [2FA-パスワード確認] パスワード入力欄を検知しました。パスワードを入力して突破します...');
  await pwInput.click().catch(() => {});
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate((el) => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, pwInput).catch(() => {});
  await pwInput.type(String(password).trim(), { delay: 55 });
  await new Promise(r => setTimeout(r, 900));

  const clickedBtn = await page.evaluate(() => {
    const words = ['確認', '次へ', 'confirm', 'next', 'verify', 'ログイン', 'log in', 'iniciar', 'continuar', '送信'];
    const btns = Array.from(document.querySelectorAll('[data-testid="ocfEnterPasswordNextLink"], [data-testid="LoginForm_Login_Button"], [role="dialog"] button, [role="dialog"] [role="button"], button, [role="button"]'));
    for (const b of btns) {
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
      const t = (b.innerText || '').trim().toLowerCase();
      const tid = (b.getAttribute('data-testid') || '').toLowerCase();
      if (tid.includes('next') || tid.includes('confirm') || tid.includes('login') || words.some(w => t === w || t.includes(w))) {
        b.click();
        return t || tid;
      }
    }
    return null;
  }).catch(() => null);

  if (!clickedBtn) {
    await page.keyboard.press('Enter');
  }
  await new Promise(r => setTimeout(r, 4000));
  console.log('    🔓 [2FA-パスワード確認] パスワード送信完了');
  return true;
}

async function waitForEmailCodeEntry(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => {
      const root = document.querySelector('[role="dialog"]') || document.body;
      const txt = root ? (root.innerText || '') : '';
      const input = document.querySelector('input[name="verfication_code"], input[name="verification_code"], input[data-testid="ocfEnterTextTextInput"], [role="dialog"] input[type="text"]');
      return /コードを送信しました|認証コードを入力|We sent you a code|Enter the verification code/i.test(txt) && !!input;
    }).catch(() => false);
    if (ready) return true;
    await new Promise(r => setTimeout(r, 1500));
  }
  return false;
}

async function clickEmailResend(page) {
  await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') || document.body;
    const els = Array.from(dialog.querySelectorAll('button, [role="button"], a, span, div'));
    for (const el of els) {
      const t = (el.innerText || '').trim();
      if (/^(コードを送信|Send code|メールを送信|Send email|Didn't receive code\??|Didn’t receive code\??|コードが届かない場合|コードを再送|メールを再送信)$/i.test(t)) {
        el.click();
      }
    }
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[role="menuitem"], [role="dialog"] button, [role="dialog"] span, span, button, a'));
    for (const el of els) {
      const t = (el.innerText || '').trim();
      if (/^(Resend email|Send email|メールを再送信|コードを再送信|再送信|Send code|コードを送信)$/i.test(t)) {
        el.click();
        break;
      }
    }
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 4000));
}

async function tryPassEmailVerificationIn2FA(page, email, emailPassword) {
  const screenInfo = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const txt = dialog ? (dialog.innerText || '') : (document.body ? document.body.innerText : '');
    const hasSendBtn = /ご本人確認が必要です|verify your identity|コードを送信|Send code|we need to send you a verification code/i.test(txt);
    const hasCodeInput = /コードを送信しました|認証コードを入力|We sent you a code|Enter the verification code/i.test(txt) &&
      !!document.querySelector('input[name="verfication_code"], input[name="verification_code"], input[data-testid="ocfEnterTextTextInput"], [role="dialog"] input[type="text"]');
    return { hasSendBtn, hasCodeInput };
  }).catch(() => ({ hasSendBtn: false, hasCodeInput: false }));

  if (!screenInfo.hasSendBtn && !screenInfo.hasCodeInput) return false;

  let prevCode = '';
  if (email) {
    for (let pTry = 0; pTry < 2; pTry++) {
      try {
        const prevObj = await fetchLatestCodeViaImapOnce(email, emailPassword || '');
        if (typeof prevObj === 'string' && /^\d{6}$/.test(prevObj)) { prevCode = prevObj; break; }
        else if (prevObj && prevObj.code) { prevCode = String(prevObj.code); break; }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  if (screenInfo.hasSendBtn) {
    console.log('    📧 [2FA-メール本人確認] 「ご本人確認が必要です」画面を検知しました！「コードを送信」をクリックします...');
    const sendBtnCoord = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]') || document.body;
      const allEls = Array.from(dialog.querySelectorAll('button, [role="button"], a, span, div'));
      const matches = allEls.filter(el => {
        const t = (el.innerText || el.textContent || '').trim();
        if (!/^(コードを送信|Send code|メールを送信|Send email)$/i.test(t)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 20 && r.height > 12;
      });
      if (matches.length > 0) {
        const target = matches[matches.length - 1];
        const r = target.getBoundingClientRect();
        target.click();
        return { found: true, text: (target.innerText || '').trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }
      return { found: false };
    }).catch(() => ({ found: false }));

    if (sendBtnCoord.found && sendBtnCoord.x && sendBtnCoord.y) {
      await page.mouse.move(sendBtnCoord.x, sendBtnCoord.y, { steps: 5 }).catch(() => {});
      await new Promise(r => setTimeout(r, 400));
      await page.mouse.click(sendBtnCoord.x, sendBtnCoord.y).catch(() => {});
      console.log(`    👉 [2FA-メール本人確認] 「${sendBtnCoord.text}」 (X:${sendBtnCoord.x}, Y:${sendBtnCoord.y}) をクリックしました`);
    }
    const sent = await waitForEmailCodeEntry(page, 25000);
    if (!sent) {
      console.log('    🔄 [2FA-メール本人確認] 送信後の入力欄が遅いため、コード送信をもう一度押します');
      await clickEmailResend(page);
      await waitForEmailCodeEntry(page, 20000);
    }
  }

  if (!email) {
    console.log('    ⚠️ [2FA-メール本人確認] アカウントに email が保存されていないためコードを取得できません');
    return false;
  }

  console.log(`    ⏳ [2FA-IMAP待機] ${email} 宛ての6桁確認コードを待機中 (既存除外: ${prevCode || 'なし'} / 最大75秒)...`);
  let emailCode = await waitForFirstmailXCode(email, emailPassword || '', 75, prevCode).catch(e => {
    console.log('    ⚠️ [2FA-IMAP受信失敗]: ' + e.message);
    return null;
  });

  if (!emailCode) {
    console.log('    🔄 [2FA-メール再要求] 75秒で未着のため、コードを再送信してさらに75秒待ちます...');
    await clickEmailResend(page);
    await waitForEmailCodeEntry(page, 20000);
    console.log(`    ⏳ [2FA-IMAP再待機] 再送信後の6桁確認コードを待機中 (既存除外: ${prevCode || 'なし'} / 最大75秒)...`);
    emailCode = await waitForFirstmailXCode(email, emailPassword || '', 75, prevCode).catch(() => null);
  }

  if (!emailCode) return false;

  const codeSel = 'input[name="verfication_code"], input[name="verification_code"], input[data-testid="ocfEnterTextTextInput"], [role="dialog"] input[type="text"], [role="dialog"] input:not([type="hidden"]):not([type="password"]):not([type="checkbox"])';
  const codeInp = await page.waitForSelector(codeSel, { timeout: 20000 }).catch(() => null);
  if (codeInp) {
    await codeInp.click().catch(() => {});
    await new Promise(r => setTimeout(r, 250));
    await page.evaluate(el => {
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, codeInp).catch(() => {});
    await codeInp.type(String(emailCode).trim(), { delay: 65 });
  } else {
    await page.keyboard.type(String(emailCode).trim(), { delay: 65 });
  }
  console.log(`    🔢 [2FA-メール本人確認] 受信した6桁コード [${emailCode}] を入力しました`);
  await new Promise(r => setTimeout(r, 1000));

  const clickedVerify = await page.evaluate(() => {
    const words = ['次へ', '確認', '認証', '確定', '送信', 'next', 'verify', 'confirm', 'submit', 'continue'];
    const btns = Array.from(document.querySelectorAll('[data-testid="ocfEnterTextNextButton"], [role="dialog"] button, [role="dialog"] [role="button"], button, [role="button"]'));
    for (const b of btns) {
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
      const t = (b.innerText || '').trim().toLowerCase();
      const tid = (b.getAttribute('data-testid') || '').toLowerCase();
      if (tid.includes('next') || tid.includes('confirm') || words.some(w => t === w || t.includes(w))) {
        b.click();
        return t || tid;
      }
    }
    return null;
  }).catch(() => null);

  if (!clickedVerify) {
    await page.keyboard.press('Enter');
  }
  await new Promise(r => setTimeout(r, 4500));
  console.log('    ✅ [2FA-メール本人確認] メール確認コードを突破しました！');
  return true;
}

async function open2FaModalViaOfficialMenuRoute(page, password) {
  console.log('    🧭 [2FA正規ルート] 設定 -> セキュリティとアカウントアクセス -> セキュリティ -> 2要素認証 の順にメニューを辿ります...');

  await page.goto('https://x.com/settings/account', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 4000));

  await page.waitForSelector('a[href="/settings/security_and_account_access"], a[href*="security_and_account_access"]', { timeout: 20000 }).catch(() => null);
  const clicked1 = await page.evaluate(() => {
    const a = document.querySelector('a[href="/settings/security_and_account_access"], a[href*="security_and_account_access"]');
    if (a) { a.click(); return true; }
    return false;
  }).catch(() => false);
  if (!clicked1) {
    await page.goto('https://x.com/settings/security_and_account_access', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }
  await new Promise(r => setTimeout(r, 2500));
  await tryUnlock2FaPassword(page, password);

  await page.waitForSelector('a[href="/settings/security"]', { timeout: 20000 }).catch(() => null);
  const clicked2 = await page.evaluate(() => {
    const a = document.querySelector('a[href="/settings/security"]');
    if (a) { a.click(); return true; }
    return false;
  }).catch(() => false);
  if (!clicked2) {
    await page.goto('https://x.com/settings/security', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }
  await new Promise(r => setTimeout(r, 2500));
  await tryUnlock2FaPassword(page, password);

  await page.waitForSelector('a[href="/settings/account/login_verification"], a[href*="login_verification"]', { timeout: 20000 }).catch(() => null);
  const clicked3 = await page.evaluate(() => {
    const a = document.querySelector('a[href="/settings/account/login_verification"], a[href*="login_verification"]');
    if (a) { a.click(); return true; }
    return false;
  }).catch(() => false);
  if (!clicked3) {
    await page.goto('https://x.com/settings/account/login_verification', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }
  await new Promise(r => setTimeout(r, 3200));
  await tryUnlock2FaPassword(page, password);

  await page.waitForSelector('input[type="checkbox"]', { timeout: 20000 }).catch(() => null);
  let appBoxInfo = await page.evaluate(() => {
    const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    if (cbs.length === 0) return { status: 'NOT_FOUND', count: 0 };

    const targetCb = cbs.length >= 2 ? cbs[1] : cbs[0];
    if (targetCb.checked) return { status: 'ALREADY_ON' };

    const r = targetCb.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return {
        status: 'FOUND_COORD',
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        count: cbs.length
      };
    }
    const lbl = targetCb.closest('label') || targetCb.parentElement;
    if (lbl) {
      const lr = lbl.getBoundingClientRect();
      if (lr.width > 0 && lr.height > 0) {
        return {
          status: 'FOUND_COORD',
          x: Math.round(lr.right - 20),
          y: Math.round(lr.top + lr.height / 2),
          count: cbs.length
        };
      }
    }
    targetCb.click();
    return { status: 'CLICKED_DOM', count: cbs.length };
  }).catch(() => ({ status: 'ERROR' }));

  if (appBoxInfo.status === 'ALREADY_ON') {
    return 'ALREADY_ON';
  }
  if (appBoxInfo.status === 'NOT_FOUND' || appBoxInfo.status === 'ERROR') {
    console.log('    🔄 [2FA正規ルート] チェックボックスが遅いプロキシで未表示のため、2要素認証画面を開き直します');
    await page.goto('https://x.com/settings/account/login_verification', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 5000));
    await tryUnlock2FaPassword(page, password);
    await page.waitForSelector('input[type="checkbox"]', { timeout: 20000 }).catch(() => null);
    appBoxInfo = await page.evaluate(() => {
      const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      if (cbs.length === 0) return { status: 'NOT_FOUND', count: 0 };
      const targetCb = cbs.length >= 2 ? cbs[1] : cbs[0];
      if (targetCb.checked) return { status: 'ALREADY_ON' };
      const r = targetCb.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { status: 'FOUND_COORD', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), count: cbs.length };
      }
      targetCb.click();
      return { status: 'CLICKED_DOM', count: cbs.length };
    }).catch(() => ({ status: 'ERROR' }));
  }
  if (appBoxInfo.status === 'NOT_FOUND' || appBoxInfo.status === 'ERROR') {
    console.log('    ⏭️ [2FA設定画面制限] 開き直してもチェックボックスが出ないため、この回の2FAは未完了です。INITが後でやり直します');
    return 'RATE_LIMITED';
  }
  if (appBoxInfo.status === 'FOUND_COORD' && appBoxInfo.x && appBoxInfo.y) {
    console.log(`    🖱️ [2FA正規ルート] 2番目の「認証アプリ」チェックボックス (X:${appBoxInfo.x}, Y:${appBoxInfo.y} / 全${appBoxInfo.count}個中2番目) を1回クリックします...`);
    await page.mouse.move(appBoxInfo.x, appBoxInfo.y, { steps: 6 }).catch(() => {});
    await new Promise(r => setTimeout(r, 200));
    await page.mouse.click(appBoxInfo.x, appBoxInfo.y).catch(() => {});
  } else {
    console.log(`    🖱️ [2FA正規ルート] 「認証アプリ」チェックボックスをクリックしました (status:${appBoxInfo.status})`);
  }

  await new Promise(r => setTimeout(r, 4200));
  const modalOpened = await page.evaluate(() => {
    return !!(document.querySelector('[role="dialog"]') || document.querySelector('input[type="password"]'));
  }).catch(() => false);
  if (!modalOpened) {
    console.log('    🔄 [2FA正規ルート] モーダルが未展開のため、認証アプリチェックボックスを再クリックします...');
    await page.evaluate(() => {
      const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const targetCb = cbs.length >= 2 ? cbs[1] : cbs[0];
      if (targetCb && !targetCb.checked) targetCb.click();
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 3800));
  }
  return 'OPENED';
}

async function enrollTwoFactorAuthOnPage(page, password, email = '', emailPassword = '') {
  if (!password) return { ok: false, reason: 'no_password' };
  console.log('  🔐 [2FA自動設定] 二要素認証(TOTP)の登録フローを正規メニューから開始します...');

  try {
    const openSt = await open2FaModalViaOfficialMenuRoute(page, password);
    if (openSt === 'ALREADY_ON') {
      console.log('    ℹ️ [2FA自動設定] このアカウントは既に認証アプリ(2FA)が有効になっています');
      return { ok: false, reason: 'already_enabled' };
    }
    if (openSt === 'RATE_LIMITED') {
      return { ok: false, reason: 'rate_limited_skip' };
    }

    let secretKey = null;
    let retryCount = 0;
    let emailVerifiedOnce = false;

    for (let round = 1; round <= 10; round++) {
      const isBlocked = await page.evaluate(() => {
        const txt = document.body ? (document.body.innerText || '') : '';
        return /Sorry, you have been blocked|unable to access x\.com/i.test(txt);
      }).catch(() => false);
      if (isBlocked) {
        console.log('    ⚠️ [2FA一時ブロック検知] Cloudflare制限画面のため、この回の2FAは未完了です。INITが後でやり直します');
        return { ok: false, reason: 'cloudflare_blocked' };
      }
      const hadRetry = await tryClickRetryButton(page);
      if (hadRetry) {
        retryCount++;
        if (retryCount >= 2) {
          console.log('    ⏭️ [2FAレート制限スキップ] 「Try again」が続いているため、この回の2FAは未完了です。冷却後にINITがやり直します');
          return { ok: false, reason: 'try_again_rate_limited' };
        }
        continue;
      }

      if (await tryUnlock2FaPassword(page, password)) continue;

      if (!emailVerifiedOnce) {
        const dialogTxt = await page.evaluate(() => {
          const d = document.querySelector('[role="dialog"]') || document.body;
          return d ? (d.innerText || '') : '';
        }).catch(() => '');
        const isEmailScreen = /ご本人確認が必要です|verify your identity|コードを送信|Send code|we need to send you a verification code|We sent you a code|Enter the verification code|認証コードを入力/i.test(dialogTxt);
        if (isEmailScreen) {
          const passed = await tryPassEmailVerificationIn2FA(page, email, emailPassword);
          if (passed) {
            emailVerifiedOnce = true;
            continue;
          }
          console.log('    ⏭️ [2FAメール不着] プロキシ待ちを含めても確認コードが届かなかったため、この回の2FAは未完了です。INITが後でやり直します');
          return { ok: false, reason: 'email_code_timeout_skip' };
        }
      }

      const stepState = await page.evaluate(() => {
        const container = document.querySelector('[role="dialog"]') || document.body;
        const bodyText = container ? (container.innerText || '') : '';
        const lines = bodyText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const ignoreWords = new Set(['HTTPS', 'TWITTER', 'ACCOUNT', 'AUTHENTICATION', 'VERIFICATION', 'SECURITY', 'SETTINGS', 'PASSWORD']);

        for (const line of lines) {
          const clean = line.replace(/\s+/g, '');
          if (/^[A-Z2-7]{12,32}$/.test(clean) && !ignoreWords.has(clean)) {
            return { type: 'seed_found', seed: clean };
          }
        }
        const matches = bodyText.match(/\b([A-Z2-7]{16,32})\b/g) || [];
        for (const m of matches) {
          if (!ignoreWords.has(m)) return { type: 'seed_found', seed: m };
        }

        const els = Array.from(container.querySelectorAll('span, a, button, div[role="button"]'));
        for (const el of els) {
          const t = (el.innerText || '').trim();
          if (
            t.includes('QRコードをスキャンできない') ||
            t.includes('スキャンできませんか') ||
            t.includes('コードを表示') ||
            /can['’]t scan|unable to scan|enter code manually|no puedes escanear/i.test(t)
          ) {
            el.click();
            return { type: 'clicked_cant_scan', text: t };
          }
        }

        const startKeywords = ['はじめる', '開始', 'get started', 'start', 'comenzar', 'empezar'];
        const btns = Array.from(container.querySelectorAll('[data-testid*="StartButton"], button, [role="button"]'));
        for (const b of btns) {
          if (b.disabled) continue;
          const t = (b.innerText || '').trim().toLowerCase();
          if (startKeywords.some(k => t === k || t.includes(k))) {
            b.click();
            return { type: 'clicked_start', text: t };
          }
        }

        return { type: 'waiting', snippet: bodyText.replace(/\s+/g, ' ').slice(0, 140) };
      }).catch(() => ({ type: 'error' }));

      if (stepState.type === 'seed_found' && stepState.seed) {
        secretKey = stepState.seed;
        break;
      } else if (stepState.type === 'clicked_cant_scan') {
        console.log('    👉 [2FA-Step3] 「' + stepState.text + '」をクリックしてテキストシードを展開しました');
        await new Promise(r => setTimeout(r, 2500));
      } else if (stepState.type === 'clicked_start') {
        console.log('    👉 [2FA-Step2] イントロ画面の「' + stepState.text + '」をクリックしました');
        await new Promise(r => setTimeout(r, 2800));
      } else {
        if (round === 1 && stepState.snippet) {
          console.log('    👀 [2FA画面状態]: ' + stepState.snippet + '...');
        }
        await new Promise(r => setTimeout(r, 2200));
      }
    }

    if (!secretKey) {
      const dump = await page.evaluate(() => (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 200)).catch(() => '');
      console.log('  ⚠️ [2FA自動設定] シードキーが画面から検出できませんでした。現在の画面テキスト: ' + dump);
      return { ok: false, reason: 'secret_not_found' };
    }

    console.log('    🔑 [2FA-Step4] シークレットキー取得成功: ' + secretKey.slice(0, 6) + '...');

    const clickedNextToInput = await page.evaluate(() => {
      const words = ['次へ', 'next', 'siguiente', 'continue', '続行'];
      const btns = Array.from(document.querySelectorAll('[data-testid*="Next"], [role="dialog"] button, [role="dialog"] [role="button"], button, [role="button"]'));
      for (const b of btns) {
        const t = (b.innerText || '').trim().toLowerCase();
        if (words.some(k => t === k || t.includes(k))) {
          b.click();
          return t;
        }
      }
      return null;
    }).catch(() => null);

    console.log('    👉 [2FA-Step4] シード確認後の「' + (clickedNextToInput || '次へ') + '」をクリックしました');
    await new Promise(r => setTimeout(r, 2500));

    const remainSec = 30 - (Math.floor(Date.now() / 1000) % 30);
    if (remainSec < 5) {
      console.log('    ⏳ [2FA-Step5] TOTPコード更新境界まで残り' + remainSec + '秒のため、新しいコードに切り替わるまで待機します...');
      await new Promise(r => setTimeout(r, (remainSec + 1) * 1000));
    }

    const code6 = generateTotpCode(secretKey);
    const codeInputSelector = 'input[name="verfication_code"], input[name="verification_code"], input[data-testid="ocfEnterTextTextInput"], input[inputmode="numeric"], [role="dialog"] input[type="text"], input[type="text"]';
    const codeInput = await page.waitForSelector(codeInputSelector, { timeout: 20000 }).catch(() => null);

    if (!codeInput) {
      console.log('  ⚠️ [2FA自動設定] 6桁コードの入力欄が見つかりませんでした');
      return { ok: false, reason: 'code_input_not_found', twoFactorKey: secretKey };
    }

    await codeInput.click().catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    await codeInput.type(code6, { delay: 65 });
    console.log('    🔢 [2FA-Step5] 6桁ワンタイムコード (' + code6 + ') を入力しました');
    await new Promise(r => setTimeout(r, 1000));

    const clickedVerify = await page.evaluate(() => {
      const words = ['確認', '確定', 'verify', 'confirm', '次へ', 'next', 'submit', 'confirmar'];
      const btns = Array.from(document.querySelectorAll('[data-testid="ocfEnterTextNextButton"], [role="dialog"] button, [role="dialog"] [role="button"], button, [role="button"]'));
      for (const b of btns) {
        if (b.disabled) continue;
        const t = (b.innerText || '').trim().toLowerCase();
        const tid = (b.getAttribute('data-testid') || '').toLowerCase();
        if (tid.includes('next') || tid.includes('confirm') || words.some(k => t === k || t.includes(k))) {
          b.click();
          return t || tid;
        }
      }
      return null;
    }).catch(() => null);

    if (!clickedVerify) {
      await page.keyboard.press('Enter');
    }
    await new Promise(r => setTimeout(r, 4000));

    const backupCode = await page.evaluate(() => {
      const container = document.querySelector('[role="dialog"]') || document.body;
      const text = container ? container.innerText : '';
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const l of lines) {
        if (/^[a-z0-9]{10,16}$/i.test(l) && !/^(完了|了解|done|gotit)$/i.test(l)) {
          return l;
        }
      }
      const m = text.match(/\b([a-z0-9]{12})\b/i);
      return m ? m[1] : '';
    }).catch(() => '');

    await page.evaluate(() => {
      const words = ['完了', '了解', 'done', 'got it', 'finish', '閉じる', 'close', 'finalizar'];
      const btns = Array.from(document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="button"], button, [role="button"]'));
      for (const b of btns) {
        const t = (b.innerText || '').trim().toLowerCase();
        if (words.some(k => t === k || t.includes(k))) {
          b.click();
          return true;
        }
      }
      return false;
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    console.log('  ✅ [2FA自動設定完了] 2FA有効化＆シード保存完了！ (Key: ' + secretKey.slice(0, 6) + '... / BackupCode: ' + (backupCode || 'なし') + ')');
    return { ok: true, twoFactorKey: secretKey, backupCode: backupCode || '' };
  } catch (e) {
    console.log('  ⚠️ [2FA自動設定例外]: ' + e.message);
    return { ok: false, reason: e.message };
  }
}

module.exports = { generateTotpCode, enrollTwoFactorAuthOnPage };
