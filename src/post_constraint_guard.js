/**
 * @file src/post_constraint_guard.js
 * @description 投稿文生成後の確定事後バリデーション＆サニタイザー（ガードレール）
 * 
 * 【防衛対象】
 * 1. 本文（第1ツイート）内URL直貼りの完全検出・2段目リプライへの自動移行（複数URL欠落防止・句読点分離）
 * 2. 禁止ワードプールの文面破壊なきスマート置換（最長一致・文脈依存・相対時間保護）
 * 3. スロット別アングル排他マトリクスの境界検査
 * 4. 日英両言語およびスレッド配列（tweets）全体への網羅的適用
 */

// 日本語の禁止語句（長い順・文脈順）
const FORBIDDEN_WORDS_JA = [
  '溶かしていた',
  '溶かして',
  '白紙の画面',
  '画面を睨み',
  'キーボードが止まる',
  '月30時間',
  '100時間',
  '30時間',
  '45分'
];

// 英語の禁止語句
const FORBIDDEN_WORDS_EN = [
  'burning 45 minutes',
  'staring at a blank screen',
  'blank screen',
  '40 hours/month'
];

class PostConstraintError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PostConstraintError';
    this.code = 'post_constraint_ambiguous';
  }
}

function assertPostThreadUnambiguous(tweets, options = {}) {
  if (!Array.isArray(tweets) || tweets.length === 0 ||
      tweets.some(text => typeof text !== 'string' || !text.trim())) {
    throw new PostConstraintError('投稿文が空または不正なため自動投稿を停止しました。');
  }

  for (const [index, text] of tweets.entries()) {
    const urlCandidates = text.match(/https?:\/\/[^\s<>"'「」『』（）]+/giu) || [];
    for (const candidate of urlCandidates) {
      const withoutPunctuation = candidate.replace(/[。、，．！？）］”’]+$/u, '');
      if (/[^\x00-\x7F]/u.test(withoutPunctuation)) {
        throw new PostConstraintError('URLと周囲の文章を安全に分離できないため自動投稿を停止しました。');
      }
    }

    const { violations, extractedUrls } = validateAndEnforcePostConstraints(text, {
      ...options,
      timeSlot: index === 0 ? options.timeSlot : null
    });
    if (violations.some(violation => !violation.startsWith('url_in_body:'))) {
      throw new PostConstraintError('投稿文の表現を安全に自動修正できないため自動投稿を停止しました。');
    }
    if (index === 0 && extractedUrls.length > 0) {
      let remaining = text;
      for (const url of [...extractedUrls].sort((a, b) => b.length - a.length)) {
        remaining = remaining.split(url).join('');
      }
      if (!remaining.replace(/[\s()[\]（）。、,.!?！？]/gu, '')) {
        throw new PostConstraintError('URLを除く投稿本文がないため自動投稿を停止しました。');
      }
    }
  }
}

/**
 * テキストからRFC 3986準拠のURLを抽出し、末尾の日本語句読点や不整合括弧を分離・クリーンアップする
 * （日本語文章「https://example.com/guideをご覧ください。」がURLに飲み込まれないようRFC 3986 ASCII文字に厳格限定）
 * 
 * @param {string} text
 * @returns {string[]} クリーンなURL配列
 */
function extractCleanUrls(text) {
  // RFC 3986 準拠のURL構成文字（日本語文字は含めず、日本語文との境界を自然に分離）
  const rawUrlRegex = /https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;%=]+/g;
  const matches = String(text || '').match(rawUrlRegex) || [];
  const cleanUrls = [];

  for (const url of matches) {
    // 末尾に付着した日本語・ASCII句読点（。、！？など）を分離
    let cleaned = url.replace(/[。、，．！？!?,:;）］\]”’]+$/u, '');
    cleaned = cleaned.replace(/[\.\,\:\;\!\?]+$/, '');

    // URL内の開き括弧と閉じ括弧のバランスを検証（Wikipedia等の正常な括弧付きURLを保護し、外側の括弧のみ除去）
    const openParens = (cleaned.match(/\(/g) || []).length;
    const closeParens = (cleaned.match(/\)/g) || []).length;
    if (closeParens > openParens) {
      cleaned = cleaned.replace(/\)+$/, '');
    }

    if (cleaned.length > 8 && !cleanUrls.includes(cleaned)) {
      cleanUrls.push(cleaned);
    }
  }

  return cleanUrls;
}

/**
 * 単一ツイート文字列の制約適合性を検査・サニタイズする
 * 
 * @param {string} rawText - 検査対象テキスト
 * @param {Object} [options={}]
 * @param {string} [options.lang='ja'] - 言語 ('ja' | 'en')
 * @param {string} [options.timeSlot] - スロット ('morning' | 'noon' | 'afternoon' | 'evening' | 'night')
 * @returns {{ isValid: boolean, sanitizedText: string, extractedUrls: string[], violations: string[] }}
 */
