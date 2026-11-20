const fs = require('fs');
const path = require('path');
const http = require('http');
const tls = require('tls');

const _deadProxyUntilMap = new Map();
const _verifiedProxyCache = new Map();

function proxyKey(p) {
  if (!p || !p.host) return 'none';
  return `${p.host}:${p.port}:${p.user || ''}`;
}

function markProxyUnhealthy(proxy, cooldownMs = 15 * 60 * 1000) {
  const k = proxyKey(proxy);
  if (k !== 'none') {
    _deadProxyUntilMap.set(k, Date.now() + cooldownMs);
    for (const [tok, cached] of _verifiedProxyCache.entries()) {
      if (proxyKey(cached.proxy) === k) _verifiedProxyCache.delete(tok);
    }
  }
}

function parseRawProxyEntry(rawStr) {
  const clean = String(rawStr || '').trim().replace(/^https?:\/\//i, '');
  if (!clean) return null;
  const parts = clean.includes(',') ? clean.split(',') : clean.split(':');
  if (parts.length >= 4) {
    return {
      host: parts[0].trim(),
      port: parts[1].trim(),
      user: parts[2].trim(),
      pass: parts.slice(3).join(':').trim()
    };
  }
  if (parts.length === 2) {
    return { host: parts[0].trim(), port: parts[1].trim(), user: '', pass: '' };
  }
  return null;
}

// TCP CONNECT だけでなく x.com との TLS ハンドシェイク + HTTP 応答バイト到達まで検査し、ストール中のプロキシを確実に弾く
function probeProxyHttpsToX(proxy, timeoutMs = 6500) {
  if (!proxy || !proxy.host || !proxy.port) return Promise.resolve({ ok: false, reason: 'empty_proxy' });
  const startMs = Date.now();

  return new Promise((resolve) => {
    let done = false;
    let rawSocket = null;
    let tlsSocket = null;

    const finish = (ok, reason) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (tlsSocket) tlsSocket.destroy(); } catch (e) {}
      try { if (rawSocket) rawSocket.destroy(); } catch (e) {}
      resolve({ ok, reason, latencyMs: Date.now() - startMs });
    };

    const timer = setTimeout(() => finish(false, 'tls_or_http_timeout'), timeoutMs);

    const authHeader = (proxy.user && proxy.pass)
      ? 'Basic ' + Buffer.from(`${proxy.user}:${proxy.pass}`).toString('base64')
      : '';

    const req = http.request({
      host: proxy.host,
      port: Number(proxy.port),
      method: 'CONNECT',
      path: 'x.com:443',
      headers: authHeader ? { 'Proxy-Authorization': authHeader } : {},
      timeout: timeoutMs
    });

    req.on('connect', (res, socket) => {
      rawSocket = socket;
      if (res.statusCode !== 200) {
        return finish(false, `connect_status_${res.statusCode}`);
      }
      try {
        tlsSocket = tls.connect({
          socket,
          servername: 'x.com',
          rejectUnauthorized: false
        }, () => {
          if (done) return;
          tlsSocket.write('HEAD /robots.txt HTTP/1.1\r\nHost: x.com\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n');
        });
        tlsSocket.on('data', (chunk) => {
          const head = chunk.toString('utf8', 0, 24);
          if (head.startsWith('HTTP/')) {
            finish(true, 'ok');
          } else {
            finish(false, 'invalid_http_head');
          }
        });
        tlsSocket.on('error', (err) => finish(false, err.code || err.message || 'tls_error'));
      } catch (e) {
        finish(false, e.message || 'tls_setup_error');
      }
    });

    req.on('error', (err) => finish(false, err.code || err.message || 'connect_error'));
    req.on('timeout', () => {
      try { req.destroy(); } catch (e) {}
      finish(false, 'connect_timeout');
    });
    req.end();
  });
}

