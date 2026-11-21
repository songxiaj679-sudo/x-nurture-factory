'use strict';

function groundedLine(claim) {
  const text = String(claim && (claim.proofQuote || claim.mechanism) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!text) return null;
  const allowed = (Array.isArray(claim.verifiedNumbers) ? claim.verifiedNumbers : []).map(item => String(item));
  const numbers = text.match(/\d+(?:\.\d+)?/g) || [];
  if (numbers.some(number => !allowed.some(item => item.includes(number)))) return null;
  return { text, numbers: allowed };
}

function clipCard(value, max) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const sentenceEnd = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('。'), slice.lastIndexOf('!'), slice.lastIndexOf('！'));
  if (sentenceEnd >= Math.floor(max * 0.45)) return slice.slice(0, sentenceEnd + 1).trim();
  const wordEnd = slice.lastIndexOf(' ');
  if (wordEnd >= Math.floor(max * 0.5)) return slice.slice(0, wordEnd).trim();
  return slice.trim();
}

function customerBadge(brandKnowledge, book, isEn) {
  const product = String(brandKnowledge && brandKnowledge.productName || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  if (product) return product.slice(0, 20);
  const topic = String(book && book.topic || '').replace(/\s+/g, ' ').trim();
  if (topic) return topic.slice(0, 20);
  return isEn ? 'KEY CHECK' : '実務メモ';
}

function cleanCardLine(value, max) {
  return clipCard(String(value || '').replace(/https?:\/\/\S+/gi, '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ''), max);
}

function planMythVsRealityCard({ editorialStance, coreFact, contrasts, lang } = {}) {
  const isEn = String(lang || '').toLowerCase().startsWith('en');
  const myth = cleanCardLine(editorialStance && editorialStance.rejectedNorm, isEn ? 140 : 90);
  const reality = cleanCardLine((editorialStance && editorialStance.coreBelief) || coreFact, isEn ? 140 : 90);
  const rows = (Array.isArray(contrasts) ? contrasts : []).map(row => cleanCardLine(row, isEn ? 80 : 48)).filter(Boolean).slice(0, 3);
  const eligible = Boolean(myth && reality);
  return {
    eligible,
    template: 'myth_vs_reality_card',
    lang: isEn ? 'en' : 'ja',
    badge: isEn ? 'MYTH / REALITY' : '思い込みと現場',
    title: cleanCardLine(coreFact, isEn ? 60 : 34) || (isEn ? 'One field check' : '現場の判断'),
    leftLabel: isEn ? 'Myth' : '思い込み',
    leftText: myth,
    rightLabel: isEn ? 'Reality' : '現場',
    rightText: reality,
    contrasts: rows,
    footerCheck: rows[0] || reality,
    lines: [myth, reality, ...rows].filter(Boolean).slice(0, 4).map(text => ({ text })),
    reason: !eligible ? 'missing_contrast' : (process.env.X_MEDIA_WRITE_ENABLED === 'true' ? 'ready' : 'media_write_not_enabled')
  };
}

function planVisualCard({ format, portfolioRole, focusPlaybook, brandKnowledge, lang, archetype, focusTopic, isolateLpContext } = {}) {
  if (archetype === 'myth_vs_reality') {
    return planMythVsRealityCard({
      editorialStance: brandKnowledge && brandKnowledge.editorialStance,
      coreFact: focusTopic && (focusTopic.topic || focusTopic.reality) || '',
      contrasts: focusTopic && (focusTopic.contrasts || []),
      lang
    });
  }
  const isEn = String(lang || '').toLowerCase().startsWith('en');
  const cardSlot = portfolioRole === 'utility_save' || portfolioRole === 'profile_asset_bridge';
  const book = focusPlaybook && focusPlaybook.topic && focusPlaybook.checkCriteria ? focusPlaybook : null;
  if (isolateLpContext === true && focusTopic) {
    const product = String(brandKnowledge && brandKnowledge.productName || '').trim();
    const clean = value => {
      const text = clipCard(value, 400);
      if (product.length >= 2 && text.toLowerCase().includes(product.toLowerCase())) return '';
      if (/登録ページ|saved page|registered page/i.test(text)) return '';
      return text;
    };
    const base = {
      eligible: false,
      lang: isEn ? 'en' : 'ja',
      mediaIds: [],
      format: format || '',
      focusPlaybookId: book && book.id || '',
      reason: 'text_only_archetype'
    };
    if (archetype === 'before_after_rewrite') {
      const beforeText = clean(focusTopic.weakExample).slice(0, isEn ? 140 : 88);
      const afterText = clean(focusTopic.strongExample).slice(0, isEn ? 140 : 88);
      if (beforeText && afterText) {
        return {
          ...base,
          eligible: true,
          template: 'before_after_card',
          badge: isEn ? 'BEFORE / AFTER' : 'Before → After',
          title: clean(focusTopic.topic).slice(0, isEn ? 60 : 34),
          beforeLabel: isEn ? 'Before — Easily Skipped' : '× 反応が止まる例',
          beforeText,
          afterLabel: isEn ? 'After — Clear & Bookmarkable' : '○ 伝わる書き換え',
          afterText,
          footerCheck: clean(focusTopic.whyItWorks).slice(0, isEn ? 135 : 74),
          lines: [{ text: afterText.slice(0, 80) }],
          reason: process.env.X_MEDIA_WRITE_ENABLED === 'true' ? 'ready' : 'media_write_not_enabled'
        };
      }
    }
    if (archetype === 'actionable_checklist') {
      const steps = (Array.isArray(focusTopic.steps) ? focusTopic.steps : []).map(step => clean(step).slice(0, isEn ? 105 : 58)).filter(Boolean).slice(0, 3);
      if (steps.length === 3) {
        return {
          ...base,
          eligible: true,
          template: 'checklist_3step_card',
          badge: isEn ? '3-STEP CHECK' : '3つの確認ポイント',
          title: clean(focusTopic.topic).slice(0, isEn ? 60 : 34),
          steps,
          footerCheck: clean(focusTopic.boundaryNote || focusTopic.readerPain).slice(0, isEn ? 135 : 74),
          lines: steps.map(text => ({ text: text.slice(0, 80) })),
          reason: process.env.X_MEDIA_WRITE_ENABLED === 'true' ? 'ready' : 'media_write_not_enabled'
        };
      }
    }
    if (archetype === 'failure_autopsy' && cardSlot) {
      const leftText = clean(focusTopic.commonTrap).slice(0, isEn ? 140 : 90);
      const rightText = clean(focusTopic.practicalFix).slice(0, isEn ? 140 : 90);
      if (leftText && rightText) {
        return {
          ...base,
          eligible: true,
          template: 'editorial_split',
          badge: isEn ? 'PRACTICAL NOTE' : '実務メモ',
          title: clean(focusTopic.topic).slice(0, isEn ? 68 : 42),
          leftLabel: isEn ? 'Common Trap' : 'よくあるつまずき',
          leftText,
          rightLabel: isEn ? 'Practical Fix' : '今日の直し方',
          rightText,
          footerCheck: clean(focusTopic.boundaryNote || focusTopic.realCause).slice(0, isEn ? 140 : 76),
          lines: [{ text: rightText.slice(0, 80) }],
          reason: process.env.X_MEDIA_WRITE_ENABLED === 'true' ? 'ready' : 'media_write_not_enabled'
        };
      }
    }
    return {
      ...base,
      template: 'editorial_split',
      badge: isEn ? 'PRACTICAL NOTE' : '実務メモ',
      title: '',
      leftLabel: '',
      leftText: '',
      rightLabel: '',
      rightText: '',
      footerCheck: '',
      lines: []
    };
  }
  const eligible = Boolean(cardSlot && book);
  const enabled = process.env.X_MEDIA_WRITE_ENABLED === 'true';
  return {
    eligible,
    template: 'editorial_split',
    lang: isEn ? 'en' : 'ja',
    badge: customerBadge(brandKnowledge, book, isEn),
    title: book ? clipCard(book.topic, isEn ? 68 : 42) : '',
    leftLabel: isEn ? 'Common Assumption' : 'ありがちな前提',
    leftText: book ? clipCard(book.commonMistake || book.readerSituation, isEn ? 140 : 90) : '',
    rightLabel: isEn ? 'Practical Check' : '実務の確認基準',
    rightText: book ? clipCard(book.checkCriteria, isEn ? 140 : 90) : '',
    footerCheck: book ? clipCard(book.boundaryCondition, isEn ? 140 : 76) : '',
    lines: book ? [{ text: clipCard(book.checkCriteria, 80) }] : [],
    mediaIds: [],
    reason: !eligible
      ? (cardSlot ? 'no_focus_playbook' : 'not_visual_slot')
      : (enabled ? 'ready' : 'media_write_not_enabled'),
    format: format || '',
    focusPlaybookId: book && book.id || ''
  };
}

async function loadCardFonts() {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '../assets/fonts');
  const regular = fs.readFileSync(path.join(dir, 'NotoSansJP-Regular.otf'));
  const bold = fs.readFileSync(path.join(dir, 'NotoSansJP-Bold.otf'));
  return [
    { name: 'Noto Sans JP', data: regular, weight: 400, style: 'normal' },
    { name: 'Noto Sans JP', data: bold, weight: 700, style: 'normal' }
  ];
}

function beforeAfterMarkup(plan) {
  const isEn = String(plan && plan.lang || '').toLowerCase().startsWith('en');
  const title = String(plan && plan.title || '');
  const before = String(plan && plan.beforeText || '');
  const after = String(plan && plan.afterText || '');
  const footer = String(plan && plan.footerCheck || '');
  const titleSize = title.length > (isEn ? 46 : 22) ? 40 : 44;
  const beforeSize = isEn ? (before.length > 100 ? 24 : 26) : (before.length > 60 ? 26 : 30);
  const afterSize = isEn ? (after.length > 100 ? 24 : 26) : (after.length > 60 ? 26 : 30);
  const footerSize = footer.length > (isEn ? 100 : 56) ? 21 : 24;
  const block = (label, text, labelColor, textColor, background, border, textWeight) => ({
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', width: '100%', backgroundColor: background, border, borderRadius: 16, padding: '18px 24px' },
      children: [
        { type: 'div', props: { style: { color: labelColor, fontSize: 20, fontWeight: 700 }, children: label } },
        { type: 'div', props: { style: { marginTop: 10, color: textColor, fontSize: text.length ? (label === (plan.beforeLabel || '') ? beforeSize : afterSize) : 26, lineHeight: 1.34, fontWeight: textWeight }, children: text } }
      ]
    }
  });
  return {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', width: 1200, height: 675, backgroundColor: '#FFFFFF', fontFamily: 'Noto Sans JP' },
      children: [
        { type: 'div', props: { style: { display: 'flex', height: 10, width: '100%', backgroundColor: '#2563EB' } } },
        { type: 'div', props: { style: { flex: 1, padding: '26px 36px 24px 36px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }, children: [
          { type: 'div', props: { style: { display: 'flex', alignSelf: 'flex-start', backgroundColor: '#2563EB', color: '#FFFFFF', borderRadius: 999, padding: '7px 18px', fontSize: 20, fontWeight: 700 }, children: plan.badge || '' } },
          { type: 'div', props: { style: { marginTop: 14, color: '#0F172A', fontSize: titleSize, fontWeight: 700, lineHeight: 1.2 }, children: title } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }, children: [
            block(plan.beforeLabel || '', before, '#BE123C', '#334155', '#FFF1F2', '1.5px solid #FECDD3', 400),
            block(plan.afterLabel || '', after, '#1D4ED8', '#0F172A', '#EFF6FF', '1.5px solid #93C5FD', 700)
          ] } },
          { type: 'div', props: { style: { borderTop: '1.5px solid #E2E8F0', paddingTop: 14, marginTop: 18, color: '#334155', fontSize: footerSize, lineHeight: 1.36 }, children: footer } }
        ] } }
      ]
    }
  };
}

