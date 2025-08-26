// controllers/instagramController.js
// First try youtube-dl-exec JSON, then fall back to scraping og: tags.
// Always returns a playable MP4 (video) or an image with embed fallback.
const ytdl = require('youtube-dl-exec');
const fetch = require('node-fetch');

async function downloadInstagramMedia(url) {
  // try yt-dl
  try {
    const info = await ytdl(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      addHeader: [
        'referer:https://www.instagram.com/',
        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      ],
    });

    if (info?.entries?.length) {
      // carousel: take first
      const f = info.entries[0];
      return {
        success: true,
        data: {
          title: info.title || 'Instagram Post',
          url: f.url,
          thumbnail: f.thumbnail || info.thumbnail,
          sizes: ['Original Quality'],
          source: 'instagram',
        },
      };
    }
    if (info?.url) {
      return {
        success: true,
        data: {
          title: info.title || 'Instagram Post',
          url: info.url,
          thumbnail: info.thumbnail,
          sizes: ['Original Quality'],
          source: 'instagram',
        },
      };
    }
  } catch (_) { /* fall through */ }

  // fallback scrape
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'text/html',
      'Referer': 'https://www.instagram.com/',
    },
  });
  if (!resp.ok) throw new Error(`Instagram fetch failed: ${resp.status}`);
  const html = await resp.text();

  const vid = (html.match(/<meta property="og:video" content="([^"]+)"/i) || [])[1];
  const img = (html.match(/<meta property="og:image" content="([^"]+)"/i) || [])[1];
  const title = (html.match(/<meta property="og:title" content="([^"]+)"/i) || [])[1] || 'Instagram';

  if (vid) {
    return {
      success: true,
      data: { title, url: vid, thumbnail: img || '', sizes: ['Original Quality'], source: 'instagram' },
    };
  }
  if (img) {
    return {
      success: true,
      data: { title, url: img, thumbnail: img, sizes: ['Original Quality'], source: 'instagram' },
    };
  }
  throw new Error('No media found in Instagram page');
}

module.exports = { downloadInstagramMedia };
