require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  X_WEB_BEARER,
  getPersistentProfileDir,
  preCheckAccountWithoutBrowser,
  getUltraSavingBrowserArgs,
  enableSmartBandwidthSaver,
  allowImagesForProfileUpload,
  attachApiHealthSniffer,
  verifyAccountStatusFast
} = require('./status_checker');
const { getDeviceProfile, applyDeviceProfile } = require('./browser_config');
const { getResidentialProxy, attachTrafficMeter } = require('./iproyal');
const { humanSleep } = require('./human_actions');

const TARGET_TOKEN = '9f7d943863800c8fe4beeb3c3ff303e50e860dd6';

const OFFICIAL_PROFILE = {
  name: 'VELOX SYSTEMS｜VeloxPost公式',
  bio: '企業のSNS広報・デジタルマーケティングを自動化する次世代クラウド「VeloxPost」公式アカウント⚡️ PCやスマホを閉じていても24時間365日、指定スケジュールでスマートに情報発信。Web業務自動化システム開発・導入のご相談は公式サイトへ👇',
  location: '日本・大阪 / Cloud Cluster JP-East',
  url: 'https://veloxpostapp.com'
};

// Canvasで高精細な公式サイバーアイコン(500x500)とヘッダーバナー(1500x500)を直接生成
async function generateOfficialBrandAssets(page, iconPath, headerPath) {
  console.log('🎨 [Asset Engine] 公式サイバーロゴ(Icon)＆3Dネットワークバナー(Header)を高解像度レンダリング中...');
  const { iconB64, headerB64 } = await page.evaluate(() => {
    // 1. 公式アイコン (500x500)
    const c1 = document.createElement('canvas');
    c1.width = 500;
    c1.height = 500;
    const ctx1 = c1.getContext('2d');

    // 背景グラデーション (ディープネイビー)
    const bgGrad = ctx1.createRadialGradient(250, 250, 30, 250, 250, 320);
    bgGrad.addColorStop(0, '#0d1b3e');
    bgGrad.addColorStop(0.6, '#060b19');
    bgGrad.addColorStop(1, '#02040a');
    ctx1.fillStyle = bgGrad;
    ctx1.fillRect(0, 0, 500, 500);

    // サイバーグリッド線
    ctx1.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    ctx1.lineWidth = 1;
    for (let i = 0; i < 500; i += 25) {
      ctx1.beginPath(); ctx1.moveTo(i, 0); ctx1.lineTo(i, 500); ctx1.stroke();
      ctx1.beginPath(); ctx1.moveTo(0, i); ctx1.lineTo(500, i); ctx1.stroke();
    }

    // 外周ネオンリング
    ctx1.beginPath();
    ctx1.arc(250, 250, 210, 0, Math.PI * 2);
    ctx1.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx1.lineWidth = 3;
    ctx1.stroke();

    // メタリック＆ネオンブルーの「V」エンブレム
    ctx1.save();
    ctx1.shadowColor = '#38bdf8';
    ctx1.shadowBlur = 35;
    const vGrad = ctx1.createLinearGradient(120, 110, 380, 400);
    vGrad.addColorStop(0, '#7dd3fc');
    vGrad.addColorStop(0.45, '#38bdf8');
    vGrad.addColorStop(1, '#2563eb');
    ctx1.fillStyle = vGrad;

    ctx1.beginPath();
    ctx1.moveTo(115, 130);
    ctx1.lineTo(195, 130);
    ctx1.lineTo(250, 285);
    ctx1.lineTo(305, 130);
    ctx1.lineTo(385, 130);
    ctx1.lineTo(275, 395);
    ctx1.lineTo(225, 395);
    ctx1.closePath();
    ctx1.fill();

    // インナーハイライトライン
    ctx1.strokeStyle = '#e0f2fe';
    ctx1.lineWidth = 2.5;
    ctx1.stroke();
    ctx1.restore();

    // 2. 公式ヘッダーバナー (1500x500)
    const c2 = document.createElement('canvas');
    c2.width = 1500;
    c2.height = 500;
    const ctx2 = c2.getContext('2d');

    const hBg = ctx2.createLinearGradient(0, 0, 1500, 500);
    hBg.addColorStop(0, '#02040a');
    hBg.addColorStop(0.5, '#071026');
    hBg.addColorStop(1, '#030712');
    ctx2.fillStyle = hBg;
    ctx2.fillRect(0, 0, 1500, 500);

    // パースペクティブ・サイバーグリッド
    ctx2.strokeStyle = 'rgba(56, 189, 248, 0.09)';
    ctx2.lineWidth = 1;
    for (let x = 0; x < 1500; x += 45) {
      ctx2.beginPath(); ctx2.moveTo(x, 0); ctx2.lineTo(x, 500); ctx2.stroke();
    }
    for (let y = 0; y < 500; y += 45) {
      ctx2.beginPath(); ctx2.moveTo(0, y); ctx2.lineTo(1500, y); ctx2.stroke();
    }

    // 右側に輝くデジタル地球儀＆ノード群
    const gx = 1160, gy = 250, gr = 175;
    const glow = ctx2.createRadialGradient(gx, gy, 10, gx, gy, 280);
    glow.addColorStop(0, 'rgba(56, 189, 248, 0.32)');
    glow.addColorStop(0.5, 'rgba(37, 99, 235, 0.12)');
    glow.addColorStop(1, 'rgba(2, 4, 10, 0)');
    ctx2.fillStyle = glow;
    ctx2.fillRect(800, 0, 700, 500);

    ctx2.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx2.lineWidth = 1.5;
    ctx2.beginPath(); ctx2.arc(gx, gy, gr, 0, Math.PI * 2); ctx2.stroke();
    for (let rx = 35; rx < gr; rx += 42) {
      ctx2.beginPath(); ctx2.ellipse(gx, gy, rx, gr, 0, 0, Math.PI * 2); ctx2.stroke();
      ctx2.beginPath(); ctx2.ellipse(gx, gy, gr, rx, 0, 0, Math.PI * 2); ctx2.stroke();
    }

    // 光のストリームライン（左から地球儀へ）
    for (let s = 0; s < 14; s++) {
      ctx2.beginPath();
      ctx2.moveTo(100, 80 + s * 26);
      ctx2.bezierCurveTo(550, 40 + s * 30, 820, 320 - s * 15, gx - gr + 20, gy + (s - 7) * 14);
      ctx2.strokeStyle = s % 2 === 0 ? 'rgba(56, 189, 248, 0.28)' : 'rgba(99, 102, 241, 0.24)';
      ctx2.lineWidth = 2;
      ctx2.stroke();
    }

    // タイポグラフィ（ブランドタイトル＆タグライン）
    ctx2.save();
    ctx2.fillStyle = '#38bdf8';
    ctx2.font = 'bold 18px monospace';
    ctx2.fillText('// GLOBAL AI CLOUD & AUTONOMOUS WEB INFRASTRUCTURE', 110, 175);

    ctx2.shadowColor = 'rgba(56, 189, 248, 0.5)';
    ctx2.shadowBlur = 20;
    ctx2.fillStyle = '#ffffff';
    ctx2.font = '900 68px sans-serif';
    ctx2.fillText('VELOX SYSTEMS', 110, 255);

    ctx2.shadowBlur = 0;
    ctx2.fillStyle = '#94a3b8';
    ctx2.font = '600 24px sans-serif';
    ctx2.fillText('Next-Gen Marketing DX & Cloud Schedule Dispatcher  |  veloxpostapp.com', 112, 310);

    // ステータスバッジ描画
    ctx2.fillStyle = 'rgba(16, 185, 129, 0.18)';
    ctx2.strokeStyle = 'rgba(16, 185, 129, 0.6)';
    ctx2.lineWidth = 1.5;
    ctx2.fillRect(112, 345, 340, 42);
    ctx2.strokeRect(112, 345, 340, 42);
    ctx2.fillStyle = '#34d399';
    ctx2.font = 'bold 16px monospace';
    ctx2.fillText('● 99.99% SLA  |  JP-EAST CLUSTER', 132, 372);
    ctx2.restore();

    return {
      iconB64: c1.toDataURL('image/jpeg', 0.95).split(',')[1],
      headerB64: c2.toDataURL('image/jpeg', 0.95).split(',')[1]
    };
  });

  fs.writeFileSync(iconPath, Buffer.from(iconB64, 'base64'));
  fs.writeFileSync(headerPath, Buffer.from(headerB64, 'base64'));
  console.log(`  ✅ 公式アイコン (${Math.round(fs.statSync(iconPath).size / 1024)}KB) ＆ 公式ヘッダー (${Math.round(fs.statSync(headerPath).size / 1024)}KB) の生成完了！`);
  return { iconB64, headerB64 };
}