function validateAndEnforcePostConstraints(rawText, options = {}) {
  const violations = [];
  let text = String(rawText || '').trim();
  const lang = options.lang === 'en' ? 'en' : 'ja';

  // 1. 本文内URL直貼りの検出と分離（最長一致順置換で /a による /ab 破壊防止・同一URL重複本文残留防止・句読点保護）
  const extractedUrls = extractCleanUrls(text);
  if (extractedUrls.length > 0) {
    violations.push(`url_in_body: ${extractedUrls.join(', ')}`);
    // 長いURLから順に除去することで、https://example.com/a が https://example.com/ab の接頭辞として誤除去され残骸 "b" が残るのを防止
    const sortedUrls = [...extractedUrls].sort((a, b) => b.length - a.length);
    for (const u of sortedUrls) {
      // 本文内に同一URLが複数回出現している場合でも全件完全に除去
      text = text.split(u).join('');
    }

    // 空の括弧 () や 余分な空白の整理
    text = text.replace(/\(\s*\)/g, '').replace(/（\s*）/g, '');
    text = text.replace(/[ \t]+([。、，．！？])/g, '$1');
    text = text.replace(/[ \t]{2,}/g, ' ');
    // 行末・行頭のゴミ空白を整理（改行は保持）
    text = text.split('\n').map(l => l.trim()).filter((l, idx, arr) => {
      return l.length > 0 || (idx > 0 && arr[idx - 1].length > 0);
    }).join('\n').trim();

    // URLのみで本文が空になった場合の安全フォールバック
    if (!text) {
      text = lang === 'en'
        ? 'Operational blueprint and executive insights. Details linked in pinned thread below.'
        : '現場検証に基づく実務プロトコル。詳細および公式アップデートは下記リプライへ整理しました。';
    }
  }

  // 2. 禁止ワードプールの安全な置換（文面破壊防止・文脈依存・相対時間保護）
  if (lang === 'ja') {
    // 2-1. 月間工数自慢（「月〇時間」）および禁止プール語（30時間、100時間、45分）のみを厳密置換
    // 数字の途中一致（「130時間」に「30時間」が誤一致して「1多くの手作業工数」になる破壊）を (?<!\d) で完全遮断
    // 相対時間表現（「10分前」「10分 前」「5分後」「3分以内」「2時間半」「2時間後」等）や会議の所要時間（「130時間続いた」等）は保護
    if (/(?:月\s*)\d+\s*時間(?!\s*(?:前|後|以[内上降]|刻|頃|目|おき|半|程度|未満))/.test(text)) {
      violations.push('forbidden_metric: 月〇時間');
      text = text.replace(/(?:月\s*)\d+\s*時間(?!\s*(?:前|後|以[内上降]|刻|頃|目|おき|半|程度|未満))/g, '多くの手作業工数');
    }
    if (/(?<!\d)(?:100|30)\s*時間(?!\s*(?:前|後|以[内上降]|刻|頃|目|おき|半|程度|未満|発|着|発着|待ち|睡眠|休憩|移動))/.test(text)) {
      violations.push('forbidden_metric: 100/30時間');
      text = text.replace(/(?<!\d)(?:100|30)\s*時間(?!\s*(?:前|後|以[内上降]|刻|頃|目|おき|半|程度|未満|発|着|発着|待ち|睡眠|休憩|移動))/g, '多くの手作業工数');
    }
    if (/(?<!\d)(?:45)\s*分(?!\s*(?:前|後|以[内上降]|刻|頃|目|おき|半|程度|未満|発|着|発着|待ち|睡眠|休憩|移動))/.test(text)) {
      violations.push('forbidden_metric: 45分');
      text = text.replace(/(?<!\d)(?:45)\s*分(?!\s*(?:前|後|以[内上降]|刻|頃|目|おき|半|程度|未満|発|着|発着|待ち|睡眠|休憩|移動))/g, '多くの作業時間');
    }

    // 2-2. 定型フレーズの順次置換（最長一致順・else if を排し全出現箇所を網羅処理）
    if (text.includes('体験を溶かしていた')) {
      violations.push('forbidden_word: 体験を溶かしていた');
      text = text.replace(/体験を溶かしていた/g, '体験を消費してしまっていた');
    }
    if (text.includes('溶かしていた')) {
      violations.push('forbidden_word: 溶かしていた');
      text = text.replace(/溶かしていた/g, '消費してしまっていた');
    }
    if (text.includes('溶かして')) {
      violations.push('forbidden_word: 溶かして');
      text = text.replace(/溶かして/g, '無駄にして');
    }

    if (text.includes('白紙の画面')) {
      violations.push('forbidden_word: 白紙の画面');
      text = text.replace(/白紙の画面/g, 'ゼロからの下書き作業');
    }
    if (text.includes('画面を睨み')) {
      violations.push('forbidden_word: 画面を睨み');
      text = text.replace(/画面を睨み/g, '思考が堂々巡りし');
    }
    if (text.includes('キーボードが止まる')) {
      violations.push('forbidden_word: キーボードが止まる');
      text = text.replace(/キーボードが止まる/g, '作業の手が止まる');
    }

    // 3. スロット別アングル排他マトリクスの整合性検査
    const slot = String(options.timeSlot || '').toLowerCase();
    if (slot.includes('morning')) {
      if (/工数削減|削減自慢/.test(text)) {
        violations.push('morning_slot_violates_effort_metric');
        text = text.replace(/工数削減|削減自慢/g, '業務ルーティンの型化');
      }
    }
  } else {
    // 英語文のサニタイズ（相対時間 before/after/ago 等は保護）
    if (/burning\s+\d+\s*minutes(?!\s*(?:before|after|ago|later))/i.test(text)) {
      violations.push('forbidden_metric_en: burning minutes');
      text = text.replace(/burning\s+\d+\s*minutes(?!\s*(?:before|after|ago|later))/gi, 'Spending valuable morning bandwidth');
    }
    if (/staring at a blank screen/i.test(text)) {
      violations.push('forbidden_word_en: blank screen');
      text = text.replace(/staring at a blank screen/gi, 'drafting content without a structured system');
    }
    if (/\d+\s*hours\/month/i.test(text)) {
      violations.push('forbidden_metric_en: hours/month');
      text = text.replace(/\d+\s*hours\/month/gi, 'repetitive operational overhead');
    }
  }

  return {
    isValid: violations.length === 0,
    sanitizedText: text,
    extractedUrls,
    violations
  };
}

