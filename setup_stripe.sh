#!/bin/bash
cp src/shop.js src/shop.js.bak_stripe

# StripeライブラリのRequireを追加
sed -i '/const express = require("express");/i const Stripe = require("stripe");\nconst stripe = Stripe(process.env.STRIPE_SECRET_KEY);' src/shop.js

# 古い仮想通貨（OxaPay）の関数をごっそり削除（コメントアウト）して審査のクリーンさを保つ
sed -i 's/async function createOxaPayInvoice/\/\/ async function createOxaPayInvoice/g' src/shop.js
sed -i 's/async function checkOxaPayStatus/\/\/ async function checkOxaPayStatus/g' src/shop.js
sed -i 's/async function createExternalKycSession/\/\/ async function createExternalKycSession/g' src/shop.js

# Stripe Checkout 用のAPIエンドポイントを追加
cat << 'ROUTE_EOF' >> src/shop.js

// === Stripe Checkout API (新規追加) ===
app.post('/api/billing/create-checkout', async (req, res) => {
  try {
    // ※後ほど本番環境の価格IDに差し替えます
    const priceId = req.body.priceId; 
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription', // 月額課金
      success_url: 'https://veloxpostapp.com/dashboard?payment=success',
      cancel_url: 'https://veloxpostapp.com/dashboard?payment=cancelled',
    });
    res.json({ ok: true, url: session.url });
  } catch (error) {
    console.error('Stripe Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});
ROUTE_EOF

pm2 restart x-shop
echo "=== Stripe API Setup Complete ==="
