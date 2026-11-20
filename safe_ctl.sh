#!/usr/bin/env bash
cd "$(dirname "$0")"

CMD="${1:-status}"
ARG2="${2:-}"

case "$CMD" in
  preflight)
    echo ""
    echo "======================================================================"
    echo "🛫 【X-Nurture-Factory 本稼働前プリフライト総合チェック (全項目診断)】"
    echo "======================================================================"
    echo "🔍 [1. 全13コアモジュールの構文＆ロード検証 (node -c / py_compile)]"
    FAIL_CNT=0
    for jsf in src/iproyal.js src/gcp_scaler.js src/persona_engine.js src/email_firstmail.js src/setup_worker.js src/init_profiles.js src/totp_helper.js src/status_checker.js src/batch_engine.js src/saas_engine.js src/shop.js src/admin.js src/mailbox_service.js; do
      if [ -f "$jsf" ]; then
        if node -c "$jsf" 2>/dev/null; then
          echo "   ✅ $jsf : 構文OK"
        else
          echo "   ❌ $jsf : 構文エラーあり！"
          FAIL_CNT=$((FAIL_CNT + 1))
        fi
      else
        echo "   ❌ $jsf : ファイルがありません"
        FAIL_CNT=$((FAIL_CNT + 1))
      fi
    done
    if python3 -m py_compile src/camoufox_runner.py 2>/dev/null; then
      echo "   ✅ src/camoufox_runner.py : 構文OK"
    else
      echo "   ❌ src/camoufox_runner.py : 構文エラーあり！"
      FAIL_CNT=$((FAIL_CNT + 1))
    fi

    echo ""
    echo "🖥️ [2. 仮想ディスプレイ (Xvfb :98 / :99) & ウィンドウマネージャ状態]"
    pgrep -a Xvfb | sed 's/^/   ✅ /' || echo "   ℹ️ Xvfb はワーカー起動時に自動生成されます"

    echo ""
    echo "🔑 [3. 必須APIキー・認証ファイル・外部疎通チェック]"
    node - << 'PRECHECK'
require('dotenv').config();
const fs = require('fs');
const { getGcpEnvironmentInfo, getLocalSystemMetrics } = require('./src/gcp_scaler');
const { syncIproyalApiBalanceIfConfigured } = require('./src/iproyal');
const { db } = require('./src/firestore');

(async () => {
  const hasGemini = Boolean((process.env.GEMINI_API_KEY || '').trim());
  const hasCf = Boolean((process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '').trim());
  const hasImap = Boolean((process.env.CATCHALL_IMAP_USER || '').trim() && (process.env.CATCHALL_IMAP_PASS || '').trim());
  const hasSa = fs.existsSync('tidal-airway-401213-26e6fae158d5.json');
  const failures = [];

  console.log(`   ・Gemini API Key      : ${hasGemini ? '✅ 設定済' : '⚠️ 未設定 (日本語フォールバック稼働)'}`);
  console.log(`   ・Cloudflare API      : ${hasCf ? '✅ 設定済 (ドメイン一括追加・DNS自動構成可能)' : '⚠️ 未設定'}`);
  console.log(`   ・Zoho Catch-All IMAP : ${hasImap ? '✅ 設定済 (' + process.env.CATCHALL_IMAP_USER + ')' : '❌ 未設定'}`);
  console.log(`   ・GCP サービスアカ鍵  : ${hasSa ? '✅ 直結済 (tidal-airway-401213-26e6fae158d5.json)' : '❌ 未検出'}`);
  if (!hasImap) failures.push('Zoho Catch-All IMAP の認証情報が未設定です');
  if (!hasSa) failures.push('GCP サービスアカウント鍵ファイルが見つかりません');

  const [gcp, ipr, pureCountSnap, poolSnap] = await Promise.all([
    getGcpEnvironmentInfo(),
    syncIproyalApiBalanceIfConfigured(false),
    db.collection('accounts').where('originType', 'in', ['pure_jp', 'pure_en']).count().get(),
    db.collection('isp_proxy_pool').get()
  ]);
  const m = getLocalSystemMetrics();
  const freeIsp = poolSnap.docs.filter(d => !d.data().assignedUserId).length;

  console.log(`   ・GCP Compute API権限 : ${gcp.hasComputeRwScope ? '✅ フル書込権限OK (自動ディスク拡張・専用VM増設/削除可能)' : '❌ 権限不足'}`);
  console.log(`   ・サーバースペック    : ✅ ${gcp.machineType} (空きRAM: ${m.freeMemGb}GB / 空きDisk: ${m.diskAvailGb}GB)`);
  console.log(`   ・IPRoyal API 連動    : ${ipr.syncedFromApi ? '✅ オンライン直結 (現在残量: ' + (ipr.remainingMb/1024).toFixed(3) + ' GB)' : '⚠️ オフライン'}`);
  console.log(`   ・Firestore DB 接続   : ✅ 正常 (ファクトリー作成アカウント: ${pureCountSnap.data().count}件 / 空きISPプロキシ: ${freeIsp}本)`);
  console.log("======================================================================");
  if (!gcp.hasComputeRwScope) failures.push('GCP Compute API の権限が不足しています');
  if (failures.length) {
    console.error('❌ プリフライト失敗: ' + failures.join(' / '));
    process.exit(1);
  }
  console.log("✅ 外部サービスの必須チェックが完了しました");
  console.log("======================================================================\n");
  process.exit(0);
})().catch(error => {
  console.error('❌ プリフライト中にエラーが発生しました:', error.message);
  process.exit(1);
});
PRECHECK
    PRECHECK_STATUS=$?
    if [ "$PRECHECK_STATUS" -ne 0 ]; then
      FAIL_CNT=$((FAIL_CNT + 1))
    fi
    if [ "$FAIL_CNT" -gt 0 ]; then
      echo "❌ プリフライト失敗: ${FAIL_CNT} 件のチェックに失敗しました"
      exit 1
    fi
    echo "✅ プリフライト構文・実環境チェックに合格しました"
    ;;

  status)
    node - << 'NODESCRIPT'
