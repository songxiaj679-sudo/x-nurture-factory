// 人間特有のランダムな待機・マウス曲線移動・UIボタン遷移・自然なタイピングを提供する共通エンジン

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

async function humanSleep(minMs = 800, maxMs = 2200) {
  const ms = randInt(minMs, maxMs);
  await new Promise(r => setTimeout(r, ms));
}

// 画面内のランダムな位置へ視線（マウス）をふらっと動かす
async function humanIdleMouseMove(page) {
  try {
    const vp = page.viewport() || { width: 1280, height: 800 };
    const x = randInt(120, Math.max(200, vp.width - 150));
    const y = randInt(100, Math.max(200, vp.height - 150));
    await page.mouse.move(x, y, { steps: randInt(12, 28) });
  } catch (e) {}
}

// 要素の真ん中ではなくランダムな内側座標へマウスを滑らかに移動させ、少し溜めてからクリックする
async function humanClickSelector(page, selector, timeoutMs = 7000) {
  try {
    const el = await page.waitForSelector(selector, { visible: true, timeout: timeoutMs }).catch(() => null);
    if (!el) return false;
    return await humanClickElement(page, el);
  } catch (e) {
    return false;
  }
}

async function humanClickElement(page, elementHandle) {
  try {
    await elementHandle.evaluate(el => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }).catch(() => {});
    await humanSleep(250, 650);

    const box = await elementHandle.boundingBox().catch(() => null);
    if (box && box.width > 4 && box.height > 4) {
      // 端すぎず中央すぎない30%〜70%のランダム位置を狙う
      const targetX = Math.floor(box.x + box.width * (0.28 + Math.random() * 0.44));
      const targetY = Math.floor(box.y + box.height * (0.28 + Math.random() * 0.44));
      await page.mouse.move(targetX, targetY, { steps: randInt(10, 24) });
      await humanSleep(120, 380);
      await page.mouse.down();
      await humanSleep(45, 130);
      await page.mouse.up();
      return true;
    }
    await elementHandle.click();
    return true;
  } catch (e) {
    return false;
  }
}

// 人間らしい加減速と読み返し（少し上に戻す動き）を含むスクロール
async function humanScroll(page, minScrolls = 2, maxScrolls = 4) {
  const count = randInt(minScrolls, maxScrolls);
  for (let i = 0; i < count; i++) {
    await humanIdleMouseMove(page);
    const dy = randInt(220, 520);
    await page.evaluate((delta) => {
      window.scrollBy({ top: delta, behavior: 'smooth' });
    }, dy).catch(() => {});
    await humanSleep(1800, 4200);

    // 25%の確率で少しだけ上にスクロールして読み返す人間挙動
    if (Math.random() < 0.25) {
      await page.evaluate((backDelta) => {
        window.scrollBy({ top: -backDelta, behavior: 'smooth' });
      }, randInt(60, 140)).catch(() => {});
      await humanSleep(900, 1800);
    }
  }
}

