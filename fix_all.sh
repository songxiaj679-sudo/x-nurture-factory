#!/bin/bash

# 1. バックアップ
cp src/shop.js src/shop.js.bak2

# 2. 必要なライブラリのRequireを追加
sed -i '/const app = express();/i const session = require("express-session");\nconst passport = require("./auth_google");' src/shop.js

# 3. HTTPリダイレクトループ（502エラーの原因）を無効化
sed -i 's/return res.redirect(301, "https:\/\/" + req.headers.host + req.originalUrl);/\/\/ return res.redirect(301, "https:\/\/" + req.headers.host + req.originalUrl);/g' src/shop.js

# 4. セッションとGoogleログインのルーティングを追加
sed -i '/app.use(express.urlencoded({ extended: true, limit: '\''20mb'\'' }));/i \
app.use(session({\n  secret: process.env.SESSION_SECRET || "veloxpost_secret",\n  resave: false,\n  saveUninitialized: false,\n  cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 }\n}));\napp.use(passport.initialize());\napp.use(passport.session());\n\napp.use("/views", express.static(path.join(__dirname, "../views")));\n\napp.get("/api/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));\napp.get("/api/auth/google/callback", \n  passport.authenticate("google", { failureRedirect: "/?error=auth_failed" }),\n  function(req, res) {\n    res.send(`\n      <script>\n        localStorage.setItem("xsw_token", "${req.user.id}_token");\n        localStorage.setItem("xsw_uid", "${req.user.id}");\n        localStorage.setItem("xsw_tier", "${req.user.plan || "free"}");\n        window.location.href = "/";\n      </script>\n    `);\n  }\n);\n' src/shop.js

# 5. 確認と再起動
echo "=== 修正完了 ==="
pm2 restart all
