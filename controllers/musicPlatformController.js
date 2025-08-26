// controllers/musicPlatformController.js
const { downloadSpotifyAudio } = require('./spotifyController');
const { downloadSoundCloudAudio } = require('./soundcloudController');
// bandcamp can be handled via youtube-dl-exec directly
const ytdl = require('youtube-dl-exec');

function platformOf(url) {
  const u = url.toLowerCase();
  if (u.includes('spotify.com')) return 'spotify';
  if (u.includes('soundcloud.com')) return 'soundcloud';
  if (u.includes('bandcamp.com')) return 'bandcamp';
  if (u.includes('deezer.com')) return 'deezer';
  if (u.includes('mixcloud.com')) return 'mixcloud';
  if (u.includes('audiomack.com')) return 'audiomack';
  if (u.includes('music.apple.com')) return 'apple_music';
  if (u.includes('music.amazon.com')) return 'amazon_music';
  return 'unknown';
}

async function downloadMusic(url) {
  const p = platformOf(url);

  if (p === 'spotify') return downloadSpotifyAudio(url);
  if (p === 'soundcloud') return downloadSoundCloudAudio(url);

  // generic ytdl-pass for others (bandcamp, mixcloud, etc.)
  try {
    const info = await ytdl(url, { dumpSingleJson: true, noWarnings: true, noCheckCertificates: true });
    const audio = info?.formats?.filter(f => f.acodec !== 'none').sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
    if (audio) {
      return { success: true, data: { title: info.title || 'Audio', url: audio.url, thumbnail: info.thumbnail, sizes: [`${audio.abr || 'High'}kbps`], source: p, mediaType: 'audio' } };
    }
  } catch (_) {}

  return { success: false, data: null, error: `No downloadable audio found for ${p}` };
}

module.exports = { downloadMusic, platformOf };