async function resolveHealthyProxy({ rawProxyStr, userProxies = [], token = '', isOwner = false, getResidentialProxy = null, account = null, logFn = null }) {
  const now = Date.now();
  const tokKey = String(token || 'default').slice(0, 16);
  const cached = _verifiedProxyCache.get(tokKey);
  if (cached && now < cached.expiresAt) {
    const deadUntil = _deadProxyUntilMap.get(proxyKey(cached.proxy)) || 0;
    if (now >= deadUntil) return cached.proxy;
  }

  const candidates = [];
  const pushUnique = (p, label) => {
    if (!p || !p.host || !p.port) return;
    const k = proxyKey(p);
    if (candidates.some(c => proxyKey(c.proxy) === k)) return;
    candidates.push({ proxy: p, label });
  };

  if (rawProxyStr && !String(rawProxyStr).includes('geo.iproyal.com')) {
    pushUnique(parseRawProxyEntry(rawProxyStr), 'account_isp');
  }

  if (Array.isArray(userProxies) && userProxies.length > 0) {
    const validList = userProxies.map(s => String(s || '').trim()).filter(s => s && !s.includes('geo.iproyal.com'));
    if (validList.length > 0) {
      let hash = 0;
      const s = String(token || 'default');
      for (let i = 0; i < s.length; i++) { hash = (hash << 5) - hash + s.charCodeAt(i); hash |= 0; }
      const startIdx = Math.abs(hash) % validList.length;
      for (let i = 0; i < validList.length; i++) {
        pushUnique(parseRawProxyEntry(validList[(startIdx + i) % validList.length]), 'tenant_isp');
      }
    }
  }

  if (isOwner) {
    // オーナーアカウントは追加済みの固有スティッキーResidential IPとCSV内ISPの両方を候補に入れ、生きている方を自動選択
    try {
      const csvCandidates = [
        path.join(__dirname, '../iproyal-proxies.csv'),
        path.join(__dirname, 'iproyal-proxies.csv')
      ];
      for (const csvPath of csvCandidates) {
        if (fs.existsSync(csvPath)) {
          const lines = fs.readFileSync(csvPath, 'utf8')
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l && !l.toLowerCase().startsWith('host'));
          if (lines.length > 0) {
            let hash = 0;
            const s = String(token || 'default');
            for (let i = 0; i < s.length; i++) { hash = (hash << 5) - hash + s.charCodeAt(i); hash |= 0; }
            const startIdx = Math.abs(hash) % lines.length;
            for (let i = 0; i < Math.min(lines.length, 4); i++) {
              pushUnique(parseRawProxyEntry(lines[(startIdx + i) % lines.length]), 'owner_csv_isp');
            }
          }
          break;
        }
      }
    } catch (e) {}

    if (account) {
      try {
        const { getResidentialProxyForAccount } = require('./iproyal');
        pushUnique(getResidentialProxyForAccount(token, account), 'owner_sticky_residential');
      } catch (e) {
        if (typeof getResidentialProxy === 'function') pushUnique(getResidentialProxy(token), 'owner_sticky_residential');
      }
    } else if (typeof getResidentialProxy === 'function') {
      pushUnique(getResidentialProxy(token), 'owner_sticky_residential');
    }
  }

  for (const cand of candidates) {
    const k = proxyKey(cand.proxy);
    const deadUntil = _deadProxyUntilMap.get(k) || 0;
    if (now < deadUntil) continue;

    const probe = await probeProxyHttpsToX(cand.proxy, 6500);
    if (probe.ok) {
      _verifiedProxyCache.set(tokKey, { proxy: cand.proxy, expiresAt: now + 4 * 60 * 1000 });
      return cand.proxy;
    }

    _deadProxyUntilMap.set(k, now + 15 * 60 * 1000);
    if (logFn) {
      logFn(`⚠️ Proxy ${cand.proxy.host}:${cand.proxy.port} failed HTTPS check (${probe.reason} in ${probe.latencyMs}ms) -> switching to backup proxy...`);
    }
  }

  // 全候補がクールダウン中の場合は最後の手段として sticky residential (isOwner) または先頭候補を返す
  if (isOwner && account) {
    try {
      const { getResidentialProxyForAccount } = require('./iproyal');
      const resP = getResidentialProxyForAccount(token, account);
      if (resP && resP.host) return resP;
    } catch (e) {}
  }
  if (isOwner && typeof getResidentialProxy === 'function') {
    const resP = getResidentialProxy(token);
    if (resP && resP.host) return resP;
  }
  return candidates.length > 0 ? candidates[0].proxy : null;
}

