const blockedPaths = [
  '/exchange-accounts',
  '/api/audit-cleared-stock',
  '/sell-and-export',
  '/api/check-robot-frozen'
];

function registerUnofficialAccountCheckGuard(app) {
  app.post(blockedPaths, (req, res) => {
    res.status(403).json({
      ok: false,
      reason: 'unofficial_account_check_disabled',
      error: '非公式のXアカウント検査を停止したため、この操作は利用できません。アカウント状態は変更していません。'
    });
  });
}

module.exports = { registerUnofficialAccountCheckGuard };
