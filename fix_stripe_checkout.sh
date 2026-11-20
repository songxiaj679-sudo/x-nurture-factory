#!/bin/bash

# LP(funnel_index.html)の決済ボタンをStripe Checkout APIへ接続する修正
cp views/funnel_index.html views/funnel_index.html.bak_stripe_checkout

sed -i 's/function handlePayClick(p, e) {/function handlePayClick(p, e) {\n      e.preventDefault();\n      const btn = e.target;\n      btn.innerText = "⏳ 決済画面を準備中...";\n      btn.style.pointerEvents = "none";\n\n      \/\/ テスト環境のPrice ID (後で松下様が取得後に置換します)\n      const priceMap = {\n        starter: "price_dummy_starter",\n        pro: "price_dummy_pro",\n        business: "price_dummy_business"\n      };\n\n      fetch("\/api\/billing\/create-checkout", {\n        method: "POST",\n        headers: { "Content-Type": "application\/json" },\n        body: JSON.stringify({ priceId: priceMap[p] })\n      }).then(r => r.json()).then(j => {\n        if (j.ok && j.url) {\n          window.location.href = j.url;\n        } else {\n          alert("決済の準備に失敗しました: " + (j.error || ""));\n          btn.innerText = "💳 決済画面へ進む";\n          btn.style.pointerEvents = "auto";\n        }\n      }).catch(err => {\n        alert("通信エラーが発生しました");\n        btn.innerText = "💳 決済画面へ進む";\n        btn.style.pointerEvents = "auto";\n      });\n      return;/g' views/funnel_index.html

echo "=== LP Stripe Checkout Button Updated ==="
