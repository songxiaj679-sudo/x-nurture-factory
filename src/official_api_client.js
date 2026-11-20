const crypto = require('crypto');
const { db } = require('./firestore');

// キー暗号化用のシークレット（環境変数を最優先、安全なキーローテーション対応）
const LEGACY_MASTER_SECRET = 'x_nurture_hybrid_master_secret_key_32bytes_v1';
if (process.env.NODE_ENV === 'production' && !process.env.HYBRID_KEY_SECRET) {
  throw new Error('CRITICAL SECURITY ERROR: HYBRID_KEY_SECRET environment variable is missing in production!');
}
const MASTER_ENCRYPTION_SECRET = process.env.HYBRID_KEY_SECRET || LEGACY_MASTER_SECRET;
const ALGORITHM = 'aes-256-gcm';

/**
 * ユーザーのAPIキー情報を安全にAES-256-GCM暗号化する
 */
function encryptCredentials(plainObj) {
  const key = crypto.createHash('sha256').update(MASTER_ENCRYPTION_SECRET).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const text = JSON.stringify(plainObj);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    tag
  };
}

function decryptWithSecret(encryptedPayload, secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = Buffer.from(encryptedPayload.iv, 'hex');
  const tag = Buffer.from(encryptedPayload.tag, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encryptedPayload.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return JSON.parse(decrypted);
}

/**
 * 暗号化されたAPIキー情報を復号する（デュアルキー対応で過去データの移行を保証）
 */
function decryptCredentials(encryptedPayload) {
  if (!encryptedPayload || !encryptedPayload.encrypted || !encryptedPayload.iv || !encryptedPayload.tag) {
    throw new Error('無効な暗号化データです');
  }
  try {
    return decryptWithSecret(encryptedPayload, MASTER_ENCRYPTION_SECRET);
  } catch (err) {
    if (MASTER_ENCRYPTION_SECRET !== LEGACY_MASTER_SECRET) {
      try {
        return decryptWithSecret(encryptedPayload, LEGACY_MASTER_SECRET);
      } catch (err2) {
        throw new Error('API資格情報の復号に失敗しました（認証タグ不一致）');
      }
    }
    throw err;
  }
}

/**
 * RFC 3986 準拠のパーセントエンコード
 */
function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

/**
 * X API (OAuth 1.0a) の署名付きヘッダーを生成する
 */
function generateOAuth1Header(method, url, oauthParams, appSecret, tokenSecret, queryParams = {}) {
  const combined = { ...oauthParams, ...queryParams };
  const sortedKeys = Object.keys(combined).sort();
  const paramString = sortedKeys.map(k => `${percentEncode(k)}=${percentEncode(combined[k])}`).join('&');
  
  const baseString = [
    method.toUpperCase(),
    percentEncode(url.split('?')[0]),
    percentEncode(paramString)
  ].join('&');
  
  const signingKey = `${percentEncode(appSecret)}&${percentEncode(tokenSecret || '')}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  
  const authHeaders = { ...oauthParams, oauth_signature: signature };
  const authHeaderStr = 'OAuth ' + Object.keys(authHeaders).sort()
    .map(k => `${percentEncode(k)}="${percentEncode(authHeaders[k])}"`)
    .join(', ');
    
  return authHeaderStr;
}

/**
 * OAuth 2.0 ユーザーアクセストークンの自動リフレッシュ（期限切れ自動修復）
 */
function accountDocId(value) {
  const id = String(value || '').trim();
  if (!id || /^\d+$/.test(id)) return '';
  return id;
}

const refreshFlights = new Map();

function refreshLockKey(credentials, userId) {
  const xId = String((credentials && credentials.userId) || '').trim();
  if (/^\d+$/.test(xId)) return `x:${xId}`;
  return `saas:${accountDocId(userId) || accountDocId(credentials && credentials.saasUserId) || accountDocId(credentials && credentials.userId) || 'none'}`;
}

async function readStoredOAuth(targetUid) {
  if (!targetUid || !db) return null;
  let snap;
  try {
    snap = await db.collection('saas_users').doc(targetUid).get();
  } catch (err) {
    const message = String((err && err.message) || '');
    if (message.includes('strictly forbidden during tests')) return null;
    throw err;
  }
  if (!snap.exists || !snap.data() || !snap.data().xOfficialCredentials) return null;
  try {
    const creds = decryptCredentials(snap.data().xOfficialCredentials);
    creds.saasUserId = targetUid;
    return creds;
  } catch (err) {
    return null;
  }
}

function storedOAuthIsNewer(stored, current) {
  if (!stored || !stored.oauth2RefreshToken || !current) return false;
  const storedExp = stored.oauth2ExpiresAt ? new Date(stored.oauth2ExpiresAt).getTime() : 0;
  const currentExp = current.oauth2ExpiresAt ? new Date(current.oauth2ExpiresAt).getTime() : 0;
  if (stored.oauth2RefreshToken !== current.oauth2RefreshToken && storedExp >= currentExp) return true;
  return storedExp > currentExp + 1000;
}

async function saveRefreshedOAuth(credentials, targetUid) {
  if (!targetUid || !db) return;
  const enc = encryptCredentials(credentials);
  const patch = {
    xOfficialCredentials: enc,
    twitterRefreshToken: credentials.oauth2RefreshToken,
    xLinkStatus: 'connected',
    xLinkMessage: '',
    twitterAuth: {
      authType: 'oauth2',
      userId: credentials.userId || targetUid,
      saasUserId: targetUid,
      username: credentials.username || '',
      oauth2AccessToken: credentials.oauth2AccessToken,
      oauth2RefreshToken: credentials.oauth2RefreshToken,
      oauth2ExpiresAt: credentials.oauth2ExpiresAt
    },
    updatedAt: new Date()
  };
  await db.collection('saas_users').doc(targetUid).set(patch, { merge: true });
  const xId = String(credentials.userId || '').trim();
  if (!/^\d+$/.test(xId)) return;
  const siblings = await db.collection('saas_users').where('twitterId', '==', xId).get();
  for (const doc of (siblings.docs || [])) {
    if (doc.id === targetUid) continue;
    await db.collection('saas_users').doc(doc.id).set(patch, { merge: true });
  }
}

function refreshOAuth2TokenIfNeeded(credentials, force = false, userId = null) {
  if (!credentials || !credentials.oauth2RefreshToken) return Promise.resolve(credentials);
  const key = refreshLockKey(credentials, userId);
  if (refreshFlights.has(key)) return refreshFlights.get(key);
  const flight = runOAuth2Refresh(credentials, force, userId).finally(() => {
    if (refreshFlights.get(key) === flight) refreshFlights.delete(key);
  });
  refreshFlights.set(key, flight);
  return flight;
}

async function runOAuth2Refresh(credentials, force, userId) {
  const clientId = String(process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET || '').trim();
  if (!clientId) return credentials;

  const targetUid = accountDocId(userId) || accountDocId(credentials.saasUserId) || accountDocId(credentials.userId);
  const sentRefreshToken = credentials.oauth2RefreshToken;
  const stored = await readStoredOAuth(targetUid);
  if (stored && storedOAuthIsNewer(stored, credentials)) {
    Object.assign(credentials, stored);
    const storedExp = stored.oauth2ExpiresAt ? new Date(stored.oauth2ExpiresAt).getTime() : 0;
    const stillFresh = storedExp && storedExp - Date.now() >= 5 * 60 * 1000;
    if (!force || stillFresh) return credentials;
  }

  const expiresAt = credentials.oauth2ExpiresAt ? new Date(credentials.oauth2ExpiresAt).getTime() : 0;
  const shouldRefresh = force || !expiresAt || (expiresAt - Date.now() < 5 * 60 * 1000);
  if (!shouldRefresh) return credentials;

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.oauth2RefreshToken,
      client_id: clientId
    });
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'VeloxPostCloud/1.0'
    };
    if (clientSecret) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    }
    const res = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers,
      body: params.toString()
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.access_token) {
      credentials.oauth2AccessToken = data.access_token;
      if (data.refresh_token) credentials.oauth2RefreshToken = data.refresh_token;
      credentials.oauth2ExpiresAt = new Date(Date.now() + (data.expires_in || 7200) * 1000).toISOString();
      if (targetUid) credentials.saasUserId = targetUid;
      console.log(`✅ [OAuth2 Auto-Refresh] Successfully refreshed access token for @${credentials.username || 'user'}`);
      try {
        await saveRefreshedOAuth(credentials, targetUid);
      } catch (e) {
        console.error('[OAuth2 Auto-Refresh Firestore Error]:', e.message);
      }
    } else if (data.error === 'invalid_grant' || res.status === 401) {
      const latest = await readStoredOAuth(targetUid);
      if (latest && latest.oauth2RefreshToken && latest.oauth2RefreshToken !== sentRefreshToken) {
        Object.assign(credentials, latest);
        return credentials;
      }
      if (targetUid && db) {
        await db.collection('saas_users').doc(targetUid).set({
          xLinkStatus: 'relink_required',
          xLinkMessage: 'Xの再連携が必要です。これまでの投稿、保存、返信の記憶は消さず、同じアカウントの続きとして使います。',
          xLinkCheckedAt: new Date()
        }, { merge: true }).catch(err => {
          console.error('[OAuth2 Relink Flag Error]:', err.message);
        });
      }
    }
  } catch (err) {
    console.error('[OAuth2 Auto-Refresh Error]:', err.message);
  }
  return credentials;
}

/**
 * X公式API v2 で認証情報を検証する（GET /2/users/me）
 * OAuth 1.0a (コンシューマーキー方式) または OAuth 2.0 (ユーザーBearerトークン方式) に両対応
 */
async function verifyOfficialCredentials(credentials) {
  const uid = accountDocId(credentials && credentials.saasUserId) || accountDocId(credentials && credentials.userId);
  if (credentials && credentials.oauth2RefreshToken) {
    credentials = await refreshOAuth2TokenIfNeeded(credentials, false, uid);
  }
  let { apiKey, apiSecret, accessToken, accessTokenSecret, oauth2AccessToken } = credentials;

  // 1. OAuth 2.0 ユーザーアクセストークンでの検証
  if (oauth2AccessToken) {
    const url = 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,description,public_metrics';
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${oauth2AccessToken.trim()}`,
          'User-Agent': 'HybridSaaSClient/1.0'
        }
      });
      let data = await res.json().catch(() => ({}));
      let status = res.status;
      let ok = res.ok;
      if (status === 401 && credentials.oauth2RefreshToken) {
        credentials = await refreshOAuth2TokenIfNeeded(credentials, true, uid);
        oauth2AccessToken = credentials.oauth2AccessToken;
        if (oauth2AccessToken) {
          const retry = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${oauth2AccessToken.trim()}`, 'User-Agent': 'HybridSaaSClient/1.0' }
          });
          data = await retry.json().catch(() => ({}));
          status = retry.status;
          ok = retry.ok;
        }
      }
      if (ok && data.data && data.data.username) {
        return {
          ok: true,
          authType: 'oauth2',
          user: {
            id: data.data.id,
            name: data.data.name,
            username: data.data.username,
            description: data.data.description || '',
            profileImageUrl: data.data.profile_image_url || null,
            metrics: data.data.public_metrics || null
          }
        };
      }
      const errMsg = (data.errors && data.errors[0] && data.errors[0].message) || data.detail || `HTTP_${status}`;
      return { ok: false, error: `公式API (OAuth 2.0) 検証失敗: ${errMsg}`, status };
    } catch (err) {
      return { ok: false, error: `通信エラー: ${err.message}` };
    }
  }

  // 2. OAuth 1.0a (コンシューマーキー ＆ アクセストークン) での検証
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    return { ok: false, error: 'OAuth 1.0 の場合は、コンシューマーキー、シークレット、アクセストークン、トークンシークレットが必要です。' };
  }

  const url = 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,description,public_metrics';
  const method = 'GET';
  const oauthParams = {
    oauth_consumer_key: apiKey.trim(),
    oauth_token: accessToken.trim(),
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0'
  };

  const authHeader = generateOAuth1Header(
    method,
    url,
    oauthParams,
    apiSecret.trim(),
    accessTokenSecret.trim(),
    { 'user.fields': 'profile_image_url,description,public_metrics' }
  );

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'HybridSaaSClient/1.0'
      }
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.data && data.data.username) {
      return {
        ok: true,
        authType: 'oauth1',
        user: {
          id: data.data.id,
          name: data.data.name,
          username: data.data.username,
          description: data.data.description || '',
          profileImageUrl: data.data.profile_image_url || null,
          metrics: data.data.public_metrics || null
        }
      };
    }

    const errMsg = (data.errors && data.errors[0] && data.errors[0].message) || data.detail || `HTTP_${res.status}`;
    return { ok: false, error: `公式API検証失敗: ${errMsg}`, status: res.status };
  } catch (err) {
    return { ok: false, error: `通信エラー: ${err.message}` };
  }
}

/**
 * 🧹 生成されたポスト・リプライ本文から、AI特有の文字数注記やメタ情報を徹底除去・完全純化する
 * 例: 「（80文字）」「(78 chars)」「【全角75文字】」「文字数: 80」「返信文:」等を100%カット
 */
function stripMatchedOuterQuotes(value) {
  let text = String(value || '').trim();
  const pairs = [
    ['&quot;', '&quot;'],
    ['「', '」'],
    ['『', '』'],
    ['"', '"'],
    ["'", "'"]
  ];
  for (let guard = 0; guard < 3 && text; guard += 1) {
    const pair = pairs.find(([open, close]) => text.startsWith(open) && text.endsWith(close) && text.length > open.length + close.length);
    if (!pair) break;
    const inner = text.slice(pair[0].length, text.length - pair[1].length);
    if (inner.includes(pair[1])) break;
    text = inner.trim();
  }
  return text;
}

function sanitizePostOrReplyText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText.trim();

  // 1. マークダウンコードブロック除去
  text = text.replace(/^```[a-zA-Z]*\n?([\s\S]*?)```$/g, '$1').trim();

  // 2. 全文を同じ引用符で包んでいるときだけ外す。文中で閉じる「」は残す。
  text = stripMatchedOuterQuotes(text);

  // 3. AI特有の前置きラベル除去 (返信文:, リプライ:, Reply:, Post: 等)
  text = text.replace(/^(?:返信文?|リプライ(?:文)?|出力(?:結果)?|ポスト本文?|ツイート本文?|Reply|Response|Tweet|Post)\s*[:：]\s*/i, '').trim();

  // 4. 文字数カウント注記の完全除去（末尾および文中）
  // 例: （80文字）, (80文字), （78字）, (78 chars), 【75文字】, [80文字], (80 characters), （全角80文字）
  text = text.replace(/[（\(\[\{【]\s*(?:全角|半角)?\s*\d+\s*(?:文字|字|chars?|characters?)\s*[）\)\]\}】]\s*$/i, '');
  text = text.replace(/[（\(\[\{【]\s*(?:全角|半角)?\s*\d+\s*(?:文字|字|chars?|characters?)\s*[）\)\]\}】]/gi, '');

  // 5. 末尾の「文字数: 80」「Length: 80 chars」等の除去
  text = text.replace(/(?:文字数|文字|Chars?|Length|Count)\s*[:：]\s*\d+.*$/i, '');

  return text.trim();
}

/**
 * X公式API v2 で本アカウントのポスト（ツイート）を投稿する (POST /2/tweets)
 * OAuth 1.0a または OAuth 2.0 Bearer 両対応
 * replyToTweetId を指定するとスレッド（ツリー）としてぶら下がり投稿可能
 */
async function uploadOfficialMedia(credentials, pngBuffer, options = {}) {
  if (!credentials || !credentials.oauth2AccessToken) return { ok: false, skipped: true, reason: 'oauth2_required' };
  if (credentials.oauth2Scope && !/\bmedia\.write\b/.test(credentials.oauth2Scope)) return { ok: false, skipped: true, reason: 'media_write_scope_missing' };
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0 || pngBuffer.length > 5 * 1024 * 1024) return { ok: false, skipped: true, reason: 'invalid_media_size' };
  const fetchImpl = options.fetchImpl || fetch;
  const signal = () => AbortSignal.timeout(15000);
  try {
  let creds = credentials;
  if (creds.oauth2RefreshToken) creds = await refreshOAuth2TokenIfNeeded(creds, false, creds.saasUserId);
  const auth = { Authorization: `Bearer ${String(creds.oauth2AccessToken || '').trim()}` };
  const initRes = await fetchImpl('https://api.x.com/2/media/upload/initialize', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ total_bytes: pngBuffer.length, media_type: 'image/png', media_category: 'tweet_image' }),
    signal: signal()
  });
  const initJson = await initRes.json().catch(() => ({}));
  if (!initRes.ok) return { ok: false, status: initRes.status, error: 'media_initialize_failed' };
  const mediaId = String(initJson.data && initJson.data.id || initJson.media_id_string || initJson.media_id || '');
  if (!mediaId) return { ok: false, status: initRes.status, error: 'media_id_missing' };
  const form = new FormData();
  form.append('segment_index', '0');
  form.append('media', new Blob([pngBuffer], { type: 'image/png' }), 'card.png');
  const appendRes = await fetchImpl(`https://api.x.com/2/media/upload/${mediaId}/append`, { method: 'POST', headers: auth, body: form, signal: signal() });
  if (!appendRes.ok) return { ok: false, status: appendRes.status, error: 'media_append_failed' };
  const finalRes = await fetchImpl(`https://api.x.com/2/media/upload/${mediaId}/finalize`, { method: 'POST', headers: auth, signal: signal() });
  const finalJson = await finalRes.json().catch(() => ({}));
  if (!finalRes.ok) return { ok: false, status: finalRes.status, error: 'media_finalize_failed' };
  const state = finalJson.processing_info && finalJson.processing_info.state;
  if (state === 'pending' || state === 'in_progress') {
    for (let poll = 0; poll < 2; poll += 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const statusRes = await fetchImpl(`https://api.x.com/2/media/upload?command=status&media_id=${mediaId}`, { headers: auth, signal: signal() });
      const statusJson = await statusRes.json().catch(() => ({}));
      const next = statusJson.processing_info && statusJson.processing_info.state;
      if (next !== 'pending' && next !== 'in_progress') break;
    }
  }
  return { ok: true, mediaId };
  } catch (error) {
    return { ok: false, error: `media_upload_error:${String(error && error.message || error).slice(0, 160)}` };
  }
}

