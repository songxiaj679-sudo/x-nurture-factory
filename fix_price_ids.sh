#!/bin/bash
cp views/funnel_index.html views/funnel_index.html.bak_prices

sed -i 's/starter: "price_dummy_starter"/starter: "price_1UbA7A2dwFBz7A1Do2iUpyYW"/g' views/funnel_index.html
sed -i 's/pro: "price_dummy_pro"/pro: "price_1UbA7j2dwFBz7A1DBtPorkbi"/g' views/funnel_index.html
sed -i 's/business: "price_dummy_business"/business: "price_1UbA892dwFBz7A1DHNPNooif"/g' views/funnel_index.html

echo "=== Price IDs Set ==="
