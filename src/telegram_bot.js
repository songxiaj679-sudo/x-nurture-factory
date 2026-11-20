require('dotenv').config();
const https = require('https');
const crypto = require('crypto');
const { db } = require('./firestore');
const { getWiseConfig, buildWiseOrderSpec, checkWiseOrderPaidViaApi } = require('./wise_payment');

const TG_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
if (!TG_BOT_TOKEN) {
  console.error('[Telegram] TELEGRAM_BOT_TOKEN is not configured; Telegram messaging is disabled.');
}
const TG_BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || 'xswarm_cloud_2026_bot').trim();
const TG_CHANNEL_URL = (process.env.TELEGRAM_CHANNEL_URL || 'https://t.me/+VykLvPhsU3AyZjNl').trim();

const TG_PLANS = {
  oneday: {
    id: 'oneday',
    title: '🔥 24-Hour Test Drive ($7)',
    titleZh: '🔥 24小时全功能实测体验 ($7)',
    titleJa: '🔥 24時間テストドライブ ($7)',
    usd: 7, jpy: 1080, threads: 1, accounts: 3, isp: 1, minInt: 5, days: 1,
    desc: '1 Active Stream + 2 Backup Slots + 1 Built-in Country IP (24h)',
    descZh: '1个并发工作流 + 2个备用轮换槽位(共3号) + 1条内置独享住宅ISP代理 (24小时)',
    descJa: '1枠同時稼働 + 予備待機2枠(計3垢) + 専用固定ISPプロキシ1本 (24時間)'
  },
  starter: {
    id: 'starter',
    title: '🚀 Solo Starter ($79 / 30 Days)',
    titleZh: '🚀 个人起步版 ($79 / 30天)',
    titleJa: '🚀 ソロスターター ($79 / 30日間)',
    usd: 79, jpy: 12200, threads: 1, accounts: 10, isp: 1, minInt: 5, days: 30,
    desc: '1 Active Stream + 9 Backup Slots + 1 Dedicated Country IP (30d)',
    descZh: '1个并发工作流 + 9个备用轮换槽位(共10号) + 1条独享静态ISP住宅IP (30天)',
    descJa: '1枠同時稼働 + 予備待機9枠(計10垢) + 専用固定ISPプロキシ1本 (30日間)'
  },
  pro: {
    id: 'pro',
    title: '👑 Agency Pro ($179 / 30 Days)',
    titleZh: '👑 工作室专业版 ($179 / 30天)',
    titleJa: '👑 エージェンシーPro ($179 / 30日間)',
    usd: 179, jpy: 27700, threads: 3, accounts: 30, isp: 3, minInt: 5, days: 30,
    desc: '3 Simultaneous Streams + 27 Backup Slots + 3 Dedicated IPs (30d)',
    descZh: '3个并发工作流 + 27个备用轮换槽位(共30号) + 3条独享静态ISP住宅IP (30天)',
    descJa: '3枠同時並行稼働 + 予備待機27枠(計30垢) + 専用固定ISPプロキシ3本 (30日間)'
  },
  business: {
    id: 'business',
    title: '🏢 Syndicate Farm ($399 / 30 Days)',
    titleZh: '🏢 矩阵大户旗舰版 ($399 / 30天)',
    titleJa: '🏢 シンジケートFarm ($399 / 30日間)',
    usd: 399, jpy: 61800, threads: 8, accounts: 100, isp: 8, minInt: 5, days: 30,
    desc: '8 Simultaneous Streams + 92 Backup Slots + 8 Dedicated IPs (30d)',
    descZh: '8个并发工作流 + 92个备用轮换槽位(共100号) + 8条独享静态ISP住宅IP (30天)',
    descJa: '8枠同時並行稼働 + 予備待機92枠(計100垢) + 専用固定ISPプロキシ8本 (30日間)'
  }
};

const COUNTRIES = [
  { code: 'US', label: '🇺🇸 USA', labelZh: '🇺🇸 美国(US)', labelJa: '🇺🇸 アメリカ(US)' },
  { code: 'GB', label: '🇬🇧 UK', labelZh: '🇬🇧 英国(UK)', labelJa: '🇬🇧 イギリス(UK)' },
  { code: 'DE', label: '🇩🇪 Germany', labelZh: '🇩🇪 德国(DE)', labelJa: '🇩🇪 ドイツ(DE)' },
  { code: 'NL', label: '🇳🇱 Netherlands', labelZh: '🇳🇱 荷兰(NL)', labelJa: '🇳🇱 オランダ(NL)' },
  { code: 'CA', label: '🇨🇦 Canada', labelZh: '🇨🇦 加拿大(CA)', labelJa: '🇨🇦 カナダ(CA)' },
  { code: 'AU', label: '🇦🇺 Australia', labelZh: '🇦🇺 澳洲(AU)', labelJa: '🇦🇺 豪州(AU)' },
  { code: 'SG', label: '🇸🇬 Singapore', labelZh: '🇸🇬 新加坡(SG)', labelJa: '🇸🇬 シンガポール(SG)' },
  { code: 'HK', label: '🇭🇰 Hong Kong', labelZh: '🇭🇰 香港(HK)', labelJa: '🇭🇰 香港(HK)' },
  { code: 'TW', label: '🇹🇼 Taiwan', labelZh: '🇹🇼 台湾(TW)', labelJa: '🇹🇼 台湾(TW)' },
  { code: 'JP', label: '🇯🇵 Japan', labelZh: '🇯🇵 日本(JP)', labelJa: '🇯🇵 日本(JP)' }
];

const INTERVAL_OPTIONS = [5, 15, 30, 60, 120, 240];

function normalizeLang(lang) {
  const s = String(lang || 'en').toLowerCase();
  if (s.startsWith('zh')) return 'zh';
  if (s.startsWith('ja')) return 'ja';
  return 'en';
}

function isFreePlanUser(user) {
  return !user || !user.planId || user.planId === 'free' || (user.ispQuota || 0) <= 0;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function httpsJson(hostname, reqPath, method, payload, extraHeaders = {}, timeoutMs = 35000) {
  return new Promise((resolve) => {
    const data = payload ? JSON.stringify(payload) : '';
    const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json', ...extraHeaders };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request({ hostname, path: reqPath, method, headers, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    if (data) req.write(data);
    req.end();
  });
}

function tgApi(method, payload, timeoutMs = 20000) {
  if (!TG_BOT_TOKEN) return Promise.resolve(null);
  return httpsJson('api.telegram.org', '/bot' + TG_BOT_TOKEN + '/' + method, 'POST', payload, {}, timeoutMs);
}

async function provisionIspProxiesForTelegramOrder(userId, countNeeded, targetCountry = 'US', durationDays = 30) {
  if (!countNeeded || countNeeded <= 0) return [];
  const cleanCountry = String(targetCountry || 'US').toUpperCase();
  const days = parseInt(durationDays || '30', 10);
  const allocated = [];
  try {
    let iproyalToken = (process.env.IPROYAL_API_TOKEN || '').trim();
    const cfgDoc = await db.collection('settings').doc('payment_config').get().catch(() => null);
    if (cfgDoc && cfgDoc.exists && cfgDoc.data().iproyalApiToken) iproyalToken = cfgDoc.data().iproyalApiToken.trim();

    if (days >= 30 && iproyalToken) {
      const orderPayload = { product_id: 2, plan_id: 30, quantity: countNeeded, country: cleanCountry.toLowerCase(), auto_extend: false };
      const endpoints = [
        { host: 'resi-api.iproyal.com', path: '/v1/orders', headers: { 'Authorization': 'Bearer ' + iproyalToken, 'X-Access-Token': iproyalToken } },
        { host: 'api.iproyal.com', path: '/v1/reseller/orders', headers: { 'X-Access-Token': iproyalToken, 'Authorization': 'Bearer ' + iproyalToken } }
      ];
      for (const ep of endpoints) {
        const res = await httpsJson(ep.host, ep.path, 'POST', orderPayload, ep.headers, 15000);
        const list = (res && (res.proxies || (res.data && res.data.proxies))) || [];
        if (Array.isArray(list) && list.length > 0) {
          for (const item of list) {
            const pStr = typeof item === 'string' ? item.trim() : ((item.ip || item.host) + ':' + (item.port || 12323) + ':' + (item.username || item.user) + ':' + (item.password || item.pass));
            if (pStr && pStr.includes(':')) {
              allocated.push(pStr);
              await db.collection('isp_proxy_pool').add({
                proxy: pStr,
                country: cleanCountry,
                source: 'iproyal_auto_30d_tg',
                assignedUserId: userId,
                assignedCountry: cleanCountry,
                assignedAt: new Date(),
                expiresAt: new Date(Date.now() + 30 * 86400000),
                createdAt: new Date()
              });
            }
          }
          break;
        }
      }
    }

    if (allocated.length < countNeeded) {
      const allPoolSnap = await db.collection('isp_proxy_pool').get();
      const nowMs = Date.now();
      const validDocs = allPoolSnap.docs.filter(d => {
        const data = d.data();
        if (!data.proxy) return false;
        const expMs = data.expiresAt && data.expiresAt.toDate ? data.expiresAt.toDate().getTime() : (nowMs + 86400000);
        return expMs > nowMs;
      });
      const freeDocs = validDocs.filter(d => !d.data().assignedUserId).sort((a, b) => {
        const ca = String(a.data().country || 'JP').toUpperCase() === cleanCountry ? 0 : 1;
        const cb = String(b.data().country || 'JP').toUpperCase() === cleanCountry ? 0 : 1;
        return ca - cb;
      });
      for (const doc of freeDocs) {
        if (allocated.length >= countNeeded) break;
        const claimed = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          if (!fresh.exists || fresh.data().assignedUserId !== null) return null;
          const pStr = fresh.data().proxy;
          tx.update(doc.ref, { assignedUserId: userId, assignedCountry: cleanCountry, assignedPlanDays: days, assignedAt: new Date() });
          return pStr;
        }).catch(() => null);
        if (claimed && !allocated.includes(claimed)) allocated.push(claimed);
      }
      if (allocated.length < countNeeded && validDocs.length > 0) {
        for (const doc of validDocs) {
          if (allocated.length >= countNeeded) break;
          const pStr = doc.data().proxy;
          if (pStr && !allocated.includes(pStr)) allocated.push(pStr);
        }
      }
    }
  } catch (e) {}
  return allocated;
}