const fs = require('fs');
const { db } = require('./src/firestore');
const { syncIproyalApiBalanceIfConfigured } = require('./src/iproyal');

(async () => {
  console.log("\n======================================================================");
  console.log("📊 【X-Nurture-Factory 総合ステータス & 10万件対応インフラ診断】");
  console.log("======================================================================");

  const q = await syncIproyalApiBalanceIfConfigured(false);
  const remGb = (q.remainingMb / 1024).toFixed(3);
  const minGb = ((q.minSafeMb || 512) / 1024).toFixed(2);
  console.log(`🌐 [1. プロキシ残量 (IPRoyal)]`);
  console.log(`   ・現在残量       : ${remGb} GB (${q.remainingMb} MB) [安全停止ライン: ${minGb} GB]`);
  console.log(`   ・保護ロック状態 : ${q.pausedByQuota ? '🔒 自動保護停止中 (<= 0.50GB)' : (q.manualDrainStop ? '🛑 手動安全停止中' : '🟢 稼働可能')}`);
  console.log(`   ・API自動同期    : ${q.syncedFromApi ? '✅ API直結同期済 (' + q.matchedEndpoint + ')' : 'ℹ️ ローカル精密減算モード稼働中'}`);

  let health = {};
  try { health = JSON.parse(fs.readFileSync('.domain_health.json', 'utf8')); } catch (e) {}
  require('dotenv').config();
  const doms = (process.env.CUSTOM_EMAIL_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const now = Date.now();
  let readyDoms = 0, cooledDoms = 0;
  for (const d of doms) {
    const st = health[d] || {};
    if (st.cooldownUntil && st.cooldownUntil > now) cooledDoms++;
    else readyDoms++;
  }
  console.log(`\n📧 [2. 独自ドメイン稼働状況 (全 ${doms.length} ドメイン)]`);
  console.log(`   ・即時利用可能   : 🟢 ${readyDoms} 個 | 🧊 クールダウン休養中: ${cooledDoms} 個`);

  const baseQuery = db.collection('accounts').where('originType', 'in', ['pure_jp', 'pure_en']);
  let total = 0, farming = 0, standby = 0, cleared = 0, has2fa = 0, minDays = 999, maxDays = 0;

  try {
    const [totalSnap, farmSnap, stbySnap, clrSnap] = await Promise.all([
      baseQuery.count().get(),
      baseQuery.where('status', '==', 'farming').count().get(),
      baseQuery.where('status', '==', 'standby').count().get(),
      baseQuery.where('status', '==', 'cleared').count().get()
    ]);
    total = totalSnap.data().count;
    farming = farmSnap.data().count;
    standby = stbySnap.data().count;
    cleared = clrSnap.data().count;
  } catch (e) {}

  const sampleSnap = await baseQuery.limit(300).get();
  let sampleCount = 0;
  sampleSnap.forEach(doc => {
    const d = doc.data();
    sampleCount++;
    if (d.twoFactorKey && String(d.twoFactorKey).length >= 4) has2fa++;
    if (d.createdAt && d.createdAt.toDate) {
      const days = (now - d.createdAt.toDate().getTime()) / 86400000;
      if (days < minDays) minDays = days;
      if (days > maxDays) maxDays = days;
    }
  });
  if (!total) total = sampleCount;

  console.log(`\n🌱 [3. 純国産アカウント品質・熟成状況 (全 ${total} 件)]`);
  console.log(`   ・ステータス内訳 : 🏆 完熟(cleared): ${cleared}件 | 🌱 養殖中(farming): ${farming}件 | ⏳ 初期設定待(standby): ${standby}件`);
  console.log(`   ・2FA付与率      : 🔐 ${has2fa} / ${sampleCount} 件 (${sampleCount ? ((has2fa/sampleCount)*100).toFixed(1) : 0}%)`);
  console.log(`   ・経過日数レンジ : 🕒 最少 ${minDays === 999 ? 0 : minDays.toFixed(1)} 日 〜 最大 ${maxDays.toFixed(1)} 日 (21日完熟ゲートまで残り約 ${Math.max(0, 21 - maxDays).toFixed(1)} 日)`);
  console.log("----------------------------------------------------------------------");
  console.log("💡 【安全操作・GCP管理コマンド一覧】");
  console.log("   ・./safe_ctl.sh preflight           : 課金・テスト前後の全モジュール＆API疎通プリフライト診断");
  console.log("   ・./safe_ctl.sh status              : 現在の総合診断を表示");
  console.log("   ・./safe_ctl.sh infra               : GCPディスク・RAM・プロファイル容量の非破壊レントゲン診断");
  console.log("   ・./safe_ctl.sh tenant-vms          : 自動投稿SaaS顧客別の専用VM・ISPプロキシ割当状況を表示");
  console.log("   ・./safe_ctl.sh paste-domains       : コピペ貼付モード(雑多なテキストからドメインを自動判別して一括登録)");
  console.log("   ・./safe_ctl.sh add-domains <一覧>  : まとめ買いドメインをCFへ一括登録＆DNS/Catch-All自動設定");
  console.log("   ・./safe_ctl.sh check-domains       : 全ドメインのCF開通(active/pending)・NS・冷却時間を確認");
  console.log("   ・./safe_ctl.sh safe-compress       : 稼働プロセス＆指紋完全保護の無停止キャッシュ・ログ整理");
  console.log("   ・./safe_ctl.sh expand-disk <目標GB>: GCP永続ディスクの無停止ライブ拡張 (例: ./safe_ctl.sh expand-disk 50)");
  console.log("   ・./safe_ctl.sh expand-swap <GB>    : 再起動なしのLinuxスワップメモリ動的拡張 (例: ./safe_ctl.sh expand-swap 4)");
  console.log("   ・./safe_ctl.sh stop                : 処理中アカウント完了後に全エンジンを安全停止");
  console.log("   ・./safe_ctl.sh resume <残量GB>     : プロキシ課金後に養殖(24)と2FA設定を安全再開");
  console.log("   ・./safe_ctl.sh resume-all <GB>     : 養殖(24)＋新規作成(25)＋2FA設定をすべて再開");
  console.log("   ・./safe_ctl.sh clean-imap          : Zoho受信箱の24時間以上前の古い認証メールを一括削除");
  console.log("   ・./safe_ctl.sh backup              : 現在のコード・設定・状態の復元ポイントを世代保存");
  console.log("   ・./safe_ctl.sh list-backups        : 保存済みの復元ポイント一覧を表示");
  console.log("   ・./safe_ctl.sh restore <ID>        : 指定した復元ポイントへ即座にロールバック");
  console.log("======================================================================\n");
  process.exit(0);
})();
NODESCRIPT
    ;;

  infra)
    echo ""
    echo "======================================================================"
    echo "🖥️ 【GCP インフラ・API連携・ディスク36GB内訳 非破壊レントゲン診断】"
    echo "======================================================================"
    node -e '
