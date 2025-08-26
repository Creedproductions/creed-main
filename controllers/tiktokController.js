// controllers/twitterController.js
// Strategy:
// 1) Try btch-downloader's `twitter()` (fast when available)
// 2) Try light HTML scraping for twimg mp4
// 3) Fallback to yt-dlp with proper Referer/UA
// Always return direct URLs; server proxies via /api/direct.

const ytdlp = require('youtube-dl-exec');

// Optional dependency (survive if not installed)
let twdl = null;
try {
  ({ twitter: twdl } = require('btch-downloader'));
} catch {
  twdl = null;
}

function extFrom(url) {
  const m = String(url).toLowerCase().match(/\.(mp4|m4v|webm|mp3|m4a|aac|jpg|jpeg|png|gif)(?:$|\?)/);
  return m ? m[1].replace('jpeg', 'jpg') : 'mp4';
}

function asFormat(u, i) {
  const ext = extFrom(u);
  const isVideo = /(mp4|m4v|webm)$/i.test(ext);
  const isAudio = /(mp3|m4a|aac)$/i.test(ext);
  return {
    itag: String(i),
    quality: 'Original Quality',
    url: u,
    mimeType: isVideo ? `video/${ext}` : (isAudio ? `audio/${ext}` : `image/${ext}`),
    hasAudio: isAudio || isVideo, // Twitter MP4s usually have audio muxed
    hasVideo: isVideo,
    container: ext,
    contentLength: 0,
  };
}

async function tryLib(url) {
  if (!twdl) throw new Error('twitter() not available');
  const d = await twdl(url);

  // Try to collect URLs from common shapes
  const urls = new Set();
  let title = 'Twitter/X Video';
  let thumb = '';

  if (d?.data) {
    const v = d.data;
    [v.high, v.low, v.HD, v.SD, v.url].forEach((x) => x && urls.add(x));
    title = v.title || title;
  }
  if (Array.isArray(d)) {
    d.forEach((x) => x?.url && urls.add(x.url));
  }
  if (d?.url) urls.add(d.url);
  if (d?.thumbnail) thumb = d.thumbnail;

  const list = Array.from(urls);
  if (!list.length) throw new Error('library returned no media');

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
      source: 'twitter',
      mediaType: best.hasVideo ? 'video' : (/image\//.test(best.mimeType) ? 'image' : 'audio'),
      formats,
    },
  };
}

async function tryLightScrape(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  if (!resp.ok) throw new Error(`failed to fetch page: ${resp.status}`);
  const html = await resp.text();

  // Find direct mp4s hosted on video.twimg.com
  const patterns = [
    /"video_url":"([^"]+)"/,
    /"playbackUrl":"([^"]+)"/,
    /"(https?:\/\/video\.twimg\.com\/[^"']+?\.mp4[^"']*)"/g,
    /https?:\/\/video\.twimg\.com\/[^"'\s]+\.mp4[^"'\s]*/g
  ];
  let u = null;

  for (const p of patterns) {
    if (p.global) {
      const m = html.match(p);
      if (m?.length) {
        u = m[0].replace(/\\/g, '').replace(/&amp;/g, '&').replace(/"/g, '');
        break;
      }
    } else {
      const m = p.exec(html);
      if (m?.[1]) {
        u = m[1].replace(/\\\//g, '/').replace(/\\/g, '').replace(/&amp;/g, '&');
        break;
      }
    }
  }
  if (!u) throw new Error('no direct mp4 found');

  let title = 'Twitter/X Video';
  const t = html.match(/<title>([^<]+)<\/title>/i);
  if (t?.[1]) title = t[1].replace(' / X', '').replace(' / Twitter', '').trim();

  let thumb = '';
  const og = html.match(/<meta property="og:image" content="([^"]+)"/i);
  if (og?.[1]) thumb = og[1];

  const formats = [asFormat(u, 0)];
  return {
    success: true,
    data: {
      title,
      url: u,
      thumbnail: thumb || '',
      quality: 'Original Quality',
      duration: null,
      source: 'twitter',
      mediaType: 'video',
      formats
    }
  };
}

async function tryYtdlp(url) {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    referer: 'https://twitter.com/',
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
      title: info?.title || 'Twitter/X Video',
      url: best.url,
      thumbnail: info?.thumbnail || '',
      quality: best.quality,
      duration: info?.duration || null,
      source: 'twitter',
      mediaType: best.hasVideo ? 'video' : 'audio',
      formats,
    },
  };
}

async function downloadTwitterVideo(url) {
  // Try library -> light scrape -> yt-dlp
  try { return await tryLib(url); } catch (_) {}
  try { return await tryLightScrape(url); } catch (_) {}
  return await tryYtdlp(url);
}

module.exports = { downloadTwitterVideo };