function checklistMarkup(plan) {
  const isEn = String(plan && plan.lang || '').toLowerCase().startsWith('en');
  const title = String(plan && plan.title || '');
  const footer = String(plan && plan.footerCheck || '');
  const steps = Array.isArray(plan && plan.steps) ? plan.steps.slice(0, 3) : [];
  const titleSize = title.length > (isEn ? 46 : 22) ? 40 : 44;
  const stepSize = isEn ? 24 : 28;
  const footerSize = footer.length > (isEn ? 100 : 56) ? 21 : 24;
  return {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', width: 1200, height: 675, backgroundColor: '#FFFFFF', fontFamily: 'Noto Sans JP' },
      children: [
        { type: 'div', props: { style: { display: 'flex', height: 10, width: '100%', backgroundColor: '#2563EB' } } },
        { type: 'div', props: { style: { flex: 1, padding: '26px 36px 24px 36px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }, children: [
          { type: 'div', props: { style: { display: 'flex', alignSelf: 'flex-start', backgroundColor: '#2563EB', color: '#FFFFFF', borderRadius: 999, padding: '7px 18px', fontSize: 20, fontWeight: 700 }, children: plan.badge || '' } },
          { type: 'div', props: { style: { marginTop: 14, color: '#0F172A', fontSize: titleSize, fontWeight: 700, lineHeight: 1.2 }, children: title } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }, children: steps.map((step, index) => ({
            type: 'div',
            props: {
              style: { display: 'flex', alignItems: 'center', gap: 18, backgroundColor: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: 14, padding: '16px 22px' },
              children: [
                { type: 'div', props: { style: { display: 'flex', width: 44, height: 44, borderRadius: 999, backgroundColor: '#2563EB', color: '#FFFFFF', fontSize: 22, fontWeight: 700, alignItems: 'center', justifyContent: 'center' }, children: String(index + 1).padStart(2, '0') } },
                { type: 'div', props: { style: { color: '#0F172A', fontSize: stepSize, fontWeight: 700, lineHeight: 1.32 }, children: String(step || '') } }
              ]
            }
          })) } },
          { type: 'div', props: { style: { borderTop: '1.5px solid #E2E8F0', paddingTop: 14, marginTop: 18, color: '#334155', fontSize: footerSize, lineHeight: 1.36 }, children: footer } }
        ] } }
      ]
    }
  };
}

