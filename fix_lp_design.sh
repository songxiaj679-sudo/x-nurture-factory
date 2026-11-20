#!/bin/bash
cp views/funnel_index.html views/funnel_index.html.bak_design

# 1. ナビゲーションの日本語化と整理
sed -i 's/<a href="#secReviews">Reviews<\/a>/<a href="#secReviews">導入実績<\/a>/g' views/funnel_index.html
sed -i 's/<a href="#secExplorer">Architecture<\/a>/<a href="#secExplorer">5大技術<\/a>/g' views/funnel_index.html
sed -i 's/<a href="#secPerformance">Silicon<\/a>/<a href="#secPerformance">自律エンジン<\/a>/g' views/funnel_index.html
sed -i 's/<a href="#secMultiStream">3-Stream & AI<\/a>/<a href="#secMultiStream">AI営業<\/a>/g' views/funnel_index.html
sed -i 's/<a href="#secSecurity">ISP Shield<\/a>/<a href="#secSecurity">セキュリティ<\/a>/g' views/funnel_index.html
sed -i 's/<a href="#liveDemoSection">Live Demo<\/a>/<a href="#liveDemoSection">無料デモ<\/a>/g' views/funnel_index.html
sed -i 's/<a href="#secEditions">Pricing<\/a>/<a href="#secEditions">料金プラン<\/a>/g' views/funnel_index.html

# 2. 多言語ドロップダウンを 日本語/英語 のみにスッキリさせる
sed -i '/<button type="button" class="lang-opt" data-lang="zh-CN"/,/<button type="button" class="lang-opt" data-lang="ru"/d' views/funnel_index.html

# 3. 料金プラン下にStripe決済対応（カードロゴ）のアピールを追加
sed -i '/<p class="sec-lead">Select your autonomous marketing tier./a \          <div style="margin-top:12px; display:flex; justify-content:center; align-items:center; gap:8px;">\n            <span style="font-size:0.85rem; font-weight:700; color:#64748B;">安心・安全な決済システム:</span>\n            <span style="background:#6366F1; color:#FFF; font-weight:900; font-size:0.75rem; padding:3px 8px; border-radius:4px;">Stripe</span>\n            <span style="font-size:1.2rem;">💳 🍏</span>\n          </div>' views/funnel_index.html

# 4. Stripe審査対策：フッターに返金ポリシー（No-Refund Policy）の明記を強化
sed -i 's/© 2026 VeloxPost Cloud. All rights reserved. | Autonomous AI Marketing & B2B Growth Infrastructure/© 2026 VeloxPost Cloud. All rights reserved.<br><span style="font-size:0.7rem; color:#64748B;">本サービスはデジタルコンテンツの性質上、決済完了後の返金には応じられません。詳細は利用規約をご確認ください。<\/span>/g' views/funnel_index.html

echo "=== LP Design & Compliance Updated ==="
