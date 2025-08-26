// controllers/instagramController.js
// Order:
// 1) btch-downloader igdl() (fast, direct)
// 2) Lightweight HTML (og:video/og:image)
// 3) yt-dlp fallback with Instagram referer
//
// Returns { success: true, data: { title, url, thumbnail, mediaType, formats } }

const ytdlp = require('youtube-dl-exec');

let igdl = null;
try { ({ igdl } = require('btch-downloader')); } catch { igdl = null; }

let fetchFn = (typeof fetch !== 'undefined') ? fetch : null;
if (!fetchFn) { try { fetchFn = require('node-fetch'); } catch {} }
if (!fetchFn) { throw new Error("Fetch API not available. Use Node 18+ or install 'node-fetch'."); }

function cleanUrl(u = '') {
  return String(u).replace(/\\u002F/g,'/').replace(/\\\//g,'/').replace(/\\/g,'').replace(/&amp;/g,'&').trim();
}
function extFrom(url) {
  const m = String(url).toLowerCase().match(/\.(mp4|m4v|webm|mp3|m4a|aac|jpg|jpeg|png|gif|webp)(?:$|\?)/);
  return m ? m[1].replace('jpeg','jpg') : (url.includes('.mp4') ? 'mp4' : 'jpg');
}
function asFormat(u, i, label='Original') {
  const ext = extFrom(u);
  const isVideo = /(mp4|m4v|webm)$/i.test(ext);
  const isImage = /(jpg|png|gif|webp)$/i.test(ext);
  return {
    itag: String(i),
    quality: label,
    url: u,
    mimeType: isVideo ? `video/${ext}` : (isImage ? `image/${ext}` : `audio/${ext}`),
    hasAudio: isVideo,
    hasVideo: isVideo,
    container: ext,
    contentLength: 0
  };
}
function ok(title, thumb, formats) {
  const best = formats.find(f => f.hasVideo) || formats[0];
  return {
    success: true,
    data: {
      title: title || 'Instagram Media',
      url: best?.url || formats[0]?.url,
      thumbnail: thumb || (formats.find(f => f.mimeType.startsWith('image/'))?.url || ''),
      duration: null,
      source: 'instagram',
      mediaType: best?.hasVideo ? 'video' : (best?.mimeType?.startsWith('image/') ? 'image' : 'audio'),
      formats,
    }
  };
}

async function tryIgdl(url) {
  if (!igdl) throw new Error('igdl not available');
  const res = await igdl(url);
  // Common shapes: array of {url, thumbnail, wm?}
  const items = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
  const urls = items.map(x => x?.url).filter(Boolean);
  if (!urls.length) throw new Error('igdl returned no urls');

  const formats = urls.map((u, i) => asFormat(u, i, i === 0 ? 'Best' : 'Alt'));
  const title = items[0]?.wm || 'Instagram Media';
  const thumb = items[0]?.thumbnail || '';
  return ok(title, thumb, formats);
}

async function tryHtml(url) {
  const resp = await fetchFn(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.instagram.com/',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`page fetch ${resp.status}`);
  const html = await resp.text();

  let title = 'Instagram Media';
  const t = html.match(/<title>([^<]+)<\/title>/i);
  if (t?.[1]) title = t[1].replace(' • Instagram photos and videos','').trim();

  let thumb = '';
  const ogImg = html.match(/<meta property="og:image" content="([^"]+)"/i);
  if (ogImg?.[1]) thumb = cleanUrl(ogImg[1]);

  const candidates = new Set();
  const patterns = [
    /<meta property="og:video" content="([^"]+)"/i,
    /<meta property="og:video:url" content="([^"]+)"/i,
    /"video_url":"([^"]+)"/i,
    /https?:\/\/[^\s"']+\.mp4[^\s"']*/i
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) candidates.add(cleanUrl(m[1]));
  }

  if (candidates.size) {
    const list = Array.from(candidates);
    const formats = list.map((u,i) => asFormat(u,i, i===0?'Best':'Alt'));
    return ok(title, thumb, formats);
  }

  // Image fallback
  const images = new Set();
  const ip = [
    /"display_url":"([^"]+)"/ig,
    /"image_url":"([^"]+)"/ig,
    /https:\/\/scontent[^"']+\.(?:jpg|jpeg|png|webp)[^"']*/ig
  ];
  for (const p of ip) {
    let m;
    while ((m = p.exec(html)) !== null) images.add(cleanUrl(m[1] || m[0]));
  }
  if (!images.size && ogImg?.[1]) images.add(cleanUrl(ogImg[1]));

  if (images.size) {
    const list = Array.from(images);
    const formats = list.map((u,i) => asFormat(u,i, i===0?'Original':'Alt'));
    return ok(title, list[0], formats);
  }

  throw new Error('no media found in HTML');
}

async function tryYtdlp(url) {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    referer: 'https://www.instagram.com/',
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
    container: f.ext || 'mp4',
    contentLength: Number(f.filesize || f.filesize_approx || 0),
  }));

  const best = formats[0];
  return {
    success: true,
    data: {
      title: info?.title || 'Instagram Media',
      url: best.url,
      thumbnail: info?.thumbnail || '',
      duration: info?.duration || null,
      source: 'instagram',
      mediaType: best.hasVideo ? 'video' : 'audio',
      formats,
    }
  };
}

async function downloadInstagramMedia(url) {
  try { return await tryIgdl(url); } catch (_) {}
  try { return await tryHtml(url); } catch (_) {}
  return await tryYtdlp(url);
}

module.exports = { downloadInstagramMedia };
