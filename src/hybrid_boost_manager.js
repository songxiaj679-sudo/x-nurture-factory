const { db } = require('./firestore');
const { FieldValue } = require('firebase-admin/firestore');
const { humanSleep, humanNavigate, humanClickSelector, humanClickElement, humanScroll } = require('./human_actions');
const { ensureAccountPersonality } = require('./persona_engine');

/**
 * 当該サテライトアカウントがまだ支援していない、有効な応援案件（boost_campaign）を1件取得する
 */
async function getAvailableBoostCampaign(cleanUsername) {
  if (!cleanUsername) return null;
  const username = String(cleanUsername).replace(/^@/, '').trim().toLowerCase();

  try {
    const now = new Date();
    // 進行中の案件（active）を取得
    const snap = await db.collection('boost_campaigns')
      .where('status', '==', 'active')
      .limit(20)
      .get();

    if (snap.empty) return null;

    const validCampaigns = [];
    snap.forEach(doc => {
      const data = doc.data();
      const expires = data.expiresAt ? (data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt)) : null;
      if (expires && expires < now) return; // 期限切れ

      const supported = Array.isArray(data.supportedAccounts) ? data.supportedAccounts.map(s => String(s).toLowerCase()) : [];
      if (supported.includes(username)) return; // すでに支援済み

      // 本人の投稿にはサテライト応援しない
      if (data.author && data.author.toLowerCase() === username) return;

      validCampaigns.push({ id: doc.id, ...data });
    });

    if (validCampaigns.length === 0) return null;

    // 作成日時が新しく、目標が未達のものを優先
    validCampaigns.sort((a, b) => {
      const aTime = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0) : 0;
      const bTime = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0) : 0;
      return bTime - aTime;
    });

    return validCampaigns[0];
  } catch (err) {
    console.error('getAvailableBoostCampaign Error:', err.message);
    return null;
  }
}

/**
 * 応援アクション完了を記録し、案件のカウンタを更新する
 */
async function recordBoostActionDone(campaignId, cleanUsername, actionType) {
  const username = String(cleanUsername).replace(/^@/, '').trim();
  try {
    const docRef = db.collection('boost_campaigns').doc(campaignId);
    const snap = await docRef.get();
    if (!snap.exists) return;

    const data = snap.data();
    const updateData = {
      supportedAccounts: FieldValue.arrayUnion(username),
      updatedAt: new Date()
    };

    if (actionType === 'like') {
      updateData.currentLikes = (data.currentLikes || 0) + 1;
    } else if (actionType === 'retweet') {
      updateData.currentRetweets = (data.currentRetweets || 0) + 1;
    } else if (actionType === 'quote') {
      updateData.currentQuotes = (data.currentQuotes || 0) + 1;
    }

    const curL = (actionType === 'like' ? 1 : 0) + (data.currentLikes || 0);
    const curR = (actionType === 'retweet' ? 1 : 0) + (data.currentRetweets || 0);
    const curQ = (actionType === 'quote' ? 1 : 0) + (data.currentQuotes || 0);

    if (curL >= (data.targetLikes || 8) && curR >= (data.targetRetweets || 4) && curQ >= (data.targetQuotes || 2)) {
      updateData.status = 'completed';
      updateData.completedAt = new Date();
    }

    await docRef.update(updateData);
    console.log(`  🎉 [応援記録完了] @${username} が案件 [${campaignId}] に [${actionType}] を実行しました (現在の進捗: いいね ${curL}/${data.targetLikes || 8}, RT ${curR}/${data.targetRetweets || 4})`);
  } catch (e) {
    console.error('recordBoostActionDone Error:', e.message);
  }
}

/**
 * サテライトアカウントがブラウザ内で自然に本垢ポストを訪問し、いいね・リポスト・引用等の応援を実行する
 */
