'use strict';

const { isIP } = require('node:net');
const dns = require('node:dns').promises;

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

function isBlockedAddress(address) {
  if (typeof address !== 'string' || !isIP(address)) return true;
  const mapped = address.toLowerCase().startsWith('::ffff:') ? address.slice(7) : address;
  if (mapped.includes(':')) {
    const lower = mapped.toLowerCase();
    return lower === '::1' || lower === '::' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd');
  }
  const parts = mapped.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function blockedHostname(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  return host === 'metadata.google.internal';
}

async function assertPublicHttpUrl(rawUrl) {
  let url;
  try {
    url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
  } catch (err) {
    const error = new Error('URLが無効です');
    error.cause = err;
    throw error;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('httpまたはhttpsの公開URLだけ取得します');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (blockedHostname(host)) throw new Error('内部向けのホストは取得しません');
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error('内部ネットワークのアドレスは取得しません');
    return url;
  }
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(record => isBlockedAddress(record.address))) {
    throw new Error('名前解決先が内部ネットワークのため取得しません');
  }
  return url;
}

function charsetName(contentType, buffer) {
  const head = Buffer.isBuffer(buffer) ? buffer.subarray(0, 2048).toString('latin1') : '';
  const found = `${contentType || ''} ${head}`.match(/charset\s*=\s*["']?([a-z0-9_\-]+)/i);
  return found ? found[1].toLowerCase() : 'utf-8';
}

function decodePublicBytes(buffer, contentType = '') {
  const name = charsetName(contentType, buffer);
  if (/shift[_-]?jis|sjis|windows-31j|cp932/.test(name)) return new TextDecoder('shift_jis').decode(buffer);
  if (/euc[-_]?jp/.test(name)) return new TextDecoder('euc-jp').decode(buffer);
  return Buffer.from(buffer).toString('utf8');
}

async function readLimitedText(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('応答が大きすぎます');
  }
  let buffer;
  if (!response.body || typeof response.body.getReader !== 'function') {
    buffer = Buffer.from(await response.arrayBuffer());
  } else {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('応答が大きすぎます');
      }
      chunks.push(Buffer.from(value));
    }
    buffer = Buffer.concat(chunks);
  }
  if (buffer.length > maxBytes) throw new Error('応答が大きすぎます');
  return decodePublicBytes(buffer, response.headers.get('content-type'));
}

async function fetchPublicText(rawUrl, options = {}) {
  let current = await assertPublicHttpUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current.href, {
      redirect: 'manual',
      headers: options.headers,
      signal: options.signal
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('転送先がありません');
      current = await assertPublicHttpUrl(new URL(location, current));
      continue;
    }
    if (!response.ok) {
      return { ok: false, url: current.href, error: `HTTP ${response.status}: ${response.statusText}` };
    }
    return { ok: true, url: current.href, text: await readLimitedText(response) };
  }
  throw new Error('転送が多すぎます');
}

module.exports = {
  MAX_RESPONSE_BYTES,
  isBlockedAddress,
  assertPublicHttpUrl,
  fetchPublicText,
  decodePublicBytes,
  charsetName
};
