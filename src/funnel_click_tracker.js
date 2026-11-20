const { refreshLaneCampaignNow } = require('./saas_rate_and_rotation');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const UPLOADS_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const LINKS_CACHE_FILE = '/tmp/xsw_tracking_links_cache.json';
const CLICKS_STATE_FILE = '/tmp/xsw_click_stats_cache.json';

let _linksMap = null;
let _linksSig = '';
let _clicksMap = null;
let _clicksSig = '';
const _recentDedupHits = new Map();

function getFileSignature(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 'missing';
    const st = fs.statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch (e) {
    return 'err';
  }
}

function loadLinksCache() {
  const sig = getFileSignature(LINKS_CACHE_FILE);
  if (_linksMap && sig === _linksSig) return _linksMap;
  _linksMap = {};
  try {
    if (sig !== 'missing' && sig !== 'err') {
      _linksMap = JSON.parse(fs.readFileSync(LINKS_CACHE_FILE, 'utf8')) || {};
    }
  } catch (e) { _linksMap = {}; }
  _linksSig = sig;
  return _linksMap;
}

function saveLinksCache() {
  try {
    if (_linksMap) {
      fs.writeFileSync(LINKS_CACHE_FILE, JSON.stringify(_linksMap), 'utf8');
      _linksSig = getFileSignature(LINKS_CACHE_FILE);
    }
  } catch (e) {}
}

function loadClicksCache() {
  const sig = getFileSignature(CLICKS_STATE_FILE);
  if (_clicksMap && sig === _clicksSig) return _clicksMap;
  _clicksMap = {};
  try {
    if (sig !== 'missing' && sig !== 'err') {
      _clicksMap = JSON.parse(fs.readFileSync(CLICKS_STATE_FILE, 'utf8')) || {};
    }
  } catch (e) { _clicksMap = {}; }
  _clicksSig = sig;
  return _clicksMap;
}

function saveClicksCache() {
  try {
    if (_clicksMap) {
      fs.writeFileSync(CLICKS_STATE_FILE, JSON.stringify(_clicksMap), 'utf8');
      _clicksSig = getFileSignature(CLICKS_STATE_FILE);
    }
  } catch (e) {}
}

function getTodayKeyJst() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 10);
}

function appendClickTerminalLog(userId, laneNo, msg) {
  try {
    if (!userId) return;
    const cleanUid = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
    const lNo = Math.min(3, Math.max(1, parseInt(laneNo || '1', 10)));
    const logFile = `/tmp/xsw_term_${cleanUid}_L${lNo}.json`;
    const jstIso = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
    const ts = jstIso.slice(5, 10).replace('-', '/') + ' ' + jstIso.slice(11, 19);
    const line = `[${ts}] [LANE #0${lNo}] ${msg}`;
    let arr = [];
    if (fs.existsSync(logFile)) {
      try { arr = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch (e) { arr = []; }
    }
    if (!Array.isArray(arr)) arr = [];
    arr.push(line);
    if (arr.length > 80) arr = arr.slice(arr.length - 80);
    fs.writeFileSync(logFile, JSON.stringify(arr), 'utf8');
  } catch (e) {}
}

function resolvePublicBaseUrl(req = null) {
  const envBase = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (envBase && /^https?:\/\//i.test(envBase) && !envBase.includes('localhost') && !envBase.includes('127.0.0.1')) {
    return envBase;
  }
  if (req) {
    const xfHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const xfProto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    if (xfHost && !xfHost.includes('localhost') && !xfHost.includes('127.0.0.1') && !/^\d+\.\d+\.\d+\.\d+/.test(xfHost)) {
      return `${xfProto}://${xfHost}`;
    }
  }
  return 'https://appflowsystem.com';
}

function escapeHtmlAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function generateSlugForLane(userId, laneIndex, destinationUrl) {
  const raw = `${userId}::L${laneIndex}::${String(destinationUrl || '').trim()}`;
  const hex = crypto.createHash('sha256').update(raw).digest('hex');
  const num = BigInt('0x' + hex.slice(0, 12));
  return num.toString(36).slice(0, 7).padStart(6, 'x');
}

async function ensureLaneTrackingLink({ db, userId, laneIndex, destinationUrl, title, description, imageUrl, req }) {
  const cleanUrl = String(destinationUrl || '').trim();
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) return null;

  const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
  const slug = generateSlugForLane(userId, numLane, cleanUrl);
  const baseUrl = resolvePublicBaseUrl(req);
  const shortUrl = `${baseUrl}/go/${slug}`;

  const links = loadLinksCache();
  const existing = links[slug] || {};
  const record = {
    slug,
    ownerUserId: userId,
    laneIndex: numLane,
    destinationUrl: cleanUrl,
    ogpTitle: String(title || existing.ogpTitle || 'Official Access & Live Details').trim().slice(0, 90),
    ogpDescription: String(description || existing.ogpDescription || 'Tap to open full setup details and official access.').trim().slice(0, 180),
    ogpImageUrl: typeof imageUrl === 'string' ? imageUrl.trim() : (existing.ogpImageUrl || ''),
    shortUrl,
    updatedAtMs: Date.now()
  };

  links[slug] = record;
  saveLinksCache();

  if (db) {
    await db.collection('saas_tracking_links').doc(slug).set({
      ...record,
      updatedAt: new Date()
    }, { merge: true }).catch(() => {});
  }

  return record;
}

