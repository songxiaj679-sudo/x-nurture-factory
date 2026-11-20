'use strict';

const { sanitizePostOrReplyText } = require('./official_api_client');

function clip(value, max) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const sentence = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('。'));
  if (sentence >= Math.floor(max * 0.45)) return slice.slice(0, sentence + 1).trim();
  const word = slice.lastIndexOf(' ');
  if (word >= Math.floor(max * 0.5)) return slice.slice(0, word).trim();
  return slice.trim();
}

function isEnLang(value) {
  return String(value || '').toLowerCase().startsWith('en');
}

function officialUrl(user = {}) {
  return /^https?:\/\//i.test(String(user.targetUrl || '')) ? String(user.targetUrl).trim() : '';
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch (err) { return ''; }
}

function currentBioOf(user = {}, liveProfile = {}) {
  return clip(
    liveProfile.description || liveProfile.bio || (user.voiceProfile && user.voiceProfile.bio) || user.xBio || user.bio || '',
    400
  );
}

function hasCjk(text) {
  return /[\u3040-\u30ff\u4e00-\u9fff]/.test(String(text || ''));
}

function clipAtBoundary(text, max) {
  const clean = String(text || '').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const sentence = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('。'), slice.lastIndexOf('!'), slice.lastIndexOf('！'));
  if (sentence >= Math.floor(max * 0.45)) return slice.slice(0, sentence + 1).trim();
  const word = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
  if (word >= Math.floor(max * 0.5)) return slice.slice(0, word).trim();
  return slice.trim();
}

function clipPin(text, url, max) {
  let clean = sanitizePostOrReplyText(String(text || '')).trim();
  if (clean.length <= max) return clean;
  if (url && clean.includes(url)) {
    const room = Math.max(0, max - url.length - 2);
    const body = clipAtBoundary(clean.replace(url, ''), room);
    const next = `${body}\n${url}`.trim();
    return next.length <= max ? next : url.slice(0, max);
  }
  return clipAtBoundary(clean, max);
}

function clipKeepingUrl(text, url, max) {
  const clean = sanitizePostOrReplyText(String(text || '')).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  if (!url || !clean.includes(url)) {
    return clean.slice(0, max).replace(/\s+\S*$/, '').trim();
  }
  const room = max - url.length - 1;
  if (room < 12) return url.slice(0, max);
  const body = clean.replace(url, '').replace(/\s+/g, ' ').trim().slice(0, room).replace(/\s+\S*$/, '').trim();
  return `${body} ${url}`.trim();
}

