const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const {
  db,
  getAccount,
  getAccountsByField,
  updateAccountData,
} = require('./firestore');
const { getAccountDisplayStatus } = require('./account_state');
const { getDeviceProfile, applyDeviceProfile, readStoredUserAgent, resolveExitCountry } = require('./browser_config');
const { getResidentialProxy } = require('./iproyal');
const { getPersistentProfileDir, extractKeepCookies } = require('./status_checker');

// Chromeリモートデスクトップのアクティブな DISPLAY と XAUTHORITY を取得
function resolveCrdDisplayEnv() {
  let display = process.env.DISPLAY || ':20';
  let xauth = process.env.XAUTHORITY || '/home/u0_a217/.Xauthority';
  try {
    const crdFile = path.join(__dirname, '../.crd_env.json');
    if (fs.existsSync(crdFile)) {
      const saved = JSON.parse(fs.readFileSync(crdFile, 'utf8'));
      if (saved.DISPLAY && saved.DISPLAY !== ':99') display = saved.DISPLAY;
      if (saved.XAUTHORITY) xauth = saved.XAUTHORITY;
    }
    if (display === ':99' && fs.existsSync('/tmp/.X11-unix')) {
      const socks = fs.readdirSync('/tmp/.X11-unix')
        .filter(f => /^X\d+$/.test(f))
        .map(f => ':' + f.slice(1))
        .filter(d => d !== ':99');
      if (socks.length > 0) display = socks[0];
    }
  } catch (e) {}
  return { DISPLAY: display, XAUTHORITY: xauth };
}

