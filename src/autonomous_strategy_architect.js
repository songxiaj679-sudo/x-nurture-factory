'use strict';

function proposeAutonomousStrategy({ bio = '', posts = [], url = '', lang = '' } = {}) {
  const lines = posts.slice(0, 20).map(item => String(typeof item === 'string' ? item : (item && item.text) || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const sample = [bio, ...lines].filter(Boolean).join('\n');
  const japanese = String(lang).toLowerCase().startsWith('ja') || /[\u3040-\u30ff\u4e00-\u9fff]/.test(sample);
  const source = String(bio || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const seen = lines[0] ? lines[0].slice(0, 80) : '';
  const notes = [
    source,
    seen ? (japanese ? `直近の投稿で確認できた一文: ${seen}` : `A line confirmed in a recent post: ${seen}`) : ''
  ].filter(Boolean).join('\n').slice(0, 800);
  const focus = source ? (japanese ? `「${source.slice(0, 80)}」` : `"${source.slice(0, 80)}"`) : '';
  return {
    userPrompt: japanese
      ? `公開プロフィール${focus}と登録ページで確認できる活動だけを使い、読者が今日使える実務の要点を短く残す。`
      : `Use only the public profile${focus ? ` ${focus}` : ''} and registered page, and leave one practical point a reader can use.`,
    aiTargetLang: japanese ? 'ja' : 'en',
    scheduleTimeZone: japanese ? 'Asia/Tokyo' : 'America/New_York',
    targetCountry: japanese ? 'JP' : 'US',
    brandContextNotes: notes,
    targetUrl: /^https?:\/\//i.test(url) ? url : '',
    strategySource: 'autonomous'
  };
}

function applyAutonomousStrategy(user, proposal) {
  if (!proposal || !user) return null;
  if (user.strategyLockByUser === true || user.isHumanOverride === true) return null;
  if (String(user.userPrompt || '').trim()) return null;
  return proposal;
}

function weeklyStrategyMemo(report) {
  const experiments = report && Array.isArray(report.recommendedExperiments) ? report.recommendedExperiments : [];
  if (!experiments.length) return '';
  return `🤖 今週 VELOX AI が自動判断して更新した戦略メモ: ${experiments[0]}`;
}

function weeklyStrategyHint(log) {
  const rows = Array.isArray(log) ? log : [];
  const memo = rows.map(row => row && row.memo).filter(text => String(text || '').trim()).pop();
  if (!memo) return '';
  const cleaned = String(memo)
    .replace(/[0-9０-９]+(?:[.,，][0-9０-９]+)?\s*[%％件]?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 4 ? cleaned.slice(0, 180) : '';
}

const PROTECTED_SETTINGS = ['targetUrl', 'userPrompt', 'aiTargetLang', 'scheduleTimeZone', 'targetCountry', 'strategyLockByUser', 'isHumanOverride', 'xOfficialCredentials', 'twitterId', 'voiceProfile'];

function mergeAuthoritativeUser(existing, incoming) {
  const full = { ...(existing || {}) };
  if (!incoming || typeof incoming !== 'object') return full;
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null || value === '') continue;
    if (PROTECTED_SETTINGS.includes(key)) {
      const saved = existing && existing[key];
      if (saved !== undefined && saved !== null && saved !== '') continue;
    }
    full[key] = value;
  }
  return full;
}

async function maybeAutofillStrategy(db, user) {
  const userId = user && user.userId;
  let existing = {};
  if (db && userId) {
    const snap = await db.collection('saas_users').doc(userId).get();
    if (snap.exists) existing = snap.data() || {};
  }
  const fullUser = mergeAuthoritativeUser(existing, user);
  if (fullUser.strategyLockByUser === true) return null;
  if (fullUser.isHumanOverride === true && String(existing.userPrompt || '').trim()) return null;
  let bio = fullUser.voiceProfile && fullUser.voiceProfile.bio || fullUser.xBio || fullUser.bio || '';
  let posts = [];
  if (fullUser.xOfficialCredentials) {
    try {
      const { decryptCredentials, getUserProfileAndRecentTweets } = require('./official_api_client');
      const { bindOfficialCreds } = require('./autonomous_promo_ai');
      const creds = bindOfficialCreds(decryptCredentials(fullUser.xOfficialCredentials), userId, fullUser);
      const recent = await Promise.race([
        getUserProfileAndRecentTweets(creds, 20),
        new Promise(resolve => setTimeout(() => resolve(null), 2000))
      ]);
      if (recent && recent.ok) {
        posts = Array.isArray(recent.tweets) ? recent.tweets.slice(0, 20) : [];
        bio = bio || (recent.user && recent.user.description) || '';
      }
    } catch (err) {
      posts = [];
    }
  }
  const proposal = proposeAutonomousStrategy({
    bio,
    posts,
    url: fullUser.targetUrl,
    lang: fullUser.aiTargetLang
  });
  if (fullUser.isHumanOverride === true) {
    if (!proposal.userPrompt || !db || !userId) return null;
    await db.collection('saas_users').doc(userId).set({ userPrompt: proposal.userPrompt, strategySource: proposal.strategySource }, { merge: true });
    return { ...fullUser, userPrompt: proposal.userPrompt };
  }
  const accepted = applyAutonomousStrategy(fullUser, proposal);
  if (!accepted || !db || !userId) return null;
  const configured = Boolean(String(existing.targetUrl || '').trim() || String(existing.userPrompt || '').trim());
  const patch = {};
  for (const key of ['targetUrl', 'userPrompt', 'aiTargetLang', 'scheduleTimeZone', 'targetCountry', 'brandContextNotes', 'strategySource']) {
    if (configured && key !== 'userPrompt' && ['targetUrl', 'aiTargetLang', 'scheduleTimeZone', 'targetCountry'].includes(key)) continue;
    if (existing[key]) continue;
    if (!proposal[key]) continue;
    patch[key] = proposal[key];
  }
  if (!Object.keys(patch).length) return null;
  await db.collection('saas_users').doc(userId).set({
    ...patch,
    strategyDecisionLog: [{ at: new Date().toISOString(), memo: '公開プロフィールから初期方針を作成しました。未確認の体験談は入れていません。' }]
  }, { merge: true });
  return { ...fullUser, ...patch };
}

module.exports = {
  proposeAutonomousStrategy,
  applyAutonomousStrategy,
  weeklyStrategyMemo,
  weeklyStrategyHint,
  maybeAutofillStrategy,
  mergeAuthoritativeUser
};
