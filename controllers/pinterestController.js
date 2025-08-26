// controllers/pinterestController.js
// Robust Pinterest extractor that returns direct media URLs.
// Order:
// 1) Lightweight HTML extraction (videos via v.pinimg.com, images via i.pinimg.com)
// 2) Parse JSON blocks (JSON-LD + internal script data) for contentUrl/images
// 3) yt-dlp fallback with Pinterest referer
//
// Output shape matches the rest of your controllers:
// { success: true, data: { title, url, thumbnail, mediaType, formats: [...] } }

const ytdlp = require('youtube-dl-exec');

// Use built-in fetch (Node 18+) or fall back to node-fetch if present
let fetchFn = (typeof fetch !== 'undefined') ? fetch : null;
if (!fetchFn) {
  try { fetchFn = require('node-fetch'); } catch { /* ignore */ }
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
  return m ? m[1].replace('jpeg', 'jpg') : (url.includes('.mp4') ? 'mp4' : 'jpg');
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
    isVideo: isVideo,
    container: ext,
    contentLength: 0,
  };
}

function buildOk(data) {
  const best = data.formats.find(f => f.hasVideo) || data.formats[0];
  return {
    success: true,
    data: {
      title: data.title || 'Pinterest Media',
      url: best?.url || data.formats[0]?.url,
      thumbnail: data.thumbnail || '',
      duration: null,
      source: 'pinterest',
      mediaType: best?.hasVideo ? 'video' : (best?.mimeType?.startsWith('image/') ? 'image' : 'audio'),
      formats: data.formats,
    },
  };
}

function parseTitle(html) {
  const t = html.match(/<title>([^<]+)<\/title>/i);
  if (t?.[1]) return t[1].replace(' | Pinterest', '').trim();
  const og = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  return (og?.[1] || 'Pinterest Media').trim();
}

function parseThumb(html) {
  const ogImg = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  return ogImg?.[1] ? cleanUrl(ogImg[1]) : '';
}

function extractVideoUrls(html) {
  const vids = new Set();

  const patterns = [
    /"video_url":"([^"]+)"/i,
    /"contentUrl":\s*"(https:\/\/v\.pinimg\.com[^"]+)"/i,
    /"contentUrl":\s*"([^"]+\.mp4[^"]*)"/i,
    /<meta\s+property="og:video"\s+content="([^"]+)"/i,
    /<meta\s+property="og:video:url"\s+content="([^"]+)"/i,
    /"v_hd":\s*\{[^}]*"url":\s*"([^"]+)"/i,
    /"v_sd":\s*\{[^}]*"url":\s*"([^"]+)"/i,
    /https:\/\/v\.pinimg\.com\/videos\/[^\s"']+\.mp4/gi,
  ];

  for (const p of patterns) {
    if (p.global) {
      const m = html.match(p);
      if (m?.length) m.forEach((x) => vids.add(cleanUrl(x)));
    } else {
      const m = html.match(p);
      if (m?.[1]) vids.add(cleanUrl(m[1]));
    }
  }

  // JSON <script type="application/ld+json"> blocks
  const ldBlocks = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (ldBlocks) {
    for (const blk of ldBlocks) {
      try {
        const jsonText = blk.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
        const data = JSON.parse(jsonText);
        const cUrl =
          (Array.isArray(data) ? data : [data])
            .map((x) => x?.contentUrl)
            .find((x) => x && (x.includes('v.pinimg.com') || x.includes('.mp4')));
        if (cUrl) vids.add(cleanUrl(cUrl));
      } catch { /* ignore */ }
    }
  }

  return Array.from(vids);
}

