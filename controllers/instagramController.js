// controllers/instagramController.js
// Uses metadownloader first; falls back to yt-dlp.
// Returns RAW direct URLs (server.js will proxy via /api/direct).

const snapsave = require('metadownloader');
const fs = require('fs');
const path = require('path');
const ytdlp = require('youtube-dl-exec');
const axios = require('axios');

function extFromUrl(u = '') {
  const s = u.toLowerCase();
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
        // keep likely media
        if (/\.(mp4|m4v|mov|jpg|jpeg|png|webp)(\?|#|$)/i.test(v) || /fbcdn|cdninstagram|video|scontent|mp4/i.test(v)) {
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

function pickMediaType(firstUrl = '') {
  return /\.(jpe?g|png|webp)(\?|#|$)/i.test(firstUrl) ? 'image' : 'video';
}

function titleOf(raw, def = 'Instagram') {
  if (!raw) return def;
  if (typeof raw === 'string') return def;
  if (Array.isArray(raw) && raw[0]) {
    return raw[0].title || raw[0].caption || def;
  }
  return raw.title || raw.caption || def;
}

function thumbOf(raw) {
  if (!raw) return '';
  if (Array.isArray(raw) && raw[0]) {
    return raw[0].thumbnail || raw[0].thumb || raw[0].image || '';
  }
  return raw.thumbnail || raw.image || '';
}

function getCookieString() {
  return (process.env.IG_COOKIE_STRING || '').trim() || null;
}

function ensureCookieFile() {
  const configured = process.env.IG_COOKIES_FILE;
  if (configured && fs.existsSync(configured)) return configured;

  const cookieStr = getCookieString();
  if (!cookieStr) return null;

  const tmp = path.join('/tmp', `ig_cookies_${Date.now()}.txt`);
  const lines = [
    '# Netscape HTTP Cookie File',
    '# Generated from IG_COOKIE_STRING',
  ];
  cookieStr.split(';').map(s => s.trim()).forEach(pair => {
    const [k, ...rest] = pair.split('=');
    if (!k || !rest.length) return;
    lines.push(`.instagram.com\tTRUE\t/\tFALSE\t0\t${k}\t${rest.join('=')}`);
  });
  fs.writeFileSync(tmp, lines.join('\n'));
  return tmp;
}

async function tryMeta(url) {
  try {
    const raw = await snapsave(url); // metadownloader
    const urls = collectUrlsFromUnknown(raw);
    if (!urls.length) return null;
    return {
      title: titleOf(raw, 'Instagram'),
      thumbnail: thumbOf(raw),
      urls
    };
  } catch {
    return null;
  }
}

async function tryJsonApi(url) {
  // public JSON (better success if cookie present / avoids rate limits sometimes)
  try {
    const m = String(url).match(/(?:instagram\.com\/(?:p|reel|tv)\/)([A-Za-z0-9_\-]+)/);
    if (!m) return null;
    const shortcode = m[1];
    const headers = {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://www.instagram.com/',
      'X-IG-App-ID': '936619743392459'
    };
    const cookieStr = getCookieString();
    if (cookieStr) headers['Cookie'] = cookieStr;

    const { data } = await axios.get(`https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`, { headers, timeout: 20000 });

    // mine likely media urls
    const urls = collectUrlsFromUnknown(data);
    if (!urls.length) return null;

    let title = 'Instagram';
    if (data?.items?.[0]?.caption?.text) title = data.items[0].caption.text;
    if (data?.graphql?.shortcode_media?.edge_media_to_caption?.edges?.[0]?.node?.text) {
      title = data.graphql.shortcode_media.edge_media_to_caption.edges[0].node.text;
    }
    const thumbnail =
      data?.items?.[0]?.image_versions2?.candidates?.[0]?.url ||
      data?.graphql?.shortcode_media?.display_url || '';

    return { title, thumbnail, urls };
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
      referer: 'https://www.instagram.com/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      cookies: cookieFile || undefined,
      timeout: 30000,
    });

    const urls = new Set();
    if (info?.url) urls.add(info.url);
    (info?.formats || []).forEach(f => f?.url && urls.add(f.url));
    if (!urls.size) return null;

    return {
      title: info?.title || 'Instagram',
      thumbnail: info?.thumbnail || '',
      urls: Array.from(urls),
      duration: info?.duration || null,
    };
  } catch (e) {
    throw new Error(
      'Instagram download failed: ' + (e?.message || e) +
      (cookieFile ? '' : ' | Hint: set IG_COOKIE_STRING or IG_COOKIES_FILE for private/limited posts.')
    );
  } finally {
    if (cookieFile && cookieFile.startsWith('/tmp/ig_cookies_') && fs.existsSync(cookieFile)) {
      fs.unlink(cookieFile, () => {});
    }
  }
}

async function downloadInstagramMedia(url) {
  const m = await tryMeta(url);
  if (m?.urls?.length) {
    return {
      success: true,
      data: {
        title: m.title,
        thumbnail: m.thumbnail || '',
        duration: null,
        mediaType: pickMediaType(m.urls[0]),
        formats: m.urls.map((u, i) => ({
          itag: String(i),
          quality: 'Original',
          url: u,                     // RAW direct URL; server will proxy
          mimeType: extFromUrl(u) === 'mp4' ? 'video/mp4' : `image/${extFromUrl(u)}`,
          hasAudio: !/\.jpe?g|\.png|\.webp/i.test(u),
          hasVideo: !/\.jpe?g|\.png|\.webp/i.test(u),
          container: extFromUrl(u),
          contentLength: 0,
        }))
      }
    };
  }

  const j = await tryJsonApi(url);
  if (j?.urls?.length) {
    return {
      success: true,
      data: {
        title: j.title,
        thumbnail: j.thumbnail || '',
        duration: null,
        mediaType: pickMediaType(j.urls[0]),
        formats: j.urls.map((u, i) => ({
          itag: String(i),
          quality: 'Original',
          url: u,
          mimeType: extFromUrl(u) === 'mp4' ? 'video/mp4' : `image/${extFromUrl(u)}`,
          hasAudio: !/\.jpe?g|\.png|\.webp/i.test(u),
          hasVideo: !/\.jpe?g|\.png|\.webp/i.test(u),
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
        mediaType: pickMediaType(y.urls[0]),
        formats: y.urls.map((u, i) => ({
          itag: String(i),
          quality: 'Original',
          url: u,
          mimeType: extFromUrl(u) === 'mp4' ? 'video/mp4' : `image/${extFromUrl(u)}`,
          hasAudio: !/\.jpe?g|\.png|\.webp/i.test(u),
          hasVideo: !/\.jpe?g|\.png|\.webp/i.test(u),
          container: extFromUrl(u),
          contentLength: 0,
        }))
      }
    };
  }

  throw new Error('Instagram download failed: No playable media found');
}

module.exports = { downloadInstagramMedia };