async function createOxaPayUsdInvoice(orderId, usdAmount) {
  let oxaKey = (process.env.OXAPAY_MERCHANT_KEY || '').trim();
  try {
    const cfg = await db.collection('settings').doc('payment_config').get();
    if (cfg.exists && cfg.data().oxapayMerchantKey) oxaKey = cfg.data().oxapayMerchantKey.trim();
  } catch (e) {}
  if (!oxaKey) return null;

  const v1 = await httpsJson('api.oxapay.com', '/v1/payment/invoice', 'POST', {
    amount: usdAmount,
    currency: 'USD',
    lifetime: 60,
    fee_paid_by_payer: 0,
    under_paid_coverage: 2.5,
    return_url: 'https://t.me/' + TG_BOT_USERNAME,
    order_id: orderId,
    description: 'X-Swarm Cloud ' + orderId + ' ($' + usdAmount + ' USD)'
  }, { 'merchant_api_key': oxaKey });

  if (v1 && v1.data && (v1.data.payment_url || v1.data.pay_link)) {
    return { payLink: v1.data.payment_url || v1.data.pay_link, trackId: String(v1.data.track_id || v1.data.trackId || '') };
  }
  const d = await httpsJson('api.oxapay.com', '/merchants/request', 'POST', {
    merchant: oxaKey,
    amount: usdAmount,
    currency: 'USD',
    lifeTime: 60,
    returnUrl: 'https://t.me/' + TG_BOT_USERNAME,
    orderId,
    description: 'X-Swarm Cloud ' + orderId
  });
  return (d && d.payLink) ? { payLink: d.payLink, trackId: String(d.trackId || '') } : null;
}

function getMainKeyboard(country = 'US', isRunning = false, intervalMin = 30, rawLang = 'en', isFree = true) {
  const lang = normalizeLang(rawLang);
  const cObj = COUNTRIES.find(c => c.code === country) || COUNTRIES[0];

  if (lang === 'zh') {
    const ipBtn = isFree ? '🔒 代理IP: 系统自动分配' : ('🌍 代理国家: ' + cObj.labelZh);
    return {
      inline_keyboard: [
        [
          { text: '➕ 1. 添加推特Token小号', callback_data: 'wiz_add_token' },
          { text: '✍️ 2. 设置发帖文案', callback_data: 'wiz_add_post' }
        ],
        [
          { text: '🔗 3. 设置简介(Bio)链接', callback_data: 'wiz_set_bio' },
          { text: isRunning ? '🟢 4. 运行中 (点击暂停)' : '▶️ 4. 启动24h全自动发帖', callback_data: 'toggle_engine' }
        ],
        [
          { text: '⏱️ 发帖间隔: 每 ' + intervalMin + ' 分钟', callback_data: 'cycle_interval' },
          { text: ipBtn, callback_data: 'cycle_country' }
        ],
        [
          { text: '📊 账号与队列状态', callback_data: 'view_status' },
          { text: '⚖️ 免责声明与规则', callback_data: 'view_disclaimer' }
        ],
        [
          { text: '❓ 新手买号与Token教程', callback_data: 'help_beginner' },
          { text: '🌐 语言: 🇨🇳中文 / EN / JA', callback_data: 'switch_lang' }
        ],
        [{ text: '🔥 立即开通 $7 (24小时) 实测体验 →', callback_data: 'buy_oneday' }],
        [{ text: '💎 查看包月套餐 ($79 / $179 / $399)', callback_data: 'menu_plans' }]
      ]
    };
  }

  if (lang === 'ja') {
    const ipBtn = isFree ? '🔒 IP: 自動割当 (変更不可)' : ('🌍 IP国: ' + cObj.labelJa);
    return {
      inline_keyboard: [
        [
          { text: '➕ 1. 使い捨て垢(Token)追加', callback_data: 'wiz_add_token' },
          { text: '✍️ 2. 投稿テキスト設定', callback_data: 'wiz_add_post' }
        ],
        [
          { text: '🔗 3. プロフ(Bio)設定', callback_data: 'wiz_set_bio' },
          { text: isRunning ? '🟢 4. 稼働中 (タップで停止)' : '▶️ 4. 24h自動投稿スタート', callback_data: 'toggle_engine' }
        ],
        [
          { text: '⏱️ 投稿間隔: ' + intervalMin + '分おき', callback_data: 'cycle_interval' },
          { text: ipBtn, callback_data: 'cycle_country' }
        ],
        [
          { text: '📊 アカウント＆投稿履歴・削除', callback_data: 'view_status' },
          { text: '⚖️ 免責事項・利用規約', callback_data: 'view_disclaimer' }
        ],
        [
          { text: '❓ 初心者ガイド(垢購入・Token)', callback_data: 'help_beginner' },
          { text: '🌐 言語: 🇯🇵日本語 / EN / 中文', callback_data: 'switch_lang' }
        ],
        [{ text: '🔥 $7 (24時間) テスト体験を開通 →', callback_data: 'buy_oneday' }],
        [{ text: '💎 月額プラン一覧 ($79 / $179 / $399)', callback_data: 'menu_plans' }]
      ]
    };
  }

  const ipBtnEn = isFree ? '🔒 IP: Auto-Assigned' : ('🌍 IP: ' + cObj.label);
  return {
    inline_keyboard: [
      [
        { text: '➕ 1. Add Burner Account', callback_data: 'wiz_add_token' },
        { text: '✍️ 2. Set Post Text', callback_data: 'wiz_add_post' }
      ],
      [
        { text: '🔗 3. Set Bio Link', callback_data: 'wiz_set_bio' },
        { text: isRunning ? '🟢 4. RUNNING (Tap to Stop)' : '▶️ 4. START AUTO-POSTING', callback_data: 'toggle_engine' }
      ],
      [
        { text: '⏱️ Interval: Every ' + intervalMin + 'm', callback_data: 'cycle_interval' },
        { text: ipBtnEn, callback_data: 'cycle_country' }
      ],
      [
        { text: '📊 My Accounts & Queue', callback_data: 'view_status' },
        { text: '⚖️ Disclaimer & Rules', callback_data: 'view_disclaimer' }
      ],
      [
        { text: '❓ Beginner Guide', callback_data: 'help_beginner' },
        { text: '🌐 Lang: 🇺🇸EN / 🇨🇳中文 / 🇯🇵JA', callback_data: 'switch_lang' }
      ],
      [{ text: '🔥 Unlock $7 (24h) Test Drive →', callback_data: 'buy_oneday' }],
      [{ text: '💎 View 30-Day Plans ($79 / $179 / $399)', callback_data: 'menu_plans' }]
    ]
  };
}

function getPlansKeyboard(country = 'US', rawLang = 'en') {
  const lang = normalizeLang(rawLang);
  const cObj = COUNTRIES.find(c => c.code === country) || COUNTRIES[0];
  if (lang === 'zh') {
    return {
      inline_keyboard: [
        [{ text: '🌍 购买套餐的独享IP国家: ' + cObj.labelZh + ' (点击切换)', callback_data: 'cycle_country_plans' }],
        [{ text: '🔥 24小时实测体验 — $7 (1并发 + 2备用槽 + 1条IP)', callback_data: 'buy_oneday' }],
        [{ text: '🚀 个人起步版 — $79/30天 (1并发 + 9备用槽 + 1条独享IP)', callback_data: 'buy_starter' }],
        [{ text: '👑 工作室专业版 — $179/30天 (3并发 + 27备用槽 + 3条独享IP)', callback_data: 'buy_pro' }],
        [{ text: '🏢 矩阵旗舰版 — $399/30天 (8并发 + 92备用槽 + 8条独享IP)', callback_data: 'buy_business' }],
        [{ text: '⚖️ 购买前必读：免责声明与防封规则', callback_data: 'view_disclaimer' }],
        [{ text: '← 返回主控面板', callback_data: 'back_home' }]
      ]
    };
  }
  if (lang === 'ja') {
    return {
      inline_keyboard: [
        [{ text: '🌍 契約する専用ISPプロキシ国: ' + cObj.labelJa + ' (タップで切替)', callback_data: 'cycle_country_plans' }],
        [{ text: '🔥 24時間テスト体験 — $7 (1枠稼働 + 予備2枠 + 固定IP 1本)', callback_data: 'buy_oneday' }],
        [{ text: '🚀 ソロスターター — $79/30日 (1枠稼働 + 予備9枠 + 専用IP 1本)', callback_data: 'buy_starter' }],
        [{ text: '👑 エージェンシーPro — $179/30日 (3枠同時 + 予備27枠 + 専用IP 3本)', callback_data: 'buy_pro' }],
        [{ text: '🏢 シンジケートFarm — $399/30日 (8枠同時 + 予備92枠 + 専用IP 8本)', callback_data: 'buy_business' }],
        [{ text: '⚖️ 購入前必読：免責事項・利用規約', callback_data: 'view_disclaimer' }],
        [{ text: '← コントロールパネルへ戻る', callback_data: 'back_home' }]
      ]
    };
  }
  return {
    inline_keyboard: [
      [{ text: '🌍 Target Plan ISP Country: ' + cObj.label + ' (Tap to Switch)', callback_data: 'cycle_country_plans' }],
      [{ text: '🔥 24h Test Drive — $7 (1 Active + 2 Backups + 1 IP)', callback_data: 'buy_oneday' }],
      [{ text: '🚀 Solo Starter — $79/30d (1 Active + 9 Backups + 1 IP)', callback_data: 'buy_starter' }],
      [{ text: '👑 Agency Pro — $179/30d (3 Active + 27 Backups + 3 IPs)', callback_data: 'buy_pro' }],
      [{ text: '🏢 Syndicate Farm — $399/30d (8 Active + 92 Backups + 8 IPs)', callback_data: 'buy_business' }],
      [{ text: '⚖️ Read Mandatory Disclaimer Before Buying', callback_data: 'view_disclaimer' }],
      [{ text: '← Back to Control Panel', callback_data: 'back_home' }]
    ]
  };
}

