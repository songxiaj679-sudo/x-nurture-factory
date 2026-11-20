const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGoogleAuthorizationUrl,
  findOrCreateGoogleUser,
  getGoogleOAuthConfig,
  matchesOAuthState,
  registerGoogleAuthRoutes
} = require('../src/google_auth');

test('Google OAuth config requires credentials and an explicit callback URL', () => {
  assert.throws(() => getGoogleOAuthConfig({}), /GOOGLE_CLIENT_ID/);
  assert.throws(() => getGoogleOAuthConfig({
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_REDIRECT_URI: 'http://example.com/api/auth/google/callback'
  }), /must use HTTPS/);

  assert.deepEqual(getGoogleOAuthConfig({
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_REDIRECT_URI: 'https://app.example.com/api/auth/google/callback'
  }), {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://app.example.com/api/auth/google/callback',
    secureCookie: true
  });
});

test('Google authorization URL uses the configured callback and CSRF state', () => {
  const url = new URL(buildGoogleAuthorizationUrl({
    clientId: 'client-id',
    redirectUri: 'https://app.example.com/api/auth/google/callback'
  }, 'state-token'));

  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example.com/api/auth/google/callback');
  assert.equal(url.searchParams.get('state'), 'state-token');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
});

test('OAuth state comparison only accepts exact non-empty values', () => {
  assert.equal(matchesOAuthState('state-token', 'state-token'), true);
  assert.equal(matchesOAuthState('state-token', 'different'), false);
  assert.equal(matchesOAuthState('', ''), false);
});

test('Google login route redirects with a state cookie and configured callback', () => {
  const originalEnv = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI
  };
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://app.example.com/api/auth/google/callback';

  try {
    const routes = new Map();
    registerGoogleAuthRoutes({ get: (path, handler) => routes.set(path, handler) }, {});

    const headers = {};
    let redirect;
    routes.get('/api/auth/google')({}, {
      setHeader: (name, value) => { headers[name] = value; },
      redirect: (status, url) => { redirect = { status, url }; }
    });

    assert.equal(redirect.status, 302);
    assert.equal(new URL(redirect.url).searchParams.get('redirect_uri'), process.env.GOOGLE_REDIRECT_URI);
    assert.match(headers['Set-Cookie'], /HttpOnly; SameSite=Lax/);
    assert.match(headers['Set-Cookie'], /Secure/);
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Google login creates a new saas user and reuses it on the next login', async () => {
  const records = new Map();
  const db = {
    collection: () => ({
      where: (field, _operator, expected) => ({
        limit: () => ({
          get: async () => {
            const docs = [...records.entries()]
              .filter(([, value]) => value[field] === expected)
              .map(([id, value]) => ({
                id,
                data: () => value,
                ref: {
                  set: async (updates, options) => {
                    records.set(id, options && options.merge ? { ...records.get(id), ...updates } : updates);
                  }
                }
              }));
            return { docs, empty: docs.length === 0 };
          }
        })
      }),
      doc: (id) => ({
        set: async (value) => { records.set(id, value); }
      })
    })
  };

  const profile = { sub: 'google-sub-123', email: 'person@example.com' };
  const firstLogin = await findOrCreateGoogleUser(db, profile);
  const secondLogin = await findOrCreateGoogleUser(db, profile);

  assert.equal(firstLogin.userId, secondLogin.userId);
  assert.equal(records.size, 1);
  assert.equal(records.get(firstLogin.userId).email, profile.email);
  assert.deepEqual(records.get(firstLogin.userId).authProviders, ['google']);
});