function reviewCurrentBio(bio, uiEn, url, knowledge = {}) {
  if (!bio) {
    return uiEn
      ? 'The current X bio was not available. Reconnect X, or use the page and account direction below. This draft does not invent missing facts.'
      : '現在のXの自己紹介は取得できていません。Xを再連携するか、登録ページと人物像から案内を作りました。取れていない事実は入れていません。';
  }
  const who = /向け|for |readers|読者|経営|founder|developer|担当|operator|builder/i.test(bio);
  const offer = /発信|手順|紹介|helps|notes|guide|サービス|product|algorithm|ai|saas|automation|workflow|tool|運用|開発|自動化/i.test(bio);
  const host = hostOf(url);
  const hostInBio = Boolean(host && bio.toLowerCase().includes(host.toLowerCase()));
  const lengthNote = bio.length > 160
    ? (uiEn ? 'It is over 160 characters, so shorten it before pasting.' : '160文字を超えているので、貼る前に短くしてください。')
    : bio.length < 40
      ? (uiEn ? 'It is very short, so add who it is for and what the account publishes.' : '短すぎるため、誰向けかと何を発信するかを足してください。')
      : (uiEn ? 'The length fits the bio field.' : '長さは自己紹介欄に収まります。');
  let nextStep;
  if (url && !hostInBio) {
    nextStep = uiEn
      ? `a page is registered, but the bio does not include the official URL (${host}). Add it so profile visitors are not left guessing.`
      : `登録ページはありますが、自己紹介文の中にも公式URL（${host}）を直接書いておくとプロフィール訪問者が迷いません。`;
  } else if (url || /https?:\/\//i.test(bio)) {
    nextStep = uiEn
      ? 'a URL or registered page is available.'
      : 'URLまたは登録ページがあります。';
  } else {
    nextStep = uiEn
      ? 'there is no official URL yet, so do not invent one.'
      : '公式URLはまだ無いので、作らないでください。';
  }
  const lines = [
    uiEn ? `Current bio: ${bio}` : `現在の自己紹介: ${bio}`,
    uiEn
      ? `1. Audience: ${who ? 'a reader is named or implied.' : 'who it is for is not clear.'}`
      : `1. 誰向けか: ${who ? '読み手が分かる語があります。' : '誰向けかがまだ明確ではありません。'}`,
    uiEn
      ? `2. What it publishes: ${offer ? 'the topic is stated.' : 'the topic is still abstract.'}`
      : `2. 何を発信するか: ${offer ? 'テーマが読めます。' : 'まだ抽象的です。'}`,
    uiEn ? `3. Next step: ${nextStep}` : `3. 次の導線: ${nextStep}`,
    uiEn ? `4. Length: ${lengthNote}` : `4. 長さ: ${lengthNote}`
  ];
  if (/7-agent|council|zero-link|stealth|guarantee|100%/i.test(bio)) {
    lines.push(uiEn
      ? '5. Wording to revise: the bio still uses older or overstated wording (for example 7-agent, stealth, or a blanket guarantee). Replace it with the practical value this account actually publishes.'
      : '5. 見直し推奨表現: 現在の仕組みとズレやすい表現（例: 7-agent / stealth 等）が含まれているため、実務価値がストレートに伝わる表現への更新をおすすめします。');
  }
  if (knowledge && knowledge.productName && !bio.toLowerCase().includes(String(knowledge.productName).toLowerCase()) && String(knowledge.productName).length >= 3) {
    lines.push(uiEn
      ? `The registered product name (${knowledge.productName}) is not in the bio.`
      : `登録済みの名称（${knowledge.productName}）が自己紹介に入っていません。`);
  }
  return lines.join('\n');
}

