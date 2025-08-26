// controllers/threadsController.js
const { threads } = require('herxa-media-downloader');
const fetch = require('node-fetch');

async function downloadThreads(url) {
  // try lib
  try {
    const r = await threads(url);
    if (r?.data?.video) {
      return ok(r.data.video, 'Threads Post', r.data.thumbnail);
    }
  } catch (_) {}

  // fallback: scrape og tags
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error(`Threads fetch failed: ${resp.status}`);
  const html = await resp.text();

  const v = (html.match(/<meta property="og:video(:url)?" content="([^"]+)"/i) || [])[2];
  const img = (html.match(/<meta property="og:image" content="([^"]+)"/i) || [])[1];
  if (v) return ok(v.replace(/&amp;/g, '&'), 'Threads Post', img);

  if (img) {
    return { success: true, data: { title: 'Threads Image', url: img, thumbnail: img, sizes: ['Original Quality'], source: 'threads' } };
  }
  throw new Error('No media found in this Threads post');

  function ok(u, t, th) {
    return { success: true, data: { title: t, url: u, thumbnail: th || 'https://via.placeholder.com/300x150', sizes: ['Original Quality'], source: 'threads' } };
  }
}

module.exports = { downloadThreads };
