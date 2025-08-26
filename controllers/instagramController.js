// controllers/instagramController.js
// Strategy:
// 1) Try btch-downloader's igdl (fast for reels/posts).
// 2) Fallback to yt-dlp with Instagram referer.
// Always return direct URLs; server will proxy via /api/direct.

const ytdlp = require('youtube-dl-exec');

let igdl;
try {
  ({ igdl } = require('btch-downloader'));
} catch {
  // Package not installed? We'll rely on yt-dlp only.
  igdl = null;
}

function extFrom(url) {
  const m = String(url).toLowerCase().match(/\.(mp4|m4v|webm|mp3|m4a|aac|jpg|jpeg|png|gif)(?:$|\?)/);
  return m ? m[1].replace('jpeg', 'jpg') : 'mp4';
}

function formatFromUrl(u, i, title) {
  const ext = extFrom(u);
  const isVideo = /(mp4|m4v|webm)$/i.test(ext);
  const isAudio = /(mp3|m4a|aac)$/i.test(ext);
  return {
    itag: String(i),
    quality: 'Original Quality',
    url: u,
    mimeType: isVideo ? `video/${ext}` : (isAudio ? `audio/${ext}` : `image/${ext}`),
    hasAudio: !isAudio ? true : true,
    hasVideo: isVideo,
    container: ext,
    contentLength: 0,
  };
}

async function tryIgdl(url) {
  if (!igdl) throw new Error('igdl unavailable');
  const data = await igdl(url); // often returns an array
  const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : [data]);

  const urls = [];
  let thumb = '';

  for (const item of list) {
    if (item?.url) urls.push(item.url);
    if (item?.thumbnail) thumb = thumb || item.thumbnail;
    if (item?.video) urls.push(item.video);
    if (item?.image) urls.push(item.image);
    if (Array.isArray(item?.media)) {
      for (const m of item.media) if (m?.url) urls.push(m.url);
    }
  }

  const uniques = Array.from(new Set(urls.filter(Boolean)));
  if (!uniques.length) throw new Error('igdl returned no media');

  const formats = uniques.map((u, i) => formatFromUrl(u, i));
  const best = formats.find(f => f.hasVideo) || formats[0];

  return {
    success: true,
    data: {
      title: 'Instagram Media',
      url: best.url,
      thumbnail: thumb || '',
      quality: best.quality,
      duration: null,
      source: 'instagram',
      mediaType: best.hasVideo ? 'video' : (/image\//.test(best.mimeType) ? 'image' : 'audio'),
      formats,
    },
  };
}

async function fallbackWithYtdlp(url) {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    referer: 'https://www.instagram.com/',
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
  if (!best) throw new Error('yt-dlp found no usable Instagram formats');

  return {
    success: true,
    data: {
      title: info?.title || 'Instagram Media',
      url: best.url,
      thumbnail: info?.thumbnail || '',
      quality: best.quality,
      duration: info?.duration || null,
      source: 'instagram',
      mediaType: best.hasVideo ? 'video' : 'audio',
      formats,
    },
  };
}

async function downloadInstagramMedia(url) {
  try {
    if (igdl) {
      try {
        return await tryIgdl(url);
      } catch (e) {
        // continue to fallback
      }
    }
    return await fallbackWithYtdlp(url);
  } catch (err) {
    throw new Error(`Instagram download failed: ${err.message}`);
  }
}

module.exports = { downloadInstagramMedia };
