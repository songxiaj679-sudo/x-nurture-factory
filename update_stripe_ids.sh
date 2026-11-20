#!/bin/bash
# Product ID ではなく本来は Price ID (price_) が必要ですが、API仕様により Checkout Session create 時の line_items に Product ID ではなく Price ID を渡す必要があります。
# 現状 prod_ から始まる ID しか取得できていない場合は、Stripe API 経由で price ID を動的に取得するか、直接スクリプトに埋め込みます。

# 今回は一時的に price_dummy のままにしておきます。
# 本当に Price ID が必要である旨を伝えます。