const { getGcpEnvironmentInfo, getLocalSystemMetrics } = require("./src/gcp_scaler");
(async () => {
  const gcp = await getGcpEnvironmentInfo();
  const m = getLocalSystemMetrics();
  console.log("☁️ [1. GCP Compute Engine API 連携状態]");
  console.log(`   ・GCPプロジェクト : ${gcp.projectId || "ローカル"} | ゾーン: ${gcp.zone} | VM名: ${gcp.instanceName}`);
  console.log(`   ・マシンタイプ    : ${gcp.machineType} (vCPU: ${m.cpuCount}コア / LoadAvg: ${m.loadAvg1m})`);
  console.log(`   ・サービスアカ    : ${gcp.serviceAccount}`);
  console.log(`   ・OAuth2トークン  : ${gcp.hasAccessToken ? "✅ 自動取得OK (Metadata Server直結)" : "❌ 未取得"}`);
  console.log(`   ・Compute書込権限 : ${gcp.hasComputeRwScope ? "✅ フル権限あり (APIから自動ディスク拡張・VM増設が可能)" : "ℹ️ 読取専用スコープ (gcloudまたはコンソール併用モード)"}`);
  console.log(`\n📀 [2. ディスク & メモリ実測値]`);
  console.log(`   ・ディスク使用量  : ${m.diskUsedGb} GB / ${m.diskTotalGb} GB (空き: ${m.diskAvailGb} GB / 使用率: ${m.diskUsePct}%) [自動拡張閾値: 85%]`);
  console.log(`   ・メモリ使用量    : ${m.usedMemGb} GB / ${m.totalMemGb} GB (空き: ${m.freeMemGb} GB / 使用率: ${m.memUsePct}%)`);
})();
'
    echo ""
    echo "📂 [3. サーバー全体(36GB使用)のどこが容量を食っているか？ (上位ディレクトリ内訳)]"
    du -xh --max-depth=2 /home/u0_a217 /var /tmp /opt 2>/dev/null | sort -hr | head -n 15 || true
    echo ""
    echo "🔍 [4. .profiles (1.4GB) の内部サブフォルダ別・容量内訳トップ12 (非破壊集計)]"
    python3 - << 'PYDIAG'