function extractImageUrls(html) {
  let imgs = [];

  // Originals
  const originals = html.match(/https:\/\/i\.pinimg\.com\/originals\/[a-z0-9\/._-]+\.(?:jpg|jpeg|png|gif|webp)/gi);
  if (originals?.length) imgs.push(...originals);

  // Sized images
  const sized = html.match(/https:\/\/i\.pinimg\.com\/\d+x\/[a-z0-9\/._-]+\.(?:jpg|jpeg|png|gif|webp)/gi);
  if (sized?.length) imgs.push(...sized);

  // JSON blocks with images
  const jsonBlobs = html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonBlobs) {
    for (const blk of jsonBlobs) {
      const m = blk.match(/>([\s\S]*?)<\/script>/i);
      if (!m?.[1]) continue;
      try {
        const data = JSON.parse(m[1]);
        const urls = [];
        const dfs = (o) => {
          if (!o) return;
          if (typeof o === 'string' && /^https?:\/\//.test(o) && /i\.pinimg\.com/.test(o)) {
            urls.push(o);
          } else if (Array.isArray(o)) {
            o.forEach(dfs);
          } else if (typeof o === 'object') {
            Object.values(o).forEach(dfs);
          }
        };
        dfs(data);
        urls.forEach((u) => imgs.push(u));
      } catch { /* ignore */ }
    }
  }

  // Fallback: og:image
  const ogImg = parseThumb(html);
  if (ogImg) imgs.push(ogImg);

  // Clean, dedupe & filter
  imgs = Array.from(new Set(imgs.map(cleanUrl))).filter((u) => /\.(jpg|jpeg|png|gif|webp)(?:$|\?)/i.test(u));

  // Sort: originals first, then by size hints if any
  imgs.sort((a, b) => {
    const aOrig = a.includes('/originals/');
    const bOrig = b.includes('/originals/');
    if (aOrig !== bOrig) return aOrig ? -1 : 1;
    const sa = a.match(/\/(\d+)x\//);
    const sb = b.match(/\/(\d+)x\//);
    if (sa && sb) return parseInt(sb[1]) - parseInt(sa[1]);
    return b.length - a.length;
    });

  return imgs;
}

async function extractViaHtml(url) {
  const resp = await fetchFn(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Referer': 'https://www.pinterest.com/',
    },
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`Failed to fetch Pinterest page: ${resp.status}`);
  const html = await resp.text();

  const title = parseTitle(html);
  const thumbnail = parseThumb(html);

  // Prefer video if present
  const videos = extractVideoUrls(html);
  if (videos.length) {
    const formats = videos.map((u, i) => asFormat(u, i, i === 0 ? 'Original Quality' : 'Alt'));
    return buildOk({ title, thumbnail, formats });
  }

  // Otherwise images
  const images = extractImageUrls(html);
  if (images.length) {
    const formats = images.map((u, i) => {
      // Derive a quality label from URL if possible
      let label = 'Image';
      if (u.includes('/originals/')) label = 'Original';
      else {
        const m = u.match(/\/(\d+)x\//);
        if (m?.[1]) label = `${m[1]}px`;
      }
      return asFormat(u, i, label);
    });

    return buildOk({ title, thumbnail: images[0] || thumbnail, formats });
  }

  throw new Error('No media found in Pinterest page');
}

async function fallbackYtdlp(url) {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    referer: 'https://www.pinterest.com/',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  });

  // Prefer formats with URLs
  const all = Array.isArray(info?.formats) ? info.formats : [];
  const pick = all.filter((f) => f?.url);
  if (!pick.length) {
    // Sometimes yt-dlp returns a single "url" at root
    if (info?.url) {
      const f = asFormat(info.url, 0, 'Original Quality');
      return buildOk({
        title: info.title || 'Pinterest Media',
        thumbnail: info.thumbnail || '',
        formats: [f],
      });
    }
    throw new Error('yt-dlp returned no usable formats');
  }

  const formats = pick.map((f, i) => {
    const url = cleanUrl(f.url);
    let label = f.format_note || (f.height ? `${f.height}p` : 'Original Quality');
    if (/image/.test(f.mime_type || '')) label = 'Image';
    return asFormat(url, i, label);
  });

  return buildOk({
    title: info.title || 'Pinterest Media',
    thumbnail: info.thumbnail || '',
    formats,
  });
}

async function getPinterestInfo(url) {
  try {
    return await extractViaHtml(url);
  } catch (_) {
    // Fall back to yt-dlp if HTML path fails
    return await fallbackYtdlp(url);
  }
}

module.exports = { getPinterestInfo };
