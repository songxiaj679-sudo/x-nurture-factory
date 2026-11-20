#!/usr/bin/env node
/**
 * 🛰️ Bulk Importer for 20 Official API Satellite Accounts (Zero-Proxy Architecture)
 * 
 * 日本語10台 ＋ 英語10台 の公式API連携サテライトアカウントを一括登録・暗号化保存するツール。
 * プロキシ不要・公式API直接通信により、月額プロキシ費用を完全ゼロ化します。
 * 
 * 使い方:
 *   1. CSVファイルを用意: data/syndicate_accounts.csv
 *   2. 実行: node scripts/import_official_syndicate.js --file data/syndicate_accounts.csv
 * 
 * CSVフォーマット例:
 *   handle,apiKey,apiSecret,accessToken,accessTokenSecret,lang
 *   @user_ja_01,API_KEY,API_SECRET,ACCESS_TOKEN,ACCESS_SECRET,ja
 *   @user_en_01,API_KEY,API_SECRET,ACCESS_TOKEN,ACCESS_SECRET,en
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { db } = require('../src/firestore');
const {
  encryptCredentials,
  verifyOfficialCredentials
} = require('../src/official_api_client');

const TEMPLATE_CSV_PATH = path.resolve(__dirname, '../data/syndicate_accounts_template.csv');

function createTemplateIfNotExist() {
  const dir = path.dirname(TEMPLATE_CSV_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(TEMPLATE_CSV_PATH)) {
    const template = [
      '# VeloxPost Syndicate Account Bulk Import Template',
      '# 日本語10アカウント (lang=ja) + 英語10アカウント (lang=en)',
      'handle,apiKey,apiSecret,accessToken,accessTokenSecret,lang',
      '@sample_ja_01,CONSUMER_KEY_HERE,CONSUMER_SECRET_HERE,ACCESS_TOKEN_HERE,ACCESS_TOKEN_SECRET_HERE,ja',
      '@sample_en_01,CONSUMER_KEY_HERE,CONSUMER_SECRET_HERE,ACCESS_TOKEN_HERE,ACCESS_TOKEN_SECRET_HERE,en'
    ].join('\n');
    fs.writeFileSync(TEMPLATE_CSV_PATH, template, 'utf8');
  }
}

async function importAccountsFromFile(filePath, ownerUid = 'WEB-GOOGLE-D12E2479A76266AEA2B4') {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ ファイルが見つかりません: ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  // ヘッダー行をスキップ
  let startIndex = 0;
  if (lines[0].toLowerCase().includes('apikey') || lines[0].toLowerCase().includes('handle')) {
    startIndex = 1;
  }

  console.log('====================================================');
  console.log(`🚀 Starting Bulk Import of Official API Satellite Accounts`);
  console.log(`📂 Source File: ${filePath}`);
  console.log(`👤 Assigned Owner UID: ${ownerUid}`);
  console.log('====================================================\n');

  let importedJa = 0;
  let importedEn = 0;
  let skipped = 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 5) {
      console.warn(`⚠️ [Skip] 列数が足りません (Line ${i + 1}): ${line}`);
      skipped++;
      continue;
    }

    const [rawHandle, apiKey, apiSecret, accessToken, accessTokenSecret, rawLang] = parts;
    const cleanHandle = rawHandle.replace(/^@/, '');
    const lang = (rawLang && rawLang.toLowerCase() === 'en') ? 'en' : 'ja';

    if (!cleanHandle || !apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
      console.warn(`⚠️ [Skip] 必須項目が空です (@${cleanHandle})`);
      skipped++;
      continue;
    }

    process.stdout.write(`⏳ 照会中: @${cleanHandle} (${lang.toUpperCase()})... `);

    // 1. 公式API有効性テスト (接続確認)
    const testCreds = {
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret
    };

    let verifyRes = null;
    try {
      verifyRes = await verifyOfficialCredentials(testCreds);
    } catch (e) {
      verifyRes = { ok: false, error: e.message };
    }

    const verified = Boolean(verifyRes && verifyRes.ok);
    const resolvedUsername = (verifyRes && verifyRes.user && verifyRes.user.username) || cleanHandle;

    // 2. AES-256-GCM 暗号化
    const encryptedCredentials = encryptCredentials({
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret,
      username: resolvedUsername,
      lang
    });

    // 3. Firestore (saas_accounts) への登録
    const docId = `official_${lang}_${resolvedUsername.toLowerCase()}`;
    const accountDoc = {
      ownerUserId: ownerUid,
      username: resolvedUsername,
      lang, // 'ja' または 'en'
      isOfficialApi: true,
      officialApiKey: apiKey.slice(0, 6) + '****************',
      encryptedCredentials,
      role: 'official_syndicate',
      isActive: true,
      verified,
      totalBoostActions: 0,
      totalHarvestActions: 0,
      lastActiveAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (db) {
      await db.collection('saas_accounts').doc(docId).set(accountDoc, { merge: true });
    }

    if (verified) {
      console.log(`✅ 正常接続！ (認証成功: @${resolvedUsername})`);
    } else {
      console.log(`⚠️ 登録完了 (APIテスト未達: ${verifyRes.error || '再認証待ち'})`);
    }

    if (lang === 'ja') importedJa++;
    else importedEn++;
  }

  console.log('\n====================================================');
  console.log(`🎉 インポート完了レポート:`);
  console.log(`   🇯🇵 日本語サテライト: ${importedJa} アカウント`);
  console.log(`   🇺🇸 英語サテライト:   ${importedEn} アカウント`);
  console.log(`   ⏭️ スキップ:         ${skipped} 件`);
  console.log(`   💎 プロキシ不要・公式API直接通信（通信費完全0円）`);
  console.log('====================================================\n');
}

async function main() {
  createTemplateIfNotExist();
  const args = process.argv.slice(2);

  let targetFile = null;
  let ownerUid = 'WEB-GOOGLE-D12E2479A76266AEA2B4';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      targetFile = args[i + 1];
      i++;
    } else if (args[i] === '--owner' && args[i + 1]) {
      ownerUid = args[i + 1];
      i++;
    }
  }

  if (!targetFile) {
    console.log('💡 [テンプレート作成済み]');
    console.log(`   ファイルパス: ${TEMPLATE_CSV_PATH}`);
    console.log('\n   実行方法:');
    console.log(`   node scripts/import_official_syndicate.js --file data/syndicate_accounts_template.csv`);
    process.exit(0);
  }

  await importAccountsFromFile(targetFile, ownerUid);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal import error:', err);
    process.exit(1);
  });
}
