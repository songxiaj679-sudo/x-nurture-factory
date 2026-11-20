'use strict';

function bodyLength(text) {
  return String(text || '').replace(/\n/g, '').trim().length;
}

function auditReadability(tweets, { lang = 'ja', formatName = '' } = {}) {
  if (formatName === 'micro_punch') return { ok: true, reasons: [] };
  const text = (Array.isArray(tweets) ? tweets : []).filter(Boolean).join('\n\n');
  const isEn = String(lang || '').toLowerCase().startsWith('en');
  const length = bodyLength(text);
  const floor = isEn ? 180 : 110;
  if (length < floor) return { ok: true, reasons: [] };
  const reasons = [];
  const first = String(text.split('\n')[0] || '').trim();
  const blanks = (text.match(/\n\n/g) || []).length;
  const hookLimit = isEn ? 110 : 48;
  const breathAt = isEn ? 240 : 150;
  const requiredBreaks = length >= breathAt ? 2 : 1;
  if (!text.includes('\n\n') || first.length > hookLimit || blanks < requiredBreaks) reasons.push('missing_hook_break');
  const wallAt = isEn ? 240 : 140;
  const wall = isEn ? 220 : 105;
  if (length >= wallAt) {
    const dense = text.split(/\n+/).some(block => block.trim().length > wall);
    if (dense) reasons.push('dense_wall_of_text');
  }
  return { ok: reasons.length === 0, reasons };
}

function readabilityPrompt(isEn) {
  return isEn
    ? 'Format for a phone screen. Put a blank line right after the opening hook. Use at least two blank lines when the post is long. Keep each block to two short sentences. Explain specialist ideas in everyday words.'
    : 'スマホの画面で読める形にする。冒頭のフックの直後に空行を入れる。長い投稿は空行を2か所以上入れる。1塊は2文まで。専門的な内容は、知らない人がそのまま使える平易な言葉で書く。';
}

module.exports = { auditReadability, readabilityPrompt, bodyLength };