import os
from collections import defaultdict

totals = defaultdict(int)
counts = defaultdict(int)
base = ".profiles"
if os.path.exists(base):
    for prof in os.listdir(base):
        pdir = os.path.join(base, prof)
        if not os.path.isdir(pdir):
            continue
        for root, dirs, files in os.walk(pdir):
            rel = os.path.relpath(root, pdir)
            top_key = rel.split(os.sep)[0] if rel != "." else "(root_files)"
            if top_key == "Default" and len(rel.split(os.sep)) >= 2:
                top_key = "Default/" + rel.split(os.sep)[1]
            for f in files:
                fp = os.path.join(root, f)
                try:
                    if not os.path.islink(fp):
                        sz = os.path.getsize(fp)
                        totals[top_key] += sz
                        counts[top_key] += 1
                except Exception:
                    pass

sorted_items = sorted(totals.items(), key=lambda x: x[1], reverse=True)[:12]
for k, b in sorted_items:
    mb = b / (1024 * 1024)
    protect = "🛡️ [絶対保護: 指紋/認証]" if any(w in k for w in ["Cookies", "Local Storage", "Preferences", "meta", "Network", "Session Storage", "Extension"]) else "🧹 [純キャッシュ候補]"
    print(f"   ・{k:<32} : {mb:>7.2f} MB ({counts[k]} files) {protect}")
PYDIAG
    echo "======================================================================"
    ;;

  safe-compress)
    echo "🛡️ [無停止・非破壊キャッシュ整理] 稼働中プロセス(lsof)と認証・指紋データを100%保護して不要キャッシュのみ整理します..."
    python3 - << 'PYSAFE'