function getClickStatsForUser(userId, lanesObj = {}, dailyStats = {}) {
  const all = loadClicksCache();
  const todayKey = getTodayKeyJst();
  const yesterdayKey = new Date(Date.now() + 9 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const uStat = all[userId] || { total: 0, byDay: {}, lanes: {}, recent: [] };

  const byLane = {};
  let sumTotal = 0;
  let sumToday = 0;
  let sumYesterday = 0;

  for (const lk of ['1', '2', '3']) {
    const lMem = (uStat.lanes && uStat.lanes[lk]) ? uStat.lanes[lk] : { total: 0, byDay: {} };
    const dbTotal = (lanesObj && lanesObj[lk] && typeof lanesObj[lk].clickCount === 'number') ? lanesObj[lk].clickCount : 0;
    const laneTotal = Math.max(lMem.total || 0, dbTotal);
    const laneToday = (lMem.byDay && lMem.byDay[todayKey]) ? lMem.byDay[todayKey] : 0;
    const laneYesterday = (lMem.byDay && lMem.byDay[yesterdayKey]) ? lMem.byDay[yesterdayKey] : 0;
    byLane[lk] = { total: laneTotal, today: laneToday, yesterday: laneYesterday };
    sumTotal += laneTotal;
    sumToday += laneToday;
    sumYesterday += laneYesterday;
  }

  return {
    totalClicks: Math.max(uStat.total || 0, sumTotal),
    clicksToday: Math.max(sumToday, Number(dailyStats[todayKey]) || 0),
    clicksYesterday: Math.max(sumYesterday, Number(dailyStats[yesterdayKey]) || 0),
    todayDate: todayKey,
    yesterdayDate: yesterdayKey,
    byLane,
    recentClicks: Array.isArray(uStat.recent) ? uStat.recent.slice(-15).reverse() : []
  };
}

function recordHumanClick({ db, linkRec, req, sourceTag }) {
  const userId = linkRec.ownerUserId;
  const lKey = String(linkRec.laneIndex || 1);
  if (!userId) return;

  const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '0.0.0.0').split(',')[0].trim();
  const ua = String(req.headers['user-agent'] || '').slice(0, 120);
  const dedupKey = `${linkRec.slug}::${ip}::${ua.slice(0, 40)}`;
  const now = Date.now();
  const prevHit = _recentDedupHits.get(dedupKey) || 0;
  if (now - prevHit < 8000) return;
  _recentDedupHits.set(dedupKey, now);
  if (_recentDedupHits.size > 2000) _recentDedupHits.clear();

  const todayKey = getTodayKeyJst();
  const all = loadClicksCache();
  if (!all[userId]) all[userId] = { total: 0, byDay: {}, lanes: {}, recent: [] };
  const uStat = all[userId];

  uStat.total = (uStat.total || 0) + 1;
  uStat.byDay[todayKey] = (uStat.byDay[todayKey] || 0) + 1;

  // 古い日付キーを整理
  const dayKeys = Object.keys(uStat.byDay);
  if (dayKeys.length > 14) {
    dayKeys.sort().slice(0, dayKeys.length - 14).forEach(k => delete uStat.byDay[k]);
  }

  if (!uStat.lanes[lKey]) uStat.lanes[lKey] = { total: 0, byDay: {} };
  uStat.lanes[lKey].total = (uStat.lanes[lKey].total || 0) + 1;
  uStat.lanes[lKey].byDay[todayKey] = (uStat.lanes[lKey].byDay[todayKey] || 0) + 1;

  uStat.recent = Array.isArray(uStat.recent) ? uStat.recent : [];
  uStat.recent.push({
    ts: new Date().toISOString(),
    laneIndex: parseInt(lKey, 10),
    slug: linkRec.slug,
    source: String(sourceTag || 'post').slice(0, 20)
  });
  if (uStat.recent.length > 30) uStat.recent = uStat.recent.slice(-30);

  saveClicksCache();

  const laneToday = uStat.lanes[lKey].byDay[todayKey];
  const laneTotal = uStat.lanes[lKey].total;
  appendClickTerminalLog(
    userId,
    lKey,
    `🎯 [CLICK TRACKED] +1 Real Visitor Click via /go/${linkRec.slug}! (Lane Today: ${laneToday} / Lane Total: ${laneTotal})`
  );

  if (db) {
    setImmediate(async () => {
      try {
        const uRef = db.collection('saas_users').doc(userId);
        const uSnap = await uRef.get().catch(() => null);
        if (uSnap && uSnap.exists) {
          const uData = uSnap.data() || {};
          const lanes = uData.lanes || {};
          if (!lanes[lKey]) lanes[lKey] = { laneIndex: parseInt(lKey, 10) };
          lanes[lKey].clickCount = Math.max(parseInt(lanes[lKey].clickCount || '0', 10) + 1, laneTotal);
          lanes[lKey].lastClickedAt = new Date();
          const dailyClicks = (uData.clicksByDayJst && typeof uData.clicksByDayJst === 'object')
            ? { ...uData.clicksByDayJst }
            : {};
          dailyClicks[todayKey] = Math.max(
            (Number(dailyClicks[todayKey]) || 0) + 1,
            Number(uStat.byDay[todayKey]) || 0
          );
          const clickDateKeys = Object.keys(dailyClicks).sort();
          if (clickDateKeys.length > 14) {
            clickDateKeys.slice(0, clickDateKeys.length - 14).forEach((dateKey) => delete dailyClicks[dateKey]);
          }
          await uRef.set({
            totalClicks: Math.max(parseInt(uData.totalClicks || '0', 10) + 1, uStat.total),
            clicksByDayJst: dailyClicks,
            lanes,
            updatedAt: new Date()
          }, { merge: true }).catch(() => {});
        }
      } catch (e) {}
    });
  }
}

