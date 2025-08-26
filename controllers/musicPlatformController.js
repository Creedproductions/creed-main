// controllers/musicPlatformController.js
// Supports: spotify, soundcloud, bandcamp, deezer, apple_music, amazon_music, mixcloud, audiomack
// Strategy: yt-dlp bestaudio with correct referer/UA per host.
// Returns { success: true, data: { title, url, thumbnail, mediaType: 'audio', formats } }

const ytdlp = require('youtube-dl-exec');

const MUSIC_PLATFORMS = {
  spotify: 'spotify.com',
  soundcloud: 'soundcloud.com',
  bandcamp: 'bandcamp.com',
  deezer: 'deezer.com',
  apple_music: 'music.apple.com',
  amazon_music: 'music.amazon.com',
  mixcloud: 'mixcloud.com',
  audiomack: 'audiomack.com',
};

function platformOf(url = '') {
  const u = url.toLowerCase();
  if (u.includes('spotify.com')) return 'spotify';
  if (u.includes('soundcloud.com')) return 'soundcloud';
  if (u.includes('bandcamp.com')) return 'bandcamp';
  if (u.includes('deezer.com')) return 'deezer';
  if (u.includes('music.apple.com')) return 'apple_music';
  if (u.includes('music.amazon.')) return 'amazon_music';
  if (u.includes('mixcloud.com')) return 'mixcloud';
  if (u.includes('audiomack.com')) return 'audiomack';
  return 'unknown';
}

function asAudioFormat(f, i) {
  const ext = f.ext || 'mp3';
  return {
    itag: String(f.format_id || i),
    quality: f.abr ? `${f.abr}kbps` : (f.format_note || 'Best'),
    url: f.url,
    mimeType: f.mime_type || `audio/${ext}`,
    hasAudio: true,
    hasVideo: false,
    container: ext,
    contentLength: Number(f.filesize || f.filesize_approx || 0),
    audioBitrate: Number(f.abr || 0),
  };
}

async function downloadMusic(url) {
  const platform = platformOf(url);
  if (platform === 'unknown') {
    throw new Error('Unsupported music platform for this controller');
  }

  const referer = `https://${MUSIC_PLATFORMS[platform]}/`;
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    extractAudio: true,
    audioFormat: 'mp3',
    format: 'bestaudio/best',
    referer,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  });

  const all = Array.isArray(info?.formats) ? info.formats : [];
  let pick = all.filter(f => (f.acodec && f.acodec !== 'none') && f?.url);
  if (!pick.length && info?.url) pick.push({ url: info.url, ext: 'mp3', acodec: 'mp3', abr: 0 });
  if (!pick.length) throw new Error('No audio formats returned');

  // Prefer highest bitrate
  pick.sort((a, b) => (b.abr || 0) - (a.abr || 0));
  const formats = pick.map(asAudioFormat);

  const best = formats[0];
  return {
    success: true,
    data: {
      title: info?.title || `${platform} Audio`,
      url: best.url,
      thumbnail: info?.thumbnail || '',
      duration: info?.duration || null,
      source: platform,
      mediaType: 'audio',
      formats,
    }
  };
}

module.exports = { downloadMusic, platformOf };
