/**
 * @file tests/official_api_client_mock.test.js
 * @description X公式APIクライアント（official_api_client）のモック検証テスト
 * 
 * 【検証対象（Copilot レビュー指摘 #15 準拠）】
 * 1. 150件ID照会時の100件＋50件の分割リクエスト（2回呼出）と全150件結合
 * 2. チャンク分割途中のエラー（2チャンク目 HTTP 429 Rate Limit）時のエラー伝播と部分レスポンス
 * 3. タイムライン取得時のHTTPエラー（HTTP 429 / 500）の明示的伝播
 * 4. 認証情報不足時の credentials_missing エラー返却
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  lookupTweetsByIds,
  getUserProfileAndRecentTweets,
  postOfficialTweet
} = require('../src/official_api_client');

describe('Official API Client Mock & Chunking Invariants', () => {
  const mockCreds = { oauth2AccessToken: 'mock_bearer_token_test' };

  test('lookupTweetsByIds correctly chunks 150 IDs into 100 + 50 requests and merges all 150 tweets', async () => {
    const mockIds = Array.from({ length: 150 }, (_, i) => `id_${i + 1}`);
    const fetchCalls = [];

    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      const urlObj = new URL(url);
      const idsParam = urlObj.searchParams.get('ids') || '';
      const ids = idsParam.split(',').filter(Boolean);

      const mockData = ids.map(id => ({
        id,
        text: `Tweet content for ${id}`,
        created_at: '2026-11-15T00:00:00Z',
        public_metrics: { impression_count: 100, bookmark_count: 5 }
      }));

      return {
        ok: true,
        status: 200,
        json: async () => ({ data: mockData })
      };
    };

    try {
      const res = await lookupTweetsByIds(mockCreds, mockIds);

      assert.strictEqual(res.ok, true, '全チャンク成功時は ok: true であること');
      assert.strictEqual(fetchCalls.length, 2, '150件は100件と50件の計2回fetchされること');

      // 1回目のチャンクリクエスト検証 (100件)
      const firstCallIds = new URL(fetchCalls[0].url).searchParams.get('ids').split(',');
      assert.strictEqual(firstCallIds.length, 100, '第1チャンクは100件であること');
      assert.strictEqual(firstCallIds[0], 'id_1');
      assert.strictEqual(firstCallIds[99], 'id_100');

      // 2回目のチャンクリクエスト検証 (50件)
      const secondCallIds = new URL(fetchCalls[1].url).searchParams.get('ids').split(',');
      assert.strictEqual(secondCallIds.length, 50, '第2チャンクは50件であること');
      assert.strictEqual(secondCallIds[0], 'id_101');
      assert.strictEqual(secondCallIds[49], 'id_150');

      // 結合結果の検証 (全150件)
      assert.strictEqual(res.tweets.length, 150, '150件のツイートが切り捨てなく結合されること');
      assert.strictEqual(res.tweets[0].id, 'id_1');
      assert.strictEqual(res.tweets[149].id, 'id_150');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('lookupTweetsByIds handles mid-flight failure on 2nd chunk (HTTP 429) cleanly with error propagation', async () => {
    const mockIds = Array.from({ length: 150 }, (_, i) => `id_${i + 1}`);
    let callIndex = 0;

    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      callIndex++;
      if (callIndex === 1) {
        // 1回目 (100件) は成功
        const ids = new URL(url).searchParams.get('ids').split(',');
        const mockData = ids.map(id => ({ id, text: `Text ${id}`, created_at: '2026-11-15T00:00:00Z' }));
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: mockData })
        };
      } else {
        // 2回目 (50件) でレートリミット (HTTP 429) 発生
        return {
          ok: false,
          status: 429,
          json: async () => ({ errors: [{ message: 'Rate limit exceeded' }] })
        };
      }
    };

    try {
      const res = await lookupTweetsByIds(mockCreds, mockIds);

      // 2チャンク目の失敗が正しく伝播されること（成功扱いにならないこと）
      assert.strictEqual(res.ok, false, '途中失敗時は ok: false が返ること');
      assert.strictEqual(res.status, 429, 'HTTP 429 ステータスが保持されること');
      assert.ok(res.error.includes('Rate limit exceeded'), 'エラーメッセージが含まれること');
      assert.strictEqual(res.tweets.length, 100, '第1チャンクで取得できた100件の部分データが保持されること');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('lookupTweetsByIds reports partial errors even when the response is HTTP 200', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: '1', text: 'Available' }],
        errors: [{ resource_id: '2', detail: 'Not found' }]
      })
    });

    try {
      const res = await lookupTweetsByIds(mockCreds, ['1', '2']);
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.tweets.length, 1);
      assert.strictEqual(res.errors[0].resource_id, '2');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('getUserProfileAndRecentTweets propagates HTTP 429 rate limit error cleanly', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      return {
        ok: false,
        status: 429,
        json: async () => ({ detail: 'Too Many Requests' })
      };
    };

    try {
      const res = await getUserProfileAndRecentTweets(mockCreds, 10);
      assert.strictEqual(res.ok, false, 'HTTPエラー時は ok: false であること');
      assert.strictEqual(res.status, 429);
      assert.ok(res.error.includes('Too Many Requests') || res.error.includes('429'));
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('getUserProfileAndRecentTweets returns credentials_missing error when credentials are incomplete', async () => {
    const res = await getUserProfileAndRecentTweets({ apiKey: 'mock_only' });
    assert.strictEqual(res.ok, false);
    assert.ok(res.error.includes('OAuth 1.0') || res.error.includes('credentials_missing'));
  });

  test('duplicate-content HTTP 403 is not retried as an OAuth refresh', async () => {
    const originalFetch = global.fetch;
    const originalClientId = process.env.X_CLIENT_ID;
    const urls = [];
    process.env.X_CLIENT_ID = 'mock-client';
    global.fetch = async url => {
      urls.push(String(url));
      return {
        ok: false,
        status: 403,
        json: async () => ({
          errors: [{ message: 'You are not allowed to create a Tweet with duplicate content.' }]
        })
      };
    };

    try {
      const result = await postOfficialTweet({
        oauth2AccessToken: 'mock-access-token',
        oauth2RefreshToken: 'mock-refresh-token',
        oauth2ExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        userId: 'mock-user'
      }, 'Duplicate post');

      assert.equal(result.ok, false);
      assert.equal(result.status, 403);
      assert.match(result.error, /duplicate content/u);
      assert.deepEqual(urls, ['https://api.twitter.com/2/tweets']);
    } finally {
      global.fetch = originalFetch;
      if (originalClientId === undefined) delete process.env.X_CLIENT_ID;
      else process.env.X_CLIENT_ID = originalClientId;
    }
  });
});
