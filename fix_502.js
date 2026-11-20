const fs = require('fs');
const path = 'src/shop.js';
let content = fs.readFileSync(path, 'utf8');

// リダイレクトループの原因となる HTTPS 強制ブロックをコメントアウト
content = content.replace(
  'if (req.headers["x-forwarded-proto"] === "http" && req.hostname && !req.hostname.includes("localhost")) {',
  '// if (req.headers["x-forwarded-proto"] === "http" && req.hostname && !req.hostname.includes("localhost")) {'
);
content = content.replace(
  'return res.redirect(301, "https://" + req.headers.host + req.originalUrl);',
  '// return res.redirect(301, "https://" + req.headers.host + req.originalUrl);'
);

fs.writeFileSync(path, content);
console.log('Fixed redirect loop.');