// CreateTweet JSON から User rest_id を完全に除外して Tweet 本体の rest_id のみを抽出
function extractTweetIdFromCreateTweetBody(rawTxt, forbiddenIds = new Set()) {
  if (!rawTxt) return { tweetId: null, errorMsg: null };
  try {
    const json = typeof rawTxt === 'string' ? JSON.parse(rawTxt) : rawTxt;
    const rawRes =
      json?.data?.create_tweet?.tweet_results?.result ||
      json?.data?.notetweet_create?.tweet_results?.result ||
      null;
    if (rawRes) {
      const tweetNode = (rawRes.__typename === 'TweetWithVisibilityResults' && rawRes.tweet)
        ? rawRes.tweet
        : rawRes;
      if (tweetNode && tweetNode.__typename !== 'User') {
        const id = tweetNode.rest_id || (tweetNode.legacy && tweetNode.legacy.id_str);
        if (id && /^\d{15,22}$/.test(String(id)) && !forbiddenIds.has(String(id))) {
          return { tweetId: String(id), errorMsg: null };
        }
      }
    }
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      const msg = json.errors.map(e => `${e.message || 'error'}${e.code ? '(' + e.code + ')' : ''}`).join('; ');
      return { tweetId: null, errorMsg: msg };
    }
  } catch (e) {}
  return { tweetId: null, errorMsg: null };
}

// Layer 1: ページ内部の XMLHttpRequest & fetch を直接フックし、CDPバッファ破棄の影響ゼロで CreateTweet 応答を捕捉
async function installCreateTweetInterceptor(page) {
  await page.evaluateOnNewDocument(() => {
    if (window.__xswTweetTapInstalled) return;
    window.__xswTweetTapInstalled = true;
    window.__xswCreatedTweets = [];

    window.__xswRecordCreateTweetPayload = function(rawText) {
      try {
        if (!rawText) return;
        const json = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
        const rawRes =
          (json && json.data && json.data.create_tweet && json.data.create_tweet.tweet_results && json.data.create_tweet.tweet_results.result) ||
          (json && json.data && json.data.notetweet_create && json.data.notetweet_create.tweet_results && json.data.notetweet_create.tweet_results.result) ||
          null;
        let tweetId = null;
        if (rawRes) {
          const tNode = (rawRes.__typename === 'TweetWithVisibilityResults' && rawRes.tweet) ? rawRes.tweet : rawRes;
          if (tNode && tNode.__typename !== 'User') {
            const id = tNode.rest_id || (tNode.legacy && tNode.legacy.id_str);
            if (id && /^\d{15,22}$/.test(String(id))) tweetId = String(id);
          }
        }
        let errorMsg = null;
        if (json && Array.isArray(json.errors) && json.errors.length > 0) {
          errorMsg = json.errors.map(function(e) { return (e.message || 'error') + (e.code ? '(' + e.code + ')' : ''); }).join('; ');
        }
        if (tweetId || errorMsg) {
          window.__xswCreatedTweets.push({ tweetId: tweetId, errorMsg: errorMsg, ts: Date.now() });
        }
      } catch (e) {}
    };

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__xswUrl = String(url || '');
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      if (this.__xswUrl && (this.__xswUrl.indexOf('CreateTweet') !== -1 || this.__xswUrl.indexOf('CreateNoteTweet') !== -1)) {
        this.addEventListener('load', function() {
          try { window.__xswRecordCreateTweetPayload(this.responseText); } catch (e) {}
        });
      }
      return origSend.apply(this, arguments);
    };

    if (typeof window.fetch === 'function') {
      const origFetch = window.fetch;
      window.fetch = function() {
        const u = arguments[0] ? (typeof arguments[0] === 'string' ? arguments[0] : (arguments[0].url || '')) : '';
        const p = origFetch.apply(this, arguments);
        if (u && (u.indexOf('CreateTweet') !== -1 || u.indexOf('CreateNoteTweet') !== -1)) {
          p.then(function(res) {
            try { res.clone().text().then(window.__xswRecordCreateTweetPayload).catch(function() {}); } catch (e) {}
          }).catch(function() {});
        }
        return p;
      };
    }
  });
}

async function resetCapturedTweetsInPage(page) {
  await page.evaluate(() => { window.__xswCreatedTweets = []; }).catch(() => {});
}

async function getSelfUserIdFromCookies(page) {
  try {
    const cookies = await page.cookies('https://x.com');
    const twid = cookies.find(c => c.name === 'twid');
    if (twid && twid.value) {
      const decoded = decodeURIComponent(twid.value);
      const m = decoded.match(/(\d{10,22})/);
      if (m && m[1]) return m[1];
    }
  } catch (e) {}
  return null;
}

