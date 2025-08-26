// controllers/pinterestController.js
const axios = require('axios');
const cheerio = require('cheerio');

async function getPinterestInfo(url) {
  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://www.pinterest.com/',
      Accept: 'text/html',
    },
    timeout: 25000,
  });

  const $ = cheerio.load(html);
  const title = $('meta[property="og:title"]').attr('content') || 'Pinterest Media';
  const image = $('meta[property="og:image"]').attr('content');
  const video = $('meta[property="og:video"]').attr('content') || $('meta[property="og:video:url"]').attr('content');

  if (video) {
    return {
      success: true,
      title,
      thumbnails: [{ url: image || 'https://via.placeholder.com/300x150' }],
      formats: [{
        itag: 'pin_video',
        quality: 'Original Quality',
        mimeType: 'video/mp4',
        url: video,
        hasAudio: true,
        hasVideo: true,
      }],
      platform: 'pinterest',
      mediaType: 'video',
      directUrl: `/api/direct?url=${encodeURIComponent(video)}&referer=pinterest.com`,
    };
  }

  if (image) {
    return {
      success: true,
      title,
      thumbnails: [{ url: image }],
      formats: [],
      platform: 'pinterest',
      mediaType: 'image',
    };
  }

  throw new Error('No images or videos found on this Pinterest page');
}

module.exports = { getPinterestInfo };