function getFullDisclaimerText(rawLang = 'en') {
  const lang = normalizeLang(rawLang);
  if (lang === 'zh') {
    return '⚖️ <b>必读免责声明与风险自担协议 (MANDATORY DISCLAIMER)</b>\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      '1️⃣ <b>发帖间隔与约2小时Shadowban实测规律：</b>\n' +
      '• 发帖间隔设置得越短，触发X(推特)Shadowban的概率越高（高频短间隔下实测<b>约2小时左右</b>会被判定Shadowban）。这是由X官方算法决定的，本平台无法控制也概不负责。\n\n' +
      '2️⃣ <b>必须使用购买的“一次性Token小号”（严禁使用个人主号）：</b>\n' +
      '• 请仅使用购买的已解除Shadowban的一次性小号。<b>严禁使用个人主号！</b>无论主号或购买的小号发生Shadowban、锁号或封号，<b>本平台概不关知，亦不提供任何赔偿（风险自负）。</b>\n\n' +
      '3️⃣ <b>修改资料风险：</b>\n' +
      '• 修改昵称(Name)或头像极易触发X二次审核导致限流，强烈建议只改个人简介(Bio)或保持原样。\n\n' +
      '4️⃣ <b>概不退款 (No Refunds)：</b>\n' +
      '• 所有USDT/加密货币付款一旦完成，在任何情况下均不予退款。';
  }
  if (lang === 'ja') {
    return '⚖️ <b>免責事項・利用規約（必ずお読みください）</b>\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      '1️⃣ <b>投稿間隔とシャドウバン確率（実測約2時間）について：</b>\n' +
      '• 短い投稿間隔に設定するほどシャドウバンになる確率が上がります（一般的な実測値として約2時間でシャドウバン判定を受けるケースがあります）。これはX側のアルゴリズムによって決定されるため、当社ではわかりかねます。すべて自己責任でご利用ください。\n\n' +
      '2️⃣ <b>使い捨ての購入アカウント限定（本アカウント使用厳禁）：</b>\n' +
      '• 必ず購入した「シャドウバン解除済みの使い捨てアカウント」をご使用ください。<b>ご自身の本アカウント（メイン垢）は絶対に使用しないでください。</b>万が一、本アカウントや購入アカウントがシャドウバンや凍結になっても、当社は一切関知・補償いたしません（完全自己責任）。\n\n' +
      '3️⃣ <b>プロフィール変更リスク：</b>\n' +
      '• 名前やアイコン画像の変更はシャドウバンを誘発するため、Bio（自己紹介文）のみの変更を推奨します。\n\n' +
      '4️⃣ <b>返金不可（No Refunds）：</b>\n' +
      '• 暗号資産決済完了後の返金・キャンセルにはいかなる理由でも一切応じられません。';
  }
  return '⚖️ <b>MANDATORY DISCLAIMER & ASSUMPTION OF RISK</b>\n' +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    '1️⃣ <b>Short Intervals & ~2-Hour Shadowban Reality:</b>\n' +
    '• The shorter your posting interval, the higher the probability of being shadowbanned by X (~2 hours empirical benchmark at short intervals). Decided solely by X; we assume zero responsibility.\n\n' +
    '2️⃣ <b>Purchased Disposable Burner Accounts ONLY (Never Use Main Account):</b>\n' +
    '• Use ONLY purchased, shadowban-cleared disposable burner accounts. <b>NEVER use your personal main account.</b> Even if your main or purchased account gets shadowbanned or suspended, <b>we have zero involvement and provide zero compensation. Use at your own risk.</b>\n\n' +
    '3️⃣ <b>Profile Edit Risk & No-Refund Policy:</b>\n' +
    '• Changing Display Name/Avatar triggers shadowbans (Bio only is recommended). All crypto payments are final and non-refundable.';
}