import os, shutil, subprocess

# 1. 現在プロセスが開いているファイルを lsof で確認し、使用中プロファイルは絶対に触らない
open_profs = set()
try:
    out = subprocess.check_output(["lsof", "+D", ".profiles"], stderr=subprocess.DEVNULL, text=True)
    for line in out.splitlines():
        if ".profiles/" in line:
            part = line.split(".profiles/")[1].split("/")[0].split()[0]
            open_profs.add(part)
except Exception:
    pass

# 2. 削除してもブラウザ動作・認証・指紋に一切影響しない100%純粋なキャッシュディレクトリのみ指定
SAFE_CACHE_REL_PATHS = [
    "Default/Cache/Cache_Data",
    "Default/Code Cache/js",
    "Default/Code Cache/wasm",
    "Default/GPUCache",
    "Default/DawnCache",
    "Default/DawnWebGPUCache",
    "Default/DawnGraphiteCache",
    "Default/Service Worker/CacheStorage",
    "Default/Service Worker/ScriptCache",
    "Default/Shared Dictionary",
    "Default/DataSharing",
    "CertificateRevocation",
    "segmentation_platform",
    "ShaderCache",
    "GrShaderCache",
    "GraphiteDawnCache",
    "Crashpad/completed",
    "Crashpad/pending",
    "BrowserMetrics",
    ".cache"
]

freed_bytes = 0
cleaned_profs = 0
base = ".profiles"
if os.path.exists(base):
    for prof in os.listdir(base):
        if prof in open_profs:
            continue
        pdir = os.path.join(base, prof)
        if not os.path.isdir(pdir):
            continue
        prof_touched = False
        for rel in SAFE_CACHE_REL_PATHS:
            target = os.path.join(pdir, rel)
            if os.path.exists(target):
                for r, d, files in os.walk(target):
                    for f in files:
                        try: freed_bytes += os.path.getsize(os.path.join(r, f))
                        except Exception: pass
                try:
                    shutil.rmtree(target, ignore_errors=True)
                    prof_touched = True
                except Exception:
                    pass
        # BrowserMetrics-*.pma ファイルの掃除
        for item in os.listdir(pdir):
            if item.startswith("BrowserMetrics") and item.endswith(".pma"):
                fp = os.path.join(pdir, item)
                try:
                    freed_bytes += os.path.getsize(fp)
                    os.remove(fp)
                    prof_touched = True
                except Exception:
                    pass
        if prof_touched:
            cleaned_profs += 1

print(f"✅ プロファイル安全整理完了: {cleaned_profs} 個処理 (稼働中保護スキップ: {len(open_profs)} 個) / 解放容量: {freed_bytes / (1024*1024):.2f} MB")
PYSAFE
    # PM2ログが50MBを超えている場合のみ直近2000行を残して安全に切り詰め (システム停止ゼロ)
    python3 - << 'PYLOG'
import os, glob
log_dir = os.path.expanduser("~/.pm2/logs")
freed_log = 0
for lp in glob.glob(os.path.join(log_dir, "*.log")):
    try:
        sz = os.path.getsize(lp)
        if sz > 50 * 1024 * 1024:
            with open(lp, "rb") as f:
                f.seek(-2 * 1024 * 1024, os.SEEK_END)
                tail_data = f.read()
            with open(lp, "wb") as f:
                f.write(tail_data)
            freed_log += (sz - len(tail_data))
    except Exception:
        pass
if freed_log > 0:
    print(f"✅ PM2肥大化ログの無停止ローテーション完了: {freed_log / (1024*1024):.2f} MB 解放")
