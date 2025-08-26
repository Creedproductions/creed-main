// controllers/dailymotionController.js
// Simple & robust via yt-dlp with proper referer

const ytdlp = require('youtube-dl-exec');

async function downloadDailymotionMedia(url) {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    referer: 'https://www.dailymotion.com/',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  });

  const all = Array.isArray(info?.formats) ? info.formats : [];
  const pick = all.filter(f => f?.url);
  if (!pick.length && info?.url) pick.push({ url: info.url, ext: 'mp4', vcodec: 'unknown', acodec: 'unknown' });
  if (!pick.length) throw new Error('Dailymotion: no usable formats');

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
      title: info?.title || 'Dailymotion Video',
      url: best.url,
      thumbnail: info?.thumbnail || '',
      duration: info?.duration || null,
      source: 'dailymotion',
      mediaType: best.hasVideo ? 'video' : 'audio',
      formats,
    }
  };
}

module.exports = { downloadDailymotionMedia };