function buildProfileChecklist(user = {}, lang = 'ja', context = {}) {
  const uiEn = isEnLang(lang);
  const copyEn = user.aiTargetLang ? isEnLang(user.aiTargetLang) : uiEn;
  const live = context.liveProfile || {};
  const knowledge = context.brandKnowledge || user.brandKnowledge || {};
  const posture = context.posture || {};
  const rawName = clip(knowledge.productName || user.xUsername || user.workspaceLabel || '', 40);
  const url = officialUrl(user);
  const host = hostOf(url);
  const focus = clip(user.userPrompt || knowledge.icpSummary || user.brandContextNotes || '', 80);
  const mechanism = clip(knowledge.oneLineMechanism || '', 90);
  const claim = clip(knowledge.verifiedClaims && knowledge.verifiedClaims[0] && (knowledge.verifiedClaims[0].mechanism || knowledge.verifiedClaims[0].proofQuote || knowledge.verifiedClaims[0]), 80);
  const sameScript = text => !copyEn || !hasCjk(text);
  const name = sameScript(rawName) ? rawName : '';
  const currentBio = currentBioOf(user, live);
  const displayName = copyEn
    ? clip(`${name || 'Account'} | Practical notes`, 50)
    : clip(`${rawName || '名前'}｜実務メモ`, 50);
  const bioFocus = sameScript(focus) ? focus : '';
  const bioMechanism = sameScript(mechanism) ? mechanism : '';
  const bioClaim = sameScript(claim) ? claim : '';
  const bioParts = copyEn
    ? [
      `${name || 'This account'} publishes practical notes from the registered page${host ? ` (${host})` : ''}, so readers can follow one concrete step at a time.`,
      bioMechanism,
      bioClaim
    ]
    : [
      `${bioFocus || (rawName ? `${rawName}の使い方` : '読者が今日使える確認手順')}を、登録内容の範囲で短く残します。`,
      bioMechanism
    ];
  const bio = clipKeepingUrl(bioParts.filter(Boolean).join(' ') + (url ? ` ${url}` : ''), url, 160);
  const pin = copyEn
    ? clipPin([
      `${name || 'This account'} is for people who want a practical next step, not a vague promise.`,
      bioMechanism || bioClaim || 'Each post stays with one concrete point from the registered page.',
      url ? `Details: ${url}` : 'No official page is registered yet, so the post does not invent a link.'
    ].join('\n\n'), url, 280)
    : clipPin([
      `${rawName || 'このアカウント'}は、現場で次の一手を決めたい人向けに書いています。`,
      bioMechanism || claim || bioFocus || '登録した内容の範囲で、今日使える確認手順を1つ残します。',
      url ? `詳細はこちらです。\n${url}` : '公式ページはまだ登録していないので、この投稿では手順だけを残します。'
    ].join('\n\n'), url, 280);
  const pinNote = uiEn
    ? 'Check that the wording matches your brand, post it on X, and pin it to the profile. Do not add numbers that are not on the page.'
    : '公開前に自社表記に合うかご確認の上、X に投稿して「プロフィールに固定」してください。ページに無い数値は入れません。';
  const premium = /premium|basic|\bpro\b/i.test(String(live.subscriptionType || live.subscription || posture.subscription || ''));
  const highlights = premium
    ? (uiEn
      ? 'This account is on a paid X plan. Keep the pinned post as the introduction, and gather the practical posts that earned a response into Highlights.'
      : 'X有料プランをご利用中のため、固定ポストを入口案内に保ちつつ、特に反応が良かった実用投稿を「ハイライト」にまとめておけます。')
    : (uiEn
      ? 'A standard X account has no Highlights tab. The most useful first step is one carefully written pinned post.'
      : '通常の X アカウントにはハイライトタブが無いため、まずはプロフィールの「固定ポスト1本」を入口として丁寧に整えるのが最も効果的です。');
  const automated = uiEn
    ? 'Not needed for scheduled posts or Phase 1 review-and-send. Set the Automated label only for unattended Phase 2 replies, and link a different X account as the managing account. This account cannot manage itself.'
    : '通常の予約投稿と Phase 1（確認して送信）なら設定不要です。無人の Phase 2 を使うときだけ、別の X アカウントを管理アカウントとして紐付けて Automated ラベルを出します。同じアカウント自身は指定できません。';
  return {
    currentBio,
    currentBioReview: reviewCurrentBio(currentBio, uiEn, url, knowledge),
    displayName,
    bio,
    pin,
    pinNote,
    highlights,
    automated
  };
}

function sourceText(user, context, currentBio) {
  const knowledge = context.brandKnowledge || user.brandKnowledge || {};
  const claims = Array.isArray(knowledge.verifiedClaims) ? knowledge.verifiedClaims : [];
  return [
    currentBio,
    user.xUsername,
    user.targetUrl,
    user.userPrompt,
    user.brandContextNotes,
    knowledge.productName,
    knowledge.oneLineMechanism,
    knowledge.icpSummary,
    JSON.stringify(knowledge.verifiedConstraints || ''),
    claims.slice(0, 3).map(item => JSON.stringify(item)).join('\n'),
    user.voiceProfile && user.voiceProfile.accountRole,
    user.voiceProfile && user.voiceProfile.voiceSummary
  ].filter(Boolean).join('\n');
}

function bookmarkRate(job) {
  const snapshot = job && job.metrics24hSnapshot;
  if (!snapshot || snapshot.isFrozen !== true) return null;
  const impressions = Number(snapshot.impressions);
  if (!(impressions > 0)) return null;
  return ((Number(snapshot.bookmarks || 0) * 3) + (Number(snapshot.replies || 0) * 2) + Number(snapshot.likes || 0)) / impressions;
}