// プログラム特有の一瞬URLワープを避け、可能な限り画面上のナビゲーションアイコンや検索窓をクリックして移動する
async function humanNavigate(page, targetUrl, cleanUsername = '') {
  try {
    await humanSleep(600, 1500);
    const curUrl = page.url();
    if (curUrl === targetUrl) return;

    // 1. ホーム画面への移動なら左メニューのホームアイコンをクリック
    if (targetUrl === 'https://x.com/home') {
      const clicked = await humanClickSelector(page, '[data-testid="AppTabBar_Home_Link"], a[href="/home"]', 3500);
      if (clicked) {
        await humanSleep(2000, 3500);
        return;
      }
    }

    // 2. 通知・メンション画面への移動なら左メニューの通知アイコンをクリック
    if (targetUrl.includes('/notifications')) {
      const clicked = await humanClickSelector(page, '[data-testid="AppTabBar_Notifications_Link"], a[href="/notifications"]', 3500);
      if (clicked) {
        await humanSleep(2200, 3600);
        if (targetUrl.includes('/mentions')) {
          await humanClickSelector(page, 'a[href="/notifications/mentions"]', 3000);
          await humanSleep(1800, 3000);
        }
        return;
      }
    }

    // 3. 投稿画面への移動なら左メニューの「ポストする」ボタンまたはホーム上部の入力欄をクリック
    if (targetUrl.includes('/compose/post')) {
      const clickedSide = await humanClickSelector(page, '[data-testid="SideNav_NewTweet_Button"], a[href="/compose/post"]', 4000);
      if (clickedSide) {
        await humanSleep(1800, 3000);
        return;
      }
    }

    // 4. 自分のプロフィール画面への移動なら左メニューのプロフィールアイコンをクリック
    if (cleanUsername && (targetUrl === `https://x.com/${cleanUsername}` || targetUrl === `https://x.com/${cleanUsername}/with_replies`)) {
      const clickedProf = await humanClickSelector(page, '[data-testid="AppTabBar_Profile_Link"]', 3500);
      if (clickedProf) {
        await humanSleep(2200, 3600);
        return;
      }
    }

    // 5. 検索画面への移動なら、画面内の検索ボックスがあればそこに入力してEnterで遷移
    if (targetUrl.includes('/search?q=')) {
      const searchInput = await page.$('[data-testid="SearchBox_Search_Input"]').catch(() => null);
      if (searchInput) {
        const u = new URL(targetUrl);
        const q = u.searchParams.get('q') || '';
        if (q) {
          await humanClickElement(page, searchInput);
          await humanSleep(300, 700);
          await page.keyboard.down('Control');
          await page.keyboard.press('KeyA');
          await page.keyboard.up('Control');
          await page.keyboard.press('Backspace');
          await humanTyping(page, q);
          await humanSleep(400, 900);
          await page.keyboard.press('Enter');
          await humanSleep(3000, 4500);
          if (targetUrl.includes('f=live')) {
            // 「最新」タブをクリック
            await page.evaluate(() => {
              const tabs = Array.from(document.querySelectorAll('[role="tab"], a[role="tab"]'));
              const liveTab = tabs.find(t => /最新|latest|live/i.test(t.innerText || '') || (t.getAttribute('href') || '').includes('f=live'));
              if (liveTab) liveTab.click();
            }).catch(() => {});
            await humanSleep(2500, 3800);
          }
          return;
        }
      }
    }

    // 6. プロフィール等のURLは画面内のリンクがあればクリックし、無ければ正規の page.goto で確実に遷移させる
    if (curUrl.startsWith('https://x.com/') && targetUrl.startsWith('https://x.com/')) {
      const targetPath = new URL(targetUrl).pathname;
      const clickedInPageLink = await page.evaluate((p) => {
        const a = document.querySelector('a[href="' + p + '"]');
        if (a) { a.click(); return true; }
        return false;
      }, targetPath).catch(() => false);
      if (clickedInPageLink) {
        await humanSleep(2500, 4000);
        return;
      }
    }
  } catch (e) {}

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await humanSleep(2600, 4200);
}

// 句読点や改行で自然な思考間合いを入れ、たまタイプミス＆修正も行う人間タイピング
async function humanTyping(page, text) {
  const dummyKeys = "あいうえおかきくけこさしすせそ";
  const chars = Array.from(String(text || ''));
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (Math.random() < 0.02 && char.length === 1 && char.charCodeAt(0) < 255 && char !== '\n' && char !== ' ') {
      const wrongChar = dummyKeys[Math.floor(Math.random() * dummyKeys.length)];
      await page.keyboard.sendCharacter(wrongChar);
      await humanSleep(90, 210);
      await page.keyboard.press('Backspace');
      await humanSleep(120, 260);
    }
    if (char === '\n') {
      await humanSleep(300, 750);
      await page.keyboard.press('Enter');
      await humanSleep(250, 600);
    } else {
      if (char.length === 1 && char.charCodeAt(0) < 128) {
        await page.keyboard.type(char, { delay: randInt(28, 68) });
      } else {
        await page.evaluate(() => {
          const el = document.activeElement;
          if (el) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code: 'KeyA', keyCode: 229, bubbles: true }));
        }).catch(() => {});
        await page.keyboard.sendCharacter(char);
        await page.evaluate(() => {
          const el = document.activeElement;
          if (el) el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Process', code: 'KeyA', keyCode: 229, bubbles: true }));
        }).catch(() => {});
      }
      if (['、', '。', '！', '？', '!', '?', '…'].includes(char)) {
        await humanSleep(280, 680);
      } else {
        await humanSleep(42, 135);
      }
    }
  }
}

module.exports = {
  randInt,
  humanSleep,
  humanIdleMouseMove,
  humanClickSelector,
  humanClickElement,
  humanScroll,
  humanNavigate,
  humanTyping
};