// 4層統合 Tweet / Reply ID 確定ヘルパー (Layer 1: ページ内XHRフック + Layer 2: CDP応答 + Layer 3: Toast通知 + Layer 4: スレッド / with_replies DOM)
async function captureConfirmedTweetId(page, { cleanUsername, selfUserId = null, isReply = false, excludeIds = [], timeoutMs = 10500 } = {}) {
  const forbidden = new Set((excludeIds || []).filter(Boolean).map(String));
  if (selfUserId) forbidden.add(String(selfUserId));
  forbidden.add('2117797055368433809'); // @VeloxPostApp ユーザーIDの混入を恒久ブロック

  let cdpTweetId = null;
  let cdpErrorMsg = null;
  const onCdpRes = async (res) => {
    try {
      const u = res.url();
      if (!u.includes('CreateTweet') && !u.includes('CreateNoteTweet')) return;
      const raw = await res.text().catch(() => '');
      const parsed = extractTweetIdFromCreateTweetBody(raw, forbidden);
      if (parsed.tweetId) cdpTweetId = parsed.tweetId;
      if (parsed.errorMsg) cdpErrorMsg = parsed.errorMsg;
    } catch (e) {}
  };
  page.on('response', onCdpRes);

  let foundId = null;
  let foundErr = null;
  const start = Date.now();

  try {
    while (Date.now() - start < timeoutMs) {
      if (cdpTweetId && !forbidden.has(cdpTweetId)) {
        foundId = cdpTweetId;
        break;
      }

      const inPageHit = await page.evaluate((forbArr) => {
        const forb = new Set(forbArr);
        const list = Array.isArray(window.__xswCreatedTweets) ? window.__xswCreatedTweets : [];
        for (let i = list.length - 1; i >= 0; i--) {
          const item = list[i];
          if (item && item.tweetId && !forb.has(String(item.tweetId))) {
            return { tweetId: String(item.tweetId), errorMsg: null };
          }
          if (item && item.errorMsg) {
            return { tweetId: null, errorMsg: item.errorMsg };
          }
        }
        // Layer 3: 同時に画面下部の "View" トーストリンクも確認
        const toastA = document.querySelector('div[data-testid="toast"] a[href*="/status/"]');
        if (toastA) {
          const href = String(toastA.getAttribute('href') || toastA.href || '');
          const m = href.match(/status\/(\d{15,22})/);
          if (m && m[1] && !forb.has(m[1])) {
            return { tweetId: m[1], errorMsg: null };
          }
        }
        return null;
      }, Array.from(forbidden)).catch(() => null);

      if (inPageHit && inPageHit.tweetId) {
        foundId = inPageHit.tweetId;
        break;
      }
      if (inPageHit && inPageHit.errorMsg) {
        foundErr = inPageHit.errorMsg;
        break;
      }
      if (cdpErrorMsg) {
        foundErr = cdpErrorMsg;
        break;
      }
      await new Promise(r => setTimeout(r, 400));
    }
  } finally {
    page.off('response', onCdpRes);
  }

  if (foundId) return { tweetId: foundId, errorMsg: null };
  if (foundErr) return { tweetId: null, errorMsg: foundErr };

  // Layer 4: 現在開いているスレッドDOM または /with_replies (通常投稿ならプロフィール) から最新ステータスIDを回収
  const uLower = String(cleanUsername || '').replace(/^@/, '').toLowerCase();
  if (!uLower) return { tweetId: null, errorMsg: 'missing_username' };

  const scanDom = async (skipPinned) => {
    return await page.evaluate((targetUser, forbArr, skipPin) => {
      const forb = new Set(forbArr);
      const arts = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      for (const art of arts) {
        if (skipPin) {
          const soc = art.querySelector('[data-testid="socialContext"]');
          if (soc && /pinned|固定/i.test(soc.innerText || '')) continue;
        }
        const links = Array.from(art.querySelectorAll('a[href*="/status/"]'));
        for (const a of links) {
          const href = String(a.getAttribute('href') || '');
          const m = href.match(/^\/([^/]+)\/status\/(\d{15,22})/i);
          if (m && m[1].toLowerCase() === targetUser && !forb.has(m[2])) {
            return m[2];
          }
        }
      }
      return null;
    }, uLower, Array.from(forbidden), Boolean(skipPinned)).catch(() => null);
  };

  if (isReply) {
    const inlineHit = await scanDom(false);
    if (inlineHit) return { tweetId: inlineHit, errorMsg: null };
  }

  const fallbackUrl = isReply
    ? `https://x.com/${cleanUsername}/with_replies`
    : `https://x.com/${cleanUsername}`;
  await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: 28000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3200));
  const profHit = await scanDom(!isReply);
  return { tweetId: profHit || null, errorMsg: profHit ? null : 'unconfirmed_after_fallback' };
}