function selectFlagshipPlaybook(playbooks, recentPostedJobs) {
  const books = (Array.isArray(playbooks) ? playbooks : []).filter(book => book && book.id && book.topic && book.checkCriteria);
  if (!books.length) return null;
  let winner = null;
  let best = -1;
  for (const job of Array.isArray(recentPostedJobs) ? recentPostedJobs : []) {
    const rate = bookmarkRate(job);
    if (rate == null || !job.focusPlaybookId || rate <= best) continue;
    const book = books.find(item => item.id === job.focusPlaybookId);
    if (!book) continue;
    winner = book;
    best = rate;
  }
  return winner || books[0];
}

function hasUngroundedNumber(text, source) {
  const nums = String(text || '').match(/\d+(?:\.\d+)?%?/g) || [];
  return nums.some(token => !source.includes(token) && !source.includes(token.replace(/%$/, '')));
}

async function draftProfileCopy(input, systemPrompt) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { completeWriter } = require('./llm_router');
      const written = await completeWriter({
        prompt: JSON.stringify(input),
        systemPrompt,
        schemaName: 'profile_checklist',
        toolDescription: 'Return profile checklist copy.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['currentBioReview', 'displayName', 'bio', 'pin', 'pinNote'],
          properties: {
            currentBioReview: { type: 'string' },
            displayName: { type: 'string' },
            bio: { type: 'string' },
            pin: { type: 'string' },
            pinNote: { type: 'string' }
          }
        },
        maxTokens: 1600,
        timeoutMs: 45000
      });
      if (written && written.parsed) return written.parsed;
      return JSON.parse(written.text);
    } catch (err) {
      console.warn(`[Profile Checklist] ${String(err && err.message || err).slice(0, 160)}`);
    }
  }
  let grok;
  try { grok = require('./grok_client'); } catch (err) { return null; }
  if (!grok.hasXaiKey()) return null;
  const { parsed } = await grok.completeJson({
    tier: 'fast',
    timeoutMs: 18000,
    json: true,
    temperature: 0.4,
    systemPrompt,
    prompt: JSON.stringify(input)
  });
  return parsed;
}

