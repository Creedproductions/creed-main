// controllers/threadsController.js
// Strategy order:
// 1) herxa-media-downloader's threads() (fast path)
// 2) Lightweight HTML parse (og:video / video_url / playbackUrl / images)
// 3) yt-dlp fallback with Threads referer
//
// All returns use direct URLs; your server will proxy via /api/direct.

const ytdlp = require('youtube-dl-exec');

// Optional deps – keep working even if not installed
let threadsLib = null;
try {
  ({ threads: threadsLib } = require('herxa-media-downloader'));
} catch {
  threadsLib = null;
}

// Fetch that works on Node 16/18+
let fetchFn = (typeof fetch !== 'undefined') ? fetch : null;
if (!fetchFn) {
  try { fetchFn = require('node-fetch'); } catch { /* ignore */ }
}
if (!fetchFn) {
  throw new Error("Fetch API not available. Use Node 18+ or install 'node-fetch'.");
}

function extFrom(url) {
  const m = String(url).toLowerCase().match(/\.(mp4|m4v|webm|mp3|m4a|aac|jpg|jpeg|png|gif|webp)(?:$|\?)/);
  return m ? m[1].replace('jpeg', 'jpg') : 'mp4';
}

function asFormat(u, i, label = 'Original Quality') {
  const ext = extFrom(u);
  const isVideo = /(mp4|m4v|webm)$/i.test(ext);
  const isAudio = /(mp3|m4a|aac)$/i.test(ext);
  return {
    itag: String(i),
    quality: label,
    url: u,
    mimeType: isVideo ? `video/${ext}` : (isAudio ? `audio/${ext}` : `image/${ext}`),
    hasAudio: isVideo || isAudio,
    hasVideo: isVideo,
    container: ext,
    contentLength: 0,
  };
}

function deriveMediaType(fmt) {
  if (!fmt) return 'video';
  if (fmt.mimeType.startsWith('image/')) return 'image';
  if (fmt.hasVideo) return 'video';
  return 'audio';
}

async function tryHerxa(url) {
  if (!threadsLib) throw new Error('herxa-media-downloader not available');

  const d = await threadsLib(url); // common shape: { data: { video?: string, image?: string } }
  const urls = new Set();
  let title = 'Threads Post';
  let thumb = '';

  if (d?.data) {
    const v = d.data;
    if (v.video) urls.add(v.video);
    if (v.image) urls.add(v.image);
    if (Array.isArray(v.media)) v.media.forEach((m) => m?.url && urls.add(m.url));
    if (v.title) title = v.title;
    if (v.thumbnail) thumb = v.thumbnail;
  }

  // Some libs return a plain object with url
  if (d?.url) urls.add(d.url);
  if (Array.isArray(d)) d.forEach((x) => x?.url && urls.add(x.url));

  const list = Array.from(urls);
  if (!list.length) throw new Error('threads() returned no media');

  const formats = list.map((u, i) => asFormat(u, i));
  const best = formats.find((f) => f.hasVideo) || formats[0];

  return {
    success: true,
    data: {
      title,
      url: best.url,
      thumbnail: thumb || '',
      quality: best.quality,
      duration: null,
      source: 'threads',
      mediaType: deriveMediaType(best),
      formats,
    },
  };
}

function extractFromHtml(html) {
  const urls = new Set();
  let title = 'Threads Post';
  let thumb = '';

  const t = html.match(/<title>([^<]+)<\/title>/i);
  if (t?.[1]) title = t[1].trim();

  // Thumbnails
  const ogImg = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  if (ogImg?.[1]) thumb = ogImg[1];

  // Video meta tags
  const candidates = [
    /<meta\s+property="og:video"\s+content="([^"]+)"/i,
    /<meta\s+property="og:video:url"\s+content="([^"]+)"/i,
    /"video_url":"([^"]+)"/i,
    /"playbackUrl":"([^"]+)"/i,
    /"mediaUrl":"([^"]+)"/i,
    /"videoUrl":"([^"]+)"/i,
    /"url":"([^"]+\.mp4[^"]*)"/i,
    /https?:\/\/[^\s"']+\.mp4[^\s"']*/i,
  ];

  for (const r of candidates) {
    const m = html.match(r);
    if (m?.[1]) {
      urls.add(
        m[1]
          .replace(/\\u002F/g, '/')
          .replace(/\\\//g, '/')
          .replace(/\\/g, '')
          .replace(/&amp;/g, '&')
      );
      break;
    }
  }

  // If still no video, try image pins
  if (!urls.size) {
    const imgCands = [
      /"display_url":"([^"]+)"/i,
      /"image_url":"([^"]+)"/i,
      /"thumbnail_url":"([^"]+)"/i,
    ];
    for (const r of imgCands) {
      const m = html.match(r);
      if (m?.[1]) {
        urls.add(m[1].replace(/\\\//g, '/').replace(/\\/g, '').replace(/&amp;/g, '&'));
        break;
      }
    }
    if (!urls.size && ogImg?.[1]) urls.add(ogImg[1]);
  }

  const list = Array.from(urls);
  if (!list.length) throw new Error('no media found in HTML');

  const formats = list.map((u, i) => asFormat(u, i));
  const best = formats.find((f) => f.hasVideo) || formats[0];

  return {
    success: true,
    data: {
      title,
      url: best.url,
      thumbnail: thumb || (formats.find((f) => f.mimeType.startsWith('image/'))?.url || ''),
      quality: best.quality,
      duration: null,
      source: 'threads',
      mediaType: deriveMediaType(best),
      formats,
    },
  };
}

async function tryHtml(url) {
  const resp = await fetchFn(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.threads.net/',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`failed to fetch page: ${resp.status}`);
  const html = await resp.text();
  return extractFromHtml(html);
}

async function tryYtdlp(url) {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    referer: 'https://www.threads.net/',
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
  if (!best) throw new Error('yt-dlp found no usable Threads formats');

  return {
    success: true,
    data: {
      title: info?.title || 'Threads Post',
      url: best.url,
      thumbnail: info?.thumbnail || '',
      quality: best.quality,
      duration: info?.duration || null,
      source: 'threads',
      mediaType: deriveMediaType(best),
      formats,
    },
  };
}

async function downloadThreads(url) {
  // herxa -> HTML parse -> yt-dlp
  try { return await tryHerxa(url); } catch (_) {}
  try { return await tryHtml(url); } catch (_) {}
  return await tryYtdlp(url);
}

module.exports = { downloadThreads };
