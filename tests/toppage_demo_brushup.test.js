const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { clipCleanText } = require('../src/lp_knowledge_extractor');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'views/funnel_index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/funnel/funnel.css'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public/funnel/funnel_client.js'), 'utf8');
const draft = fs.readFileSync(path.join(root, 'src/next_post_draft.js'), 'utf8');
const terms = fs.readFileSync(path.join(root, 'views/compliance_terms.html'), 'utf8');

test('a proof quote stops on a sentence instead of a mid-word cut', () => {
  const source = '無差別な自動いいね・自動フォロー・一斉リプライは行いません。受信メンションは確認して送ります。その続きは別の説明です。';
  const clipped = clipCleanText(source, 40);
  assert.ok(clipped.length <= 40);
  assert.match(clipped, /行いません。$/);
  assert.equal(clipped.endsWith('行'), false);
});

test('the homepage no longer says automatic replies never happen at all', () => {
  assert.equal(html.includes('自動返信などの挙動は一切行いません'), false);
  assert.equal(html.includes('自動いいね・自動返信なし'), false);
  assert.equal(html.includes('自動返信等のスパム的挙動は行いません'), false);
  assert.equal(html.includes('No automatic likes, follows, or replies are ever performed.'), false);
  assert.match(html, /無差別な自動いいね・自動フォロー・一斉リプライは行いません/);
  assert.match(html, /No unsolicited likes or mass replies/);
  assert.match(html, /受信メンションへの返信支援は確認制/);
});

test('the demo button and the draft voice rule are explicit in both languages', () => {
  assert.match(client, /Show the cached sample/);
  assert.match(client, /完成見本を表示する/);
  assert.equal(client.includes('別のページで試す'), false);
  assert.match(draft, /どのような示唆を与えるでしょうか/);
  assert.match(draft, /Do not stack two questions/);
  const keys = new Set();
  for (const match of html.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)) keys.add(match[1]);
  const missing = [];
  for (const key of keys) {
    if (html.split(`${key}:`).length - 1 < 2) missing.push(key);
  }
  assert.deepEqual(missing, []);
  for (const phrase of ['保証するものではありません', '成果は約束しません', '誤りや不適切な表現が含まれることがあります']) {
    assert.equal(html.includes(phrase), false, phrase);
    assert.equal(client.includes(phrase), false, phrase);
  }
  assert.match(terms, /第6条（免責事項およびAI生成内容について）/);
  assert.match(terms, /Article 6 \(Disclaimers and AI-generated content\)/);
  assert.match(html, /id="secOfficialExhibit"/);
  assert.match(html, /hero_exhibit_pill/);
  assert.match(html, /VeloxSystemsV4/);
  assert.match(html, /VeloxSystemsHQ/);
  assert.match(html, /developer\.x\.com\/exhibit\/veloxpostcloud/);
  assert.equal((html.match(/hero_exhibit_pill:/g) || []).length >= 2, true);
  assert.match(html, /id="secQuickStart"/);
  assert.match(html, /qs_h2:/);
  assert.equal((html.match(/qs_h2:/g) || []).length >= 2, true);
  const showcase = css.slice(css.indexOf('.exhibit-showcase'), css.indexOf('.exhibit-kicker'));
  assert.match(showcase, /linear-gradient\(135deg, #EFF6FF/);
  assert.equal(showcase.includes('#0F172A'), false);
  const accounts = css.slice(css.indexOf('.exhibit-accounts'), css.indexOf('.exhibit-account {'));
  assert.match(accounts, /grid-template-columns: repeat\(2/);
  assert.equal(html.includes('● developer.x.com'), false);
  assert.equal((html.match(/official_exhibit_url: "●/g) || []).length, 0);
});
