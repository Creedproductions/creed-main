// controllers/soundcloudController.js
// Extract progressive stream from hydration (client_id) where possible.
const fetch = require('node-fetch');

async function downloadSoundCloudAudio(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`SoundCloud fetch failed: ${r.status}`);
  const html = await r.text();

  const title = (html.match(/<meta property="og:title" content="([^"]+)"/i) || [])[1] || 'SoundCloud Track';
  const img = (html.match(/<meta property="og:image" content="([^"]+)"/i) || [])[1];

  // find client_id + progressive url
  const clientId = (html.match(/client_id=([^&"']+)/) || [])[1];
  const hydra = (html.match(/window\.__sc_hydration\s*=\s*(\[.*?\]);/s) || [])[1];
  if (hydra) {
    try {
      const data = JSON.parse(hydra);
      const item = data.find(it => it?.data?.media?.transcodings);
      const prog = item?.data?.media?.transcodings?.find(t => t.format?.protocol === 'progressive');
      if (prog?.url && clientId) {
        const api = `${prog.url}?client_id=${clientId}`;
        // resolve the progressive URL
        const s = await fetch(api, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://soundcloud.com/' } });
        const j = await s.json();
        if (j?.url) {
          return { success: true, data: { title, url: j.url, thumbnail: img, sizes: ['128kbps'], source: 'soundcloud', mediaType: 'audio' } };
        }
      }
    } catch (_) {}
  }

  // fallback to embed-only
  return { success: true, data: { title, url: url, thumbnail: img, sizes: ['Embed'], source: 'soundcloud', note: 'Embed only (no direct stream)' } };
}

module.exports = { downloadSoundCloudAudio };
