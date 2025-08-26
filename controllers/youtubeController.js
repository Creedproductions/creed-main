// controllers/youtubeController.js
// Robust: always return playable, proxied URLs for your Flutter app.

const axios = require("axios");

/** Build a proxied URL so downloads stream through /api/direct with proper headers */
function makeProxy(mediaUrl, title = 'YouTube Video', ext = 'mp4') {
  const safe = String(title || 'YouTube_Video').replace(/[^\w\-]+/g, '_').slice(0, 60);
  return `/api/direct?url=${encodeURIComponent(mediaUrl)}&referer=youtube.com&filename=${encodeURIComponent(safe)}.${ext}`;
}

function qualityToNumber(q) {
  const n = parseInt(String(q || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Prefer direct MP4-ish URLs when available */
function looksPlayableMp4(u = "") {
  const s = u.toLowerCase();
  return s.includes(".mp4") || s.includes("mime=video/mp4") || s.includes("itag=");
}

async function fetchYouTubeData(url) {
  // Using vidfly because it tends to return ready-to-stream muxed links
  const res = await axios.get("https://api.vidfly.ai/api/media/youtube/download", {
    params: { url },
    headers: {
      accept: "*/*",
      "content-type": "application/json",
      "x-app-name": "vidfly-web",
      "x-app-version": "1.0.0",
      Referer: "https://vidfly.ai/",
    },
    timeout: 30000,
  });

  const data = res.data?.data;
  if (!data || !data.items || !data.title) {
    throw new Error("Invalid or empty response from YouTube downloader API");
  }

  // Normalize (keep original URL in memory; we proxy later)
  return {
    title: data.title,
    thumbnail: data.cover,
    duration: data.duration,
    formats: data.items.map((item) => ({
      type: item.type, // 'video' | 'audio' | 'video-only' | 'audio-only'
      quality: item.label || item.quality || "unknown",
      ext: item.ext || item.extension || "mp4",
      url: item.url,
    })),
  };
}

async function downloadYouTubeVideo(url) {
  try {
    const data = await fetchYouTubeData(url);

    // pick the best *muxed video with audio* when possible
    const muxed = data.formats.filter(f => f.url && f.type === 'video');
    const bestMuxed =
      muxed.sort((a, b) => qualityToNumber(b.quality) - qualityToNumber(a.quality))[0] ||
      data.formats.find(f => f.url) ||
      null;

    if (!bestMuxed) throw new Error("No valid download URL found");

    // Build the list your client shows. IMPORTANT: we proxy every URL.
    const appFormats = data.formats
      .filter(f => f.url)
      .map((f, index) => {
        const isAudioOnly = f.type === 'audio' || f.type === 'audio-only';
        const isVideoOnly = f.type === 'video-only';
        const ext = f.ext || (isAudioOnly ? 'mp3' : 'mp4');

        // Prefer playable mp4-ish for top entries
        const proxied = makeProxy(f.url, data.title, ext);

        return {
          itag: String(index),
          quality: f.quality || 'unknown',
          url: proxied, // <-- your app will click this
          mimeType: `${isAudioOnly ? 'audio' : 'video'}/${ext}`,
          hasAudio: !isVideoOnly,
          hasVideo: !isAudioOnly,
          isVideo: !isAudioOnly,
          audioBitrate: isAudioOnly ? 128 : 0,
          videoCodec: isAudioOnly ? 'none' : 'h264',
          audioCodec: isVideoOnly ? 'none' : 'aac',
          container: ext || 'mp4',
          contentLength: 0,
        };
      })
      // put mp4-like first so the default selection is playable
      .sort((a, b) => Number(looksPlayableMp4(b.url)) - Number(looksPlayableMp4(a.url)));

    // "best" top-level url (also proxied)
    const bestExt = bestMuxed.ext || 'mp4';
    const bestUrl = makeProxy(bestMuxed.url, data.title, bestExt);

    return {
      success: true,
      data: {
        title: data.title,
        url: bestUrl,
        thumbnail: data.thumbnail || 'https://via.placeholder.com/300x150',
        quality: bestMuxed.quality || 'Best Available',
        duration: data.duration,
        source: 'youtube',
        mediaType: 'video',
        formats: appFormats,
      }
    };
  } catch (err) {
    console.error('YouTube controller failed:', err);
    throw new Error(`YouTube download failed: ${err.message}`);
  }
}

module.exports = { downloadYouTubeVideo, fetchYouTubeData };
