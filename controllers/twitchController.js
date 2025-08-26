// controllers/twitchController.js
// Order:
// 1) Quick HTML scan for clips CDN
// 2) yt-dlp fallback (works for Clips; VODs may require auth)
//
// Returns { success: true, data: {...} }

const ytdlp = require('youtube-dl-exec');

let fetchFn = (typeof fetch !== 'undefined') ? fetch : null;
if (!fetchFn) { try { fetchFn = require('node-fetch'); } catch {} }
if (!fetchFn) { throw new Error("Fetch API not available. Use Node 18+ or install 'node-fetch'."); }

function asFormat(url, i, label='Original') {
  const isVideo = /\.mp4|\.m3u8/i.test(url);
  return {
    itag: String(i),
    quality: label,
    url,
    mimeType: isVideo ? (url.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/mp4') : 'application/octet-stream',
    hasAudio: true,
    hasVideo: true,
    container: url.endsWith('.m3u8') ? 'hls' : 'mp4',
    contentLength: 0,
  };
}
function ok(title, thumb, formats) {
  const best = formats[0];
  return {
    success: true,
    data: {
      title: title || 'Twitch Media',
      url: best.url,
      thumbnail: thumb || '',
      duration: null,
      source: 'twitch',
      mediaType: 'video',
      formats,
    }
  };
}

async function tryHtml(url) {
  const resp = await fetchFn(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Referer': 'https://www.twitch.tv/',
    }
  });
  if (!resp.ok) throw new Error(`page fetch ${resp.status}`);
  const html = await resp.text();

  let title = 'Twitch Media';
  const t = html.match(/<title>([^<]+)<\/title>/i);
  if (t?.[1]) title = t[1].trim();

  let thumb = '';
  const og = html.match(/<meta property="og:image" content="([^"]+)"/i);
  if (og?.[1]) thumb = og[1];

  // Clips CDN patterns
  const clips = [];
  const p = [
    /https:\/\/clips-media-assets\d+\.twitch\.tv\/[^"'\s]+\.mp4/ig,
    /https:\/\/production-assets\.clips\.twitchcdn\.net\/[^"'\s]+\.mp4/ig
  ];
  for (const r of p) {
    let m;
    while ((m = r.exec(html)) !== null) clips.push(m[0]);
  }
  if (!clips.length) throw new Error('no clip media found');

  const formats = clips.map((u,i) => asFormat(u, i, i===0 ? 'Best' : 'Alt'));
  return ok(title, thumb, formats);
}

async function tryYtdlp(url) {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    referer: 'https://www.twitch.tv/',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  });

  const all = Array.isArray(info?.formats) ? info.formats : [];
  const pick = all.filter(f => f?.url);
  if (!pick.length && info?.url) pick.push({ url: info.url, ext: 'mp4', vcodec: 'unknown', acodec: 'unknown' });
  if (!pick.length) throw new Error('yt-dlp returned no formats');

  const formats = pick.map((f, i) => ({
    itag: String(f.format_id || i),
    quality: f.format_note || (f.height ? `${f.height}p` : 'Original'),
    url: f.url,
    mimeType: f.mime_type || (f.vcodec && f.vcodec !== 'none' ? `video/${f.ext || 'mp4'}` : `audio/${f.ext || 'mp3'}`),
    hasAudio: f.acodec && f.acodec !== 'none',
    hasVideo: f.vcodec && f.vcodec !== 'none',
    container: f.ext || (String(f.protocol).includes('m3u8') ? 'hls' : 'mp4'),
    contentLength: Number(f.filesize || f.filesize_approx || 0),
  }));

  const best = formats[0];
  return {
    success: true,
    data: {
      title: info?.title || 'Twitch Media',
      url: best.url,
      thumbnail: info?.thumbnail || '',
      duration: info?.duration || null,
      source: 'twitch',
      mediaType: best.hasVideo ? 'video' : 'audio',
      formats,
    }
  };
}

async function downloadTwitchMedia(url) {
  try { return await tryHtml(url); } catch (_) {}
  return await tryYtdlp(url);
}

module.exports = { downloadTwitchMedia };
