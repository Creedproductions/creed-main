// controllers/youtubeController.js
// Robust YouTube controller:
// 1) primary: Vidfly API (fast, many formats)
// 2) fallback: yt-dlp (progressive MP4 with audio preferred)

const axios = require('axios');
const ytdlp = require('youtube-dl-exec');

function qualityToNumber(q) {
  const n = parseInt(String(q || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function extFromFormat(f) {
  if (f.ext) return f.ext;
  if (f.extension) return f.extension;
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

async function fetchYouTubeData(url) {
  try {
    const res = await axios.get('https://api.vidfly.ai/api/media/youtube/download', {
      params: { url },
      headers: {
        accept: '*/*',
        'content-type': 'application/json',
        'x-app-name': 'vidfly-web',
        'x-app-version': '1.0.0',
        Referer: 'https://vidfly.ai/',
      },
      timeout: 25000,
    });

    const data = res.data?.data;
    if (!data || !Array.isArray(data.items) || !data.title) {
      throw new Error('Invalid or empty response from YouTube downloader API');
    }

    return {
      title: data.title,
      thumbnail: data.cover,
      duration: data.duration,
      formats: data.items
        .filter((it) => it?.url)
        .map((it) => ({
          type: it.type, // 'video' | 'audio' | 'video-only' | 'audio-only'
          quality: it.label || it.quality || 'unknown',
          ext: it.ext || it.extension || 'mp4',
          url: it.url,
        })),
    };
  } catch (err) {
    throw new Error(`YouTube downloader request failed: ${err.message}`);
  }
}

function pickBestFromVidfly(data) {
  const withUrl = data.formats.filter((f) => !!f.url);
  // Prefer highest quality "video" (has audio)
  const videoWithAudio = withUrl.filter((f) => f.type === 'video');
  const best =
    videoWithAudio.sort((a, b) => qualityToNumber(b.quality) - qualityToNumber(a.quality))[0] ||
    withUrl[0] ||
    null;
  return best;
}

async function fallbackWithYtdlp(url) {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    referer: 'https://www.youtube.com/',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  });

  const all = Array.isArray(info?.formats) ? info.formats : [];
  // Prefer progressive mp4 with audio+video
  let pick = all.filter(
    (f) => (f.ext === 'mp4' || f.ext === 'm4v') && f.vcodec !== 'none' && f.acodec !== 'none' && f.url
  );
  if (!pick.length) {
    // next best: mp4 with video
    pick = all.filter((f) => (f.ext === 'mp4' || f.ext === 'm4v') && f.vcodec !== 'none' && f.url);
  }
  if (!pick.length) pick = all.filter((f) => f.url);

  const formats = pick.map((f, i) => ({
    itag: String(f.format_id || i),
    quality: f.format_note || (f.height ? `${f.height}p` : 'Best'),
    url: f.url,
    mimeType: f.mime_type || (f.vcodec && f.vcodec !== 'none' ? `video/${extFromFormat(f)}` : `audio/${extFromFormat(f)}`),
    hasAudio: f.acodec && f.acodec !== 'none',
    hasVideo: f.vcodec && f.vcodec !== 'none',
    contentLength: Number(f.filesize || f.filesize_approx || 0),
    container: extFromFormat(f),
    audioBitrate: f.abr || 0,
    videoCodec: f.vcodec || 'unknown',
    audioCodec: f.acodec || 'unknown',
  }));

  const best = formats[0];
  if (!best) throw new Error('yt-dlp fallback found no usable formats');

  return {
    success: true,
    data: {
      title: info?.title || 'YouTube Video',
      url: best.url,
      thumbnail: info?.thumbnail || 'https://via.placeholder.com/300x150',
      quality: best.quality || 'Best',
      duration: info?.duration || null,
      source: 'youtube',
      mediaType: best.hasVideo ? 'video' : 'audio',
      formats,
    },
  };
}

async function downloadYouTubeVideo(url) {
  try {
    const data = await fetchYouTubeData(url);
    const best = pickBestFromVidfly(data);
    if (!best) throw new Error('No valid download URL found');

    const formats = data.formats.map((f, index) => {
      const isAudioOnly = f.type === 'audio' || f.type === 'audio-only';
      const isVideoOnly = f.type === 'video-only';
      const ext = extFromFormat(f);

      return {
        itag: String(index),
        quality: f.quality || 'unknown',
        url: f.url, // direct; server will proxy
        mimeType: `${isAudioOnly ? 'audio' : 'video'}/${ext}`,
        hasAudio: !isVideoOnly,
        hasVideo: !isAudioOnly,
        contentLength: 0,
        container: ext,
        isVideo: !isAudioOnly,
        audioBitrate: isAudioOnly ? 128 : 0,
        videoCodec: isAudioOnly ? 'none' : 'h264',
        audioCodec: isVideoOnly ? 'none' : 'aac',
      };
    });

    return {
      success: true,
      data: {
        title: data.title,
        url: best.url,
        thumbnail: data.thumbnail || 'https://via.placeholder.com/300x150',
        quality: best.quality || 'Best Available',
        duration: data.duration || null,
        source: 'youtube',
        mediaType: 'video',
        formats,
      },
    };
  } catch (err) {
    // Fallback to yt-dlp if the primary fails
    return await fallbackWithYtdlp(url);
  }
}

module.exports = { downloadYouTubeVideo, fetchYouTubeData };
