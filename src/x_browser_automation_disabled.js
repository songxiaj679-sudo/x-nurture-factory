function rejectXBrowserAutomation() {
  const error = 'Xのブラウザー自動操作は停止しています。公式APIをご利用ください。';
  console.warn(`[X Browser Automation] ${error}`);
  return { ok: false, reason: 'browser_automation_disabled', error };
}

module.exports = { rejectXBrowserAutomation };
