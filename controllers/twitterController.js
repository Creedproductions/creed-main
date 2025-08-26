// controllers/twitterController.js
// Robust: HTML scan for twimg .mp4 + yt-dl as fallback.
const ytdl = require('youtube-dl-exec');
const fetch = require('node-fetch');

async function downloadTwitterVideo(url) {
  // scrape
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html',
      },
    });
    if (!r.ok) throw new Error(`Fetch ${r.status}`);
    const html = await r.text();

    const patterns = [
      /"(https?:\/\/video\.twimg\.com\/[^"']+\.mp4[^"']*)"/g,
      /playbackUrl":"([^"]+)"/,
      /video_url":"([^"]+)"/,
    ];

    for (const p of patterns) {
      const matches = p.global ? html.match(p) : null;
      if (matches?.length) {
        const url0 = matches[0].replace(/(^"|"$)/g, '').replace(/&amp;/g, '&');
        return ok(url0);
      }
      const m = p.exec(html);
      if (m?.[1]) return ok(m[1].replace(/\\u002F/g, '/').replace(/&amp;/g, '&'));
    }
  } catch (_) { /* next */ }

  // yt-dl fallback
  try {
    const info = await ytdl(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      addHeader: ['referer:twitter.com', 'user-agent:Mozilla/5.0'],
    });
    if (info?.formats?.length) {
      const withAv = info.formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none');
      const best = withAv[0] || info.formats[0];
      return ok(best.url, info.title, info.thumbnail);
    }
  } catch (e) {
    throw new Error(`Twitter error: ${e.message}`);
  }

  function ok(u, t = 'Twitter/X Video', th = 'https://via.placeholder.com/300x150') {
    return { success: true, data: { title: t, url: u, thumbnail: th, sizes: ['Original Quality'], source: 'twitter' } };
  }
}

module.exports = { downloadTwitterVideo };
