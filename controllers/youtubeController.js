// controllers/youtubeController.js
// Uses VidFly API + shortener (exactly like the code you shared), returns app-friendly formats.
const axios = require("axios");
const { shortenUrl } = require("../utils/urlShortener");

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
  const best = videoFormats[0] || data.formats.find((f) => f.url);
  if (!best) throw new Error("No valid download URL found");

  const shortenedBest = await shortenUrl(best.url);
  const appFormats = [];
  for (let i = 0; i < data.formats.length; i++) {
    const f = data.formats[i];
    if (!f.url) continue;
    const sUrl = await shortenUrl(f.url);
    appFormats.push({
      itag: String(i),
      quality: f.quality || "best",
      url: sUrl,
      mimeType: f.extension ? `video/${f.extension}` : "video/mp4",
      hasAudio: f.type !== "video-only",
      hasVideo: f.type !== "audio-only",
      contentLength: 0,
    });
  }

  return {
    success: true,
    data: {
      title: data.title,
      url: shortenedBest,
      thumbnail: data.thumbnail || "https://via.placeholder.com/300x150",
      quality: best.quality || "Best Available",
      duration: data.duration,
      source: "youtube",
      formats: appFormats,
    },
  };
}

module.exports = { downloadYouTubeVideo, fetchYouTubeData };