async function dismissXOverlays(page) {
  await page.evaluate(() => {
    const labels = ['accept all cookies', 'refuse non-essential cookies', 'not now', 'got it', '後で', '今はしない', '了解'];
    const btns = Array.from(document.querySelectorAll('[data-testid="BottomBar"] button, [role="dialog"] button, [data-testid="sheetDialog"] button'));
    for (const b of btns) {
      const t = String(b.innerText || '').trim().toLowerCase();
      if (labels.some(l => t === l || t.includes(l))) {
        try { b.click(); } catch (e) {}
      }
    }
  }).catch(() => {});
}

// /home 上でページ再読込なしに投稿モーダルを開く高速・省ギガコンポーザー展開
async function openComposerOnHomeOrFallback(page, logFn = null) {
  await dismissXOverlays(page);

  // 1. 左サイドバーの Post ボタン (SideNav_NewTweet_Button) をクリックして SPA モーダルを起動
  const clickedSideBtn = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="SideNav_NewTweet_Button"], a[data-testid="SideNav_NewTweet_Button"], a[href="/compose/post"]');
    if (btn) { btn.click(); return true; }
    return false;
  }).catch(() => false);

  if (clickedSideBtn) {
    const modalBox = await page.waitForSelector('[role="dialog"] [data-testid="tweetTextarea_0"]', { timeout: 5000 }).catch(() => null);
    if (modalBox) {
      return { textbox: modalBox, scopeSelector: '[role="dialog"] ' };
    }
  }

  // 2. /home 最上部に常設されているインライン投稿ボックスを確認
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  const inlineBox = await page.$('[data-testid="tweetTextarea_0"]');
  if (inlineBox) {
    return { textbox: inlineBox, scopeSelector: '' };
  }

  // 3. 最終フォールバック: /compose/post への直接遷移
  if (logFn) logFn('  ↻ Opening /compose/post fallback...');
  await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2800));
  await dismissXOverlays(page);
  const dialogBox = await page.$('[role="dialog"] [data-testid="tweetTextarea_0"]');
  if (dialogBox) return { textbox: dialogBox, scopeSelector: '[role="dialog"] ' };
  const anyBox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 12000 }).catch(() => null);
  return { textbox: anyBox, scopeSelector: '' };
}

// 個別ポスト画面でのリプライ入力欄展開（折りたたみ時は返信アイコンをクリックしてモーダル展開）
async function openReplyComposerReliable(page) {
  await dismissXOverlays(page);
  let box = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 4000 }).catch(() => null);
  if (box) {
    const inDialog = await page.evaluate(el => !!el.closest('[role="dialog"]'), box).catch(() => false);
    return { textbox: box, scopeSelector: inDialog ? '[role="dialog"] ' : '' };
  }

  // 折りたたまれている場合は対象ポストの Reply アイコンをクリックしてモーダルを開く
  await page.evaluate(() => {
    const repBtn = document.querySelector('article[data-testid="tweet"] [data-testid="reply"]');
    if (repBtn) repBtn.click();
  }).catch(() => {});

  box = await page.waitForSelector('[role="dialog"] [data-testid="tweetTextarea_0"], [data-testid="tweetTextarea_0"]', { timeout: 7000 }).catch(() => null);
  if (!box) return { textbox: null, scopeSelector: '' };
  const inDialog = await page.evaluate(el => !!el.closest('[role="dialog"]'), box).catch(() => false);
  return { textbox: box, scopeSelector: inDialog ? '[role="dialog"] ' : '' };
}

module.exports = {
  probeProxyHttpsToX,
  resolveHealthyProxy,
  markProxyUnhealthy,
  extractTweetIdFromCreateTweetBody,
  installCreateTweetInterceptor,
  resetCapturedTweetsInPage,
  getSelfUserIdFromCookies,
  captureConfirmedTweetId,
  dismissXOverlays,
  openComposerOnHomeOrFallback,
  openReplyComposerReliable
};