async function postOfficialTweet(credentials, tweetText, mediaIds = [], replyToTweetId = null) {
  if (credentials && credentials.oauth2RefreshToken) {
    credentials = await refreshOAuth2TokenIfNeeded(credentials, false, credentials.saasUserId);
  }
  const { apiKey, apiSecret, accessToken, accessTokenSecret, oauth2AccessToken } = credentials;
  const cleanText = sanitizePostOrReplyText(tweetText);
  if (!cleanText) return { ok: false, error: 'ツイート本文が空です' };

  const url = 'https://api.twitter.com/2/tweets';
  const method = 'POST';

  let authHeader = '';
  if (oauth2AccessToken) {
    authHeader = `Bearer ${oauth2AccessToken.trim()}`;
  } else {
    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
      return { ok: false, error: 'OAuth 1.0a 認証情報が不足しています' };
    }
    const oauthParams = {
      oauth_consumer_key: apiKey.trim(),
      oauth_token: accessToken.trim(),
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_version: '1.0'
    };
    authHeader = generateOAuth1Header(
      method,
      url,
      oauthParams,
      apiSecret.trim(),
      accessTokenSecret.trim()
    );
  }

  const payload = { text: cleanText };
  if (Array.isArray(mediaIds) && mediaIds.length > 0) {
    payload.media = { media_ids: mediaIds };
  }
  if (replyToTweetId) {
    payload.reply = { in_reply_to_tweet_id: String(replyToTweetId) };
  }

  const sendPostRequest = requestAuthHeader => fetch(url, {
      method,
      headers: {
        'Authorization': requestAuthHeader,
        'Content-Type': 'application/json',
        'User-Agent': 'HybridSaaSClient/1.0'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000)
    });

  try {
    let res = await sendPostRequest(authHeader);

    // A 403 can mean a policy or duplicate-content rejection; retry only on 401.
    if (res.status === 401 && credentials.oauth2RefreshToken) {
      console.log('[postOfficialTweet] HTTP 401 received; refreshing OAuth 2.0 token once.');
      const refreshed = await refreshOAuth2TokenIfNeeded(credentials, true, credentials.saasUserId);
      if (refreshed && refreshed.oauth2AccessToken) {
        authHeader = `Bearer ${refreshed.oauth2AccessToken.trim()}`;
        res = await sendPostRequest(authHeader);
      }
    }

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.data && data.data.id) {
      const tweetId = data.data.id;
      const username = credentials.username || 'i';
      const tweetUrl = `https://x.com/${username}/status/${tweetId}`;

      return {
        ok: true,
        tweetId,
        text: data.data.text,
        tweetUrl,
        postedAt: new Date().toISOString()
      };
    }

    const errMsg = (data.errors && data.errors[0] && data.errors[0].message) || data.detail || `HTTP_${res.status}`;
    return { ok: false, error: `公式API投稿エラー: ${errMsg}`, status: res.status };
  } catch (err) {
    return { ok: false, error: `通信例外: ${err.message}` };
  }
}

