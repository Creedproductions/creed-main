// controllers/tiktokController.js
const { ttdl } = require('btch-downloader');

async function downloadTikTok(url) {
  const data = await ttdl(url);
  return {
    success: true,
    data: {
      title: data?.title || 'TikTok',
      url: data?.video?.[0] || '',
      thumbnail: data?.thumbnail || 'https://via.placeholder.com/300x150',
      sizes: ['Original Quality'],
      audio: data?.audio?.[0] || '',
      source: 'tiktok',
    },
  };
}

module.exports = { downloadTikTok };