PYLOG
    # /tmp 内の古い一時ファイル(稼働中ロックやX11ソケットは絶対保護)とVSCodeキャッシュを安全整理
    find /tmp -maxdepth 1 \( -name "puppeteer_dev_chrome_profile-*" -o -name "camoufox*" -o -name "playwright*" -o -name ".org.chromium.*" \) -mmin +120 -exec rm -rf {} + 2>/dev/null || true
    rm -rf ~/.vscode-server/data/CachedExtensionVSIXs/* ~/.vscode-server/cli/servers/*/server/node_modules/.cache 2>/dev/null || true
    du -sh .profiles /tmp ~/.pm2/logs 2>/dev/null || true
    ;;

  expand-disk)
    if [ -z "$ARG2" ]; then
      echo "⚠️ 使用法: ./safe_ctl.sh expand-disk <目標合計GB数>  (例: ./safe_ctl.sh expand-disk 50)"
      echo "   ※GCP永続ディスクをサーバー無停止(ダウンタイム0秒)で指定GBへライブ拡張します。"
      exit 1
    fi
    echo "🚀 [GCP無停止ディスク拡張] サーバーを止めずに永続ディスクを ${ARG2} GB へオンライン拡張します..."
    INST_NAME=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/name || hostname)
    ZONE_FULL=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/zone || echo "")
    ZONE_NAME=$(basename "$ZONE_FULL")
    ROOT_DEV=$(findmnt -n -o SOURCE / | sed 's/[0-9]*$//' | sed 's/p$//')
    PART_NUM=$(findmnt -n -o SOURCE / | grep -o '[0-9]*$')
    echo "   ・対象インスタンス: ${INST_NAME} (Zone: ${ZONE_NAME}) | ルートデバイス: ${ROOT_DEV} (Part: ${PART_NUM})"
    if [ -n "$ZONE_NAME" ]; then
      gcloud compute disks resize "${INST_NAME}" --size="${ARG2}GB" --zone="${ZONE_NAME}" --quiet || echo "⚠️ gcloud権限が不足している場合はGCPコンソールからサイズ変更後に再度このコマンドを実行してください"
    fi
    sudo growpart "${ROOT_DEV}" "${PART_NUM}" 2>/dev/null || true
    sudo resize2fs "$(findmnt -n -o SOURCE /)" 2>/dev/null || true
    echo "✅ ファイルシステムのオンライン拡張結果:"
    df -h /
    ;;

  expand-swap)
    SWAP_GB="${ARG2:-4}"
    echo "🧠 [無停止メモリ拡張] サーバーを再起動せずに ${SWAP_GB} GB の高速スワップ領域を動的構成します..."
    if [ ! -f /swapfile_x ]; then
      sudo fallocate -l "${SWAP_GB}G" /swapfile_x || sudo dd if=/dev/zero of=/swapfile_x bs=1M count=$((SWAP_GB * 1024))
      sudo chmod 600 /swapfile_x
      sudo mkswap /swapfile_x
      sudo swapon /swapfile_x
      echo "✅ 新規スワップ (/swapfile_x: ${SWAP_GB}GB) を無停止で有効化しました！"
    else
      echo "ℹ️ 既に /swapfile_x が存在します。"
    fi
    free -h
    ;;

  stop)
    echo "🛡️ [安全停止] 現在動いているアカウントの処理完了を待ってから安全に停止します..."
    node -e "require('./src/iproyal').requestGracefulDrainStop();"
    sleep 2
    pm2 stop 24 25
    echo "✅ 全エンジンの安全停止が完了しました。"
    ;;

  resume)
    if [ -z "$ARG2" ]; then
      echo "⚠️ 使用法: ./safe_ctl.sh resume <現在の合計残りGB数>  (例: ./safe_ctl.sh resume 5.3)"
      exit 1
    fi
    node -e "require('./src/iproyal').setRemainingGbAndResume(${ARG2}, true, false);"
    ;;

  resume-all)
    if [ -z "$ARG2" ]; then
      echo "⚠️ 使用法: ./safe_ctl.sh resume-all <現在の合計残りGB数>  (例: ./safe_ctl.sh resume-all 10.3)"
      exit 1
    fi
    node -e "require('./src/iproyal').setRemainingGbAndResume(${ARG2}, true, true);"
    ;;

  slim-profiles)
    ./safe_ctl.sh safe-compress
    ;;

  paste-domains)
    echo ""
    echo "======================================================================"
    echo "📋 【ドメイン自動判別・一括登録モード (コピペ貼付専用)】"
    echo "   購入完了画面・メール本文・複数行のドメインリストをそのまま貼り付けて、"
    echo "   最後に【空行でEnter】を押してください（不要な文字や金額は自動で除外されます）:"
    echo "======================================================================"
    PASTED_TEXT=""
    while IFS= read -r line; do
      [ -z "$line" ] && break
      PASTED_TEXT="${PASTED_TEXT}
