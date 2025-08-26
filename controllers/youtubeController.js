// controllers/youtubeController.js - Remove URL shortening for media URLs
const axios = require("axios");
// Remove or comment out the shortenUrl import for now
// const { shortenUrl } = require("../utils/urlShortener");

async function fetchYouTubeData(url) {
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
  return {
    title: data.title,
    thumbnail: data.cover,
    duration: data.duration,
    formats: data.items.map((item) => ({
      type: item.type,
      quality: item.label || "unknown",
      extension: item.ext || item.extension || "mp4",
      url: item.url,
    })),
  };
}

async function downloadYouTubeVideo(url) {
  const data = await fetchYouTubeData(url);

  const videoFormats = data.formats.filter((f) => f.url && f.type !== "audio");
  const audioFormats = data.formats.filter((f) => f.url && f.type === "audio");
  const best = videoFormats[0] || data.formats.find((f) => f.url);
  if (!best) throw new Error("No valid download URL found");

  // Use original URLs instead of shortened ones
  const appFormats = [];
  for (let i = 0; i < data.formats.length; i++) {
    const f = data.formats[i];
    if (!f.url) continue;

    appFormats.push({
      itag: String(i),
      quality: f.quality || "best",
      url: f.url, // Use original URL
      mimeType: f.type === 'audio' ? 'audio/mp3' : `video/${f.extension || 'mp4'}`,
      hasAudio: f.type !== "video-only",
      hasVideo: f.type !== "audio-only",
      isVideo: f.type !== "audio-only",
      audioBitrate: f.type === "audio" ? 128 : 0,
      videoCodec: f.type !== "audio" ? "h264" : "none",
      audioCodec: f.type !== "video-only" ? "aac" : "none",
      container: f.extension || "mp4",
      contentLength: 0,
    });
  }

  return {
    success: true,
    data: {
      title: data.title,
      url: best.url, // Use original URL
      thumbnail: data.thumbnail || "https://via.placeholder.com/300x150",
      quality: best.quality || "Best Available",
      duration: data.duration,
      source: "youtube",
      mediaType: "video",
      formats: appFormats,
    },
  };
}

module.exports = { downloadYouTubeVideo, fetchYouTubeData };