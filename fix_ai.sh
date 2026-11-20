#!/bin/bash
cp src/ai_deliberation_council.js src/ai_deliberation_council.js.bak_trend

sed -i '/const VIRAL_CASE_STUDIES = \[/i \
/**\n * Google Trends (RSS) から本日の急上昇ワードを取得する関数\n */\nasync function fetchTodayTrends() {\n  try {\n    const Parser = require("rss-parser");\n    const parser = new Parser();\n    const feed = await parser.parseURL("https://trends.google.com/trends/trendingsearches/daily/rss?geo=JP");\n    if (feed && feed.items && feed.items.length > 0) {\n      const trends = feed.items.slice(0, 5).map(i => i.title);\n      return trends;\n    }\n  } catch(e) { console.warn("Trend fetch error:", e.message); }\n  return ["AI活用", "働き方改革", "インボイス", "生成AI", "副業"]; // Fallback\n}\n' src/ai_deliberation_council.js

sed -i 's/let marketAnalysis = null;/const currentTrends = await fetchTodayTrends();\n  let marketAnalysis = null;/g' src/ai_deliberation_council.js

sed -i 's/【他アカウントの成功事例・勝ちパターン（ナレッジベース）】/【🎌 本日の日本国内トレンドワード (Newsjacking用)】\n${currentTrends.join("、")}\n※AI①の特別ミッション: もし可能であれば、これらのトレンドワードのいずれかを冒頭のフックや文脈に自然に織り交ぜて(Newsjacking)、インプレッションを爆発的に高めてください。ただし、宣伝内容と全く関係ない不自然な織り交ぜ方はAI④が却下してください。\n\n【他アカウントの成功事例・勝ちパターン（ナレッジベース）】/g' src/ai_deliberation_council.js

echo "=== AI Trend Hijack Implemented ==="