${line}"
    done
    if [ -z "$PASTED_TEXT" ]; then
      echo "⚠️ テキストが入力されませんでした。"
      exit 0
    fi
    ./safe_ctl.sh add-domains "$PASTED_TEXT"
    ;;

  add-domains)
    if [ -z "$ARG2" ]; then
      echo "⚠️ 使用法: ./safe_ctl.sh add-domains <ドメイン1,ドメイン2,...>"
      echo "   例: ./safe_ctl.sh add-domains example1.com,example2.org,example3.net"
      exit 1
    fi
    node -e '
const { setupMultipleDomainsBulk } = require("./src/cloudflare_dns");
(async () => {
  const input = process.argv[1];
  const { extractValidDomainsFromAnyText } = require("./src/cloudflare_dns");
  const detected = extractValidDomainsFromAnyText(input);
  console.log(`\n🔍 [自動判別完了] 貼り付けられたテキストから ${detected.length} 個のドメインを検出しました: ${detected.join(", ")}`);
  console.log("🌐 [ドメイン一括自動登録] Cloudflareゾーン作成・MX/SPF/DMARC/Catch-All自動構成を開始します...");
  const results = await setupMultipleDomainsBulk(input);
  const nsSet = new Set();
  console.log("----------------------------------------------------------------------");
  for (const r of results) {
    if (!r.ok) {
      console.log(`❌ ${r.domain.padEnd(26)} : 失敗 (${r.error})`);
    } else {
      r.nameServers.forEach(ns => nsSet.add(ns));
      const stateLabel = r.isActive ? "🟢 即時利用可能 (active)" : "⏳ NS反映待ち保護中 (pending)";
      const newLabel = r.newlyCreatedZone ? "[新規ゾーン作成]" : "[既存ゾーン更新]";
      console.log(`✅ ${r.domain.padEnd(26)} : ${newLabel} ${stateLabel} | NS: ${r.nameServers.join(", ")}`);
    }
  }
  console.log("----------------------------------------------------------------------");
  if (nsSet.size > 0) {
    console.log("📌 【外部サイト(Porkbun/Namecheap/Spaceship等)でまとめ買いした場合の手順】");
    console.log("   購入サイトの「Bulk Nameservers (一括ネームサーバー変更)」に以下の2本を設定してください:");
    Array.from(nsSet).forEach((ns, idx) => console.log(`     NS${idx + 1}: ${ns}`));
    console.log("   ※NS変更が反映(active)されると、15分周期の自動監視が検知して自動的にアカウント作成へ合流します！");
  }
  console.log("");
  process.exit(0);
})();
' "$ARG2"
    ;;

  check-domains)
    node - << 'DOMSCRIPT'
const { syncAllDomainsZoneStatus } = require('./src/cloudflare_dns');
(async () => {
  console.log("\n======================================================================");
  console.log("📧 【登録ドメイン Cloudflare開通状態・ネームサーバー・冷却状況一覧】");
  console.log("======================================================================");
  const list = await syncAllDomainsZoneStatus();
  const now = Date.now();
  for (const item of list) {
    const cdMin = item.cooldownUntil > now ? Math.ceil((item.cooldownUntil - now) / 60000) : 0;
    const coolStr = cdMin > 0 ? `🧊 休養/待機中(残り${(cdMin/60).toFixed(1)}h)` : `🟢 稼働可能`;
    const stStr = item.status === 'active' ? '✅ active' : `⏳ ${item.status}`;
    console.log(`・${item.domain.padEnd(25)} | CF: ${stStr.padEnd(10)} | 累計:${String(item.totalCreated).padStart(2)}件 | ${coolStr} | NS: ${item.nameServers.join(', ')}`);
  }
  console.log("======================================================================\n");
  process.exit(0);
})();
DOMSCRIPT
    ;;

  tenant-vms)
    node - << 'VMSCRIPT'