async function performHumanBoostAction(page, boostCampaign, maturity, cleanUsername, accountData = {}) {
  const targetUrl = boostCampaign.tweetUrl;
  console.log(`  🚀 [サテライト自動応援開始] @${cleanUsername} が本アカウントのポスト (${targetUrl}) へ支援に向かいます...`);

  try {
    // 1. 自然なナビゲーションで本垢ポストを開く
    await humanNavigate(page, targetUrl).catch(() => {});
    await humanSleep(2500, 4500);

    // 2. 人間らしい読冷スクロール（200〜450pxスクロールしてツイートを視界に入れる）
    await humanScroll(page, 150, 400);
    await humanSleep(1800, 3200);

    const articleSelector = 'article[data-testid="tweet"]';
    const hasArticle = await page.$(articleSelector).catch(() => null);
    if (!hasArticle) {
      console.log(`  ⚠️ [応援スキップ] 投稿記事 (${articleSelector}) が描画されませんでした`);
      return { ok: false, reason: 'tweet_not_rendered' };
    }

    // 🤝 公式アカウント未フォローなら自然にフォロー
    if (!accountData.followedOfficial) {
      const followClicked = await page.evaluate(() => {
        const btn = document.querySelector('button[data-testid$="-follow"]');
        if (btn && !btn.getAttribute('data-testid').includes('unfollow')) {
          btn.click();
          return true;
        }
        return false;
      }).catch(() => false);
      if (followClicked) {
        console.log(`    🤝 [公式フォロー] @${cleanUsername} が公式アカウントを自然フォローしました！`);
        accountData.followedOfficial = true;
        await humanSleep(1200, 2200);
      }
    }

    const currentLikes = boostCampaign.currentLikes || 0;
    const targetLikes = boostCampaign.targetLikes || 8;
    const currentRts = boostCampaign.currentRetweets || 0;
    const targetRts = boostCampaign.targetRetweets || 4;
    const currentQuotes = boostCampaign.currentQuotes || 0;
    const targetQuotes = boostCampaign.targetQuotes || 2;

    // アクションの決定:
    // Stage 2以降で、引用RTが未達かつ確率25%なら「AI共感引用リポスト」
    // それ以外はリポスト未達なら「リポスト（RT）」、または「いいね & ブックマーク」
    let actionChosen = 'like';
    if (maturity && maturity.stage >= 2 && currentQuotes < targetQuotes && Math.random() < 0.35) {
      actionChosen = 'quote';
    } else if (currentRts < targetRts && Math.random() < 0.65) {
      actionChosen = 'retweet';
    } else {
      actionChosen = 'like';
    }

    // A. いいね (Like) アクション
    if (actionChosen === 'like') {
      const liked = await page.evaluate(() => {
        const art = document.querySelector('article[data-testid="tweet"]');
        if (!art) return false;
        const likeBtn = art.querySelector('[data-testid="like"]');
        if (likeBtn) { likeBtn.click(); return true; }
        return false;
      }).catch(() => false);

      if (liked) {
        console.log(`    ❤️ [本垢応援] @${cleanUsername} が本垢ポストに「いいね」を押しました！`);
        await humanSleep(1500, 2500);
        
        // 50%の確率でブックマークも押してアルゴリズムスコアを最大化
        if (Math.random() < 0.5) {
          await page.evaluate(() => {
            const art = document.querySelector('article[data-testid="tweet"]');
            if (art) {
              const bm = art.querySelector('[data-testid="bookmark"]');
              if (bm) bm.click();
            }
          }).catch(() => {});
          console.log(`    🔖 [アルゴリズムブースト] ついでに「ブックマーク」も追加しました！`);
        }

        await recordBoostActionDone(boostCampaign.id, cleanUsername, 'like');
        return { ok: true, action: 'like' };
      }
    }

    // B. リポスト (Retweet) アクション
    if (actionChosen === 'retweet') {
      const rtClicked = await page.evaluate(() => {
        const art = document.querySelector('article[data-testid="tweet"]');
        if (!art) return false;
        const rtBtn = art.querySelector('[data-testid="retweet"]');
        if (rtBtn) { rtBtn.click(); return true; }
        return false;
      }).catch(() => false);

      if (rtClicked) {
        await humanSleep(1000, 2000);
        const confirmed = await page.evaluate(() => {
          const confirmBtn = document.querySelector('[data-testid="retweetConfirm"]');
          if (confirmBtn) { confirmBtn.click(); return true; }
          return false;
        }).catch(() => false);

        if (confirmed) {
          console.log(`    🔁 [本垢応援] @${cleanUsername} が本垢ポストを「リポスト (RT)」しました！`);
          await humanSleep(2000, 3500);
          await recordBoostActionDone(boostCampaign.id, cleanUsername, 'retweet');
          return { ok: true, action: 'retweet' };
        }
      }
    }

    // C. 共感引用リポスト (Quote Tweet) アクション
    if (actionChosen === 'quote') {
      const rtClicked = await page.evaluate(() => {
        const art = document.querySelector('article[data-testid="tweet"]');
        if (!art) return false;
        const rtBtn = art.querySelector('[data-testid="retweet"]');
        if (rtBtn) { rtBtn.click(); return true; }
        return false;
      }).catch(() => false);

      if (rtClicked) {
        await humanSleep(1000, 1800);
        // メニューから「引用 (Quote)」を選択
        const quoteMenuItem = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('[role="menuitem"], a[href="/compose/post"]'));
          const quoteItem = items.find(el => (el.innerText || '').includes('引用') || (el.innerText || '').includes('Quote'));
          if (quoteItem) { quoteItem.click(); return true; }
          return false;
        }).catch(() => false);

        if (quoteMenuItem) {
          await humanSleep(2000, 3000);
          // AIで自然な共感引用文を生成
          const quotesList = [
            'これは参考になる。保存しておこう。',
            'めちゃくちゃ分かりやすい！特に大事なポイント。',
            'なるほど、この視点は無かった。勉強になります！',
            'まさにこれ。日頃から意識したい内容。',
            'すごく共感できる。シェアさせていただきます！'
          ];
          const quoteText = quotesList[Math.floor(Math.random() * quotesList.length)];

          const typed = await page.evaluate((text) => {
            const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
            if (editor) {
              editor.focus();
              document.execCommand('insertText', false, text);
              return true;
            }
            return false;
          }, quoteText).catch(() => false);

          if (typed) {
            await humanSleep(1500, 2500);
            const tweeted = await page.evaluate(() => {
              const btn = document.querySelector('[data-testid="tweetButton"]');
              if (btn) { btn.click(); return true; }
              return false;
            }).catch(() => false);

            if (tweeted) {
              console.log(`    💬 [本垢応援] @${cleanUsername} が自然な感想を添えて「引用リポスト」しました: "${quoteText}"`);
              await humanSleep(3000, 5000);
              await recordBoostActionDone(boostCampaign.id, cleanUsername, 'quote');
              return { ok: true, action: 'quote', text: quoteText };
            }
          }
        }
      }
    }

    // フォールバック: 確定でいいねを押す
    await page.evaluate(() => {
      const art = document.querySelector('article[data-testid="tweet"]');
      if (art) {
        const likeBtn = art.querySelector('[data-testid="like"]');
        if (likeBtn) likeBtn.click();
      }
    }).catch(() => {});
    await recordBoostActionDone(boostCampaign.id, cleanUsername, 'like');
    return { ok: true, action: 'like_fallback' };

  } catch (err) {
    console.error(`  ⚠️ [応援アクション例外] @${cleanUsername}:`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getAvailableBoostCampaign,
  recordBoostActionDone,
  performHumanBoostAction
};
