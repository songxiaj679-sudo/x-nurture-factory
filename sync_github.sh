#!/bin/bash
cd ~/x-nurture-factory
git add .
git commit -m "Update: $(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')" || echo "変更はありません"
git push origin main
echo "✅ GitHubへの最新バックアップが完了しました！"
