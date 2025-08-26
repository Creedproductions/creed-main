// controllers/dailymotionController.js
const ytdl = require('youtube-dl-exec');
const fetch = require('node-fetch');

async function downloadDailymotionMedia(url) {
  try {
    const info = await ytdl(url, { dumpSingleJson: true, noWarnings: true, noCheckCertificates: true });
    if (info?.formats?.length) {
      const f = info.formats.find(x => /m3u8|mp4/i.test(x.ext || '') || /mp4|m3u8|mpd/i.test(x.url)) || info.formats[0];
      return { success: true, data: { title: info.title || 'Dailymotion', url: f.url, thumbnail: info.thumbnail, sizes: ['Original Quality'], source: 'dailymotion' } };
    }
  } catch (_) {}
  // fallback OG
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await r.text();
  const v = (html.match(/<meta property="og:video" content="([^"]+)"/i) || [])[1];
  const t = (html.match(/<meta property="og:image" content="([^"]+)"/i) || [])[1];
  const title = (html.match(/<meta property="og:title" content="([^"]+)"/i) || [])[1] || 'Dailymotion';
  if (v) return { success: true, data: { title, url: v, thumbnail: t, sizes: ['Original Quality'], source: 'dailymotion' } };
  throw new Error('No media found');
}

module.exports = { downloadDailymotionMedia };