function applyTrackingUrlToReplyText(rawReplyText, laneCfg, sourceTag = '') {
  const txt = String(rawReplyText || '').trim();
  if (!txt) return '';
  if (!laneCfg || laneCfg.useClickTracker !== true || !laneCfg.trackingShortUrl) {
    return txt;
  }
  const shortBase = String(laneCfg.trackingShortUrl).trim();
  if (!/^https?:\/\//i.test(shortBase)) return txt;
  const trackedUrl = sourceTag ? `${shortBase}?s=${encodeURIComponent(sourceTag)}` : shortBase;
  if (/https?:\/\/[^\s]+/.test(txt)) {
    return txt.replace(/https?:\/\/[^\s]+/g, trackedUrl);
  }
  return `${txt}\n${trackedUrl}`;
}

function readRawRequestBodyBuffer(req, maxBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('IMAGE_TOO_LARGE_MAX_12MB'));
        try { req.destroy(); } catch (e) {}
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function registerPhase4FunnelRoutes(app, { db, resolveUserId }) {
  // 1. アップロード画像を静的配信 (/uploads/...) — XのOGPクローラーと管理画面の両方から参照可能
  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

  // 2. /api/funnel/user-state のレスポンスにリアルタイムクリック統計・Phase 4 フィールドを自動注入
  app.use('/api/funnel/user-state', (req, res, next) => {
    const origJson = res.json.bind(res);
    res.json = (body) => {
      try {
        if (body && typeof body === 'object' && body.ok !== false) {
          const uid = body.userId || (body.user && body.user.userId) || null;
          if (uid) {
            const cStats = getClickStatsForUser(uid, body.lanes || {});
            body.clickStats = cStats;
            if (body.lanes && typeof body.lanes === 'object') {
              for (const lk of ['1', '2', '3']) {
                if (body.lanes[lk]) {
                  body.lanes[lk].clickCount = cStats.byLane[lk] ? cStats.byLane[lk].total : 0;
                  body.lanes[lk].clicksToday = cStats.byLane[lk] ? cStats.byLane[lk].today : 0;
                  const topRun = (body.user ? body.user.isEngineRunning !== false : body.isEngineRunning !== false);
                  body.lanes[lk].isLaneRunning = Boolean(topRun && body.lanes[lk].isEngineRunning !== false && (body.lanes[lk].autoPostMode === true || body.lanes[lk].aiReplyMode === true));
                }
              }
            }
          }
        }
      } catch (e) {}
      return origJson(body);
    };
    next();
  });

  // 3. 画像未設定時でも大型Xカード(summary_large_image)を表示する動的PNGバナー生成 (3段フォールバック付き)
  function buildPureZlibBannerPng(width = 1200, height = 628) {
    const zlib = require('zlib');
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
    const crc32 = (buf) => {
      let c = 0xffffffff;
      for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const makeChunk = (typeStr, dataBuf) => {
      const typeBuf = Buffer.from(typeStr, 'ascii');
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(dataBuf.length, 0);
      const crcInput = Buffer.concat([typeBuf, dataBuf]);
      const crcBuf = Buffer.alloc(4);
      crcBuf.writeUInt32BE(crc32(crcInput), 0);
      return Buffer.concat([lenBuf, crcInput, crcBuf]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const rowBytes = 1 + width * 3;
    const raw = Buffer.alloc(rowBytes * height);
    for (let y = 0; y < height; y++) {
      const rowStart = y * rowBytes;
      raw[rowStart] = 0;
      const r = 15 + Math.floor((y / height) * 14);
      const g = 23 + Math.floor((y / height) * 42);
      const b = 42 + Math.floor((y / height) * 52);
      for (let x = 0; x < width; x++) {
        const p = rowStart + 1 + x * 3;
        raw[p] = r;
        raw[p + 1] = g;
        raw[p + 2] = b;
      }
    }
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      makeChunk('IHDR', ihdr),
      makeChunk('IDAT', zlib.deflateSync(raw, { level: 1 })),
      makeChunk('IEND', Buffer.alloc(0))
    ]);
  }

  app.get('/go-card/:cardFile', async (req, res) => {
    let pngBuf = null;
    try {
      const svg = `<svg width="1200" height="628" viewBox="0 0 1200 628" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0F172A"/>
            <stop offset="55%" stop-color="#1E1B4B"/>
            <stop offset="100%" stop-color="#064E3B"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="628" fill="url(#bg)"/>
        <rect x="80" y="76" width="1040" height="476" rx="32" fill="#0F172A" fill-opacity="0.7" stroke="#34D399" stroke-width="3"/>
        <text x="600" y="275" font-family="sans-serif" font-size="54" font-weight="bold" fill="#FFFFFF" text-anchor="middle">OFFICIAL PORTAL &amp; LIVE ACCESS</text>
        <text x="600" y="355" font-family="sans-serif" font-size="28" fill="#A7F3D0" text-anchor="middle">Tap to open the full setup &amp; official destination</text>
      </svg>`;
      pngBuf = await require('sharp')(Buffer.from(svg)).png({ compressionLevel: 8 }).toBuffer();
    } catch (_svgErr) {
      try {
        pngBuf = await require('sharp')({
          create: { width: 1200, height: 628, channels: 3, background: { r: 15, g: 23, b: 42 } }
        }).png().toBuffer();
      } catch (_rawErr) {
        pngBuf = buildPureZlibBannerPng(1200, 628);
      }
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(pngBuf);
  });

  // 4. 公開クッションURL (/go/:slug & /r/:slug) — クローラーには大型OGPカード、生身の人間には計測＋即302転送
  const handleTrackingRedirect = async (req, res) => {
    try {
      const slug = String(req.params.slug || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!slug) return res.redirect(302, '/');

      const links = loadLinksCache();
      let linkRec = links[slug] || null;

      if (!linkRec && db) {
        const docSnap = await db.collection('saas_tracking_links').doc(slug).get().catch(() => null);
        if (docSnap && docSnap.exists) {
          linkRec = docSnap.data();
          links[slug] = linkRec;
          saveLinksCache();
        }
      }

      if (!linkRec || !linkRec.destinationUrl || String(linkRec.destinationUrl).includes('/go/' + slug) || String(linkRec.destinationUrl).includes('/r/' + slug)) {
        return res.redirect(302, '/');
      }

      const ua = String(req.headers['user-agent'] || '');
      const isSocialCrawler = /twitterbot|facebookexternalhit|discordbot|telegrambot|slackbot|whatsapp|linkedinbot|pinterest|embedly|vkshare|line-poker/i.test(ua);
      const isAutomatedBot = /googlebot|bingbot|yandex|baiduspider|duckduckbot|semrush|ahrefs|mj12bot|curl\/|python-requests|go-http-client|headlesschrome|puppeteer/i.test(ua);

      if (isSocialCrawler) {
        const baseUrl = resolvePublicBaseUrl(req);
        const rawImg = String(linkRec.ogpImageUrl || '').trim();
        const fullImgUrl = rawImg
          ? (rawImg.startsWith('http') ? rawImg : `${baseUrl}${rawImg.startsWith('/') ? '' : '/'}${rawImg}`)
          : `${baseUrl}/go-card/${slug}.png`;
        const title = escapeHtmlAttr(linkRec.ogpTitle || 'Official Access & Live Details');
        const desc = escapeHtmlAttr(linkRec.ogpDescription || 'Tap to view the official page and full details.');
        const destEsc = escapeHtmlAttr(linkRec.destinationUrl);

        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image" content="${escapeHtmlAttr(fullImgUrl)}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:image" content="${escapeHtmlAttr(fullImgUrl)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="628" />
</head>
<body><a href="${destEsc}">${title}</a></body>
</html>`);
      }

      if (!isAutomatedBot && ua.length >= 12) {
        recordHumanClick({
          db,
          linkRec,
          req,
          sourceTag: req.query.s || req.query.p || 'direct'
        });
      }

      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Referrer-Policy', 'no-referrer');
      return res.redirect(302, linkRec.destinationUrl);
    } catch (e) {
      return res.redirect(302, '/');
    }
  };

  app.get('/go/:slug', handleTrackingRedirect);
  app.get('/r/:slug', handleTrackingRedirect);

  // 5. プロモ画像・アイコン画像の高速アップロードAPI (バイナリストリーム & Base64 JSON 両対応)
  app.post('/api/funnel/upload-media', async (req, res) => {
    try {
      req.body = req.body || {};
      if (!req.body.userId) {
        const qUid = (req.query && req.query.userId) || req.headers['x-user-id'] || '';
        if (qUid) req.body.userId = String(qUid).trim();
      }
      const userId = await resolveUserId(req, res);
      if (res.headersSent) return;
      if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required.' });

      const kind = String((req.query && req.query.kind) || (req.body && req.body.kind) || 'promo').toLowerCase();
      let inputBuf = null;

      const cType = String(req.headers['content-type'] || '').toLowerCase();
      if (cType.includes('application/octet-stream') || cType.startsWith('image/')) {
        inputBuf = await readRawRequestBodyBuffer(req);
      } else if (req.body && typeof req.body.imageBase64 === 'string') {
        const cleanB64 = req.body.imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
        inputBuf = Buffer.from(cleanB64, 'base64');
      }

      if (!inputBuf || inputBuf.length < 64) {
        return res.status(400).json({ ok: false, error: 'No valid image payload received.' });
      }

      const sharp = require('sharp');
      const randId = crypto.randomBytes(5).toString('hex');
      const fileName = `${kind}_${Date.now()}_${randId}.jpg`;
      const outPath = path.join(UPLOADS_DIR, fileName);

      if (kind === 'avatar') {
        await sharp(inputBuf)
          .rotate()
          .resize(400, 400, { fit: 'cover' })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 90 })
          .toFile(outPath);
      } else {
        await sharp(inputBuf)
          .rotate()
          .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 90 })
          .toFile(outPath);
      }

      const publicPath = `/uploads/${fileName}`;
      return res.json({ ok: true, kind, imageUrl: publicPath });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Image processing failed: ' + e.message });
    }
  });

  // 6. レーン内の全投稿テンプレート・看板ポスト・OGPカードへプロモ画像を一括適用
  app.post('/api/funnel/apply-lane-promo-image', async (req, res) => {
    try {
      const userId = await resolveUserId(req, res);
      if (res.headersSent) return;
      if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required.' });

      const { laneIndex, imageUrl, applyToAllPosts = true } = req.body || {};
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const lKey = String(numLane);
      const cleanImg = String(imageUrl || '').trim();

      const uRef = db.collection('saas_users').doc(userId);
      const uSnap = await uRef.get();
      const uData = uSnap.exists ? (uSnap.data() || {}) : {};
      const lanes = uData.lanes || {};
      if (!lanes[lKey]) lanes[lKey] = { laneIndex: numLane };

      lanes[lKey].defaultPromoImageUrl = cleanImg;
      if (lanes[lKey].pinnedPost && typeof lanes[lKey].pinnedPost === 'object') {
        lanes[lKey].pinnedPost.imageUrl = cleanImg;
      }

      let trackingShortUrl = lanes[lKey].trackingShortUrl || '';
      if (lanes[lKey].aiAffiliateUrl) {
        const tr = await ensureLaneTrackingLink({
          db,
          userId,
          laneIndex: numLane,
          destinationUrl: lanes[lKey].aiAffiliateUrl,
          title: lanes[lKey].aiProductDesc || 'Official Access',
          description: lanes[lKey].profileBio || '',
          imageUrl: cleanImg,
          req
        });
        if (tr) {
          trackingShortUrl = tr.shortUrl;
          lanes[lKey].trackingShortUrl = tr.shortUrl;
        }
      }

      await uRef.set({ lanes, updatedAt: new Date() }, { merge: true });

      let updatedPostsCount = 0;
      if (applyToAllPosts) {
        const pSnap = await db.collection('saas_posts').where('ownerUserId', '==', userId).get();
        for (const pDoc of pSnap.docs) {
          if (parseInt(pDoc.data().laneIndex || '1', 10) === numLane) {
            await pDoc.ref.update({ imageUrl: cleanImg, updatedAt: new Date() }).catch(() => {});
            updatedPostsCount++;
          }
        }
      }

      appendClickTerminalLog(
        userId,
        numLane,
        cleanImg
          ? `📸 Applied eye-catching promo image across ${updatedPostsCount} post template(s) & OGP card!`
          : `🧹 Cleared promo image from Lane #0${numLane} templates.`
      );

      return res.json({
        ok: true,
        laneIndex: numLane,
        imageUrl: cleanImg,
        updatedPostsCount,
        trackingShortUrl
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 7. クッションクリック計測URL (/go/:slug) のON/OFF切替＆即時発行API
  app.post('/api/funnel/toggle-click-tracker', async (req, res) => {
    try {
      const userId = await resolveUserId(req, res);
      if (res.headersSent) return;
      if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required.' });

      const { laneIndex, enabled, destinationUrl, ogpTitle, ogpDescription } = req.body || {};
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const lKey = String(numLane);

      const uRef = db.collection('saas_users').doc(userId);
      const uSnap = await uRef.get();
      const uData = uSnap.exists ? (uSnap.data() || {}) : {};
      const lanes = uData.lanes || {};
      if (!lanes[lKey]) lanes[lKey] = { laneIndex: numLane };

      const targetDest = String(destinationUrl || lanes[lKey].aiAffiliateUrl || '').trim();
      const turnOn = Boolean(enabled);

      let shortUrl = lanes[lKey].trackingShortUrl || '';
      if (targetDest && /^https?:\/\//i.test(targetDest)) {
        lanes[lKey].aiAffiliateUrl = targetDest;
        const tr = await ensureLaneTrackingLink({
          db,
          userId,
          laneIndex: numLane,
          destinationUrl: targetDest,
          title: ogpTitle || lanes[lKey].aiProductDesc || 'Official Access',
          description: ogpDescription || lanes[lKey].profileBio || '',
          imageUrl: lanes[lKey].defaultPromoImageUrl || '',
          req
        });
        if (tr) shortUrl = tr.shortUrl;
      }

      lanes[lKey].useClickTracker = turnOn;
      lanes[lKey].trackingShortUrl = shortUrl;
      await uRef.set({ lanes, updatedAt: new Date() }, { merge: true });

      return res.json({
        ok: true,
        laneIndex: numLane,
        useClickTracker: turnOn,
        trackingShortUrl: shortUrl
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 8. BIO・表示名・場所欄・アイコン画像 ＆ 看板ポストピン留めのワンクリック即時同期API
  app.post('/api/funnel/instant-sync-persona', async (req, res) => {
    try {
      const userId = await resolveUserId(req, res);
      if (res.headersSent) return;
      if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required.' });

      const { laneIndex, profileBio, personaName, personaLocation, personaAvatarUrl, triggerPinNow } = req.body || {};
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const lKey = String(numLane);

      const uRef = db.collection('saas_users').doc(userId);
      const uSnap = await uRef.get();
      const uData = uSnap.exists ? (uSnap.data() || {}) : {};
      const lanes = uData.lanes || {};
      if (!lanes[lKey]) lanes[lKey] = { laneIndex: numLane };

      if (typeof profileBio === 'string') lanes[lKey].profileBio = profileBio.replace(/\r?\n/g, ' ').trim().slice(0, 155);
      if (typeof personaName === 'string') lanes[lKey].personaName = personaName.trim().slice(0, 48);
      if (typeof personaLocation === 'string') lanes[lKey].personaLocation = personaLocation.trim().slice(0, 30);
      if (typeof personaAvatarUrl === 'string') lanes[lKey].personaAvatarUrl = personaAvatarUrl.trim();

      lanes[lKey].bioSyncPending = true;
      lanes[lKey].bioUpdatedAtMs = Date.now();
      if (triggerPinNow && lanes[lKey].pinnedPost) {
        lanes[lKey].pinSyncPending = true;
        lanes[lKey].aiLastRefreshedAtMs = Date.now();
      }

      await uRef.set({ lanes, updatedAt: new Date() }, { merge: true });

      // 対象レーンの1番手アカウントの lastSyncedBio をクリアして確実に即時同期を発火
      const aSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
      for (const d of aSnap.docs) {
        const ad = d.data() || {};
        if (parseInt(ad.laneIndex || '1', 10) === numLane && ad.isActive !== false) {
          await d.ref.update({ lastSyncedBio: '', updatedAt: new Date() }).catch(() => {});
        }
      }

      appendClickTerminalLog(
        userId,
        numLane,
        `⚡ [Instant Persona Sync] Queued immediate X Profile BIO/Persona update${triggerPinNow ? ' + Flagship Pin' : ''} (executing within ~3s)...`
      );

      return res.json({
        ok: true,
        laneIndex: numLane,
        profileBio: lanes[lKey].profileBio || '',
        pinQueued: Boolean(triggerPinNow && lanes[lKey].pinnedPost)
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 9. 見込み客への営業リプライ / 引用RT をクールダウン無しで今すぐ1回テスト発射する即時トリガーAPI
  app.post('/api/funnel/trigger-outreach-now', async (req, res) => {
    try {
      const userId = await resolveUserId(req, res);
      if (res.headersSent) return;
      if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required.' });

      const { laneIndex, outreachType = 'auto', aiKeywords } = req.body || {};
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const lKey = String(numLane);

      const uRef = db.collection('saas_users').doc(userId);
      const uSnap = await uRef.get();
      const uData = uSnap.exists ? (uSnap.data() || {}) : {};
      const lanes = uData.lanes || {};
      if (!lanes[lKey]) lanes[lKey] = { laneIndex: numLane };

      lanes[lKey].aiReplyMode = true;
      lanes[lKey].isEngineRunning = true;
      lanes[lKey].manualForceOutreachAtMs = Date.now();
      if (typeof aiKeywords === 'string' && aiKeywords.trim()) {
        lanes[lKey].aiKeywords = aiKeywords.trim();
      }

      await uRef.set({
        isEngineRunning: true,
        aiReplyMode: true,
        lanes,
        updatedAt: new Date()
      }, { merge: true });

      const aSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
      let triggeredUsername = '';
      for (const d of aSnap.docs) {
        const ad = d.data() || {};
        const isHealthy = (ad.role === '最新' || ad.role === 'ACTIVE') && ad.isActive !== false;
        if (parseInt(ad.laneIndex || '1', 10) === numLane && isHealthy) {
          let curCount = parseInt(ad.outreachCount || '0', 10);
          if (outreachType === 'quote_rt') {
            while ((curCount + 1) % 4 !== 0) curCount++;
          } else if (outreachType === 'reply' && (curCount + 1) % 4 === 0) {
            curCount++;
          }
          // 通常投稿と衝突しないよう nextPostAt が直近45秒以内なら少し後ろへずらし、営業リプライを3秒以内に最優先発射
          const nextPMs = ad.nextPostAt && ad.nextPostAt.toDate ? ad.nextPostAt.toDate().getTime() : 0;
          const upd = {
            outreachCount: curCount,
            nextOutreachAt: new Date(0),
            lastActionAt: new Date(0),
            updatedAt: new Date()
          };
          if (nextPMs > 0 && nextPMs - Date.now() < 60000) {
            upd.nextPostAt = new Date(Date.now() + 95000);
          }
          await d.ref.update(upd).catch(() => {});
          if (!triggeredUsername && ad.username) triggeredUsername = ad.username;
        }
      }

      if (!triggeredUsername) {
        return res.status(400).json({ ok: false, error: 'No active healthy (#1 Primary) burner in this lane yet.' });
      }

      const label = outreachType === 'quote_rt' ? 'Quote-RT Piggyback' : 'AI Prospecting Search & Reply';
      appendClickTerminalLog(
        userId,
        numLane,
        `🚀 [Instant Outreach Triggered] Firing live ${label} on @${triggeredUsername} within ~3s...`
      );

      return res.json({
        ok: true,
        laneIndex: numLane,
        targetUsername: triggeredUsername,
        outreachType
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });


  // 11. 20パターンの投稿テンプレートを1クリックで新調する鮮度リフレッシュAPI
  app.post('/api/funnel/refresh-campaign-now', async (req, res) => {
    try {
      const userId = await resolveUserId(req, res);
      if (res.headersSent) return;
      if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required.' });

      const { laneIndex } = req.body || {};
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const lKey = String(numLane);

      const uSnap = await db.collection('saas_users').doc(userId).get();
      const uData = uSnap.exists ? (uSnap.data() || {}) : {};
      const laneCfg = (uData.lanes && uData.lanes[lKey]) ? uData.lanes[lKey] : {};

      if (!laneCfg.aiProductDesc || !laneCfg.aiAffiliateUrl) {
        return res.status(400).json({ ok: false, error: 'Configure Q1 Offer & Q2 Destination URL on this lane first.' });
      }

      const result = await refreshLaneCampaignNow({
        db,
        userId,
        laneNo: numLane,
        laneCfg,
        logSaaS: (tag, msg, uid, lNo) => appendClickTerminalLog(uid, lNo, msg)
      });

      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.reason || 'Refresh failed.' });
      }

      return res.json({
        ok: true,
        laneIndex: numLane,
        count: result.count,
        angleNumber: result.angleNumber,
        lang: result.lang
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });


  // 12. レーン個別停止API (他レーンの稼働は維持したまま指定レーンのみ即時停止)
  app.post('/api/funnel/stop-lane', async (req, res) => {
    try {
      const userId = await resolveUserId(req, res);
      if (res.headersSent) return;
      if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required.' });

      const { laneIndex } = req.body || {};
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const lKey = String(numLane);

      const uRef = db.collection('saas_users').doc(userId);
      const uSnap = await uRef.get();
      const uData = uSnap.exists ? (uSnap.data() || {}) : {};
      const lanes = uData.lanes || {};
      if (!lanes[lKey]) lanes[lKey] = { laneIndex: numLane };

      lanes[lKey].lastAiReplyPref = Boolean(lanes[lKey].aiReplyMode);
      lanes[lKey].isEngineRunning = false;
      lanes[lKey].autoPostMode = false;
      lanes[lKey].aiReplyMode = false;
      lanes[lKey].bioSyncPending = false;
      lanes[lKey].pinSyncPending = false;
      lanes[lKey].stoppedAt = new Date();

      const anyOtherRunning = ['1', '2', '3'].some(k => k !== lKey && lanes[k] && lanes[k].isEngineRunning === true && (lanes[k].autoPostMode !== false || lanes[k].aiReplyMode === true));
      const anyReplyRunning = ['1', '2', '3'].some(k => k !== lKey && lanes[k] && lanes[k].isEngineRunning === true && lanes[k].aiReplyMode === true);

      await uRef.set({
        isEngineRunning: anyOtherRunning,
        aiReplyMode: anyReplyRunning,
        lanes,
        updatedAt: new Date()
      }, { merge: true });

      appendClickTerminalLog(userId, numLane, '⏹️ [LANE STOPPED] Autopilot & AI Prospecting paused for Stream Lane #0' + numLane + '.');
      return res.json({ ok: true, laneIndex: numLane, isEngineRunning: false, globalRunning: anyOtherRunning });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 13. レーン個別再開API
  app.post('/api/funnel/resume-lane', async (req, res) => {
    try {
      const userId = await resolveUserId(req, res);
      if (res.headersSent) return;
      if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required.' });

      const { laneIndex, enableAiReply } = req.body || {};
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const lKey = String(numLane);

      const uRef = db.collection('saas_users').doc(userId);
      const uSnap = await uRef.get();
      const uData = uSnap.exists ? (uSnap.data() || {}) : {};
      const lanes = uData.lanes || {};
      if (!lanes[lKey]) lanes[lKey] = { laneIndex: numLane };

      const replyOn = typeof enableAiReply === 'boolean'
        ? enableAiReply
        : (typeof lanes[lKey].lastAiReplyPref === 'boolean' ? lanes[lKey].lastAiReplyPref : true);

      lanes[lKey].isEngineRunning = true;
      lanes[lKey].autoPostMode = true;
      lanes[lKey].aiReplyMode = replyOn;
      lanes[lKey].updatedAt = new Date();

      await uRef.set({
        isEngineRunning: true,
        aiReplyMode: replyOn || Boolean(uData.aiReplyMode),
        lanes,
        updatedAt: new Date()
      }, { merge: true });

      const aSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
      for (const d of aSnap.docs) {
        const ad = d.data() || {};
        if (parseInt(ad.laneIndex || '1', 10) === numLane && ad.isActive !== false) {
          await d.ref.update({
            nextPostAt: new Date(0),
            nextOutreachAt: new Date(Date.now() + 90 * 1000),
            updatedAt: new Date()
          }).catch(() => {});
        }
      }

      appendClickTerminalLog(
        userId,
        numLane,
        '▶️ [LANE RESUMED] Stream Lane #0' + numLane + ' is now LIVE (Interval: ' + (lanes[lKey].postIntervalMin || 30) + 'm | AI Replies: ' + (replyOn ? 'ON' : 'OFF') + ')!'
      );
      return res.json({ ok: true, laneIndex: numLane, isEngineRunning: true, aiReplyMode: replyOn });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 14. 全3レーン一括緊急停止API
  app.post('/api/funnel/stop-all-lanes', async (req, res) => {
    try {
      const userId = await resolveUserId(req, res);
      if (res.headersSent) return;
      if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required.' });

      const uRef = db.collection('saas_users').doc(userId);
      const uSnap = await uRef.get();
      const uData = uSnap.exists ? (uSnap.data() || {}) : {};
      const lanes = uData.lanes || {};

      for (const k of ['1', '2', '3']) {
        if (!lanes[k]) lanes[k] = { laneIndex: parseInt(k, 10) };
        lanes[k].lastAiReplyPref = Boolean(lanes[k].aiReplyMode);
        lanes[k].isEngineRunning = false;
        lanes[k].autoPostMode = false;
        lanes[k].aiReplyMode = false;
        lanes[k].bioSyncPending = false;
        lanes[k].pinSyncPending = false;
        appendClickTerminalLog(userId, k, '🛑 [EMERGENCY STOP ALL] All Stream Lanes paused immediately by operator.');
      }

      await uRef.set({
        isEngineRunning: false,
        aiReplyMode: false,
        lanes,
        updatedAt: new Date()
      }, { merge: true });

      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 15. 指定レーンのターミナル表示ログ消去API
  app.post('/api/funnel/clear-terminal-log', async (req, res) => {
    try {
      const userId = await resolveUserId(req, res);
      if (res.headersSent) return;
      if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required.' });

      const { laneIndex } = req.body || {};
      const numLane = Math.min(3, Math.max(1, parseInt(laneIndex || '1', 10)));
      const cleanUid = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
      const logFile = '/tmp/xsw_term_' + cleanUid + '_L' + numLane + '.json';
      fs.writeFileSync(logFile, JSON.stringify([]), 'utf8');
      appendClickTerminalLog(userId, numLane, '🧹 Terminal log cleared. Ready for live events on Stream Lane #0' + numLane + '.');
      return res.json({ ok: true, laneIndex: numLane });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 10. リアルタイムクリック統計の単体取得API
  app.get('/api/funnel/click-stats', async (req, res) => {
    try {
      const userId = await resolveUserId(req, res);
      if (res.headersSent) return;
      if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required.' });
      return res.json({ ok: true, clickStats: getClickStatsForUser(userId, {}) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = {
  UPLOADS_DIR,
  ensureLaneTrackingLink,
  getClickStatsForUser,
  applyTrackingUrlToReplyText,
  registerPhase4FunnelRoutes
};