async function buildAiProfileChecklist(user = {}, lang = 'ja', context = {}) {
  const fallback = buildProfileChecklist(user, lang, context);
  const uiEn = isEnLang(lang);
  const copyEn = user.aiTargetLang ? isEnLang(user.aiTargetLang) : uiEn;
  const knowledge = context.brandKnowledge || user.brandKnowledge || {};
  const focusPlaybook = selectFlagshipPlaybook(knowledge.domainPlaybooks, context.recentPostedJobs);
  const { planVisualCard } = require('./visual_card');
  const pinVisualCard = planVisualCard({
    portfolioRole: 'utility_save',
    focusPlaybook,
    brandKnowledge: knowledge,
    lang: copyEn ? 'en' : 'ja'
  });
  const withCard = {
    ...fallback,
    focusPlaybookId: focusPlaybook && focusPlaybook.id || '',
    pinVisualCard,
    llmUsed: false
  };
  const premium = /premium|basic|\bpro\b/i.test(String((context.liveProfile && (context.liveProfile.subscriptionType || context.liveProfile.subscription)) || (context.posture && context.posture.subscription) || user.xSubscriptionType || ''));
  const planPaid = /starter|pro|business/i.test(String(user.planId || user.tier || ''));
  const pinMax = premium || planPaid ? 450 : 280;
  if (focusPlaybook && focusPlaybook.topic && focusPlaybook.checkCriteria) {
    const anchored = clipPin([
      focusPlaybook.topic,
      focusPlaybook.checkCriteria,
      officialUrl(user) ? (copyEn ? `Details: ${officialUrl(user)}` : `詳細はこちらです。\n${officialUrl(user)}`) : ''
    ].filter(Boolean).join('\n\n'), officialUrl(user), pinMax);
    const anchoredOk = anchored && (copyEn ? !hasCjk(anchored) : hasCjk(anchored) || !hasCjk(focusPlaybook.topic));
    if (anchoredOk && !hasUngroundedNumber(anchored, sourceText(user, context, fallback.currentBio))) withCard.pin = anchored;
  }
  if (context.budgetDegraded) {
    withCard.budgetDegraded = true;
    withCard.pinNote = `${uiEn ? 'Monthly AI allowance is used, so this draft comes from the saved playbook.' : '今月のAI利用枠を使い切ったため、保存済みの判断カードから作った文です。'}${withCard.pinNote ? `\n${withCard.pinNote}` : ''}`;
    return withCard;
  }
  const claims = Array.isArray(knowledge.verifiedClaims) ? knowledge.verifiedClaims.slice(0, 3) : [];
  const input = {
    currentBio: fallback.currentBio,
    xUsername: user.xUsername || '',
    targetUrl: officialUrl(user),
    brandKnowledge: {
      productName: knowledge.productName || '',
      oneLineMechanism: knowledge.oneLineMechanism || '',
      icpSummary: knowledge.icpSummary || '',
      verifiedClaims: claims,
      verifiedConstraints: knowledge.verifiedConstraints || []
    },
    userPrompt: user.userPrompt || '',
    brandContextNotes: user.brandContextNotes || '',
    voiceProfile: {
      accountRole: user.voiceProfile && user.voiceProfile.accountRole || '',
      voiceSummary: user.voiceProfile && user.voiceProfile.voiceSummary || ''
    },
    copyLang: copyEn ? 'en' : 'ja',
    uiLang: uiEn ? 'en' : 'ja',
    pinMax,
    focusPlaybook: focusPlaybook ? {
      id: focusPlaybook.id,
      topic: focusPlaybook.topic,
      readerSituation: focusPlaybook.readerSituation,
      commonMistake: focusPlaybook.commonMistake,
      checkCriteria: focusPlaybook.checkCriteria,
      boundaryCondition: focusPlaybook.boundaryCondition
    } : null
  };
  const systemPrompt = `You draft X profile copy from the supplied account facts only. currentBioReview and pinNote use uiLang. displayName, bio, and pin use copyLang and must be paste-ready. pin is a finished post of at most ${pinMax} characters, with blank-line breaks, anchored in focusPlaybook when present. Never auto-pin instructions inside pin. bio is at most 160 characters and keeps targetUrl intact at the end when one is supplied. displayName is at most 50 characters. Do not invent percentages, follower counts, revenue, or guarantees. Return JSON with currentBioReview, displayName, bio, pin, pinNote.`;
  try {
    const parsed = await draftProfileCopy(input, systemPrompt);
    const llmUsed = Boolean(parsed && typeof parsed === 'object' && (parsed.pin || parsed.bio || parsed.displayName || parsed.currentBioReview));
    const url = officialUrl(user);
    const displayName = clip(sanitizePostOrReplyText(parsed && parsed.displayName), 50);
    const bio = clipKeepingUrl(parsed && parsed.bio, url, 160);
    const pin = clipPin(parsed && parsed.pin, url, pinMax);
    const review = String(parsed && parsed.currentBioReview || '').trim();
    const pinNote = String(parsed && parsed.pinNote || '').trim();
    const paste = `${displayName}\n${bio}\n${pin}`;
    if (!displayName || !bio || !pin || !review || !pinNote) return { ...withCard, llmUsed };
    if (url && (!bio.includes(url) || !pin.includes(url))) return { ...withCard, llmUsed };
    if (copyEn && hasCjk(paste)) return { ...withCard, llmUsed };
    if (!copyEn && !hasCjk(paste)) return { ...withCard, llmUsed };
    if (uiEn && hasCjk(review + pinNote)) return { ...withCard, llmUsed };
    if (!uiEn && !hasCjk(review + pinNote)) return { ...withCard, llmUsed };
    if (/^固定ポストは|Do not add numbers|ページに無い数値は入れません/.test(pin)) return { ...withCard, llmUsed };
    if (hasUngroundedNumber(`${bio}\n${pin}\n${displayName}`, sourceText(user, context, fallback.currentBio))) return { ...withCard, llmUsed };
    return {
      ...withCard,
      llmUsed,
      currentBioReview: review.slice(0, 1200),
      displayName,
      bio,
      pin,
      pinNote: pinNote.slice(0, 400)
    };
  } catch (err) {
    return withCard;
  }
}

module.exports = { buildProfileChecklist, buildAiProfileChecklist, selectFlagshipPlaybook };