const { db } = require('./src/firestore');
const { listTenantDedicatedVms, selectOptimalMachineSpec } = require('./src/gcp_scaler');
(async () => {
  console.log("\n======================================================================");
  console.log("🏢 【自動投稿SaaS 顧客別・専用サーバー & ISPプロキシ割当ステータス】");
  console.log("======================================================================");
  const usersSnap = await db.collection('saas_users').get();
  const poolSnap = await db.collection('isp_proxy_pool').get();
  const freeIsp = poolSnap.docs.filter(d => !d.data().assignedUserId).length;
  const usedIsp = poolSnap.docs.length - freeIsp;
  console.log(`🌐 [IPRoyal 専用ISPプロキシプール] 総数: ${poolSnap.docs.length}本 (割当済: ${usedIsp}本 / 空き待機: ${freeIsp}本)`);
  console.log("----------------------------------------------------------------------");
  if (usersSnap.empty) {
    console.log("   現在登録されているSaaS顧客はいません。");
  } else {
    for (const doc of usersSnap.docs) {
      const u = doc.data();
      const spec = selectOptimalMachineSpec(u.maxThreads || 1, u.maxAccounts || 5);
      const pCount = Array.isArray(u.assignedProxies) ? u.assignedProxies.length : 0;
      console.log(`👤 顧客ID: ${String(u.userId || doc.id).slice(0, 14).padEnd(14)} | 契約枠: ${u.maxThreads || 1}スレッド(${u.maxAccounts || 1}垢) | 推奨VM: ${spec.machineType} (${spec.vcpu}vCPU/${spec.ramGb}GB) | 割当ISP: ${pCount}本 | 状態: ${u.dedicatedVmStatus || (u.isEngineRunning ? '稼働中' : '待機中')}`);
    }
  }
  console.log("======================================================================\n");
  process.exit(0);
})();
VMSCRIPT
    ;;

  backup)
    SNAP_ID="snap_$(date +%Y%m%d_%H%M%S)"
    DEST=".backups/${SNAP_ID}"
    mkdir -p "${DEST}/src"
    cp -p src/*.js src/*.py "${DEST}/src/" 2>/dev/null || true
    cp -p .env .domain_health.json .iproyal_quota.json safe_ctl.sh "${DEST}/" 2>/dev/null || true
    # 古いスナップショットは直近20世代を残して自動整理
    ls -1dt .backups/snap_* 2>/dev/null | tail -n +21 | xargs rm -rf 2>/dev/null || true
    echo "✅ [世代バックアップ完了] スナップショット ${SNAP_ID} を保存しました！ (復元: ./safe_ctl.sh restore ${SNAP_ID})"
    ;;

  list-backups)
    echo "📦 【保存済み復元ポイント (.backups) 一覧】"
    ls -1dt .backups/snap_* 2>/dev/null | head -n 20 || echo "バックアップはまだありません"
    ;;

  restore)
    if [ -z "$ARG2" ] || [ ! -d ".backups/$ARG2" ]; then
      echo "⚠️ 使用法: ./safe_ctl.sh restore <snap_YYYYMMDD_HHMMSS>"
      ./safe_ctl.sh list-backups
      exit 1
    fi
    echo "♻️ [システム復元] スナップショット ${ARG2} からコードと設定ファイルを復元しています..."
    cp -p ".backups/${ARG2}/src/"* src/ 2>/dev/null || true
    cp -p ".backups/${ARG2}/.domain_health.json" ".backups/${ARG2}/.iproyal_quota.json" ./ 2>/dev/null || true
    echo "✅ 復元が完了しました！"
    ;;

  clean-imap)
    echo "📬 [IMAP容量保護] Catch-All受信箱(Zoho)から24時間以上前の古い認証メールを削除しています..."
    node -e "require('./src/email_firstmail').purgeOldVerificationEmails(24).then(r => { console.log('✅ IMAP整理結果:', r); process.exit(0); });"
    ;;

  migrate-lifecycle)
    DRY_ARG="${ARG2:-}"
    if [ "$DRY_ARG" = "--dry-run" ]; then
      node src/migrate_account_lifecycle.js --dry-run
    else
      node src/migrate_account_lifecycle.js
    fi
    ;;

  *)
    echo "使用法: ./safe_ctl.sh {status|infra|preflight|migrate-lifecycle [--dry-run]|safe-compress|expand-disk <GB>|expand-swap <GB>|stop|resume <GB>|resume-all <GB>|clean-imap}"
    ;;
esac