/**
 * 複数のポスト（配列）を、公式APIで綺麗な連動ツリー（スレッド）として順番に投稿する
 */
async function postOfficialThread(credentials, tweetTextsArray, mediaIds = []) {
  if (!Array.isArray(tweetTextsArray) || tweetTextsArray.length === 0) {
    return { ok: false, error: 'スレッド投稿用のテキスト配列が空です' };
  }

  const results = [];
  let previousTweetId = null;

  for (let i = 0; i < tweetTextsArray.length; i++) {
    const text = tweetTextsArray[i];
    // 最初の投稿のみメディア添付可能、以降は前のツイートに返信
    const curMedia = (i === 0) ? mediaIds : [];
    const res = await postOfficialTweet(credentials, text, curMedia, previousTweetId);
    if (!res.ok) {
      return {
        ok: false,
        error: `スレッド ${i + 1}本目で失敗: ${res.error}`,
        partialResults: results
      };
    }

    results.push(res);
    previousTweetId = res.tweetId;

    // スレッド間の自然な待機（1.2秒〜2.5秒）
    if (i < tweetTextsArray.length - 1) {
      await new Promise(r => setTimeout(r, 1200 + Math.random() * 1300));
    }
  }

  return {
    ok: true,
    isThread: true,
    threadCount: results.length,
    rootTweet: results[0],
    tweetId: results[0].tweetId,
    tweetUrl: results[0].tweetUrl,
    allTweets: results
  };
}

