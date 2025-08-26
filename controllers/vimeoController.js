// controllers/vimeoController.js
// Order:
// 1) HTML "var config = {...}" progressive sources
// 2) yt-dlp fallback
//
// Returns { success: true, data: {...} }

const ytdlp = require('youtube-dl-exec');

let fetchFn = (typeof fetch !== 'undefined') ? fetch : null;
if (!fetchFn) { try { fetchFn = require('node-fetch'); } catch {} }
if (!fetchFn) { throw new Error("Fetch API not available. Use Node 18+ or install 'node-fetch'."); }

function asFormat(url, i, label='Original Quality') {
  const isVideo = /\.mp4(?:$|\?)/i.test(url);
  return {
    itag: String(i),
    quality: label,
    url,
    mimeType: isVideo ? 'video/mp4' : 'application/octet-stream',
    hasAudio: true,
    hasVideo: isVideo,
    container: isVideo ? 'mp4' : 'bin',
    contentLength: 0,
  };
}
function ok(title, thumb, formats) {
  const best = formats.find(f => f.hasVideo) || formats[0];
  return {
    success: true,
    data: {
      title: title || 'Vimeo Video',
      url: best?.url || formats[0]?.url,
      thumbnail: thumb || '',
      duration: null,
      source: 'vimeo',
      mediaType: best?.hasVideo ? 'video' : 'audio',
      formats,
    }
  };
}

async function tryHtml(url) {
  const resp = await fetchFn(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Referer': 'https://vimeo.com/',
    }
  });
  if (!resp.ok) throw new Error(`page fetch ${resp.status}`);
  const html = await resp.text();

  let title = 'Vimeo Video';
  const t = html.match(/<title>([^<]+)<\/title>/i);
  if (t?.[1]) title = t[1].trim();

  let thumb = '';
  const og = html.match(/<meta property="og:image" content="([^"]+)"/i);
  if (og?.[1]) thumb = og[1];

  const cfg = html.match(/var\s+config\s*=\s*({[\s\S]*?});/);
  if (cfg?.[1]) {
    try {
      const json = JSON.parse(cfg[1].replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')); // mild normalize
      const list = json?.video?.play?.progressive || [];
      if (Array.isArray(list) && list.length) {
        list.sort((a, b) => (b.height || 0) - (a.height || 0));
        const formats = list.map((f, i) => asFormat(f.url, i, f.height ? `${f.height}p` : 'Original'));
        return ok(title, thumb, formats);
      }
    } catch {}
  }

  throw new Error('no progressive sources');
}

async function tryYtdlp(url) {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    referer: 'https://vimeo.com/',
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
      title: info?.title || 'Vimeo Video',
      url: best.url,
      thumbnail: info?.thumbnail || '',
      duration: info?.duration || null,
      source: 'vimeo',
      mediaType: best.hasVideo ? 'video' : 'audio',
      formats,
    }
  };
}

async function downloadVimeoMedia(url) {
  try { return await tryHtml(url); } catch (_) {}
  return await tryYtdlp(url);
}

module.exports = { downloadVimeoMedia };
