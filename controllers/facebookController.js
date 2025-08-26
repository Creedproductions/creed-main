// controllers/facebookController.js
// Strategy: use yt-dlp with proper Referer + UA, choose progressive MP4 with audio.
// Return direct CDN URLs; server will proxy via /api/direct for playability.

const ytdlp = require('youtube-dl-exec');

function extFromFormat(f) {
  if (f.ext) return f.ext;
  if (f.container) return f.container;
  if (f.mimeType) {
    if (f.mimeType.includes('video/')) return 'mp4';
    if (f.mimeType.includes('audio/')) return 'mp3';
  }
  if (f.mime_type) {
    if (f.mime_type.includes('video/')) return 'mp4';
    if (f.mime_type.includes('audio/')) return 'mp3';
  }
  return 'mp4';
}

async function downloadFacebookVideo(url) {
  try {
    const info = await ytdlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      referer: 'https://www.facebook.com/',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    });

    const all = Array.isArray(info?.formats) ? info.formats : [];

    // Prefer progressive MP4 with audio
    let pick = all.filter(
      (f) => (f.ext === 'mp4' || f.ext === 'm4v') && f.vcodec !== 'none' && f.acodec !== 'none' && f.url
    );
    if (!pick.length) {
      // Next best: any mp4 with video
      pick = all.filter((f) => (f.ext === 'mp4' || f.ext === 'm4v') && f.vcodec !== 'none' && f.url);
    }
    if (!pick.length) pick = all.filter((f) => f.url);

    const formats = pick.map((f, i) => ({
      itag: String(f.format_id || i),
      quality: f.format_note || (f.height ? `${f.height}p` : 'Original Quality'),
      url: f.url, // direct; server will proxy with FB referer
      mimeType: f.mime_type || (f.vcodec && f.vcodec !== 'none' ? `video/${extFromFormat(f)}` : `audio/${extFromFormat(f)}`),
      hasAudio: f.acodec && f.acodec !== 'none',
      hasVideo: f.vcodec && f.vcodec !== 'none',
      container: extFromFormat(f),
      contentLength: Number(f.filesize || f.filesize_approx || 0),
      audioBitrate: f.abr || 0,
      videoCodec: f.vcodec || 'unknown',
      audioCodec: f.acodec || 'unknown',
    }));

    const best = formats[0];
    if (!best) throw new Error('No playable Facebook formats found');

    return {
      success: true,
      data: {
        title: info?.title || 'Facebook Video',
        url: best.url,
        thumbnail: info?.thumbnail || 'https://via.placeholder.com/300x150',
        quality: best.quality,
        duration: info?.duration || null,
        source: 'facebook',
        mediaType: best.hasVideo ? 'video' : 'audio',
        formats,
      },
    };
  } catch (err) {
    throw new Error(`Facebook download failed: ${err.message}`);
  }
}

module.exports = { downloadFacebookVideo };
