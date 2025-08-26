// controllers/tiktokController.js
// Strategy:
// 1) Try btch-downloader's `ttdl()` to get no-watermark video/audio
// 2) Fallback to yt-dlp with TikTok referer
// Return direct URLs; server will proxy through /api/direct.

const ytdlp = require('youtube-dl-exec');

// Optional dependency (survive if not installed)
let ttdl = null;
try {
  ({ ttdl } = require('btch-downloader'));
} catch {
  ttdl = null;
}

function extFrom(url) {
  const m = String(url).toLowerCase().match(/\.(mp4|m4v|webm|mp3|m4a|aac)(?:$|\?)/);
  return m ? m[1] : 'mp4';
}

function asFormat(u, i, label = 'Original Quality') {
  const ext = extFrom(u);
  const isVideo = /(mp4|m4v|webm)$/i.test(ext);
  return {
    itag: String(i),
    quality: label,
    url: u,
    mimeType: isVideo ? `video/${ext}` : `audio/${ext}`,
    hasAudio: true,
    hasVideo: isVideo,
    container: ext,
    contentLength: 0,
  };
}

async function tryLib(url) {
  if (!ttdl) throw new Error('ttdl() not available');
  const d = await ttdl(url);

  // Common shapes:
  // d.nowm (no watermark), d.wm, d.hd, d.audio, d.thumbnail, d.title
  const urls = [];
  if (d?.nowm) urls.push({ u: d.nowm, q: 'No Watermark' });
  if (d?.hd) urls.push({ u: d.hd, q: 'HD' });
  if (d?.wm) urls.push({ u: d.wm, q: 'Watermark' });
  if (d?.audio) urls.push({ u: d.audio, q: 'Audio' });

  // Fallback arrays
  if (Array.isArray(d?.video)) d.video.forEach((u) => urls.push({ u, q: 'Video' }));
  if (Array.isArray(d?.audio)) d.audio.forEach((u) => urls.push({ u, q: 'Audio' }));

  const list = urls.filter((x) => x.u);
  if (!list.length) throw new Error('library returned no media');

  const formats = list.map((x, i) => asFormat(x.u, i, x.q));
  const best = formats.find((f) => f.hasVideo) || formats[0];

  return {
    success: true,
    data: {
      title: d?.title || 'TikTok Video',
      url: best.url,
      thumbnail: d?.thumbnail || '',
      quality: best.quality,
      duration: null,
      source: 'tiktok',
      mediaType: best.hasVideo ? 'video' : 'audio',
      formats,
    },
  };
}

async function tryYtdlp(url) {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    referer: 'https://www.tiktok.com/',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  });

  const all = Array.isArray(info?.formats) ? info.formats : [];
  let pick = all.filter(
    (f) => (f.ext === 'mp4' || f.ext === 'm4v') && f.vcodec !== 'none' && f.acodec !== 'none' && f.url
  );
  if (!pick.length) pick = all.filter((f) => f.url);

  const formats = pick.map((f, i) => ({
    itag: String(f.format_id || i),
    quality: f.format_note || (f.height ? `${f.height}p` : 'Original Quality'),
    url: f.url,
    mimeType: f.mime_type || (f.vcodec && f.vcodec !== 'none' ? `video/${f.ext || 'mp4'}` : `audio/${f.ext || 'mp3'}`),
    hasAudio: f.acodec && f.acodec !== 'none',
    hasVideo: f.vcodec && f.vcodec !== 'none',
    container: f.ext || 'mp4',
    contentLength: Number(f.filesize || f.filesize_approx || 0),
  }));

  const best = formats[0];
  if (!best) throw new Error('yt-dlp returned no usable formats');

  return {
    success: true,
    data: {
      title: info?.title || 'TikTok Video',
      url: best.url,
      thumbnail: info?.thumbnail || '',
      quality: best.quality,
      duration: info?.duration || null,
      source: 'tiktok',
      mediaType: best.hasVideo ? 'video' : 'audio',
      formats,
    },
  };
}

async function downloadTikTok(url) {
  try { return await tryLib(url); } catch (_) {}
  return await tryYtdlp(url);
}

module.exports = { downloadTikTok };
