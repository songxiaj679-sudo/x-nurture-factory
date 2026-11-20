#!/bin/bash
# 502エラーとルート（/views/〜）の修正パッチ
cp src/shop.js src/shop.js.bak_routes

# httpsリダイレクトの完全無効化
sed -i 's/app.enable("trust proxy");/\/\/ app.enable("trust proxy");/g' src/shop.js
sed -i 's/if (req.headers\["x-forwarded-proto"\] === "http" && req.hostname && !req.hostname.includes("localhost")) {/\/\/ if (req.headers\["x-forwarded-proto"\] === "http" && req.hostname && !req.hostname.includes("localhost")) {/g' src/shop.js
sed -i 's/return res.redirect(301, "https:\/\/" + req.headers.host + req.originalUrl);/\/\/ return res.redirect(301, "https:\/\/" + req.headers.host + req.originalUrl);/g' src/shop.js
sed -i 's/res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");/\/\/ res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");/g' src/shop.js

# viewsへのルーティングを明示的に追加（既存の記述が空振りしている可能性に対応）
sed -i '/app.use(express.json({ limit: '\''20mb'\'' }));/a app.use("\/views", express.static(path.join(__dirname, "..\/views")));' src/shop.js

# lane=2のリンク修正
sed -i 's/href="http:\/\/localhost:3001\/#lane=2"/href="\/"/g' views/funnel_index.html

echo "=== Applying fixes and restarting... ==="
pm2 restart all
