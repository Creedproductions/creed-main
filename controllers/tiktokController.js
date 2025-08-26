// controllers/tiktokController.js
const { ttdl } = require('btch-downloader');
const { shortenUrl } = require('../utils/urlShortener');

async function downloadTikTok(url) {
  try {
    const data = await ttdl(url);

    if (!data) {
      throw new Error('No data returned from TikTok API');
    }

    const title = data.title || 'TikTok Video';
    const thumbnail = data.thumbnail || 'https://via.placeholder.com/300x150';

    // Build formats array with both video and audio
    const formats = [];

    // Add video formats if available
    if (data.video && Array.isArray(data.video)) {
      data.video.forEach((videoUrl, index) => {
        if (videoUrl) {
          formats.push({
            itag: `video_${index}`,
            quality: index === 0 ? 'HD' : 'SD',
            url: videoUrl,
            mimeType: 'video/mp4',
            hasAudio: true,
            hasVideo: true,
            isVideo: true,
            contentLength: 0,
          });
        }
      });
    }

    // Add audio formats if available
    if (data.audio && Array.isArray(data.audio)) {
      data.audio.forEach((audioUrl, index) => {
        if (audioUrl) {
          formats.push({
            itag: `audio_${index}`,
            quality: 'Audio Only',
            url: audioUrl,
            mimeType: 'audio/mp3',
            hasAudio: true,
            hasVideo: false,
            audioBitrate: 128,
            contentLength: 0,
          });
        }
      });
    }

    // Fallback: if no formats, create one from the main video URL
    if (formats.length === 0 && data.video?.[0]) {
      formats.push({
        itag: 'default',
        quality: 'Original',
        url: data.video[0],
        mimeType: 'video/mp4',
        hasAudio: true,
        hasVideo: true,
        isVideo: true,
        contentLength: 0,
      });
    }

    return {
      success: true,
      data: {
        title,
        url: data.video?.[0] || '',
        thumbnail,
        quality: 'HD',
        source: 'tiktok',
        mediaType: 'video',
        formats,
      },
    };
  } catch (error) {
    console.error('TikTok download error:', error);
    throw new Error(`Failed to download TikTok video: ${error.message}`);
  }
}

module.exports = { downloadTikTok };