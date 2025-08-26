// controllers/facebookController.js
// Order:
// 1) Lightweight HTML scan for hd/sd sources & playable_url variants
// 2) yt-dlp fallback with Facebook referer/UA
//
// Returns { success: true, data: { title, url, thumbnail, mediaType, formats } }

const ytdlp = require('youtube-dl-exec');

// Use built-in fetch (Node 18+) or node-fetch if present
let fetchFn = (typeof fetch !== 'undefined') ? fetch : null;
if (!fetchFn) {
  try { fetchFn = require('node-fetch'); } catch {}
}
if (!fetchFn) {
  throw new Error("Fetch API not available. Use Node 18+ or install 'node-fetch'.");
}

function cleanUrl(u = '') {
  return String(u)
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .replace(/\\/g, '')
    .replace(/&amp;/g, '&')
    .trim();
}
function extFrom(url) {
  const m = String(url).toLowerCase().match(/\.(mp4|m4v|webm|mp3|m4a|aac|jpg|jpeg|png|gif|webp)(?:$|\?)/);
  return m ? m[1].replace('jpeg', 'jpg') : (url.includes('.mp4') ? 'mp4' : 'mp4');
}
function asFormat(u, i, label = 'Original Quality') {
  const ext = extFrom(u);
  const isVideo = /(mp4|m4v|webm)$/i.test(ext);
  return {
    itag: String(i),
    quality: label,
    url: u,
    mimeType: isVideo ? `video/${ext}` : `image/${ext}`,
    hasAudio: isVideo,
    hasVideo: isVideo,
    container: ext,
    contentLength: 0,
  };
}
function ok(title, thumb, formats) {
  const best = formats.find(f => f.hasVideo) || formats[0];
  return {
    success: true,
    data: {
      title: title || 'Facebook Video',
      url: best?.url || formats[0]?.url,
      thumbnail: thumb || '',
      duration: null,
      source: 'facebook',
      mediaType: best?.hasVideo ? 'video' : 'image',
      formats,
    }
  };
}

async function tryHtml(url) {
  const resp = await fetchFn(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.facebook.com/',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`page fetch ${resp.status}`);
  const html = await resp.text();

  let title = 'Facebook Video';
  const t = html.match(/<title>([^<]+)<\/title>/i);
  if (t?.[1]) title = t[1].replace(' | Facebook', '').trim();

  let thumb = '';
  const og = html.match(/<meta property="og:image" content="([^"]+)"/i);
  if (og?.[1]) thumb = cleanUrl(og[1]);

  // Look for common JSON fields Facebook uses
  const candidates = new Set();
  const patterns = [
    /"hd_src_no_ratelimit":"([^"]+)"/,
    /"sd_src_no_ratelimit":"([^"]+)"/,
    /"browser_native_hd_url":"([^"]+)"/,
    /"browser_native_sd_url":"([^"]+)"/,
    /"playable_url_quality_hd":"([^"]+)"/,
    /"playable_url":"([^"]+)"/,
    /"video_url":"([^"]+)"/,
    /https?:\/\/video\.xx\.fbcdn\.net\/[^"'\s]+/g,
  ];
  for (const p of patterns) {
    if (p.global) {
      const m = html.match(p);
      if (m?.length) m.forEach((x) => candidates.add(cleanUrl(x)));
    } else {
      const m = html.match(p);
      if (m?.[1]) candidates.add(cleanUrl(m[1]));
    }
  }

  // Some FB pages embed sources in escaped JS blocks
  const decoded = html.replace(/\\u0025/g, '%'); // mitigate % encodings
  const escPatterns = [
    /hd_src\\":\\"(https:[^"]+?)\\"/,
    /sd_src\\":\\"(https:[^"]+?)\\"/,
    /playable_url\\":\\"(https:[^"]+?)\\"/,
  ];
  for (const p of escPatterns) {
    const m = decoded.match(p);
    if (m?.[1]) candidates.add(cleanUrl(m[1]));
  }

  const list = Array.from(candidates).filter(u => /fbcdn\.net|facebook\.com/.test(u));
  if (!list.length) throw new Error('no direct media found');

  // Prefer HD
  list.sort((a, b) => {
    const aHd = /hd|1080|720/.test(a);
    const bHd = /hd|1080|720/.test(b);
    return Number(bHd) - Number(aHd);
  });

  const formats = list.map((u, i) => asFormat(u, i, i === 0 ? 'Best' : 'Alt'));
  return ok(title, thumb, formats);
}

async function tryYtdlp(url) {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    referer: 'https://www.facebook.com/',
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
    quality: f.format_note || (f.height ? `${f.height}p` : 'Original'),
    url: f.url,
    mimeType: f.mime_type || (f.vcodec && f.vcodec !== 'none' ? `video/${f.ext || 'mp4'}` : `audio/${f.ext || 'mp3'}`),
    hasAudio: f.acodec && f.acodec !== 'none',
    hasVideo: f.vcodec && f.vcodec !== 'none',
    container: f.ext || 'mp4',
    contentLength: Number(f.filesize || f.filesize_approx || 0),
  }));

  if (!formats.length && info?.url) {
    formats.push(asFormat(cleanUrl(info.url), 0));
  }
  if (!formats.length) throw new Error('yt-dlp returned no formats');

  const best = formats[0];
  return {
    success: true,
    data: {
      title: info?.title || 'Facebook Video',
      url: best.url,
      thumbnail: info?.thumbnail || '',
      duration: info?.duration || null,
      quality: best.quality,
      source: 'facebook',
      mediaType: best.hasVideo ? 'video' : 'audio',
      formats,
    }
  };
}

async function downloadFacebookVideo(url) {
  try { return await tryHtml(url); } catch (_) {}
  return await tryYtdlp(url);
}

module.exports = { downloadFacebookVideo };