/**
 * 投稿スレッド配列全体（tweets / tweets_en）に対して制約を強制し、
 * 本文（tweets[0]）から抽出されたURLを第2ツイート（リプライ枠）へ確実に移行する。
 * 複数のURLが存在する場合も1件も欠落させず全て移行・保持する。
 * 
 * @param {string[]} tweets - ツイート配列 [本文, リプライ1, ...]
 * @param {Object} [options={}]
 * @param {string} [options.lang='ja']
 * @param {string} [options.timeSlot]
 * @returns {{ tweets: string[], violations: string[] }}
 */
function enforcePostThreadConstraints(tweets, options = {}) {
  assertPostThreadUnambiguous(tweets, options);
  const list = (Array.isArray(tweets) && tweets.length > 0 ? [...tweets] : [''])
    .map(t => String(t || ''));
  const allViolations = [];
  const lang = options.lang === 'en' ? 'en' : 'ja';

  // 1. 本文（第1ツイート）の制約検査＆サニタイズ
  const bodyResult = validateAndEnforcePostConstraints(list[0], options);
  list[0] = bodyResult.sanitizedText;
  allViolations.push(...bodyResult.violations);

  // 2. 本文からURLが抽出された場合、第2ツイート（2段目リプライ）へ全件安全に移行
  if (bodyResult.extractedUrls.length > 0) {
    if (list.length > 1 && list[1].trim()) {
      // 既存の2段目リプライがある場合、完全一致Setで既存URLを判定し、未追加URLのみを追記
      // （https://example.com/a が https://example.com/ab の部分一致で誤って既存扱いされるのを防止）
      const existingReplyUrls = new Set(extractCleanUrls(list[1]));
      const missingUrls = bodyResult.extractedUrls.filter(u => !existingReplyUrls.has(u));
      if (missingUrls.length > 0) {
        list[1] = `${list[1].trim()}\n\n${missingUrls.join('\n')}`;
      }
    } else {
      // 2段目リプライが存在しない場合は新設して全URLを格納
      const replyPrefix = lang === 'en'
        ? '▼ Reference details and enterprise asset:'
        : '▼ 詳細および公式案内はこちら：';
      list[1] = `${replyPrefix}\n${bodyResult.extractedUrls.join('\n')}`;
    }
  }

  // 3. 後続のリプライ（第2ツイート以降）も禁止ワード等をサニタイズ（リプライのURLは許可）
  for (let i = 1; i < list.length; i++) {
    const existingUrls = extractCleanUrls(list[i]);
    let sanitizedReply = list[i];

    // リプライ枠のURLを一時退避（同一URL重複時も全件置換）
    existingUrls.forEach((u, idx) => {
      sanitizedReply = sanitizedReply.split(u).join(`__URL_PLACEHOLDER_${idx}__`);
    });

    const replyResult = validateAndEnforcePostConstraints(sanitizedReply, { ...options, timeSlot: null });
    allViolations.push(...replyResult.violations);

    let restoredReply = replyResult.sanitizedText;
    existingUrls.forEach((u, idx) => {
      restoredReply = restoredReply.split(`__URL_PLACEHOLDER_${idx}__`).join(u);
    });
    list[i] = restoredReply;
  }

  return {
    tweets: list,
    violations: allViolations
  };
}

module.exports = {
  PostConstraintError,
  assertPostThreadUnambiguous,
  FORBIDDEN_WORDS: FORBIDDEN_WORDS_JA,
  FORBIDDEN_WORDS_JA,
  FORBIDDEN_WORDS_EN,
  extractCleanUrls,
  validateAndEnforcePostConstraints,
  enforcePostThreadConstraints
};
