// controllers/spotifyController.js
// Spotify does not expose direct audio streams — return metadata + embed_url safely.
const fetch = require('node-fetch');

async function downloadSpotifyAudio(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Spotify fetch failed: ${r.status}`);
  const html = await r.text();

  const title = (html.match(/<meta property="og:title" content="([^"]+)"/i) || [])[1] || 'Spotify';
  const img = (html.match(/<meta property="og:image" content="([^"]+)"/i) || [])[1];
  return {
    success: true,
    data: {
      title,
      url: null,
      thumbnail: img || 'https://via.placeholder.com/300x150',
      sizes: [],
      source: 'spotify',
      embed_url: url, // safe to open in webview
      note: 'Direct download is not provided; Spotify streams are protected.',
      mediaType: 'audio',
    },
  };
}

module.exports = { downloadSpotifyAudio };
