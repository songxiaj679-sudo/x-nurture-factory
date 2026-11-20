import re

with open('src/autonomous_promo_ai.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. In deliberateCouncilStrategy, define full5Posts before prompt
old_func_head = """async function deliberateCouncilStrategy(marketAnalysis, accountGrowth, userPrompt, collectiveKnowledge, scheduleTimeZone = 'Asia/Tokyo', userKnowledge = null, userPlan = 'pro') {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEYが設定されていません');

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' });"""

# Let's extract full5Posts from lines 497-668
full5_start = content.find('        const full5Posts = [')
full5_end = content.find('        if (userPlan === \'business\') {', full5_start)

if full5_start == -1 or full5_end == -1:
    print("ERROR: full5Posts markers not found!")
    exit(1)

full5_code = content[full5_start:full5_end].strip()
# Remove indentation
full5_code = re.sub(r'^[ ]{8}', '  ', full5_code, flags=re.MULTILINE)

new_func_head = f"""async function deliberateCouncilStrategy(marketAnalysis, accountGrowth, userPrompt, collectiveKnowledge, scheduleTimeZone = 'Asia/Tokyo', userKnowledge = null, userPlan = 'pro') {{
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEYが設定されていません');

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({{ model: 'gemini-3.8-flash' }});

  {full5_code}
  const targetCount = userPlan === 'business' ? 5 : (userPlan === 'starter' ? 1 : 3);"""

content = content.replace(old_func_head, new_func_head, 1)

# In prompt, adjust contract plan and post count instruction
old_prompt_plan = """- 予約タイムゾーン: ${scheduleTimeZone}（時間帯・理由はこの現地時間を基準にし、理由にもタイムゾーン名を明記）
- 契約プラン: ${userPlan} (ビジネス: 1日5投稿 / プロ運用: 1日3投稿 / スターター: 1日1投稿)"""

new_prompt_plan = """- 予約タイムゾーン: ${scheduleTimeZone}（時間帯・理由はこの現地時間を基準にし、理由にもタイムゾーン名を明記）
- 契約プラン: ${userPlan} (${userPlan === 'business' ? 'ビジネス最高峰: 1日5投稿 (朝・昼・夕・夜・深夜の24時間露出)' : (userPlan === 'starter' ? 'スターター: 1日1投稿 (朝枠)' : 'プロ運用: 1日3投稿 (朝・昼・夜のゴールデンタイム)')})
- 投稿件数指示: postPlan配列には契約プランに合わせ【必ず${targetCount}件】（${userPlan === 'business' ? '5件：朝08:30、昼12:30、夕17:30、夜20:00、深夜22:30' : (userPlan === 'starter' ? '1件：朝08:30' : '3件：朝08:30、昼12:30、夜20:00')}）を出力してください。"""

content = content.replace(old_prompt_plan, new_prompt_plan, 1)

# In try { const result = ... }, enforce postPlan count
old_try_block = """  try {
    const result = await model.generateContent(prompt);
    const cleaned = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {"""

new_try_block = """  try {
    const result = await model.generateContent(prompt);
    const cleaned = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    let planPosts = Array.isArray(parsed.postPlan) ? parsed.postPlan : [];
    if (userPlan === 'business') {
      if (planPosts.length < 5) {
        for (let i = 0; i < 5; i++) {
          if (!planPosts[i]) planPosts.push({ ...full5Posts[i], step: i + 1 });
        }
      } else if (planPosts.length > 5) {
        planPosts = planPosts.slice(0, 5);
      }
    } else if (userPlan === 'starter') {
      planPosts = planPosts.length > 0 ? [planPosts[0]] : [full5Posts[0]];
    } else {
      if (planPosts.length < 3) {
        const proDefaults = [full5Posts[0], full5Posts[1], full5Posts[3]];
        for (let i = 0; i < 3; i++) {
          if (!planPosts[i]) planPosts.push({ ...proDefaults[i], step: i + 1 });
        }
      } else if (planPosts.length > 3) {
        planPosts = planPosts.slice(0, 3);
      }
    }
    parsed.postPlan = planPosts;
    return parsed;
  } catch (e) {"""

content = content.replace(old_try_block, new_try_block, 1)

# In fallback catch block, replace postPlan: (() => { ... })
old_fallback_pattern = re.search(r'postPlan: \(\(\) => \{[\s\S]*?return full5Posts;[\s\S]*?\}\)\(\)', content)
if old_fallback_pattern:
    new_fallback_code = """postPlan: (() => {
        if (userPlan === 'business') return full5Posts;
        if (userPlan === 'starter') return [full5Posts[0]];
        return [full5Posts[0], full5Posts[1], full5Posts[3]];
      })()"""
    content = content[:old_fallback_pattern.start()] + new_fallback_code + content[old_fallback_pattern.end():]
    print("Updated fallback in deliberateCouncilStrategy")
else:
    print("Warning: old fallback pattern not found")

# Update writeCouncilApprovedPosts prompt
content = content.replace(
    '厳選された3件の投稿本文を、日本語版（120〜140文字）と英語版（220〜270文字のExecutive B2B English）の【両方】を執筆してください。',
    '計画された全${councilPlan.postPlan.length}件の投稿本文を、日本語版（120〜140文字）と英語版（220〜270文字のExecutive B2B English）の【両方】を執筆してください。'
)
content = content.replace(
    '【評議会が決定した投稿計画】',
    '【評議会が決定した投稿計画（全${councilPlan.postPlan.length}件）】'
)

# Update critiqueAndRefineDraftPosts prompt
content = content.replace(
    '前段のコピーライターが執筆した以下の「3件の投稿ドラフト（スレッド含む）」を、',
    '前段のコピーライターが執筆した以下の「全${initialDrafts.length}件の投稿ドラフト（スレッド含む）」を、'
)
content = content.replace(
    '【執筆されたドラフト投稿（全スレッド・全ツイート）】',
    '【執筆されたドラフト投稿（全${initialDrafts.length}件：全スレッド・全ツイート）】'
)

with open('src/autonomous_promo_ai.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("SUCCESS: Updated autonomous_promo_ai.js for dynamic 1/3/5 post plan!")