// 上流の認証付きIPRoyalプロキシへパスワード無しで中継するローカルフォワーダー（Chromeの認証ポップアップ防止＆IP100%固定）
function createLocalProxyForwarder(upstreamProxy) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const auth = Buffer.from(`${upstreamProxy.user}:${upstreamProxy.pass}`).toString('base64');
      const options = {
         host: upstreamProxy.host,
        port: Number(upstreamProxy.port),
        method: req.method,
        path: req.url,
        headers: { ...req.headers, 'Proxy-Authorization': `Basic ${auth}` }
      };
      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });
      proxyReq.on('error', () => { try { res.end(); } catch (e) {} });
      req.pipe(proxyReq, { end: true });
    });

  server.on('connect', (req, clientSocket, head) => {
      const [targetHost, targetPort] = req.url.split(':');
      const auth = Buffer.from(`${upstreamProxy.user}:${upstreamProxy.pass}`).toString('base64');
      const proxySocket = net.connect(Number(upstreamProxy.port), upstreamProxy.host, () => {
        const connectReq =
          `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
          `Host: ${targetHost}:${targetPort}\r\n` +
          `Proxy-Authorization: Basic ${auth}\r\n` +
          `Proxy-Connection: Keep-Alive\r\n\r\n`;
        proxySocket.write(connectReq);
        if (head && head.length > 0) proxySocket.write(head);
      });

      let connected = false;
      proxySocket.on('data', (chunk) => {
        if (!connected) {
          const str = chunk.toString('utf8');
          if (str.includes('200')) {
            connected = true;
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            const idx = chunk.indexOf('\r\n\r\n');
            if (idx !== -1 && idx + 4 < chunk.length) {
              clientSocket.write(chunk.slice(idx + 4));
            }
            proxySocket.pipe(clientSocket);
            clientSocket.pipe(proxySocket);
          } else {
            clientSocket.end();
            proxySocket.end();
          }
        }
      });

      proxySocket.on('error', () => { try { clientSocket.destroy(); } catch (e) {} });
      clientSocket.on('error', () => { try { proxySocket.destroy(); } catch (e) {} });
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
    server.on('error', reject);
  });
}

let activeVncSession = null;


function checkProxyFastAlive(proxy) {
  return new Promise((resolve) => {
    if (!proxy || !proxy.host || !proxy.port || !proxy.user || !proxy.pass) return resolve(false);
    const t0 = Date.now();
    const auth = 'Basic ' + Buffer.from(`${proxy.user}:${proxy.pass}`).toString('base64');
    const req = http.request({
      host: proxy.host,
      port: Number(proxy.port),
      method: 'CONNECT',
      path: 'x.com:443',
      headers: { 'Proxy-Authorization': auth },
      timeout: 1500
    });
    req.on('connect', (res, sock) => {
      const rtt = Date.now() - t0;
      try { sock.destroy(); } catch (e) {}
      resolve(res.statusCode === 200 && rtt <= 1500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve(false); });
    req.end();
  });
}

async function ensureFastResidentialProxy(savedProxy, cleanToken, docRef, accountData = null) {
  const country = resolveExitCountry(accountData || {});
  const savedCountryMatch = String(savedProxy && savedProxy.pass || '').match(/_country-([a-z]{2})/i);
  const savedCountry = savedCountryMatch ? (savedCountryMatch[1].toLowerCase() === 'uk' ? 'gb' : savedCountryMatch[1].toLowerCase()) : '';
  if (await checkProxyFastAlive(savedProxy) && (!savedCountry || savedCountry === country)) {
    return savedProxy;
  }
  console.log(`  ⚡ [CRD高速回線リカバリー] 保存プロキシがオフラインまたは国不一致のため、${country.toUpperCase()} のセッションを再取得します...`);
  for (let i = 1; i <= 12; i++) {
    const fresh = getResidentialProxy(`${cleanToken}_crd_${Date.now()}_${i}`, { country });
    if (await checkProxyFastAlive(fresh)) {
      if (docRef) {
        try { await docRef.update({ proxy: fresh, updatedAt: new Date() }); } catch (e) {}
      }
      console.log(`  ✅ [CRD高速回線ロック] 高速応答の日本プロキシ回線に切り替えました (試行${i}回目)`);
      return fresh;
    }
  }
  return getResidentialProxy(`${cleanToken}_crd_${Date.now()}`, { country });
}

async function launchXBrowser(authToken, docId = '') {
  const cleanToken = String(authToken || '').trim();
  if (!cleanToken) throw new Error('auth_token が指定されていません');

  // 既に開いているVNCブラウザがあれば安全に閉じてロック競合を防ぐ
  if (activeVncSession) {
    try { await activeVncSession.browser.close(); } catch (e) {}
    try { activeVncSession.forwarder.server.close(); } catch (e) {}
    activeVncSession = null;
  }

  // 1. Firestoreからアカウントの固定UA・固定Proxy・保存済みCookie・ユーザーIDを取得
  let accountData = {};
  let docRef = null;
  try {
    if (docId) {
      const doc = await getAccount(docId);
      if (doc.exists) {
        accountData = doc.data() || {};
        docRef = doc.ref;
      }
    }
    if (!accountData.authToken) {
      const docs = await getAccountsByField('authToken', cleanToken, { limit: 1 });
      if (docs.length > 0) {
        docId = docs[0].id;
        accountData = docs[0].data() || {};
        docRef = docs[0].ref;
      }
    }
  } catch (e) {}

  // 2. 固定プロキシの決定（DB保存済みの同一セッションを最優先）
  const proxy = await ensureFastResidentialProxy(accountData.proxy, cleanToken, docRef, accountData);

  // 3. 固定UA・デバイス指紋の決定（DB保存済みの userAgent を最優先）
  const storedUa = readStoredUserAgent(accountData);
  const devProf = getDeviceProfile(cleanToken, storedUa, accountData);
  const fixedUA = storedUa || devProf.userAgent;
  const vpW = (devProf && devProf.viewport && devProf.viewport.width) || 1920;
  const vpH = (devProf && devProf.viewport && devProf.viewport.height) || 1080;

  // 4. 初期設定・養殖と同一の永続プロファイルディレクトリを使用＆残存ロック除去
  const profileDir = getPersistentProfileDir(cleanToken);
  for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(profileDir, lockName)); } catch (e) {}
  }

  // 5. ローカルプロキシ中継器を起動（IPを100%固定）
  const forwarder = await createLocalProxyForwarder(proxy);
  const crdEnv = resolveCrdDisplayEnv();

  console.log(`🖥️ [VNC起動] @${accountData.userId || docId} | DISPLAY=${crdEnv.DISPLAY} | ProxySession=${proxy.sessionId || proxy.pass.slice(-14)} | UA=${fixedUA.slice(0, 45)}...`);

  // システムに標準 Google Chrome があれば優先し、無ければ Puppeteer 同梱版を使用
  let executablePath = undefined;
  for (const candidate of ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']) {
    if (fs.existsSync(candidate)) {
      executablePath = candidate;
      break;
    }
  }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath,
    userDataDir: profileDir,
    ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=IdleDetection'],
    env: { ...process.env, DISPLAY: crdEnv.DISPLAY, XAUTHORITY: crdEnv.XAUTHORITY },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--test-type',
      '--no-first-run',
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-sync",
    "--autoplay-policy=document-user-activation-required",
    "--host-resolver-rules=MAP pbs.twimg.com 127.0.0.1,MAP ton.twimg.com 127.0.0.1,MAP abs-0.twimg.com 127.0.0.1,MAP video.twimg.com 127.0.0.1,MAP analytics.twitter.com 127.0.0.1,MAP syndication.twitter.com 127.0.0.1,MAP ads-twitter.com 127.0.0.1,MAP static.ads-twitter.com 127.0.0.1,MAP update.googleapis.com 127.0.0.1,MAP safebrowsing.googleapis.com 127.0.0.1,MAP optimizationguide-pa.googleapis.com 127.0.0.1,MAP clients2.google.com 127.0.0.1,MAP *.gvt1.com 127.0.0.1,MAP play.google.com 127.0.0.1",
      '--no-default-browser-check',
      '--lang=ja-JP',
      '--window-position=20,20',
      `--window-size=${vpW},${vpH}`,
      `--user-agent=${fixedUA}`,
      `--proxy-server=http://127.0.0.1:${forwarder.port}`
    ],
    defaultViewport: null
  });

  activeVncSession = { browser, forwarder, docId, token: cleanToken };

  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  // 6. 養殖エンジンと100%同じデバイス指紋（WebGL/Canvas/navigator.webdriver消去/Asia/Tokyo）を注入
  await applyDeviceProfile(page, cleanToken, fixedUA, accountData);

  // 7. Cookie（auth_token + 保存済みセッションCookie）をセット
  const cookiesToSet = [
    { name: 'auth_token', value: cleanToken, domain: '.x.com', path: '/', secure: true, httpOnly: true },
    { name: 'auth_token', value: cleanToken, domain: '.twitter.com', path: '/', secure: true, httpOnly: true },
    { name: 'lang', value: 'ja', domain: '.x.com', path: '/' }
  ];
  if (Array.isArray(accountData.savedCookies)) {
    for (const sc of accountData.savedCookies) {
      if (sc && sc.name && sc.value && sc.name !== 'auth_token') {
        cookiesToSet.push(sc);
      }
    }
  }
  await page.setCookie(...cookiesToSet).catch(() => {});

  // ロボット解除待ちなら /account/access または /home へ遷移
  const targetUrl = ['robot', 'app_lock'].includes(getAccountDisplayStatus(accountData))
    ? 'https://x.com/account/access'
    : 'https://x.com/home';

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

  // ブラウザを閉じた際に最新のCookie（ロボット解除後のct0等）を自動でDBへ保存
  browser.on('disconnected', async () => {
    try { forwarder.server.close(); } catch (e) {}
    if (activeVncSession && activeVncSession.browser === browser) {
      activeVncSession = null;
    }
  });

  // 10秒ごとにVNC操作後の最新CookieをDBへバックグラウンド同期（手動でロボット解除した直後のセッション維持用）
  const cookieSyncTimer = setInterval(async () => {
    if (!(browser && typeof browser.isConnected === "function" ? browser.isConnected() : (browser && browser.connected))) {
      clearInterval(cookieSyncTimer);
      return;
    }
    try {
      const currentPages = await browser.pages();
      if (currentPages.length > 0 && docId) {
        const freshCookies = await extractKeepCookies(currentPages[0]);
        if (freshCookies && freshCookies.length > 0) {
          await updateAccountData(docId, {
            savedCookies: freshCookies,
            userAgent: fixedUA,
            proxy
          }).catch(() => {});
        }
      }
    } catch (e) {}
  }, 10000);

  return { ok: true, display: crdEnv.DISPLAY, proxySession: proxy.sessionId, userAgent: fixedUA };
}

module.exports = { launchXBrowser };