function mythMarkup(plan) {
  const contrasts = Array.isArray(plan && plan.contrasts) ? plan.contrasts.slice(0, 3) : [];
  const split = cardMarkup({ ...plan, template: 'editorial_split' });
  const column = split.props.children[1].props.children;
  if (contrasts.length) {
    column.splice(2, 0, {
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 },
        children: contrasts.map(text => ({
          type: 'div',
          props: { style: { color: '#334155', fontSize: 22, lineHeight: 1.3 }, children: String(text || '') }
        }))
      }
    });
  }
  return split;
}

function cardMarkup(plan) {
  if (plan && plan.template === 'before_after_card') return beforeAfterMarkup(plan);
  if (plan && plan.template === 'checklist_3step_card') return checklistMarkup(plan);
  if (plan && plan.template === 'myth_vs_reality_card') return mythMarkup(plan);
  const isEn = String(plan && plan.lang || '').toLowerCase().startsWith('en');
  const title = String(plan && plan.title || '');
  const left = String(plan && plan.leftText || '');
  const right = String(plan && plan.rightText || '');
  const footer = String(plan && plan.footerCheck || '');
  const titleSize = isEn ? (title.length > 48 ? 36 : 40) : (title.length > 24 ? 38 : 44);
  const leftSize = isEn ? (left.length > 105 ? 24 : 28) : (left.length > 62 ? 28 : 32);
  const rightSize = isEn ? (right.length > 105 ? 24 : 28) : (right.length > 62 ? 28 : 32);
  const footerSize = isEn ? (footer.length > 105 ? 20 : 22) : (footer.length > 58 ? 21 : 24);
  const bodyLine = isEn ? 1.36 : 1.44;
  return {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', width: 1200, height: 675, backgroundColor: '#FFFFFF', fontFamily: 'Noto Sans JP' },
      children: [
        { type: 'div', props: { style: { display: 'flex', height: 10, width: '100%', backgroundColor: '#2563EB' } } },
        { type: 'div', props: { style: { flex: 1, padding: '26px 36px 24px 36px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxSizing: 'border-box' }, children: [
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column' }, children: [
            { type: 'div', props: { style: { display: 'flex', alignSelf: 'flex-start', backgroundColor: '#2563EB', color: '#FFFFFF', borderRadius: 999, padding: '7px 18px', fontSize: 20, fontWeight: 700 }, children: plan.badge || (isEn ? 'KEY CHECK' : '実務メモ') } },
            { type: 'div', props: { style: { marginTop: 14, color: '#0F172A', fontSize: titleSize, fontWeight: 700, lineHeight: 1.2 }, children: title } }
          ] } },
          { type: 'div', props: { style: { display: 'flex', gap: 22, marginTop: 20, flex: 1 }, children: [
            { type: 'div', props: { style: { flex: 1, backgroundColor: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: 18, padding: '22px 26px', display: 'flex', flexDirection: 'column' }, children: [
              { type: 'div', props: { style: { color: '#475569', fontSize: 22, fontWeight: 700 }, children: plan.leftLabel || '' } },
              { type: 'div', props: { style: { marginTop: 12, color: '#334155', fontSize: leftSize, lineHeight: bodyLine }, children: left } }
            ] } },
            { type: 'div', props: { style: { flex: 1, backgroundColor: '#EFF6FF', border: '1.5px solid #93C5FD', borderRadius: 18, padding: '22px 26px', display: 'flex', flexDirection: 'column' }, children: [
              { type: 'div', props: { style: { color: '#1D4ED8', fontSize: 22, fontWeight: 700 }, children: plan.rightLabel || '' } },
              { type: 'div', props: { style: { marginTop: 12, color: '#0F172A', fontSize: rightSize, lineHeight: bodyLine, fontWeight: 700 }, children: right } }
            ] } }
          ] } },
          { type: 'div', props: { style: { borderTop: '1.5px solid #E2E8F0', paddingTop: 14, marginTop: 18, color: '#334155', fontSize: footerSize, lineHeight: 1.36 }, children: footer } }
        ] } }
      ]
    }
  };
}

async function renderVisualCardPng(plan) {
  const satori = require('satori').default || require('satori');
  const { Resvg } = require('@resvg/resvg-js');
  const fonts = await loadCardFonts();
  const svg = await satori(cardMarkup(plan || {}), { width: 1200, height: 675, fonts });
  const png = Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng());
  if (!png.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('png_signature_missing');
  }
  if (!png.length || png.length > 5 * 1024 * 1024) throw new Error('png_size_invalid');
  return png;
}

function renderGroundedCard(plan) {
  const lines = plan && Array.isArray(plan.lines) ? plan.lines.map(line => line && line.text).filter(Boolean).slice(0, 4) : [];
  const body = lines.map((line, index) => `<text x="72" y="${180 + index * 88}" font-size="32" font-family="sans-serif" fill="#0f172a">${escapeXml(line)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#f8fafc"/>${body}</svg>`;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

module.exports = { planVisualCard, planMythVsRealityCard, renderGroundedCard, renderVisualCardPng, cardMarkup };