async function ensureTgUser(chatId, fromUser, forceLang = null) {
  const userId = 'TG-' + String(chatId);
  const ref = db.collection('saas_users').doc(userId);
  const snap = await ref.get();
  const rawCode = (fromUser && fromUser.language_code) ? String(fromUser.language_code).toLowerCase() : 'en';
  const detectedLang = rawCode.startsWith('zh') ? 'zh' : (rawCode.startsWith('ja') ? 'ja' : 'en');

  if (!snap.exists) {
    const name = (fromUser && (fromUser.username || fromUser.first_name)) || ('User_' + String(chatId).slice(-4));
    const newData = {
      userId,
      tgChatId: chatId,
      name,
      lang: forceLang || detectedLang,
      email: userId.toLowerCase() + '@telegram.local',
      ispCountry: 'US',
      botInputStep: '',
      pendingConfirm: null,
      kycStatus: 'verified',
      planId: 'free',
      planName: 'Free Preview Tier',
      planStatus: 'active',
      maxThreads: 1,
      maxAccounts: 1,
      ispQuota: 0,
      minIntervalMin: 1440,
      postIntervalMin: 30,
      assignedProxies: [],
      profileBio: '',
      isEngineRunning: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await ref.set(newData);
    return newData;
  }
  const data = snap.data() || {};
  if (forceLang && data.lang !== forceLang) {
    await ref.update({ lang: forceLang, updatedAt: new Date() });
    data.lang = forceLang;
  }
  if (!data.lang) data.lang = detectedLang;
  return data;
}

async function buildDashboardMessage(user) {
  const lang = normalizeLang(user.lang);
  const isFree = isFreePlanUser(user);
  const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', user.userId).get();
  const postSnap = await db.collection('saas_posts').where('ownerUserId', '==', user.userId).get();
  const cObj = COUNTRIES.find(c => c.code === (user.ispCountry || 'US')) || COUNTRIES[0];
  const intMin = user.postIntervalMin || 30;

  if (lang === 'zh') {
    const ipStr = isFree ? '🔒 系统自动分配 (升级付费套餐可自选国家)' : cObj.labelZh;
    const s1 = accSnap.size > 0
      ? ('✅ <b>1. 推特Token小号:</b> 已添加 ' + accSnap.size + ' 个 (上限 ' + (user.maxAccounts || 1) + ' 个)')
      : '❌ <b>1. 推特Token小号:</b> 未添加 <i>(点击 [➕ 1. 添加推特Token小号])</i>';
    const s2 = postSnap.size > 0
      ? ('✅ <b>2. 循环发帖文案:</b> 已保存 ' + postSnap.size + ' 条模板')
      : '❌ <b>2. 循环发帖文案:</b> 未设置 <i>(点击 [✍️ 2. 设置发帖文案])</i>';
    const s3 = user.profileBio
      ? ('✅ <b>3. 个人简介(Bio):</b> <code>' + escapeHtml(user.profileBio.slice(0, 32)) + (user.profileBio.length > 32 ? '...' : '') + '</code>')
      : '⚪ <b>3. 个人简介(Bio):</b> 保持原样 <i>(点击 [🔗 3. 设置简介链接])</i>';
    const s4 = user.isEngineRunning ? '🟢 <b>4. 云端引擎:</b> <b>24h全自动运行中</b>' : '🔴 <b>4. 云端引擎:</b> <b>已暂停</b>';

    return '⚡ <b>X-SWARM CLOUD — 推特矩阵24h全自动防封主控台</b>\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      '📦 <b>当前套餐:</b> ' + (user.planName || '免费预览版') + '\n' +
      '🌍 <b>代理IP:</b> ' + ipStr + '\n' +
      '⏱️ <b>发帖间隔:</b> 每 <b>' + intMin + ' 分钟</b>\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      s1 + '\n' + s2 + '\n' + s3 + '\n' + s4 + '\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      '⚠️ <b>重要防封与免责铁律（风险自负）：</b>\n' +
      '• 发帖间隔越短，触发Shadowban概率越高（短间隔实测<b>约2小时</b>，由X官方决定，本平台概不关知）。\n' +
      '• <b>请务必使用购买的一次性Token小号！严禁使用个人主号！</b>任何封号或限流本平台概不负责。';
  }

  if (lang === 'ja') {
    const ipStr = isFree ? '🔒 システム自動割当 (有料プランで国選択可)' : cObj.labelJa;
    const s1 = accSnap.size > 0
      ? ('✅ <b>1. 使い捨て垢:</b> ' + accSnap.size + '個 登録済 (上限 ' + (user.maxAccounts || 1) + '個)')
      : '❌ <b>1. 使い捨て垢:</b> 未登録 <i>([➕ 1. 使い捨て垢追加]をタップ)</i>';
    const s2 = postSnap.size > 0
      ? ('✅ <b>2. 投稿テキスト:</b> ' + postSnap.size + '件 保存済')
      : '❌ <b>2. 投稿テキスト:</b> 未設定 <i>([✍️ 2. 投稿テキスト設定]をタップ)</i>';
    const s3 = user.profileBio
      ? ('✅ <b>3. Bioリンク:</b> <code>' + escapeHtml(user.profileBio.slice(0, 32)) + (user.profileBio.length > 32 ? '...' : '') + '</code>')
      : '⚪ <b>3. Bioリンク:</b> 変更なし <i>([🔗 3. プロフ設定]をタップ)</i>';
    const s4 = user.isEngineRunning ? '🟢 <b>4. 稼働状態:</b> <b>24時間自動稼働中</b>' : '🔴 <b>4. 稼働状態:</b> <b>停止中</b>';

    return '⚡ <b>X-SWARM CLOUD — かんたん4ステップ操作パネル</b>\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      '📦 <b>プラン:</b> ' + (user.planName || '無料プレビュー') + '\n' +
      '🌍 <b>固定IP:</b> ' + ipStr + '\n' +
      '⏱️ <b>投稿間隔:</b> <b>' + intMin + '分おき</b>\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      s1 + '\n' + s2 + '\n' + s3 + '\n' + s4 + '\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n' +
      '⚠️ <b>重要ルール（完全自己責任）：</b>\n' +
      '• 短い投稿間隔にするほどシャドウバン確率が上がります（実測値として<b>約2時間</b>・X側の決定のため当社は一切関知いたしません）。\n' +
      '• <b>必ず購入した使い捨てアカウントをご使用ください（本垢使用厳禁）。</b>凍結・制限について当社は一切関知いたしません。';
  }

  const ipDisplayEn = isFree ? '🔒 Auto-Assigned (Upgrade to choose country)' : cObj.label;
  const step1 = accSnap.size > 0
    ? ('✅ <b>1. Burner Accounts:</b> ' + accSnap.size + ' loaded (Max ' + (user.maxAccounts || 1) + ')')
    : '❌ <b>1. Burner Accounts:</b> None <i>(Tap [➕ 1. Add Burner Account])</i>';
  const step2 = postSnap.size > 0
    ? ('✅ <b>2. Post Texts:</b> ' + postSnap.size + ' templates ready')
    : '❌ <b>2. Post Texts:</b> None <i>(Tap [✍️ 2. Set Post Text])</i>';
  const step3 = user.profileBio
    ? ('✅ <b>3. Bio Link:</b> <code>' + escapeHtml(user.profileBio.slice(0, 32)) + (user.profileBio.length > 32 ? '...' : '') + '</code>')
    : '⚪ <b>3. Bio Link:</b> Unchanged <i>(Tap [🔗 3. Set Bio Link] to set)</i>';
  const step4 = user.isEngineRunning ? '🟢 <b>4. Status:</b> <b>RUNNING 24/7</b>' : '🔴 <b>4. Status:</b> <b>PAUSED</b>';

  return '⚡ <b>X-SWARM CLOUD — EASY 4-STEP CONTROL PANEL</b>\n' +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    '📦 <b>Plan:</b> ' + (user.planName || 'Free Preview Tier') + '\n' +
    '🌍 <b>IP:</b> ' + ipDisplayEn + '\n' +
    '⏱️ <b>Post Interval:</b> Every <b>' + intMin + ' mins</b>\n' +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    step1 + '\n' + step2 + '\n' + step3 + '\n' + step4 + '\n' +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    '⚠️ <b>IMPORTANT RULES (SELF-RESPONSIBILITY):</b>\n' +
    '• Shorter intervals = Higher shadowban probability (~2 hours empirical average, decided by X).\n' +
    '• <b>Use ONLY purchased disposable burner accounts!</b> Never use your main account. We have zero involvement or liability if any account is shadowbanned or suspended.';
}

async function sendChannelPinnedWelcome(channelChatId) {
  const text =
    '⚡ <b>X-SWARM CLOUD — 24/7 X (TWITTER) BURNER ROTATION & AUTO-POSTER</b>\n' +
    '🇨🇳 <b>推特(X) 24小时全自动矩阵发帖 & 防封0秒轮换云引擎</b>\n' +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    '🇺🇸 <b>How It Works:</b> Paste disposable 40-char <code>auth_token</code> accounts ➔ Auto-assigns built-in <b>Country Static Residential ISP IP</b> (US/UK/DE/NL/SG/HK/TW/JP) ➔ Human typing simulation ➔ Checks live search every 3 posts & <b>auto-swaps to your backup account in 0s</b> when shadowbanned!\n\n' +
    '🇨🇳 <b>核心原理：</b> 直接粘贴40位 <code>auth_token</code> 免密直登 ➔ 自动分配<b>各国独享静态ISP住宅IP</b> ➔ 拟人打字防检测 ➔ 每3帖自动用独立检测号核验搜索展示，一旦发现Shadowban限流，<b>0秒全自动无缝切换下一个备用小号</b>，24小时引流不断流！\n\n' +
    '🚨 <b>MANDATORY DISCLAIMER / 必读免责声明 (风险自负):</b>\n' +
    '• <b>Interval & ~2h Shadowban Benchmark:</b> Shorter intervals increase shadowban risk (typically <b>~2 hours</b> at short intervals). Decided solely by X; we have zero involvement.\n' +
    '• <b>Disposable Purchased Accounts ONLY:</b> <b>NEVER use your personal main account!</b> We assume zero responsibility for any shadowbanned or suspended accounts. All USDT payments are final and non-refundable.\n\n' +
    '💎 <b>ALL-INCLUSIVE PRICING (Dedicated ISP Proxy Included):</b>\n' +
    '• 🔥 <b>24h Test Drive: $7</b> (1 Stream / 3 Slots / 1 ISP IP)\n' +
    '• 🚀 <b>Solo Starter (30d): $79</b> (1 Stream / 10 Slots / 1 Dedicated ISP)\n' +
    '• 👑 <b>Agency Pro (30d): $179</b> (3 Parallel / 30 Slots / 3 Dedicated ISPs)\n' +
    '• 🏢 <b>Syndicate Farm (30d): $399</b> (8 Parallel / 100 Slots / 8 Dedicated ISPs)\n\n' +
    '👇 <b>Choose your language below to launch the Bot & start your $7 Test Drive:</b>';

  const sent = await tgApi('sendMessage', {
    chat_id: channelChatId,
    parse_mode: 'HTML',
    text,
    reply_markup: {
      inline_keyboard: [
        [{ text: '🇺🇸 Launch Bot (English) — Start $7 Trial →', url: 'https://t.me/' + TG_BOT_USERNAME + '?start=lang_en' }],
        [{ text: '🇨🇳 启动中文机器人 (简体中文) — $7 立即体验 →', url: 'https://t.me/' + TG_BOT_USERNAME + '?start=lang_zh' }],
        [{ text: '🇯🇵 日本語ボットを起動 — $7 体験スタート →', url: 'https://t.me/' + TG_BOT_USERNAME + '?start=lang_ja' }]
      ]
    }
  });
  if (sent && sent.ok && sent.result && sent.result.message_id) {
    await tgApi('pinChatMessage', { chat_id: channelChatId, message_id: sent.result.message_id, disable_notification: false }).catch(() => {});
  }
}

async function activateTelegramOrder(orderId, order) {
  const now = new Date();
  const userId = order.userId;
  const days = parseInt(order.durationDays || '1', 10);
  const threads = parseInt(order.totalThreads || '1', 10);
  const accounts = parseInt(order.totalMaxAccounts || '3', 10);
  const ispCount = parseInt(order.totalIspCount || '1', 10);
  const country = String(order.ispCountry || 'US').toUpperCase();

  const proxies = await provisionIspProxiesForTelegramOrder(userId, ispCount, country, days);
  const contractId = 'CNT-' + Date.now().toString(36).toUpperCase();
  const expiresAt = new Date(Date.now() + days * 86400000);

  await db.collection('saas_contracts').doc(contractId).set({
    contractId, orderId, userId,
    title: order.planName || 'Telegram Plan',
    threads, accounts, ispCount, minIntervalMin: 5, durationDays: days,
    proxies, status: 'active', startedAt: now, expiresAt, createdAt: now, updatedAt: now
  });

  await db.collection('saas_users').doc(userId).set({
    planId: order.planId || 'oneday',
    planName: order.planName || 'Active Plan',
    planStatus: 'active',
    maxThreads: threads,
    maxAccounts: accounts,
    ispQuota: ispCount,
    minIntervalMin: 5,
    assignedProxies: proxies,
    updatedAt: now
  }, { merge: true });

  if (proxies.length > 0) {
    const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', userId).get();
    let idx = 0;
    for (const d of accSnap.docs) {
      if (!d.data().proxy) {
        await d.ref.update({ proxy: proxies[idx % proxies.length], updatedAt: now });
        idx++;
      }
    }
  }

  await db.collection('orders').doc(orderId).update({ status: 'completed', completedAt: now, updatedAt: now });

  if (order.tgChatId) {
    const updatedUser = await ensureTgUser(order.tgChatId, null);
    const lang = normalizeLang(updatedUser.lang);
    const msgText = lang === 'zh'
      ? ('🎉 <b>USDT付款已确认 — 您的套餐已全自动开通！</b>\n\n• 套餐: <b>' + order.planName + '</b>\n• 并发工作流: <b>' + threads + ' 个</b> (最多 <b>' + accounts + ' 个备用小号</b>)\n• 独享静态ISP代理 (' + country + '): <b>' + proxies.length + ' 条</b>')
      : (lang === 'ja'
        ? ('🎉 <b>お支払いが確認されました — プランが即時開通しました！</b>\n\n• プラン: <b>' + order.planName + '</b>\n• 同時稼働枠: <b>' + threads + ' 枠</b> (最大 <b>' + accounts + ' アカウント</b>)\n• 専用固定ISPプロキシ (' + country + '): <b>' + proxies.length + ' 本割当済</b>')
        : ('🎉 <b>PAYMENT CONFIRMED — YOUR PLAN IS NOW ACTIVE!</b>\n\n• Plan: <b>' + order.planName + '</b>\n• Simultaneous Streams: <b>' + threads + '</b> (Up to <b>' + accounts + ' Burner Slots</b>)\n• Built-in Country IP (' + country + '): <b>' + proxies.length + ' Assigned</b>'));
    await tgApi('sendMessage', {
      chat_id: order.tgChatId,
      parse_mode: 'HTML',
      text: msgText,
      reply_markup: getMainKeyboard(country, !!updatedUser.isEngineRunning, updatedUser.postIntervalMin || 30, lang, false)
    });
  }
}

function getConfirmKeyboard(rawLang = 'en') {
  const lang = normalizeLang(rawLang);
  if (lang === 'zh') {
    return {
      inline_keyboard: [[
        { text: '✅ 确认无误，立即保存设置', callback_data: 'confirm_apply' },
        { text: '❌ 取消 / 重新输入', callback_data: 'confirm_cancel' }
      ]]
    };
  }
  if (lang === 'ja') {
    return {
      inline_keyboard: [[
        { text: '✅ はい、この内容でセッティングする', callback_data: 'confirm_apply' },
        { text: '❌ キャンセル / やり直す', callback_data: 'confirm_cancel' }
      ]]
    };
  }
  return {
    inline_keyboard: [[
      { text: '✅ Yes, Save & Apply Setting', callback_data: 'confirm_apply' },
      { text: '❌ Cancel / Re-enter', callback_data: 'confirm_cancel' }
    ]]
  };
}

async function verifySingleOrderPaidWithOxaPay(orderDoc) {
  try {
    const o = orderDoc.data();
    if (!o || o.status === 'completed') return false;
    if (await checkWiseOrderPaidViaApi(o)) {
      await activateTelegramOrder(orderDoc.id, o);
      return true;
    }
    if (!o.oxaTrackId) return false;
    let oxaKey = (process.env.OXAPAY_MERCHANT_KEY || '').trim();
    try {
      const cfg = await db.collection('settings').doc('payment_config').get();
      if (cfg.exists && cfg.data().oxapayMerchantKey) oxaKey = cfg.data().oxapayMerchantKey.trim();
    } catch (e) {}
    if (!oxaKey) return false;

    const v1 = await httpsJson('api.oxapay.com', '/v1/payment/' + encodeURIComponent(String(o.oxaTrackId)), 'GET', null, { 'merchant_api_key': oxaKey }, 12000);
    const st1 = String((v1 && v1.data && v1.data.status) || (v1 && v1.status) || '').toLowerCase();
    if (['paid', 'confirming', 'complete', 'completed'].includes(st1)) {
      await activateTelegramOrder(orderDoc.id, o);
      return true;
    }

    const inq = await httpsJson('api.oxapay.com', '/merchants/inquiry', 'POST', { merchant: oxaKey, trackId: Number(o.oxaTrackId) || o.oxaTrackId }, {}, 12000);
    const st2 = String((inq && inq.status) || '').toLowerCase();
    if (['paid', 'confirming', 'complete', 'completed'].includes(st2)) {
      await activateTelegramOrder(orderDoc.id, o);
      return true;
    }
  } catch (e) {}
  return false;
}

async function handleTelegramUpdate(upd) {
  try {
    if (!upd || typeof upd !== 'object') return;
    const chatMember = upd.my_chat_member || upd.chat_member;
    if (chatMember && chatMember.chat && (chatMember.chat.type === 'channel' || chatMember.chat.type === 'supergroup')) {
      const chId = chatMember.chat.id;
      await db.collection('settings').doc('telegram_config').set({ channelChatId: chId, updatedAt: new Date() }, { merge: true });
      await sendChannelPinnedWelcome(chId);
      return;
    }
    if (upd.channel_post && upd.channel_post.chat) {
      const chId = upd.channel_post.chat.id;
      const cfg = await db.collection('settings').doc('telegram_config').get();
      if (!cfg.exists || !cfg.data().channelChatId || String(upd.channel_post.text || '').trim() === '/setup') {
        await db.collection('settings').doc('telegram_config').set({ channelChatId: chId, updatedAt: new Date() }, { merge: true });
        await sendChannelPinnedWelcome(chId);
      }
      return;
    }

    if (upd.callback_query) {
      const cq = upd.callback_query;
      const chatId = cq.message && cq.message.chat && cq.message.chat.id;
      const data = String(cq.data || '');
      if (!chatId) return;
      const user = await ensureTgUser(chatId, cq.from);
      const lang = normalizeLang(user.lang);
      const isFree = isFreePlanUser(user);

      if (data === 'confirm_apply') {
        const pending = user.pendingConfirm;
        if (!pending || !pending.type) {
          await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '⚠️ No pending setting.' });
          return;
        }
        let doneHeader = '';
        if (pending.type === 'token') {
          const tokens = Array.isArray(pending.tokens) ? pending.tokens : [];
          const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', user.userId).get();
          const maxSlots = user.maxAccounts || 3;
          let currentCount = accSnap.size;
          let addedCount = 0;
          const userProxies = Array.isArray(user.assignedProxies) ? user.assignedProxies : [];

          for (const rawTok of tokens) {
            if (currentCount >= maxSlots) break;
            const cleanToken = String(rawTok).toLowerCase();
            const proxyToUse = userProxies.length > 0 ? userProxies[currentCount % userProxies.length] : '';
            const docId = user.userId + '_' + cleanToken.slice(0, 10);
            await db.collection('saas_accounts').doc(docId).set({
              ownerUserId: user.userId,
              authToken: cleanToken,
              username: '',
              role: '検証中',
              isActive: true,
              proxy: proxyToUse,
              nextPostAt: new Date(0),
              createdAt: new Date(),
              updatedAt: new Date()
            });
            currentCount++;
            addedCount++;
          }
          doneHeader = lang === 'zh'
            ? ('🎉 <b>已确认并成功导入 ' + addedCount + ' 个推特Token小号！</b>\n\n')
            : (lang === 'ja'
              ? ('🎉 <b>確認完了：' + addedCount + ' 個の使い捨てアカウントをセッティングしました！</b>\n\n')
              : ('🎉 <b>Confirmed & Added ' + addedCount + ' Disposable Burner Account(s)!</b>\n\n'));
        } else if (pending.type === 'post') {
          await db.collection('saas_posts').add({
            ownerUserId: user.userId,
            text: String(pending.value || ''),
            imageUrl: '',
            createdAt: new Date(),
            updatedAt: new Date()
          });
          doneHeader = lang === 'zh' ? '✅ <b>发帖文案已确认并保存！</b>\n\n' : (lang === 'ja' ? '✅ <b>投稿テキストをセッティングしました！</b>\n\n' : '✅ <b>Post Text Confirmed & Saved!</b>\n\n');
        } else if (pending.type === 'bio') {
          await db.collection('saas_users').doc(user.userId).update({
            profileBio: String(pending.value || '').slice(0, 160),
            updatedAt: new Date()
          });
          doneHeader = lang === 'zh' ? '✅ <b>个人简介(Bio)已确认并保存！</b>\n\n' : (lang === 'ja' ? '✅ <b>プロフィール(Bio)をセッティングしました！</b>\n\n' : '✅ <b>Profile Bio Link Confirmed & Saved!</b>\n\n');
        } else if (pending.type === 'adv_name') {
          await db.collection('saas_users').doc(user.userId).update({
            profileName: String(pending.value || '').slice(0, 50),
            updatedAt: new Date()
          });
          doneHeader = lang === 'zh' ? '✅ <b>昵称已确认并保存！</b>\n\n' : (lang === 'ja' ? '✅ <b>表示名をセッティングしました！</b>\n\n' : '✅ <b>Display Name Confirmed & Saved!</b>\n\n');
        }

        await db.collection('saas_users').doc(user.userId).update({ botInputStep: '', pendingConfirm: null, updatedAt: new Date() });
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '✅ Saved!' });
        const updatedUser = await ensureTgUser(chatId, cq.from);
        const dashText = await buildDashboardMessage(updatedUser);
        await tgApi('editMessageText', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          parse_mode: 'HTML',
          text: doneHeader + dashText,
          reply_markup: getMainKeyboard(updatedUser.ispCountry || 'US', !!updatedUser.isEngineRunning, updatedUser.postIntervalMin || 30, lang, isFreePlanUser(updatedUser))
        });
        return;
      }

      if (data === 'confirm_cancel') {
        await db.collection('saas_users').doc(user.userId).update({ botInputStep: '', pendingConfirm: null, updatedAt: new Date() });
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '❌ Cancelled' });
        const updatedUser = await ensureTgUser(chatId, cq.from);
        const dashText = await buildDashboardMessage(updatedUser);
        await tgApi('editMessageText', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          parse_mode: 'HTML',
          text: dashText,
          reply_markup: getMainKeyboard(updatedUser.ispCountry || 'US', !!updatedUser.isEngineRunning, updatedUser.postIntervalMin || 30, lang, isFreePlanUser(updatedUser))
        });
        return;
      }

      if (data === 'switch_lang') {
        const order = ['en', 'zh', 'ja'];
        const nextLang = order[(order.indexOf(lang) + 1) % order.length];
        await db.collection('saas_users').doc(user.userId).update({ lang: nextLang, updatedAt: new Date() });
        user.lang = nextLang;
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: nextLang === 'zh' ? '🇨🇳 已切换为中文' : (nextLang === 'ja' ? '🇯🇵 日本語に切り替えました' : '🇺🇸 Switched to English') });
        const dashText = await buildDashboardMessage(user);
        await tgApi('editMessageText', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          parse_mode: 'HTML',
          text: dashText,
          reply_markup: getMainKeyboard(user.ispCountry || 'US', !!user.isEngineRunning, user.postIntervalMin || 30, nextLang, isFree)
        });
        return;
      }

      if (data === 'back_home') {
        await db.collection('saas_users').doc(user.userId).update({ botInputStep: '', pendingConfirm: null, updatedAt: new Date() });
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id });
        const dashText = await buildDashboardMessage(user);
        await tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: dashText, reply_markup: getMainKeyboard(user.ispCountry || 'US', !!user.isEngineRunning, user.postIntervalMin || 30, lang, isFree) });
        return;
      }

      if (data === 'view_disclaimer') {
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id });
        await tgApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: getFullDisclaimerText(lang),
          reply_markup: {
            inline_keyboard: [[{ text: lang === 'zh' ? '✅ 我已阅读并同意 (返回)' : (lang === 'ja' ? '✅ 同意してパネルへ戻る' : '✅ I Understand & Agree (Back)'), callback_data: 'back_home' }]]
          }
        });
        return;
      }

      if (data === 'cycle_interval') {
        const curInt = parseInt(user.postIntervalMin || '30', 10);
        const idx = INTERVAL_OPTIONS.indexOf(curInt);
        const nextInt = INTERVAL_OPTIONS[(idx + 1) % INTERVAL_OPTIONS.length];
        await db.collection('saas_users').doc(user.userId).update({ postIntervalMin: nextInt, updatedAt: new Date() });
        const warnMsg = lang === 'zh'
          ? (nextInt <= 15 ? ('⚠️ 间隔已设为 ' + nextInt + ' 分钟。短间隔约2小时易触发Shadowban，请务必使用备用小号，风险自负！') : ('⏱️ 间隔已设为每 ' + nextInt + ' 分钟'))
          : (lang === 'ja'
            ? (nextInt <= 15 ? ('⚠️ 投稿間隔を ' + nextInt + '分 に設定しました。短い間隔ほど約2時間でシャドウバンになる確率が上がります（完全自己責任）。') : ('⏱️ 投稿間隔を ' + nextInt + '分おき に設定しました'))
            : (nextInt <= 15 ? ('⚠️ Interval set to ' + nextInt + 'm. Shorter intervals increase shadowban risk (~2h average). Use disposable burners at your own risk!') : ('⏱️ Post interval set to every ' + nextInt + ' minutes.')));
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: warnMsg, show_alert: nextInt <= 15 });
        const updatedUser = await ensureTgUser(chatId, cq.from);
        const dashText = await buildDashboardMessage(updatedUser);
        await tgApi('editMessageText', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          parse_mode: 'HTML',
          text: dashText,
          reply_markup: getMainKeyboard(updatedUser.ispCountry || 'US', !!updatedUser.isEngineRunning, nextInt, lang, isFree)
        });
        return;
      }

      if (data === 'menu_plans') {
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id });
        const planText = lang === 'zh'
          ? '💎 <b>选择全包套餐（均含独享静态ISP住宅IP + 0秒防封轮换）</b>\n━━━━━━━━━━━━━━━━━━━━━━\n🔥 <b>24小时体验 — $7</b> (1并发 / 3号槽位 / 1条IP)\n🚀 <b>个人起步版 — $79/30天</b> (1并发 / 10号槽位 / 1条独享IP)\n👑 <b>工作室专业版 — $179/30天</b> (3并发 / 30号槽位 / 3条独享IP)\n🏢 <b>矩阵旗舰版 — $399/30天</b> (8并发 / 100号槽位 / 8条独享IP)'
          : (lang === 'ja'
            ? '💎 <b>専用固定ISPプロキシ込み・オールインワンプラン</b>\n━━━━━━━━━━━━━━━━━━━━━━\n🔥 <b>24時間テスト体験 — $7</b> (1枠稼働 / 計3垢枠 / 固定IP 1本)\n🚀 <b>ソロスターター — $79/30日</b> (1枠稼働 / 計10垢枠 / 専用IP 1本)\n👑 <b>エージェンシーPro — $179/30日</b> (3枠同時 / 計30垢枠 / 専用IP 3本)\n🏢 <b>シンジケートFarm — $399/30日</b> (8枠同時 / 計100垢枠 / 専用IP 8本)'
            : '💎 <b>CHOOSE YOUR ALL-INCLUSIVE PLAN</b>\n━━━━━━━━━━━━━━━━━━━━━━\n🔥 <b>24-Hour Test Drive — $7</b> (1 Stream / 3 Slots / 1 IP)\n🚀 <b>Solo Starter — $79 / 30d</b> (1 Stream / 10 Slots / 1 Dedicated IP)\n👑 <b>Agency Pro — $179 / 30d</b> (3 Streams / 30 Slots / 3 Dedicated IPs)\n🏢 <b>Syndicate Farm — $399 / 30d</b> (8 Streams / 100 Slots / 8 Dedicated IPs)');
        await tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: planText, reply_markup: getPlansKeyboard(user.ispCountry || 'US', lang) });
        return;
      }

      if (data === 'cycle_country') {
        if (isFree) {
          const lockAlert = lang === 'zh'
            ? '🔒 免费版使用系统自动分配的代理IP，无法手动选择国家。开通 $7 体验或包月套餐即可自选独享ISP国家！'
            : (lang === 'ja'
              ? '🔒 無料プランはシステム自動割当プロキシのため国を選択できません。$7体験または月額プランを開通すると希望の国を選べます！'
              : '🔒 Free plan uses our auto-assigned proxy IP. Upgrade to the $7 Test Drive or a 30-Day Plan to select your dedicated ISP country!');
          await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: lockAlert, show_alert: true });
          return;
        }
        const curIdx = COUNTRIES.findIndex(c => c.code === (user.ispCountry || 'US'));
        const nextObj = COUNTRIES[(curIdx + 1) % COUNTRIES.length];
        await db.collection('saas_users').doc(user.userId).update({ ispCountry: nextObj.code, updatedAt: new Date() });
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '🌍 IP Country: ' + nextObj.label });
        await tgApi('editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          reply_markup: getMainKeyboard(nextObj.code, !!user.isEngineRunning, user.postIntervalMin || 30, lang, false)
        });
        return;
      }

      if (data === 'cycle_country_plans') {
        const curIdx = COUNTRIES.findIndex(c => c.code === (user.ispCountry || 'US'));
        const nextObj = COUNTRIES[(curIdx + 1) % COUNTRIES.length];
        await db.collection('saas_users').doc(user.userId).update({ ispCountry: nextObj.code, updatedAt: new Date() });
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '🌍 Target Country: ' + nextObj.label });
        await tgApi('editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          reply_markup: getPlansKeyboard(nextObj.code, lang)
        });
        return;
      }

      if (data === 'wiz_add_token') {
        await db.collection('saas_users').doc(user.userId).update({ botInputStep: 'WAIT_TOKEN', pendingConfirm: null, updatedAt: new Date() });
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id });
        const msgTxt = lang === 'zh'
          ? '➕ <b>第一步：添加购买的推特一次性Token小号</b>\n━━━━━━━━━━━━━━━━━━━━━━\n🚨 请仅使用<b>购买的已解除Shadowban的一次性Token小号</b>（严禁使用个人主号！风险自负）。\n\n👉 <b>请把40位 <code>auth_token</code> 粘贴到下方聊天框发送（发送后将显示确认画面）：</b>'
          : (lang === 'ja'
            ? '➕ <b>ステップ1：購入した使い捨てアカウント(auth_token)の追加</b>\n━━━━━━━━━━━━━━━━━━━━━━\n🚨 必ず<b>購入したシャドウバン解除済みの使い捨てアカウント</b>をご使用ください（本アカウントは絶対に使用しないでください・完全自己責任）。\n\n👉 <b>下のチャット欄に40文字の <code>auth_token</code>（複数行まとめ貼りも可）を貼り付けて送信してください（送信後に確認画面が出ます）：</b>'
            : '➕ <b>STEP 1: ADD PURCHASED DISPOSABLE BURNER ACCOUNT(S)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n🚨 Use ONLY <b>purchased, shadowban-cleared disposable burner accounts</b> (NEVER use your personal main account!).\n\n👉 <b>Paste your 40-character <code>auth_token</code> into the chat box below and send it:</b>');
        await tgApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: msgTxt,
          reply_markup: { inline_keyboard: [[{ text: lang === 'zh' ? '← 取消 / 返回' : (lang === 'ja' ? '← キャンセル / 戻る' : '← Cancel / Back'), callback_data: 'back_home' }]] }
        });
        return;
      }

      if (data === 'wiz_add_post') {
        await db.collection('saas_users').doc(user.userId).update({ botInputStep: 'WAIT_POST', pendingConfirm: null, updatedAt: new Date() });
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id });
        const postSnap = await db.collection('saas_posts').where('ownerUserId', '==', user.userId).get();
        const msgTxt = lang === 'zh'
          ? ('✍️ <b>第二步：设置循环发帖文案 (当前已存 ' + postSnap.size + ' 条)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n👉 <b>请直接在下方输入框发送您想要发布的推文内容（发送后将先显示预览确认，确认后才正式生效）！</b>')
          : (lang === 'ja'
            ? ('✍️ <b>ステップ2：投稿テキストの設定 (現在 ' + postSnap.size + ' 件保存済)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n👉 <b>下のチャット欄に自動投稿したい文章を入力して送信してください（送信後に「この内容でセッティングしますか？」の確認画面が出ます）！</b>')
            : ('✍️ <b>STEP 2: ADD POST TEXT (Currently ' + postSnap.size + ' saved)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n👉 <b>Type or paste the tweet text you want to post into the chat box below and send it!</b>'));
        await tgApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: msgTxt,
          reply_markup: {
            inline_keyboard: [
              [{ text: lang === 'zh' ? '⚡ 一键导入3条防封引流模板' : (lang === 'ja' ? '⚡ サンプル投稿テンプレートを1タップ読込' : '⚡ 1-Click Load Viral Templates'), callback_data: 'load_templates' }],
              [{ text: lang === 'zh' ? '🗑️ 清空所有已存文案' : (lang === 'ja' ? '🗑️ 保存済みテキストを全消去' : '🗑️ Clear All Saved Posts'), callback_data: 'clear_posts' }],
              [{ text: lang === 'zh' ? '← 取消 / 返回' : (lang === 'ja' ? '← キャンセル / 戻る' : '← Cancel / Back'), callback_data: 'back_home' }]
            ]
          }
        });
        return;
      }

      if (data === 'wiz_set_bio') {
        await db.collection('saas_users').doc(user.userId).update({ botInputStep: 'WAIT_BIO', pendingConfirm: null, updatedAt: new Date() });
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id });
        const msgTxt = lang === 'zh'
          ? ('🔗 <b>第三步：设置个人简介 (Bio) 引流链接</b>\n━━━━━━━━━━━━━━━━━━━━━━\n当前简介: <code>' + escapeHtml(user.profileBio || '(保持原样)') + '</code>\n\n👉 <b>请发送您想同步到推特个人简介(Bio)的文字或链接（发送后将显示确认预览）：</b>')
          : (lang === 'ja'
            ? ('🔗 <b>ステップ3：プロフィール (Bio) 紹介文・リンクの設定</b>\n━━━━━━━━━━━━━━━━━━━━━━\n現在の設定: <code>' + escapeHtml(user.profileBio || '(未設定 — 元のBioを維持)') + '</code>\n\n👉 <b>Xの自己紹介(Bio)に載せたい文章やリンクを下のチャット欄に入力して送信してください（送信後に確認画面が出ます）：</b>')
            : ('🔗 <b>STEP 3: SET PROFILE BIO / LINK</b>\n━━━━━━━━━━━━━━━━━━━━━━\nCurrent Bio: <code>' + escapeHtml(user.profileBio || '(Unchanged)') + '</code>\n\n👉 <b>Type or paste the Bio text / URL you want on your X profile and send it below:</b>'));
        await tgApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: msgTxt,
          reply_markup: {
            inline_keyboard: [
              [{ text: lang === 'zh' ? '🚫 不修改简介 (保持原样)' : (lang === 'ja' ? '🚫 Bioを変更しない (元のまま維持)' : '🚫 Do Not Change Bio (Keep Original)'), callback_data: 'clear_bio' }],
              [{ text: lang === 'zh' ? '← 取消 / 返回' : (lang === 'ja' ? '← キャンセル / 戻る' : '← Cancel / Back'), callback_data: 'back_home' }]
            ]
          }
        });
        return;
      }

      if (data === 'help_beginner') {
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id });
        const guideTxt = lang === 'zh'
          ? '📘 <b>新手3步快速上手指南</b>\n1. 在 AccsMarket.com / Z2U.com 等平台购买 $0.50 左右的解除Shadowban推特Token直登号（严禁使用个人主号）。\n2. 点击 [➕ 1. 添加推特Token小号] 粘贴发货文本中的40位 <code>auth_token</code> 并确认。\n3. 设置文案与Bio后点击启动即可24h全自动发帖轮换！'
          : (lang === 'ja'
            ? '📘 <b>初心者ガイド（使い捨て垢の用意と使い方）</b>\n1. AccsMarketやZ2U等のアカウント販売サイトで、シャドウバン解除済みの使い捨てXアカウント（auth_token付き）を用意します（本垢は絶対に使わないでください）。\n2. [➕ 1. 使い捨て垢追加] を押し、40文字の <code>auth_token</code> をチャットに貼って「はい」で確定します。\n3. 投稿文とBioを設定してスタートを押すだけで、シャドウバン検知0秒交代つきの24時間自動投稿が回ります！'
            : '📘 <b>BEGINNER 3-STEP GUIDE</b>\n1. Buy cheap shadowban-cleared disposable X accounts ($0.50) with <code>auth_token</code> on AccsMarket or Z2U (Never use your main account!).\n2. Tap [➕ 1. Add Burner Account] and paste your 40-char token.\n3. Set your post text & Bio, then tap START!');
        await tgApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: guideTxt,
          reply_markup: { inline_keyboard: [[{ text: '← Back', callback_data: 'back_home' }]] }
        });
        return;
      }

      if (data === 'clear_posts') {
        const pSnap = await db.collection('saas_posts').where('ownerUserId', '==', user.userId).get();
        for (const d of pSnap.docs) await d.ref.delete();
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '🗑️ Cleared!' });
        const dashText = await buildDashboardMessage(user);
        await tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: dashText, reply_markup: getMainKeyboard(user.ispCountry || 'US', !!user.isEngineRunning, user.postIntervalMin || 30, lang, isFree) });
        return;
      }

      if (data === 'clear_bio') {
        await db.collection('saas_users').doc(user.userId).update({ profileBio: '', profileName: '', profileAvatarUrl: '', botInputStep: '', pendingConfirm: null, updatedAt: new Date() });
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '✅ Bio sync disabled' });
        const dashText = await buildDashboardMessage(user);
        await tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: dashText, reply_markup: getMainKeyboard(user.ispCountry || 'US', !!user.isEngineRunning, user.postIntervalMin || 30, lang, isFree) });
        return;
      }

      if (data === 'toggle_engine') {
        if (isFree) {
          await tgApi('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: lang === 'zh'
              ? '🔒 请先开通 $7 (24小时体验) 或包月套餐，即可启动24小时云端自动发帖与独享ISP代理！'
              : (lang === 'ja'
                ? '🔒 24時間クラウド自動投稿＆専用固定IPを稼働するには、まず $7 (24時間体験) または月額プランを開通してください！'
                : '🔒 Please unlock the $7 (24h) Test Drive or a Monthly Plan first to start the 24/7 Cloud Engine!'),
            show_alert: true
          });
          return;
        }
        const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', user.userId).get();
        const postSnap = await db.collection('saas_posts').where('ownerUserId', '==', user.userId).get();
        if (!user.isEngineRunning && accSnap.empty) {
          await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '⚠️ Please add at least 1 burner account first (Step 1)!', show_alert: true });
          return;
        }
        if (!user.isEngineRunning && postSnap.empty) {
          await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '⚠️ Please add at least 1 post text first (Step 2)!', show_alert: true });
          return;
        }
        const nextRun = !user.isEngineRunning;
        await db.collection('saas_users').doc(user.userId).update({ isEngineRunning: nextRun, botInputStep: '', pendingConfirm: null, updatedAt: new Date() });
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: nextRun ? '🟢 Started!' : '🔴 Paused.' });
        const updatedUser = await ensureTgUser(chatId, cq.from);
        const dashText = await buildDashboardMessage(updatedUser);
        await tgApi('editMessageText', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          parse_mode: 'HTML',
          text: dashText,
          reply_markup: getMainKeyboard(updatedUser.ispCountry || 'US', nextRun, updatedUser.postIntervalMin || 30, lang, isFreePlanUser(updatedUser))
        });
        return;
      }

      if (data.startsWith('buy_')) {
        const planKey = data.replace('buy_', '');
        const plan = TG_PLANS[planKey] || TG_PLANS.oneday;
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '⏳ Generating OxaPay Crypto Link...' });
        const orderId = 'TGO-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
        const oxa = await createOxaPayUsdInvoice(orderId, plan.usd);
        const wiseSpec = buildWiseOrderSpec(orderId, plan.usd);
        const wiseCfg = await getWiseConfig();
        const pTitle = lang === 'zh' ? plan.titleZh : (lang === 'ja' ? plan.titleJa : plan.title);
        const pDesc = lang === 'zh' ? plan.descZh : (lang === 'ja' ? plan.descJa : plan.desc);
        await db.collection('orders').doc(orderId).set({
          orderId, orderType: 'saas_plan', userId: user.userId, tgChatId: chatId,
          planId: plan.id, planName: pTitle, durationDays: plan.days,
          totalThreads: plan.threads, totalMaxAccounts: plan.accounts, totalIspCount: plan.isp,
          minIntervalMin: plan.minInt, ispCountry: user.ispCountry || 'US',
          grossAmountUsd: plan.usd, grossAmountJpy: plan.jpy,
          gatewayRedirectUrl: oxa ? oxa.payLink : null, oxaTrackId: oxa ? oxa.trackId : null,
          wiseRef: wiseSpec.wiseRef, wiseExactUsd: wiseSpec.exactUsd, wisePayUrl: wiseCfg.quickPayUrl,
          status: 'pending_payment', createdAt: new Date(), updatedAt: new Date()
        });
        if (oxa && oxa.payLink) {
          const invText = lang === 'zh'
            ? ('💎 <b>订单已生成: ' + pTitle + '</b>\n━━━━━━━━━━━━━━━━━━━━━━\n• <b>配置:</b> ' + pDesc + '\n• <b>独享代理国家:</b> 🌍 ' + (user.ispCountry || 'US') + '\n• <b>金额:</b> <b>$' + plan.usd + ' USD</b> (USDT / BTC / ETH / SOL)\n\n⚠️ <b>免责确认：</b>短间隔约2小时易触发Shadowban（X官方决定），必须使用购买的一次性Token小号（严禁主号），USDT付款后概不退款。')
            : (lang === 'ja'
              ? ('💎 <b>お支払い案内: ' + pTitle + '</b>\n━━━━━━━━━━━━━━━━━━━━━━\n• <b>内容:</b> ' + pDesc + '\n• <b>選択プロキシ国:</b> 🌍 ' + (user.ispCountry || 'US') + '\n• <b>金額:</b> <b>$' + plan.usd + ' USD</b> (USDT / USDC / BTC / ETH / SOL)\n\n⚠️ <b>免責確認：</b>短い間隔ほどシャドウバン確率が上がります（実測約2時間・X側の決定のため当社不関知）。必ず購入した使い捨て垢をご使用ください（本垢厳禁・返金不可）。')
              : ('💎 <b>ORDER INVOICE: ' + pTitle + '</b>\n━━━━━━━━━━━━━━━━━━━━━━\n• <b>Specs:</b> ' + pDesc + '\n• <b>Proxy Country:</b> 🌍 ' + (user.ispCountry || 'US') + '\n• <b>Amount:</b> <b>$' + plan.usd + ' USD</b> (USDT / USDC / BTC / ETH / SOL)\n\n⚠️ <b>Mandatory Agreement:</b> Shorter intervals increase shadowban risk (~2h benchmark). Use ONLY purchased disposable burner accounts. All crypto payments are non-refundable.'));
          await tgApi('sendMessage', {
            chat_id: chatId,
            parse_mode: 'HTML',
            text: invText,
            reply_markup: {
              inline_keyboard: [
                [{ text: '💳 Pay $' + plan.usd + ' USD (Crypto / OxaPay) →', url: oxa.payLink }],
                [{ text: '🏦 Pay $' + wiseSpec.exactUsd + ' USD via Wise / Bank (Ref: ' + wiseSpec.wiseRef + ') →', url: wiseCfg.quickPayUrl || 'https://wise.com' }],
                [{ text: '🔄 Check Payment & Activate Now', callback_data: 'check_' + orderId }],
                [{ text: '← Back', callback_data: 'back_home' }]
              ]
            }
          });
        }
        return;
      }

      if (data.startsWith('check_')) {
        const ordId = data.replace('check_', '');
        const oDoc = await db.collection('orders').doc(ordId).get();
        if (!oDoc.exists) return;
        if (oDoc.data().status === 'completed') {
          await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '✅ Plan is already active!', show_alert: true });
          return;
        }
        const paidNow = await verifySingleOrderPaidWithOxaPay(oDoc);
        if (paidNow) {
          await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '🎉 Payment confirmed! Plan activated!', show_alert: true });
        } else {
          await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '⏳ Blockchain confirmation not detected yet. Once paid, it activates automatically within 15-20 seconds!', show_alert: true });
        }
        return;
      }

      if (data === 'load_templates') {
        const defaultSamples = lang === 'zh'
          ? [
              '{最新福利已更新|今日私密动态已发} — {点击我的个人简介链接查看|入口在主页Bio里} 🔥',
              '{别错过今天的最新更新|限时私密频道已开放} 👉 {查看我的主页简介链接|点击主页Bio直达} ⚡'
            ]
          : [
              '{Hey everyone|gm|Quick update} — {check out the new drop in my bio|exclusive link is live in my bio} 🔥',
              '{New content just went live|Updated my private link today}! {Check my profile bio|See bio for details} ⚡'
            ];
        for (const s of defaultSamples) {
          await db.collection('saas_posts').add({ ownerUserId: user.userId, text: s, imageUrl: '', createdAt: new Date(), updatedAt: new Date() });
        }
        await db.collection('saas_users').doc(user.userId).update({ botInputStep: '', pendingConfirm: null, updatedAt: new Date() });
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '⚡ Templates Added!' });
        const updatedUser = await ensureTgUser(chatId, cq.from);
        const dashText = await buildDashboardMessage(updatedUser);
        await tgApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: dashText,
          reply_markup: getMainKeyboard(updatedUser.ispCountry || 'US', !!updatedUser.isEngineRunning, updatedUser.postIntervalMin || 30, lang, isFreePlanUser(updatedUser))
        });
        return;
      }

      if (data === 'view_status') {
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id });
        const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', user.userId).get();
        const postSnap = await db.collection('saas_posts').where('ownerUserId', '==', user.userId).get();
        const histSnap = await db.collection('saas_history').where('ownerUserId', '==', user.userId).limit(15).get();
        const roleMap = { '検証中': '🔍 Verifying', '最新': '🟢 Active/Standby', 'シャドウバン': '🟠 Shadowbanned (Auto-Swapped)', 'ロボット': '🔴 Locked (Auto-Swapped)', '利用不可': '⚫ Suspended (Auto-Swapped)' };
        const lines = accSnap.docs.map((d, i) => {
          const a = d.data();
          const stLabel = roleMap[a.role] || a.role || '🔍';
          return (i + 1) + '. <b>@' + (a.username || 'checking...') + '</b> — ' + stLabel + ' <i>(' + (a.postCount || 0) + ' posts)</i>';
        });
        const pLines = postSnap.docs.slice(0, 5).map((d, i) => (i + 1) + '. <code>' + escapeHtml(String(d.data().text || '').slice(0, 45)) + '...</code>');
        const activeHist = histSnap.docs.filter(d => !d.data().deleted).slice(0, 5);
        const hLines = activeHist.map((d, i) => (i + 1) + '. <a href="' + d.data().url + '">@' + (d.data().username || 'post') + '</a> ' + (d.data().deleteReq ? '<i>(⏳ Deleting...)</i>' : ''));

        await tgApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          text: '📊 <b>ACCOUNTS, QUEUE & LIVE POST HISTORY</b>\n━━━━━━━━━━━━━━━━━━━━━━\n' +
            '<b>Accounts (' + accSnap.size + '/' + (user.maxAccounts || 1) + '):</b>\n' + (lines.length ? lines.join('\n') : '<i>None</i>') + '\n\n' +
            '<b>Post Templates (' + postSnap.size + '):</b>\n' + (pLines.length ? pLines.join('\n') : '<i>None</i>') + '\n\n' +
            '<b>Recent Live Posts on X:</b>\n' + (hLines.length ? hLines.join('\n') : '<i>No posts recorded yet</i>'),
          reply_markup: {
            inline_keyboard: [
              [{ text: '🗑️ Remove Banned/Dead Burners', callback_data: 'clean_dead_accs' }],
              [{ text: '🧹 Remote-Delete Posted Tweets on X', callback_data: 'remote_delete_posts' }],
              [{ text: '← Back to Control Panel', callback_data: 'back_home' }]
            ]
          }
        });
        return;
      }

      if (data === 'remote_delete_posts') {
        const histSnap = await db.collection('saas_history').where('ownerUserId', '==', user.userId).get();
        let reqCount = 0;
        for (const d of histSnap.docs) {
          if (!d.data().deleted && !d.data().deleteReq) {
            await d.ref.update({ deleteReq: true, updatedAt: new Date() });
            reqCount++;
          }
        }
        await tgApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: reqCount > 0 ? ('🧹 Queued ' + reqCount + ' tweet(s) for remote deletion on X!') : 'ℹ️ No active posted tweets to delete.',
          show_alert: true
        });
        return;
      }

      if (data === 'clean_dead_accs') {
        const accSnap = await db.collection('saas_accounts').where('ownerUserId', '==', user.userId).get();
        let removed = 0;
        for (const d of accSnap.docs) {
          if (['シャドウバン', 'ロボット', '利用不可'].includes(d.data().role)) {
            await d.ref.delete();
            removed++;
          }
        }
        await tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: '🧹 Removed ' + removed + ' restricted burner(s)!' });
        const dashText = await buildDashboardMessage(user);
        await tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: dashText, reply_markup: getMainKeyboard(user.ispCountry || 'US', !!user.isEngineRunning, user.postIntervalMin || 30, lang, isFree) });
        return;
      }
    }

    const msg = upd.message;
    if (!msg || !msg.chat || msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;
    const text = String(msg.text || '').trim();
    if (!text) return;

    let forceLang = null;
    if (text.startsWith('/start')) {
      if (text.includes('lang_zh')) forceLang = 'zh';
      if (text.includes('lang_en')) forceLang = 'en';
      if (text.includes('lang_ja')) forceLang = 'ja';
    }
    const user = await ensureTgUser(chatId, msg.from, forceLang);
    const lang = normalizeLang(user.lang);
    const isFree = isFreePlanUser(user);

    if (text.startsWith('/start')) {
      await db.collection('saas_users').doc(user.userId).update({ botInputStep: '', pendingConfirm: null, updatedAt: new Date() });
      const dashText = await buildDashboardMessage(user);
      await tgApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: dashText,
        reply_markup: getMainKeyboard(user.ispCountry || 'US', !!user.isEngineRunning, user.postIntervalMin || 30, lang, isFree)
      });
      return;
    }

    // 1. 40文字の auth_token が入力された場合 ➔ ワンステップ確認画面
    const extractedTokens = text.match(/\b[a-fA-F0-9]{40}\b/g);
    if (extractedTokens && extractedTokens.length > 0 && user.botInputStep !== 'WAIT_POST' && user.botInputStep !== 'WAIT_BIO') {
      const uniqueTokens = Array.from(new Set(extractedTokens.map(t => t.toLowerCase())));
      const previewList = uniqueTokens.slice(0, 10).map((t, i) => (i + 1) + '. <code>' + t.slice(0, 8) + '...' + t.slice(-6) + '</code>').join('\n');
      await db.collection('saas_users').doc(user.userId).update({
        pendingConfirm: { type: 'token', tokens: uniqueTokens },
        updatedAt: new Date()
      });
      const confirmTxt = lang === 'zh'
        ? ('🔍 <b>请确认：您输入的以下 ' + uniqueTokens.length + ' 个推特 <code>auth_token</code> 小号即将进行配置，确定要保存吗？</b>\n━━━━━━━━━━━━━━━━━━━━━━\n' + previewList)
        : (lang === 'ja'
          ? ('🔍 <b>チャットに入力していただいた以下の内容（' + uniqueTokens.length + '個の <code>auth_token</code>）でセッティングします。よろしいですか？</b>\n━━━━━━━━━━━━━━━━━━━━━━\n' + previewList)
          : ('🔍 <b>CONFIRMATION: We will configure the following ' + uniqueTokens.length + ' <code>auth_token</code> account(s) you entered. Proceed?</b>\n━━━━━━━━━━━━━━━━━━━━━━\n' + previewList));
      await tgApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: confirmTxt,
        reply_markup: getConfirmKeyboard(lang)
      });
      return;
    }

    // 2. 投稿テキストが入力された場合 ➔ ワンステップ確認画面
    if (user.botInputStep === 'WAIT_POST' || text.startsWith('/post ')) {
      const postBody = text.startsWith('/post ') ? text.slice(6).trim() : text;
      await db.collection('saas_users').doc(user.userId).update({
        pendingConfirm: { type: 'post', value: postBody },
        updatedAt: new Date()
      });
      const confirmTxt = lang === 'zh'
        ? ('🔍 <b>请确认：即将把您输入的以下内容设置为循环发帖文案，确定吗？</b>\n━━━━━━━━━━━━━━━━━━━━━━\n<code>' + escapeHtml(postBody) + '</code>')
        : (lang === 'ja'
          ? ('🔍 <b>チャットに入力していただいた以下の投稿テキストでセッティングします。よろしいですか？</b>\n━━━━━━━━━━━━━━━━━━━━━━\n<code>' + escapeHtml(postBody) + '</code>')
          : ('🔍 <b>CONFIRMATION: We will configure your post queue with the text you entered below. Proceed?</b>\n━━━━━━━━━━━━━━━━━━━━━━\n<code>' + escapeHtml(postBody) + '</code>'));
      await tgApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: confirmTxt,
        reply_markup: getConfirmKeyboard(lang)
      });
      return;
    }

    // 3. Bioが入力された場合 ➔ ワンステップ確認画面
    if (user.botInputStep === 'WAIT_BIO' || text.startsWith('/bio ')) {
      const bioBody = (text.startsWith('/bio ') ? text.slice(5).trim() : text).slice(0, 160);
      await db.collection('saas_users').doc(user.userId).update({
        pendingConfirm: { type: 'bio', value: bioBody },
        updatedAt: new Date()
      });
      const confirmTxt = lang === 'zh'
        ? ('🔍 <b>请确认：即将把您输入的以下内容设置为推特个人简介 (Bio)，确定吗？</b>\n━━━━━━━━━━━━━━━━━━━━━━\n<code>' + escapeHtml(bioBody) + '</code>')
        : (lang === 'ja'
          ? ('🔍 <b>チャットに入力していただいた以下のプロフィール（Bio）でセッティングします。よろしいですか？</b>\n━━━━━━━━━━━━━━━━━━━━━━\n<code>' + escapeHtml(bioBody) + '</code>')
          : ('🔍 <b>CONFIRMATION: We will set your X Profile Bio to the content you entered below. Proceed?</b>\n━━━━━━━━━━━━━━━━━━━━━━\n<code>' + escapeHtml(bioBody) + '</code>'));
      await tgApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: confirmTxt,
        reply_markup: getConfirmKeyboard(lang)
      });
      return;
    }

    const dashText = await buildDashboardMessage(user);
    await tgApi('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: dashText,
      reply_markup: getMainKeyboard(user.ispCountry || 'US', !!user.isEngineRunning, user.postIntervalMin || 30, lang, isFree)
    });
  } catch (e) {
    console.error('TG Update Error:', e.stack || e.message);
  }
}

async function pollOxaPayPendingOrders() {
  try {
    const snap = await db.collection('orders').where('status', '==', 'pending_payment').limit(25).get();
    for (const doc of snap.docs) {
      await verifySingleOrderPaidWithOxaPay(doc);
    }
  } catch (e) {}
}

async function startBotDaemon() {
  console.log('🤖 X-Swarm Multilingual (EN/ZH/JA) Telegram Bot (@' + TG_BOT_USERNAME + ') with 1-Step Confirmation & Free-Tier IP Lock Started!');
  let offset = 0;
  setInterval(pollOxaPayPendingOrders, 20000);
  while (true) {
    try {
      const res = await tgApi('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query', 'channel_post', 'my_chat_member', 'chat_member'] }, 35000);
      if (res && res.ok && Array.isArray(res.result)) {
        for (const upd of res.result) {
          offset = upd.update_id + 1;
          await handleTelegramUpdate(upd);
        }
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 1500));
  }
}

if (require.main === module) {
  startBotDaemon();
}
module.exports = { tgApi, createOxaPayUsdInvoice, sendChannelPinnedWelcome };
