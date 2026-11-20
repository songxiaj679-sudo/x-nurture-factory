#!/bin/bash
# データベースの検索エラー（502の原因）を回避するパッチ
cp src/ai_deliberation_council.js src/ai_deliberation_council.js.bak_index

sed -i "s/.where('status', '==', 'posted')//g" src/ai_deliberation_council.js

echo "=== Firestore Index Error Fixed ==="
pm2 restart all
