// controllers/twitterController.js
// Strong page-scrape + yt-dlp fallback. Always returns proxied, playable URLs.

const axios = require('axios');
const youtubeDl = require('youtube-dl-exec');

function makeProxy(mediaUrl, title = 'Twitter', ext = 'mp4') {
  const safe = String(title || 'Twitter').replace(/[^\w\-]+/g, '_').slice(0, 60);
  return `/api/direct?url=${encodeURIComponent(mediaUrl)}&referer=twitter.com&filename=${encodeURIComponent(safe)}.${ext}`;
}

function normalize(formats, title, thumbnail) {
  const uniq = Array.from(new Set(formats.filter(Boolean)));
  if (!uniq.length) return null;
  const appFormats = uniq.map((u, i) => ({
    itag: String(i),
    quality: 'Original Quality',
    url: makeProxy(u, title, 'mp4'),
    mimeType: 'video/mp4',
    hasAudio: true,
    hasVideo: true,
    isVideo: true,
    container: 'mp4',
    contentLength: 0,
  }));
  return {
    success: true,
    data: {
      title: title || 'Twitter Video',
      url: appFormats[0].url,
      thumbnail: thumbnail || 'https://via.placeholder.com/300x150',
      quality: 'Original Quality',
      source: 'twitter',
      mediaType: 'video',
      formats: appFormats,
    }
  };
}

async function scrapePage(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Referer': 'https://twitter.com/',
  };
  const res = await axios.get(url, { headers, timeout: 20000 });
  const html = res.data || '';

  // Title
  let title = 'Twitter Video';
  const t1 = html.match(/<title>([^<]+)<\/title>/i);
  if (t1 && t1[1]) title = t1[1].replace(' / X', '').replace(' / Twitter', '').trim();

  // Thumbnail
  let thumbnail = '';
  const ogImg = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  if (ogImg && ogImg[1]) thumbnail = ogImg[1];

  // Extract twimg mp4s
  const urls = [];
  const patterns = [
    /"(https?:\/\/video\.twimg\.com\/[^"']+\.mp4[^"']*)"/gi,
    /video_url":"([^"]+)"/i,
    /playbackUrl":"([^"]+)"/i,
    /"variants":\s*\[(.*?)\]/is
  ];
  for (const pat of patterns) {
    if (pat.flags && pat.flags.includes('g')) {
      let m;
      while ((m = pat.exec(html)) !== null) {
        const u = (m[1] || m[0]).replace(/\\u002F/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/"/g, '');
        if (u.includes('video.twimg.com') && u.includes('.mp4')) urls.push(u);
      }
    } else {
      const m = html.match(pat);
      if (m && m[1]) {
        const u = m[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
        if (u.includes('.mp4')) urls.push(u);
      }
    }
  }

  return { title, thumbnail, urls: Array.from(new Set(urls)) };
}

async function ytdlpFallback(url) {
  const info = await youtubeDl(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    addHeader: [
      'referer:twitter.com',
      'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    ],
    timeout: 30000,
  });

  const urls = [];
  if (info?.url) urls.push(info.url);
  if (Array.isArray(info?.formats)) {
    // prefer variants that have audio+video
    const withAv = info.formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.url);
    (withAv.length ? withAv : info.formats).forEach(f => {
      if (f?.url) urls.push(f.url);
    });
  }
  return { title: info?.title || 'Twitter Video', thumbnail: info?.thumbnail || '', urls: Array.from(new Set(urls)) };
}

async function downloadTwitterVideo(url) {
  try {
    // 1) Try page scrape (fast, no dl tool)
    const page = await scrapePage(url);
    if (page.urls.length) {
      const normalized = normalize(page.urls, page.title, page.thumbnail);
      if (normalized) return normalized;
    }

    // 2) yt-dlp fallback
    const info = await ytdlpFallback(url);
    if (info.urls.length) {
      const normalized = normalize(info.urls, info.title, info.thumbnail);
      if (normalized) return normalized;
    }

    throw new Error('No playable Twitter formats');
  } catch (e) {
    throw new Error(`Twitter processing failed: ${e.message || e}`);
  }
}

module.exports = { downloadTwitterVideo };
