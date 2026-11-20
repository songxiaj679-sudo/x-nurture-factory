const fs = require('fs');
const path = 'src/shop.js';
let content = fs.readFileSync(path, 'utf8');

// 重複しているルーティングを正規表現で綺麗に削除
content = content.replace(/app\.use\("\/views", express\.static\(path\.join\(__dirname, "\.\.\/views"\)\)\);\n/g, '');
content = content.replace(/app\.use\(session\(\{[\s\S]*?\}\)\);\n/g, '');
content = content.replace(/app\.use\(passport\.initialize\(\)\);\n/g, '');
content = content.replace(/app\.use\(passport\.session\(\)\);\n/g, '');
content = content.replace(/app\.get\("\/api\/auth\/google"[\s\S]*?\}\n\);\n/g, '');

// クリーンな状態で1回だけ挿入
const cleanRoutes = `
app.use(session({
  secret: process.env.SESSION_SECRET || "veloxpost_secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use("/views", express.static(path.join(__dirname, "../views")));

app.get("/api/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
app.get("/api/auth/google/callback", 
  passport.authenticate("google", { failureRedirect: "/?error=auth_failed" }),
  function(req, res) {
    res.send(\`
      <script>
        localStorage.setItem("xsw_token", "\${req.user.id}_token");
        localStorage.setItem("xsw_uid", "\${req.user.id}");
        localStorage.setItem("xsw_tier", "\${req.user.plan || "free"}");
        window.location.href = "/dashboard";
      </script>
    \`);
  }
);
`;

content = content.replace('const app = express();', 'const app = express();\n' + cleanRoutes);
fs.writeFileSync(path, content);
console.log('Shop.js cleaned and fixed.');
