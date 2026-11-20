const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerUnofficialAccountCheckGuard } = require('../src/x_unofficial_account_check_guard');

test('unofficial account checks reject requests before account changes', async () => {
  const app = express();
  let changes = 0;
  registerUnofficialAccountCheckGuard(app);
  const paths = ['/exchange-accounts', '/api/audit-cleared-stock', '/sell-and-export', '/api/check-robot-frozen'];
  app.post(paths, (req, res) => {
    changes++;
    res.sendStatus(200);
  });
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    for (const path of paths) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST' });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).reason, 'unofficial_account_check_disabled');
    }
    assert.equal(changes, 0);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
