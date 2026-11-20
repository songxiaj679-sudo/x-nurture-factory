'use strict';

const RELINK_MESSAGE = 'Xの再連携が必要です。これまでの投稿、保存、返信の記憶は消さず、同じアカウントの続きとして使います。';

function xLinkHealth(user = {}, now = Date.now()) {
  const hasCreds = Boolean(user.xOfficialCredentials || (user.officialApiKey && user.officialAccessToken));
  if (!hasCreds) return { connected: false, relink: false, message: '' };
  if (user.xLinkStatus === 'relink_required') {
    return { connected: true, relink: true, message: user.xLinkMessage || RELINK_MESSAGE };
  }
  const auth = user.twitterAuth || {};
  const refresh = auth.oauth2RefreshToken || user.twitterRefreshToken || '';
  const expiresAt = auth.oauth2ExpiresAt ? new Date(auth.oauth2ExpiresAt).getTime() : 0;
  if ((auth.authType === 'oauth2' || auth.oauth2AccessToken) && expiresAt && expiresAt <= now && !refresh) {
    return { connected: true, relink: true, message: RELINK_MESSAGE };
  }
  return { connected: true, relink: false, message: '' };
}

module.exports = { RELINK_MESSAGE, xLinkHealth };