async function setInputValueClean(page, selector, val) {
  await page.evaluate((sel, v) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, v);
    else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, val).catch(() => {});
}

async function setupOfficialVelox() {
  console.log('\n============================================================');
  console.log('🚀 【VELOX SYSTEMS 公式Xアカウント 全自動セットアップ】');
  console.log('============================================================');

  const proxy = getResidentialProxy(TARGET_TOKEN);
  const devProf = getDeviceProfile(TARGET_TOKEN);
  const fixedUA = devProf.userAgent;

  console.log('🔍 [Step 1] 住宅用プロキシ経由でアカウントの事前API監査を実行中...');
  const nodePreCheck = await preCheckAccountWithoutBrowser(TARGET_TOKEN, proxy, fixedUA);
  console.log(`  -> 事前チェック結果: ok=${nodePreCheck.ok}, user=@${nodePreCheck.username || '確認中'}, status=${nodePreCheck.status}`);

  const tokenHash = crypto.createHash('md5').update(TARGET_TOKEN).digest('hex');
  const userDir = getPersistentProfileDir(TARGET_TOKEN);
  const outDir = path.join(__dirname, '../tmp_images');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const iconPath = path.join(outDir, `official_icon_${tokenHash}.jpg`);
  const headerPath = path.join(outDir, `official_header_${tokenHash}.jpg`);

  let browser = null;
  try {
    process.env.DISPLAY = process.env.DISPLAY || ':99';
    const vncLikeArgs = getUltraSavingBrowserArgs(proxy).filter(a =>
      !a.includes('--disable-webgl') &&
      !a.includes('--disable-3d-apis') &&
      !a.includes('--blink-settings=imagesEnabled=false')
    );

    console.log('🌐 [Step 2] 専用ステルスブラウザを起動中 (25番プロセスとは完全分離)...');
    browser = await puppeteer.launch({
      headless: false,
      env: { ...process.env, DISPLAY: ':99' },
      args: [
        ...vncLikeArgs,
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--test-type',
        '--window-size=1280,900'
      ],
      ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=IdleDetection'],
      userDataDir: userDir,
      protocolTimeout: 60000
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(40000);
    const cdpClient = await enableSmartBandwidthSaver(page, true);
    const snifferState = attachApiHealthSniffer(page);
    if (proxy && proxy.user && proxy.pass) {
      await page.authenticate({ username: proxy.user, password: proxy.pass });
    }
    await applyDeviceProfile(page, TARGET_TOKEN, fixedUA);

    // Canvasで公式アイコン・ヘッダーを生成
    const { iconB64, headerB64 } = await generateOfficialBrandAssets(page, iconPath, headerPath);

    // Cookieセット (lang=ja で日本語強制)
    const initCookies = [
      { name: 'auth_token', value: TARGET_TOKEN, domain: '.x.com', path: '/', secure: true },
      { name: 'auth_token', value: TARGET_TOKEN, domain: '.twitter.com', path: '/', secure: true },
      { name: 'lang', value: 'ja', domain: '.x.com', path: '/' }
    ];
    if (nodePreCheck.ct0) {
      initCookies.push({ name: 'ct0', value: nodePreCheck.ct0, domain: '.x.com', path: '/', secure: true });
    }
    await page.setCookie(...initCookies);

    console.log('🏠 [Step 3] Xホーム画面へ接続し、セッショントークン(ct0)を同期中...');
    const preCheck = await verifyAccountStatusFast(page, nodePreCheck.username || '', snifferState, 'https://x.com/home');
    const cleanUsername = preCheck.username || nodePreCheck.username || '';
    console.log(`  ✅ ログイン確認完了: @${cleanUsername}`);

    if (typeof allowImagesForProfileUpload === 'function') {
      await allowImagesForProfileUpload(page, cdpClient).catch(() => {});
    }

    console.log('✏️ [Step 4] /settings/profile を開いて画像＆プロフィールをUI注入中...');
    await page.goto('https://x.com/settings/profile', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
    await page.waitForSelector('input[name="displayName"], textarea[name="description"]', { timeout: 12000 }).catch(() => null);
    await humanSleep(1500, 2200);

    // DataTransfer によるヘッダー(index 0)＆アイコン(index 1)注入
    async function injectImage(inputIndex, filePath, label) {
      const b64 = fs.readFileSync(filePath).toString('base64');
      const res = await page.evaluate((idx, b64Data) => {
        const inputs = Array.from(document.querySelectorAll('input[type="file"][data-testid="fileInput"], [role="dialog"] input[type="file"], input[type="file"]'));
        if (inputs.length === 0) return { ok: false, count: 0 };
        const target = inputs.length >= 2 ? inputs[idx] : inputs[0];
        if (!target) return { ok: false, count: inputs.length };
        const bin = atob(b64Data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = new File([bytes], idx === 0 ? 'header.jpg' : 'avatar.jpg', { type: 'image/jpeg', lastModified: Date.now() });
        const dt = new DataTransfer();
        dt.items.add(file);
        target.files = dt.files;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, count: inputs.length };
      }, inputIndex, b64).catch(e => ({ ok: false, err: e.message }));

      if (res && res.ok) {
        const appBtn = await page.waitForSelector('[data-testid="applyButton"]', { timeout: 8000 }).catch(() => null);
        if (appBtn) {
          await humanSleep(800, 1200);
          await page.evaluate(() => document.querySelector('[data-testid="applyButton"]')?.click());
          await page.waitForFunction(() => !document.querySelector('[data-testid="applyButton"]'), { timeout: 6000 }).catch(() => {});
          await humanSleep(1800, 2400);
          console.log(`  ✅ ${label} のUIトリミング適用完了`);
        }
      }
    }

    await injectImage(0, headerPath, '1/2: 公式ヘッダーバナー');
    await injectImage(1, iconPath, '2/2: 公式アイコンロゴ');

    // UIフィールド入力
    await setInputValueClean(page, 'input[name="displayName"]', OFFICIAL_PROFILE.name);
    await setInputValueClean(page, 'textarea[name="description"]', OFFICIAL_PROFILE.bio);
    await setInputValueClean(page, 'input[name="location"]', OFFICIAL_PROFILE.location);
    if (await page.$('input[name="url"]').catch(() => null)) {
      await setInputValueClean(page, 'input[name="url"]', OFFICIAL_PROFILE.url);
    }

    const saveBtn = await page.$('[data-testid="Profile_Save_Button"]').catch(() => null);
    if (saveBtn) {
      await page.evaluate(() => document.querySelector('[data-testid="Profile_Save_Button"]')?.click());
      await page.waitForFunction(() => !document.querySelector('[data-testid="Profile_Save_Button"]'), { timeout: 10000 }).catch(() => {});
      await humanSleep(2500, 3500);
    }

    // Step 5: X内部APIによる「日本・日本語・タイムゾーン東京」＋「プロフィール・URL・アイコン・バナー」の100%確実な反映保証
    console.log('🇯🇵 [Step 5] X内部APIで「国=日本 / 言語=日本語 / タイムゾーン=Asia/Tokyo」および公式プロフィール＆画像を確定中...');
    const curCookies = await page.cookies().catch(() => []);
    const curCt0 = curCookies.find(c => c.name === 'ct0')?.value || nodePreCheck.ct0 || '';

    if (curCt0) {
      const apiResult = await page.evaluate(async (bearer, csrf, prof, iB64, hB64) => {
        const headers = {
          'authorization': `Bearer ${bearer}`,
          'x-csrf-token': csrf,
          'x-twitter-active-user': 'yes',
          'x-twitter-auth-type': 'OAuth2Session',
          'content-type': 'application/x-www-form-urlencoded'
        };
        const out = { settings: 0, profile: 0, icon: 0, banner: 0 };

        // 1. 日本・日本語・東京タイムゾーン設定
        try {
          const r0 = await fetch('https://x.com/i/api/1.1/account/settings.json', {
            method: 'POST',
            credentials: 'include',
            headers,
            body: new URLSearchParams({
              lang: 'ja',
              tz: 'Tokyo',
              country: 'jp',
              discoverable_by_email: 'false',
              discoverable_by_mobile_phone: 'false'
            }).toString()
          });
          out.settings = r0.status;
        } catch (e) {}

        // 2. 表示名・Bio・場所・公式サイトURLの反映
        try {
          const r1 = await fetch('https://x.com/i/api/1.1/account/update_profile.json', {
            method: 'POST',
            credentials: 'include',
            headers,
            body: new URLSearchParams({
              name: prof.name,
              description: prof.bio,
              location: prof.location,
              url: prof.url
            }).toString()
          });
          out.profile = r1.status;
        } catch (e) {}

        // 3. 公式アイコン画像の反映
        try {
          const r2 = await fetch('https://x.com/i/api/1.1/account/update_profile_image.json', {
            method: 'POST',
            credentials: 'include',
            headers,
            body: new URLSearchParams({
              image: iB64,
              include_entities: 'true',
              skip_status: 'true'
            }).toString()
          });
          out.icon = r2.status;
        } catch (e) {}

        // 4. 公式ヘッダーバナー画像の反映
        try {
          const r3 = await fetch('https://x.com/i/api/1.1/account/update_profile_banner.json', {
            method: 'POST',
            credentials: 'include',
            headers,
            body: new URLSearchParams({
              banner: hB64
            }).toString()
          });
          out.banner = r3.status;
        } catch (e) {}

        return out;
      }, X_WEB_BEARER, curCt0, OFFICIAL_PROFILE, iconB64, headerB64);

      console.log('  🎉 [API確定ステータス]', JSON.stringify(apiResult));
    }

    // 完成したプロフィール画面を開いて記念スクリーンショットを保存
    if (cleanUsername) {
      await page.goto(`https://x.com/${cleanUsername}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await humanSleep(3500, 4500);
      await page.screenshot({ path: path.join(__dirname, '../official_velox_profile.png') }).catch(() => {});
      console.log(`📸 完成した公式プロフィール画面を official_velox_profile.png に保存しました！`);
      console.log(`🔗 公式アカウントURL: https://x.com/${cleanUsername}`);
    }

  } catch (err) {
    console.error('❌ エラーが発生しました:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

if (require.main === module) setupOfficialVelox();
module.exports = { setupOfficialVelox };
