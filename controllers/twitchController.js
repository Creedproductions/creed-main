// controllers/twitchController.js
// VODs/Clips usually expose HLS; youtube-dl-exec can extract.
const ytdl = require('youtube-dl-exec');

async function downloadTwitchMedia(url) {
  const info = await ytdl(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    addHeader: ['referer:https://www.twitch.tv', 'user-agent:Mozilla/5.0'],
  });

  if (!info?.formats?.length) throw new Error('No Twitch formats found');

  // Prefer HLS m3u8
  const m3u8 = info.formats.find(f => /\.m3u8/i.test(f.url)) || info.formats[0];
  return {
    success: true,
    data: {
      title: info.title || 'Twitch',
      url: m3u8.url,
      thumbnail: info.thumbnail || 'https://via.placeholder.com/300x150',
      sizes: ['HLS'],
      source: 'twitch',
    },
  };
}

module.exports = { downloadTwitchMedia };
