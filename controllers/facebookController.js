// controllers/facebookController.js
// Uses metadownloader first; falls back to yt-dlp.
// Returns RAW direct URLs (server.js will proxy via /api/direct).

const snapsave = require('metadownloader');
const fs = require('fs');
const path = require('path');
const ytdlp = require('youtube-dl-exec');

function extFromUrl(u = '') {
  const s = u.toLowerCase();
  if (s.includes('.mp4') || s.includes('.m4v') || s.includes('.mov')) return 'mp4';
  if (s.includes('.png')) return 'png';
  if (s.includes('.webp')) return 'webp';
  if (s.includes('.jpg') || s.includes('.jpeg')) return 'jpg';
  return 'mp4';
}

function collectUrlsFromUnknown(raw) {
  const out = new Set();
  const walk = (v) => {
    if (!v) return;
    if (typeof v === 'string') {
      if (/^https?:\/\//i.test(v)) {
        if (/\.(mp4|m4v|mov|jpg|jpeg|png|webp)(\?|#|$)/i.test(v) || /fbcdn|video|scontent|mp4/i.test(v)) {
          out.add(v);
        }
      }
      return;
    }
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(raw);
  return Array.from(out);
}

function titleOf(raw, def = 'Facebook Video') {
  if (!raw) return def;
  if (Array.isArray(raw) && raw[0]) return raw[0].title || def;
  return raw.title || def;
}

function thumbOf(raw) {
  if (!raw) return '';
  if (Array.isArray(raw) && raw[0]) return raw[0].thumbnail || raw[0].image || '';
  return raw.thumbnail || raw.image || '';
}

function getCookieString() {
  return (process.env.FB_COOKIE_STRING || '').trim() || null;
}

function ensureCookieFile() {
  const configured = process.env.FB_COOKIES_FILE;
  if (configured && fs.existsSync(configured)) return configured;

  const cookieStr = getCookieString();
  if (!cookieStr) return null;

  const tmp = path.join('/tmp', `fb_cookies_${Date.now()}.txt`);
  const lines = [
    '# Netscape HTTP Cookie File',
    '# Generated from FB_COOKIE_STRING',
  ];
  cookieStr.split(';').map(s => s.trim()).forEach(pair => {
    const [k, ...rest] = pair.split('=');
    if (!k || !rest.length) return;
    lines.push(`.facebook.com\tTRUE\t/\tFALSE\t0\t${k}\t${rest.join('=')}`);
  });
  fs.writeFileSync(tmp, lines.join('\n'));
  return tmp;
}

async function tryMeta(url) {
  try {
    // metadownloader handles FB & IG
    const raw = await snapsave(url);
    const urls = collectUrlsFromUnknown(raw);
    if (!urls.length) return null;
    return {
      title: titleOf(raw, 'Facebook Video'),
      thumbnail: thumbOf(raw),
      urls
    };
  } catch {
    return null;
  }
}

async function tryYtdlp(url) {
  const cookieFile = ensureCookieFile();
  try {
    const info = await ytdlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      referer: 'https://www.facebook.com/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      cookies: cookieFile || undefined,
      timeout: 30000,
    });

    const urls = new Set();
    if (info?.url) urls.add(info.url);
    (info?.formats || []).forEach(f => f?.url && urls.add(f.url));
    if (!urls.size) return null;

    return {
      title: info?.title || 'Facebook Video',
      thumbnail: info?.thumbnail || '',
      urls: Array.from(urls),
      duration: info?.duration || null,
    };
  } catch (e) {
    throw new Error(
      'Facebook download failed: ' + (e?.message || e) +
      (cookieFile ? '' : ' | Hint: set FB_COOKIE_STRING or FB_COOKIES_FILE for private/limited posts.')
    );
  } finally {
    if (cookieFile && cookieFile.startsWith('/tmp/fb_cookies_') && fs.existsSync(cookieFile)) {
      fs.unlink(cookieFile, () => {});
    }
  }
}

async function downloadFacebookVideo(url) {
  const m = await tryMeta(url);
  if (m?.urls?.length) {
    return {
      success: true,
      data: {
        title: m.title,
        thumbnail: m.thumbnail || '',
        duration: null,
        mediaType: 'video',
        formats: m.urls.map((u, i) => ({
          itag: String(i),
          quality: 'Original',
          url: u, // RAW direct URL
          mimeType: extFromUrl(u) === 'mp4' ? 'video/mp4' : `image/${extFromUrl(u)}`,
          hasAudio: true,
          hasVideo: true,
          container: extFromUrl(u),
          contentLength: 0,
        }))
      }
    };
  }

  const y = await tryYtdlp(url); // throws with hint if cookies needed
  if (y?.urls?.length) {
    return {
      success: true,
      data: {
        title: y.title,
        thumbnail: y.thumbnail || '',
        duration: y.duration || null,
        mediaType: 'video',
        formats: y.urls.map((u, i) => ({
          itag: String(i),
          quality: 'Original',
          url: u, // RAW
          mimeType: 'video/mp4',
          hasAudio: true,
          hasVideo: true,
          container: 'mp4',
          contentLength: 0,
        }))
      }
    };
  }

  throw new Error('Facebook download failed: No playable media found');
}

module.exports = { downloadFacebookVideo };