/**
 * 自動応援案件の新規登録は停止中。
 */
async function registerBoostCampaign() {
  console.warn('[Boost Campaign] 自動応援案件の登録は停止しています。');
  return { ok: false, reason: 'automatic_boost_disabled' };
}

/**
 * X公式API v2 でユーザーのプロファイルと直近のポスト履歴を取得する
 */
async function getUserProfileAndRecentTweets(credentials, maxResults = 10) {
  try {
    const userRes = await verifyOfficialCredentials(credentials);
    if (!userRes.ok || !userRes.user) {
      return { ok: false, error: userRes.error || 'ユーザー認証に失敗しました', status: userRes.status };
    }

    const user = userRes.user;
    const userId = user.id;
    const { apiKey, apiSecret, accessToken, accessTokenSecret, oauth2AccessToken } = credentials;

    const count = Math.min(100, Math.max(5, maxResults));
    const url = `https://api.twitter.com/2/users/${userId}/tweets?max_results=${count}&tweet.fields=created_at,public_metrics,text`;

    let authHeader = '';
    if (oauth2AccessToken) {
      authHeader = `Bearer ${oauth2AccessToken.trim()}`;
    } else {
      if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
        return { ok: false, error: 'credentials_missing', user, tweets: [] };
      }
      const oauthParams = {
        oauth_consumer_key: apiKey.trim(),
        oauth_token: accessToken.trim(),
        oauth_nonce: crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_version: '1.0'
      };
      const queryParams = {
        'max_results': String(count),
        'tweet.fields': 'created_at,public_metrics,text'
      };
      authHeader = generateOAuth1Header('GET', url, oauthParams, apiSecret.trim(), accessTokenSecret.trim(), queryParams);
    }

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'HybridSaaSClient/1.0'
      }
    });

    let tweetRes = res;
    let data = await tweetRes.json().catch(() => ({}));
    if (tweetRes.status === 401 && credentials.oauth2RefreshToken) {
      const uid = accountDocId(credentials.saasUserId) || accountDocId(credentials.userId);
      const refreshed = await refreshOAuth2TokenIfNeeded(credentials, true, uid);
      Object.assign(credentials, refreshed);
      if (credentials.oauth2AccessToken) {
        tweetRes = await fetch(url, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${credentials.oauth2AccessToken.trim()}`, 'User-Agent': 'HybridSaaSClient/1.0' }
        });
        data = await tweetRes.json().catch(() => ({}));
      }
    }
    if (!tweetRes.ok) {
      const errMsg = (data.errors && data.errors[0]?.message) || data.detail || `HTTP_${tweetRes.status}`;
      console.warn(`[getUserProfileAndRecentTweets HTTP_${tweetRes.status} error]:`, errMsg);
      return { ok: false, error: errMsg, status: tweetRes.status };
    }

    const tweets = (data.data || []).map(t => ({
      id: t.id,
      text: t.text,
      createdAt: t.created_at,
      created_at: t.created_at,
      metrics: t.public_metrics || null
    }));

    return {
      ok: true,
      user,
      tweets
    };
  } catch (err) {
    console.error('[getUserProfileAndRecentTweets error]:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 複数のポストID（配列）を指定して、X公式API v2 から直接メトリクス・投稿情報を一括照会する
 * 100件ごとのチャンク分割により、100件を超えるIDも切り捨てず全件取得
 * タイムラインから流れてしまった古い投稿の回収漏れを100%物理遮断
 */
async function lookupTweetsByIds(credentials, tweetIds = []) {
  if (!Array.isArray(tweetIds) || tweetIds.length === 0) {
    return { ok: true, tweets: [] };
  }
  const cleanIds = tweetIds.map(id => String(id).trim()).filter(Boolean);
  if (cleanIds.length === 0) return { ok: true, tweets: [] };

  const { apiKey, apiSecret, accessToken, accessTokenSecret, oauth2AccessToken } = credentials;
  const allTweets = [];
  const chunkSize = 100; // X API v2 allows up to 100 IDs per request

  let retried401 = false;
  for (let i = 0; i < cleanIds.length; i += chunkSize) {
    const chunkIds = cleanIds.slice(i, i + chunkSize);
    const url = `https://api.twitter.com/2/tweets?ids=${chunkIds.join(',')}&tweet.fields=created_at,public_metrics,text`;

    let authHeader = '';
    if (oauth2AccessToken) {
      authHeader = `Bearer ${oauth2AccessToken.trim()}`;
    } else {
      if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
        return { ok: false, error: 'credentials_missing', tweets: allTweets };
      }
      const oauthParams = {
        oauth_consumer_key: apiKey.trim(),
        oauth_token: accessToken.trim(),
        oauth_nonce: crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_version: '1.0'
      };
      const queryParams = {
        'ids': chunkIds.join(','),
        'tweet.fields': 'created_at,public_metrics,text'
      };
      authHeader = generateOAuth1Header('GET', url, oauthParams, apiSecret.trim(), accessTokenSecret.trim(), queryParams);
    }

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'User-Agent': 'HybridSaaSClient/1.0'
        }
      });

      let data = await res.json().catch(() => ({}));
      let status = res.status;
      let ok = res.ok;
      if (status === 401 && !retried401 && credentials.oauth2RefreshToken) {
        retried401 = true;
        const uid = accountDocId(credentials.saasUserId) || accountDocId(credentials.userId);
        const refreshed = await refreshOAuth2TokenIfNeeded(credentials, true, uid);
        Object.assign(credentials, refreshed);
        if (credentials.oauth2AccessToken) {
          const retry = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${credentials.oauth2AccessToken.trim()}`, 'User-Agent': 'HybridSaaSClient/1.0' }
          });
          data = await retry.json().catch(() => ({}));
          status = retry.status;
          ok = retry.ok;
        }
      }
      if (!ok) {
        const errMsg = (data.errors && data.errors[0]?.message) || data.detail || `HTTP_${status}`;
        console.warn(`[lookupTweetsByIds chunk HTTP_${status} error]:`, errMsg);
        return { ok: false, error: errMsg, status, tweets: allTweets };
      }

      const tweets = (data.data || []).map(t => ({
        id: t.id,
        text: t.text,
        createdAt: t.created_at,
        created_at: t.created_at,
        metrics: t.public_metrics || null
      }));
      allTweets.push(...tweets);
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        return {
          ok: false,
          error: 'Tweet lookup returned partial errors',
          errors: data.errors,
          tweets: allTweets
        };
      }
    } catch (err) {
      console.warn('[lookupTweetsByIds error]:', err.message);
      return { ok: false, error: err.message, tweets: allTweets };
    }
  }

  return { ok: true, tweets: allTweets };
}

/**
 * 任意のXユーザー名（未登録一般客・外部アカウント）のプロファイルと直近ツイートを照会・巡回取得する
 * 私たちの公式APIクレデンシャル（または巡回トークン）を用いて実行
 */
async function lookupAnyUserProfileAndTweets(credentials, targetUsername, maxResults = 10, options = {}) {
  const cleanName = String(targetUsername || '').trim().replace(/^@/, '');
  if (!cleanName) return { ok: false, error: 'ユーザー名が指定されていません' };

  const { apiKey, apiSecret, accessToken, accessTokenSecret, oauth2AccessToken } = credentials || {};
  const count = Math.min(20, Math.max(5, maxResults));

  try {
    // 1. ユーザープロファイル照会 (GET /2/users/by/username/:username)
    const userFields = 'description,profile_image_url,public_metrics,verified,verified_type';
    const userUrl = `https://api.twitter.com/2/users/by/username/${cleanName}?user.fields=${userFields}`;
    let userAuthHeader = '';

    if (oauth2AccessToken) {
      userAuthHeader = `Bearer ${oauth2AccessToken.trim()}`;
    } else {
      if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
        return { ok: false, error: '認証情報が不足しています' };
      }
      const oauthParams = {
        oauth_consumer_key: apiKey.trim(),
        oauth_token: accessToken.trim(),
        oauth_nonce: crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_version: '1.0'
      };
      const queryParams = { 'user.fields': userFields };
      userAuthHeader = generateOAuth1Header('GET', userUrl, oauthParams, apiSecret.trim(), accessTokenSecret.trim(), queryParams);
    }

    const uRes = await fetch(userUrl, {
      method: 'GET',
      headers: {
        'Authorization': userAuthHeader,
        'User-Agent': 'HybridSaaSClient/1.0'
      }
    });

    const uData = await uRes.json().catch(() => ({}));
    if (!uRes.ok || !uData.data || !uData.data.id) {
      return { ok: false, error: (uData.errors && uData.errors[0]?.message) || `ユーザー @${cleanName} の取得に失敗しました (Status: ${uRes.status})` };
    }

    const verifiedType = String(uData.data.verified_type || '').toLowerCase();
    const inferredSub = ['blue', 'business', 'government'].includes(verifiedType)
      ? 'premium'
      : (verifiedType === 'none' ? 'none' : undefined);

    const targetUser = {
      id: uData.data.id,
      name: uData.data.name,
      username: uData.data.username,
      description: uData.data.description,
      profileImageUrl: uData.data.profile_image_url || null,
      verified: Boolean(uData.data.verified),
      verifiedType: verifiedType || null,
      subscription_type: uData.data.subscription_type || inferredSub,
      metrics: uData.data.public_metrics || { followers_count: 0, following_count: 0, tweet_count: 0 }
    };

    // 2. 直近ツイート照会 (GET /2/users/:id/tweets)
    const excludeParam = options.excludeRepliesRetweets ? '&exclude=retweets,replies' : '';
    const tweetUrl = `https://api.twitter.com/2/users/${targetUser.id}/tweets?max_results=${count}&tweet.fields=created_at,public_metrics,text${excludeParam}`;
    let tweetAuthHeader = '';

    if (oauth2AccessToken) {
      tweetAuthHeader = `Bearer ${oauth2AccessToken.trim()}`;
    } else {
      const oauthParams = {
        oauth_consumer_key: apiKey.trim(),
        oauth_token: accessToken.trim(),
        oauth_nonce: crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_version: '1.0'
      };
      const queryParams = {
        'max_results': String(count),
        'tweet.fields': 'created_at,public_metrics,text'
      };
      if (options.excludeRepliesRetweets) queryParams.exclude = 'retweets,replies';
      tweetAuthHeader = generateOAuth1Header('GET', tweetUrl, oauthParams, apiSecret.trim(), accessTokenSecret.trim(), queryParams);
    }

    const tRes = await fetch(tweetUrl, {
      method: 'GET',
      headers: {
        'Authorization': tweetAuthHeader,
        'User-Agent': 'HybridSaaSClient/1.0'
      }
    });

    const tData = await tRes.json().catch(() => ({}));
    if (!tRes.ok) {
      const errMsg = (tData.errors && tData.errors[0]?.message) || tData.detail || `HTTP_${tRes.status}`;
      console.warn(`[lookupAnyUserProfileAndTweets HTTP_${tRes.status} error for @${cleanName}]:`, errMsg);
      if (options.allowPartialProfile) {
        return { ok: true, user: targetUser, tweets: [], tweetsError: errMsg };
      }
      return { ok: false, error: errMsg, status: tRes.status };
    }
    const tweets = (tData.data || []).map(t => ({
      id: t.id,
      text: t.text,
      createdAt: t.created_at,
      metricsAvailable: Boolean(t.public_metrics),
      metrics: t.public_metrics || { impression_count: 0, like_count: 0, retweet_count: 0, bookmark_count: 0, quote_count: 0, reply_count: 0 }
    }));

    return {
      ok: true,
      user: targetUser,
      tweets
    };
  } catch (err) {
    console.error(`[lookupAnyUserProfileAndTweets error for @${cleanName}]:`, err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 🤖 Geminiによる公式アカウント用リプライ生成（共感・感謝・現場の知見）
 */
const { hasXaiKey, completeText } = require('./grok_client');

/**
 * 🤖 公式アカウントからの共感・感謝リプライ文をAI自律生成する（日英両言語対応）
 */
async function generateOfficialReplyContent(mentionText, authorUsername, lang = 'ja') {
  const isEn = String(lang).toLowerCase().startsWith('en');
  if (hasXaiKey() && mentionText) {
    try {
      const prompt = isEn
        ? `You are the official representative of Velox Systems (@VeloxSystemsHQ), the autonomous social pipeline engine for B2B founders and operators.
A user (@${authorUsername || 'peer'}) left this reply to our post:
"${mentionText}"

Write a concise, thoughtful, authentic executive reply in English (60-140 characters).
Rules:
- Express genuine appreciation and solidarity.
- Pick up on their specific operational context or pain point.
- Zero sales pitches, zero promo links, zero buzzwords.
- Sound like a pragmatic senior founder/engineer chatting peer-to-peer.
- CRITICAL: Output ONLY the raw reply text itself. Never include character counts, notes (e.g. "(80 chars)"), preamble, quotes, or meta-commentary.
Reply text only:`
        : `あなたは「VeloxSystems」（業務自動化・Xアルゴリズム運用の専門家）の公式アカウント担当者です。
自社の投稿に対して、読者・ユーザー（@${authorUsername || '読者'}）から以下のリプライが届きました。
これに対して、感謝の気持ちを伝えつつ、相手の悩みに寄り添い、プロとしての実践的な知見や共感を込めた、知的で温かみのある返信文（全角45〜85文字程度）を1つ作成してください。

【厳守ルール】
・売り込みや露骨な宣伝は一切禁止。純粋なプロとしての対話・感謝・共感に徹すること。
・相手の投稿内の具体的な言葉や課題感を拾うこと。
・「いかがでしたでしょうか」「必見です」などの量産型AI構文は禁止。生身のエンジニア・運用責任者としての自然なトーン。
・URLは絶対に入れないこと。
・【最重要・文字数注記の絶対禁止】文章末尾や文頭に「（80文字）」「（〇文字）」「文字数: 〇」などの文字数カウント・注記・解説を絶対に含めないこと。Xにそのまま投稿される返信本文のみを出力すること。

相手からのリプライ:
${mentionText}`;
      const text = (await completeText({ tier: 'quality', prompt })).text.trim();
      text = sanitizePostOrReplyText(text);
      if (text.length >= 15 && text.length <= 180) return text;
    } catch (e) {
      console.warn('[generateOfficialReplyContent warning]:', e.message);
    }
  }

  if (isEn) {
    const enFallbacks = [
      'Appreciate you reading and saving! Eliminating manual operational grind is a game changer for founders.',
      'Glad this resonates! Manual writing eats up precious leadership bandwidth. Rooting for your team!',
      'Thanks for the feedback! Solving distribution with systems rather than brute force is the only way to scale.',
      'Appreciate the thoughts! Operators living in the trenches understand this pain best. Best of luck!'
    ];
    return enFallbacks[Math.floor(Math.random() * enFallbacks.length)];
  }

  const fallbacks = [
    '保存いただきありがとうございます！現場で悩む時間を減らす仕組み化は本当に大切ですので、ぜひ参考にしてみてください✨',
    '共感いただき嬉しいです！手作業に追われると本業の思考が削られますよね。少しでもお役に立てれば幸いです！',
    'ご感想ありがとうございます！感情論ではなく数字と仕組みで解決していくのが一番の近道ですので、ぜひ実践してみてください👍',
    '見ていただきありがとうございます！まさに現場で直面する課題ですので、参考になれば幸いです。応援しています！'
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

/**
 * 📩 公式アカウント宛の最新メンションを取得する (GET /2/users/:id/mentions)
 */
async function getOfficialMentions(credentials, maxResults = 10) {
  if (credentials && credentials.oauth2RefreshToken) {
    credentials = await refreshOAuth2TokenIfNeeded(credentials, false, credentials.saasUserId);
  }
  const token = credentials.oauth2AccessToken;
  if (!token) return { ok: false, error: 'OAuth 2.0 access token is required for mentions' };

  try {
    const meRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const meData = await meRes.json().catch(() => ({}));
    const myId = meData.data?.id;
    if (!myId) return { ok: false, error: 'Failed to resolve official user ID' };

    const count = Math.min(20, Math.max(5, maxResults));
    const url = `https://api.twitter.com/2/users/${myId}/mentions?max_results=${count}&tweet.fields=author_id,conversation_id,created_at,text&expansions=author_id&user.fields=username,name`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = (data.errors && data.errors[0]?.message) || data.detail || `HTTP_${res.status}`;
      return { ok: false, error: errMsg };
    }

    const usersMap = new Map();
    if (Array.isArray(data.includes?.users)) {
      for (const u of data.includes.users) {
        usersMap.set(u.id, u.username);
      }
    }

    const mentions = (data.data || []).map(m => ({
      id: m.id,
      text: m.text,
      authorId: m.author_id,
      authorUsername: usersMap.get(m.author_id) || '',
      conversationId: m.conversation_id,
      createdAt: m.created_at
    }));

    return { ok: true, myId, mentions };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 🤝 公式APIで指定ユーザーをフォローする (POST /2/users/:source_user_id/following)
 */
async function followUserViaOfficialApi(credentials, targetUserId) {
  if (credentials && credentials.oauth2RefreshToken) {
    credentials = await refreshOAuth2TokenIfNeeded(credentials, false, credentials.saasUserId);
  }
  const token = credentials.oauth2AccessToken;
  if (!token || !targetUserId) return { ok: false, error: 'Missing token or targetUserId' };

  try {
    const meRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const meData = await meRes.json().catch(() => ({}));
    const myId = meData.data?.id;
    if (!myId) return { ok: false, error: 'Failed to resolve official user ID' };

    if (String(myId) === String(targetUserId)) return { ok: false, error: 'Cannot follow self' };

    const res = await fetch(`https://api.twitter.com/2/users/${myId}/following`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ target_user_id: String(targetUserId) })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.data) {
      return { ok: true, following: !!data.data.following };
    }
    const errMsg = (data.errors && data.errors[0]?.message) || data.detail || `HTTP_${res.status}`;
    return { ok: false, error: errMsg };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * ⚡ 公式アカウント自律エンゲージメント（リプライ返し ＆ フォロー返し自律実行）
 */
async function runOfficialAutonomousEngagement() {
  return {
    ok: false,
    reason: 'x_approval_required',
    error: 'Xの事前承認と適用ルールを確認するまで、AI返信・自動フォローは停止しています。'
  };
}

/**
 * 📊 公式ツイートの実測値（インプ・ブクマ・いいね）をX APIから自動収集し、ネガティブリストを自己進化させる
 */
async function syncOfficialPostMetricsAndEvolve(ownerUid = 'WEB-GOOGLE-D12E2479A76266AEA2B4') {
  try {
    const { harvestTweetMetricsAndEvolveKnowledge } = require('./autonomous_promo_ai');
    const result = await harvestTweetMetricsAndEvolveKnowledge(ownerUid);
    return result;
  } catch (err) {
    console.error('[syncOfficialPostMetricsAndEvolve error]:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 🌐 全てのアクティブな契約顧客アカウントのポスト実績を巡回同期・ネガティブリスト自律進化
 * 
 * 🛡️ 取りこぼし防止 ＆ 不要API呼び出し抑制:
 * - targetUrl未設定ユーザーも除外せず、X認証連携を持つ全ユーザーを対象化
 * - 24〜25時間の回収窓に未確定投稿がある場合はクールダウンをバイパスして即時同期
 * - 回収窓内の未確定投稿がなく、直近60分以内に同期済みの場合は安全にスキップ
 */
async function syncAllActiveCustomersPostMetrics(options = {}) {
  try {
    const { evaluateUserSyncEligibility } = require('./metrics_harvest_engine');
    const pageSize = options.pageSize || 100;

    let totalSynced = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let lastUserDoc = null;
    let hasMoreUsers = true;

    // 🛡️ ユーザー取りこぼし完全防止: カーソルベースの全件安全ページネーション巡回
    while (hasMoreUsers) {
      let usersQuery = db.collection('saas_users')
        .orderBy('__name__')
        .limit(pageSize);

      if (lastUserDoc) {
        usersQuery = usersQuery.startAfter(lastUserDoc);
      }

      const snap = await usersQuery.get();
      if (snap.empty) break;

      for (const doc of snap.docs) {
        const uData = doc.data() || {};
        const hasCreds = uData.xOfficialCredentials ||
                         (uData.twitterAuth && uData.twitterAuth.oauth2RefreshToken) ||
                         uData.encryptedTwitterCredentials ||
                         uData.twitterCredentials;
        if (!hasCreds) continue;
        const { officialApiOperationAllowed } = require('./operated_accounts');
        let officialCreds = null;
        if (uData.xOfficialCredentials) {
          try { officialCreds = decryptCredentials(uData.xOfficialCredentials); } catch (e) { officialCreds = null; }
        }
        if (!officialApiOperationAllowed({ ...uData, userId: doc.id }, officialCreds)) continue;
        if (uData.xLinkHealthStatus === 'suspended') {
          totalSkipped++;
          continue;
        }

        // 🛡️ ユーザー投稿ジョブの完全取得（未回収・未凍結・新旧フラグ全対応・取りこぼし防止）
        let postedJobs = [];
        let jobFetchFailed = false;
        try {
          const postedJobsSnap = await db.collection('autopilot_jobs')
            .where('userId', '==', doc.id)
            .where('status', '==', 'posted')
            .get();
          postedJobs = (postedJobsSnap.docs || []).map(d => ({ id: d.id, ...d.data() }));
        } catch (jobErr) {
          jobFetchFailed = true;
          console.error(`[Job Fetch Error] User ${doc.id}: ジョブ取得エラーのため判定をスキップ（クールダウン誤判定を防止し次回再試行）:`, jobErr.message);
        }

        if (jobFetchFailed) {
          // ジョブ取得失敗時は「ジョブ0件」と誤認してクールダウン判定でスキップすると緊急回収を見逃す恐れがあるため、
          // eligibility判定を行わず次回巡回時に即座に再試行させる
          totalFailed++;
          continue;
        }

        let eligibility;
        try {
          eligibility = evaluateUserSyncEligibility({
            lastHarvestAt: uData.lastMetricsHarvestAt || null,
            postedJobs,
            now: options.now instanceof Date ? options.now : new Date(),
            cooldownMinutes: options.cooldownMinutes || 60
          });
        } catch (eligibilityErr) {
          totalFailed++;
          console.error(`[Metrics Eligibility Error] User ${doc.id}:`, eligibilityErr.message);
          continue;
        }

        if (!eligibility.shouldSync && !options.force) {
          totalSkipped++;
          continue;
        }

        const res = await syncOfficialPostMetricsAndEvolve(doc.id);
        if (res && res.suspended) {
          totalSkipped++;
          console.warn(`[Suspended Account] User ${doc.id} paused`);
        } else if (!res || !res.ok) {
          totalFailed++;
          console.error(`[Metrics Sync Error] User ${doc.id}: ${res?.error || res?.reason || 'unknown error'}`);
        } else if (res.skipped) {
          totalSkipped++;
        } else {
          totalSynced++;
          try {
            const { abstractAudienceQuestions, audienceCacheFresh } = require('./audience_questions');
            if (!audienceCacheFresh(uData.audienceQuestionsCache) && uData.xOfficialCredentials) {
              const creds = decryptCredentials(uData.xOfficialCredentials);
              creds.saasUserId = doc.id;
              const mentions = await getOfficialMentions(creds, 10);
              if (mentions && mentions.ok) {
                await db.collection('saas_users').doc(doc.id).set({
                  audienceQuestionsCache: {
                    questions: abstractAudienceQuestions(mentions.mentions),
                    fetchedAt: new Date().toISOString()
                  }
                }, { merge: true });
              }
            }
          } catch (mentionErr) {
            console.warn(`[Audience Questions] ${mentionErr.message}`);
          }
        }
      }

      if (snap.size < pageSize) {
        hasMoreUsers = false;
      } else {
        lastUserDoc = snap.docs[snap.docs.length - 1];
      }
    }

    return { ok: totalFailed === 0, totalSynced, totalSkipped, totalFailed };
  } catch (e) {
    console.warn('[syncAllActiveCustomersPostMetrics warning]:', e.message);
    return { ok: false, error: e.message };
  }
}

function reserveStructuredMediaCard() {
  return null;
}

function countOrUnknown(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function fetchMeWithFields(credentials, fields) {
  const { apiKey, apiSecret, accessToken, accessTokenSecret, oauth2AccessToken } = credentials;
  const url = `https://api.twitter.com/2/users/me?user.fields=${fields}`;
  let authHeader = '';
  if (oauth2AccessToken) {
    authHeader = `Bearer ${oauth2AccessToken.trim()}`;
  } else if (apiKey && apiSecret && accessToken && accessTokenSecret) {
    const oauthParams = {
      oauth_consumer_key: apiKey.trim(),
      oauth_token: accessToken.trim(),
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_version: '1.0'
    };
    authHeader = generateOAuth1Header('GET', url, oauthParams, apiSecret.trim(), accessTokenSecret.trim(), { 'user.fields': fields });
  } else {
    return { ok: false, error: '認証情報が不足しています' };
  }
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: authHeader, 'User-Agent': 'HybridSaaSClient/1.0' }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.data) {
    const errMsg = (data.errors && data.errors[0] && data.errors[0].message) || data.detail || `HTTP_${res.status}`;
    return { ok: false, status: res.status, error: errMsg };
  }
  const metrics = data.data.public_metrics || {};
  return {
    ok: true,
    username: data.data.username || null,
    name: data.data.name || null,
    followers: countOrUnknown(metrics.followers_count),
    following: countOrUnknown(metrics.following_count),
    tweetCount: countOrUnknown(metrics.tweet_count),
    subscriptionType: data.data.subscription_type || null,
    verifiedType: data.data.verified_type || null
  };
}

async function fetchMyAccountState(credentials) {
  const uid = accountDocId(credentials && credentials.saasUserId) || accountDocId(credentials && credentials.userId);
  if (credentials && credentials.oauth2RefreshToken) {
    credentials = await refreshOAuth2TokenIfNeeded(credentials, false, uid);
  }
  let full = await fetchMeWithFields(credentials, 'public_metrics,subscription_type,verified,verified_type');
  if (full.status === 401 && credentials && credentials.oauth2RefreshToken) {
    credentials = await refreshOAuth2TokenIfNeeded(credentials, true, uid);
    full = await fetchMeWithFields(credentials, 'public_metrics,subscription_type,verified,verified_type');
  }
  if (full.ok || full.status !== 400) return full;
  const basic = await fetchMeWithFields(credentials, 'public_metrics');
  if (basic.ok) basic.subscriptionType = null;
  return basic;
}

module.exports = {
  sanitizePostOrReplyText,
  fetchMyAccountState,
  encryptCredentials,
  decryptCredentials,
  verifyOfficialCredentials,
  postOfficialTweet,
  uploadOfficialMedia,
  postOfficialThread,
  registerBoostCampaign,
  getUserProfileAndRecentTweets,
  lookupTweetsByIds,
  lookupAnyUserProfileAndTweets,
  refreshOAuth2TokenIfNeeded,
  getOfficialMentions,
  reserveStructuredMediaCard,
  followUserViaOfficialApi,
  generateOfficialReplyContent,
  runOfficialAutonomousEngagement,
  syncOfficialPostMetricsAndEvolve,
  syncAllActiveCustomersPostMetrics
};
