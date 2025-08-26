// utils/urlShortener.js
// Bitly first; tinyurl fallback; finally return original.
const { BitlyClient } = require('bitly');
const tinyurl = require('tinyurl');
const config = require('./config'); // Fixed: changed from '../config' to './config'

const bitly = config.BITLY_ACCESS_TOKEN ? new BitlyClient(config.BITLY_ACCESS_TOKEN) : null;

async function shortenUrl(longUrl) {
  try {
    if (bitly) {
      const r = await bitly.shorten(longUrl);
      if (r?.link) return r.link;
    }
  } catch (_) {}
  try {
    const t = await tinyurl.shorten(longUrl);
    if (t && /^https?:\/\//i.test(t)) return t;
  } catch (_) {}
  return longUrl;
}

module.exports = { shortenUrl };