// server.js — UniSaver with Enhanced Instagram Support
// Node >= 18 recommended (global fetch). If on Node 16, add 'node-fetch' and use it in place of fetch.

require('dotenv').config();
process.env.YTDL_NO_UPDATE = '1';

const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const ytdlp = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs');

// --- utils/config (your file) ---
let config = {};
try {
  config = require('./utils/config');
} catch {
  config = {};
}
const PORT = Number(config.PORT || process.env.PORT || 5000);
const RATE = Number(config.RATE_LIMIT_PER_MINUTE || process.env.RATE_LIMIT_PER_MINUTE || 120);

// --- Safe require for controllers ---
function safeRequire(p) {
  try {
    return require(p) || {};
  } catch (e) {
    console.warn(`[warn] could not load ${p}: ${e.message}`);
    return {};
  }
}

// Controllers
const yt = safeRequire('./controllers/youtubeController');
const fb = safeRequire('./controllers/facebookController');
const ig = safeRequire('./controllers/instagramController');
const tw = safeRequire('./controllers/twitterController');
const tk = safeRequire('./controllers/tiktokController');
const th = safeRequire('./controllers/threadsController');
const pi = safeRequire('./controllers/pinterestController');
const vm = safeRequire('./controllers/vimeoController');
const dm = safeRequire('./controllers/dailymotionController');
const tc = safeRequire('./controllers/twitchController');
const sp = safeRequire('./controllers/spotifyController');
const sc = safeRequire('./controllers/soundcloudController');
const mp = safeRequire('./controllers/musicPlatformController');

// --- App & middleware ---
const app = express();
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false // Allow media streaming
}));
app.use(cors({
  origin: (_o, cb) => cb(null, true),
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept']
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: RATE,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Health
app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'UniSaver Backend', version: '2.1.1', playableProxy: true });
});

// ---------- Enhanced Platform Detection ----------
function detectPlatform(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('facebook.com') || u.includes('fb.watch') || u.includes('fbcdn') || u.includes('fb.com')) return 'facebook';
  if (u.includes('instagram.com') || u.includes('cdninstagram.com')) return 'instagram';
  if (u.includes('x.com') || u.includes('twitter.com') || u.includes('twimg.com')) return 'twitter';
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('threads.net')) return 'threads';
  if (u.includes('pinterest.com') || u.includes('pinimg.com')) return 'pinterest';
  if (u.includes('vimeo.com')) return 'vimeo';
  if (u.includes('dailymotion.com')) return 'dailymotion';
  if (u.includes('twitch.tv')) return 'twitch';
  if (u.includes('soundcloud.com')) return 'soundcloud';
  if (u.includes('spotify.com')) return 'spotify';
  if (typeof mp?.platformOf === 'function' && mp.platformOf(url) !== 'unknown') return 'music';
  return 'generic';
}

function platformReferer(platform, url = '') {
  switch (platform) {
    case 'facebook': return 'https://www.facebook.com/';
    case 'instagram': return 'https://www.instagram.com/';
    case 'twitter': return 'https://twitter.com/';
    case 'tiktok': return 'https://www.tiktok.com/';
    case 'youtube': return 'https://www.youtube.com/';
    case 'threads': return 'https://www.threads.net/';
    case 'pinterest': return 'https://www.pinterest.com/';
    case 'vimeo': return 'https://vimeo.com/';
    case 'dailymotion': return 'https://www.dailymotion.com/';
    case 'twitch': return 'https://www.twitch.tv/';
    default: {
      try {
        return new URL(url).origin;
      } catch {
        return null;
      }
    }
  }
}

// ---------- Enhanced Instagram-specific headers ----------
function getInstagramHeaders(originalUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };

  // Add Instagram-specific headers
  if (originalUrl && originalUrl.includes('instagram.com')) {
    headers['Referer'] = 'https://www.instagram.com/';
    headers['Origin'] = 'https://www.instagram.com';
    headers['X-Instagram-AJAX'] = '1';
    headers['X-IG-App-ID'] = '936619743392459';
    headers['X-ASBD-ID'] = '129477';
    headers['X-IG-WWW-Claim'] = '0';
  }

  // Add cookies if available
  const cookieStr = process.env.IG_COOKIE_STRING;
  if (cookieStr) {
    headers['Cookie'] = cookieStr;
  }

  return headers;
}

function titleFromInfo(info, fallback = 'Media') {
  return (info && (info.title || info.fulltitle)) || fallback;
}

function extFromFormat(f) {
  if (f.ext) return f.ext;
  if (f.container) return f.container;
  if (f.mimeType) {
    if (f.mimeType.includes('video/')) return 'mp4';
    if (f.mimeType.includes('audio/')) return 'mp3';
    if (f.mimeType.includes('image/jpeg')) return 'jpg';
    if (f.mimeType.includes('image/png')) return 'png';
    if (f.mimeType.includes('image/webp')) return 'webp';
  }
  if (f.mime_type) {
    if (f.mime_type.includes('video/')) return 'mp4';
    if (f.mime_type.includes('audio/')) return 'mp3';
    if (f.mime_type.includes('image/jpeg')) return 'jpg';
    if (f.mime_type.includes('image/png')) return 'png';
    if (f.mime_type.includes('image/webp')) return 'webp';
  }
  return 'mp4';
}

function makeProxy(mediaUrl, { title = 'Media', ext = 'mp4', referer = null, platform = null } = {}) {
  const safe = String(title || 'Media').replace(/[^\w\-\s]+/g, '_').trim().slice(0, 60);
  const base = `/api/direct?url=${encodeURIComponent(mediaUrl)}&filename=${encodeURIComponent(safe)}.${ext}`;
  let result = base;

  if (referer) {
    result += `&referer=${encodeURIComponent(referer)}`;
  }

  if (platform) {
    result += `&platform=${encodeURIComponent(platform)}`;
  }

  return result;
}

// Prefer progressive MP4 with audio
function pickPlayableFormatsFromYtdlp(info) {
  const all = Array.isArray(info?.formats) ? info.formats : [];
  const progressive = all.filter(f =>
    (f.ext === 'mp4' || f.ext === 'm4v') &&
    (f.vcodec && f.vcodec !== 'none') &&
    (f.acodec && f.acodec !== 'none') &&
    f.url
  );
  if (progressive.length) return progressive;

  const mp4Video = all.filter(f =>
    (f.ext === 'mp4' || f.ext === 'm4v') &&
    (f.vcodec && f.vcodec !== 'none') &&
    f.url
  );
  if (mp4Video.length) return mp4Video;

  return all.filter(f => f.url);
}

// ---------- Enhanced Normalization ----------
function normalizeToUnified(platform, raw) {
  const data = raw?.data && (raw.title || raw.formats || raw.platform) ? raw : raw?.data ? raw.data : raw;

  const title = data?.title || 'Media';
  const thumbnail = data?.thumbnail || data?.thumbnails?.[0]?.url || '';
  const referer = platformReferer(platform);
  const mediaType = data?.mediaType || (data?.audio ? 'audio' : 'video');

  let inputFormats = data?.formats || [];

  if ((!inputFormats || !inputFormats.length) && (data?.url || data?.directUrl)) {
    const u = data.url || data.directUrl;
    inputFormats = [{
      itag: 'best',
      quality: data?.quality || 'Original Quality',
      url: u,
      mimeType: data?.mimeType || (mediaType === 'audio' ? 'audio/mp3' : 'video/mp4'),
      hasAudio: mediaType !== 'video-only',
      hasVideo: mediaType !== 'audio',
      isVideo: mediaType !== 'audio',
      container: extFromFormat({ ext: data?.ext, mimeType: data?.mimeType }) || (mediaType === 'audio' ? 'mp3' : 'mp4'),
      contentLength: 0,
    }];
  }

  const formats = (inputFormats || [])
    .filter(f => f?.url)
    .map((f, i) => {
      const ext = extFromFormat(f);
      return {
        itag: String(f.itag || f.format_id || i),
        quality: f.quality || f.format_note || 'Original',
        url: makeProxy(f.url, { title, ext, referer, platform }),
        mimeType: f.mimeType || f.mime_type || (f.hasVideo || f.isVideo ? `video/${ext}` : `audio/${ext}`),
        hasAudio: f.hasAudio !== false,
        hasVideo: f.hasVideo === true || f.isVideo === true || !!(f.vcodec && f.vcodec !== 'none'),
        isVideo: f.hasVideo === true || f.isVideo === true || !!(f.vcodec && f.vcodec !== 'none'),
        audioBitrate: f.audioBitrate || f.abr || 0,
        videoCodec: f.videoCodec || f.vcodec || 'unknown',
        audioCodec: f.audioCodec || f.acodec || 'unknown',
        container: f.container || ext,
        contentLength: Number(f.contentLength || f.filesize || f.filesize_approx || 0),
      };
    });

  return {
    success: true,
    platform,
    mediaType,
    title,
    duration: data?.duration || null,
    thumbnails: thumbnail ? [{ url: thumbnail }] : [],
    formats,
    directUrl: formats[0]?.url || null,
  };
}

// ---------- Generic extractor with yt-dlp ----------
async function extractWithYtdlp(url, platform) {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    referer: platformReferer(platform, url) || new URL(url).origin,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  });

  const referer = platformReferer(platform, url);
  const title = titleFromInfo(info, `${platform} Media`);
  const chosen = pickPlayableFormatsFromYtdlp(info);

  const formats = chosen.map((f, i) => {
    const ext = extFromFormat(f);
    const proxied = makeProxy(f.url, { title, ext, referer, platform });
    const q =
      f.format_note ||
      (f.height ? `${f.height}p` : (f.abr ? `${f.abr}kbps` : 'Best'));
    const mt =
      f.mime_type ||
      (f.vcodec && f.vcodec !== 'none' ? `video/${ext}` : `audio/${ext}`);

    const hasV = !!(f.vcodec && f.vcodec !== 'none');
    const hasA = !!(f.acodec && f.acodec !== 'none');

    return {
      itag: String(f.format_id || i),
      quality: q,
      url: proxied,
      mimeType: mt,
      hasAudio: hasA,
      hasVideo: hasV,
      isVideo: hasV,
      audioBitrate: f.abr || (hasA ? 128 : 0),
      videoCodec: f.vcodec || (hasV ? 'h264' : 'none'),
      audioCodec: f.acodec || (hasA ? 'aac' : 'none'),
      container: ext,
      contentLength: Number(f.filesize || f.filesize_approx || 0),
    };
  });

  // Fallback if yt-dlp returned only top-level url
  if (!formats.length && info?.url) {
    const ext = 'mp4';
    formats.push({
      itag: 'best',
      quality: 'Original Quality',
      url: makeProxy(info.url, { title, ext, referer, platform }),
      mimeType: 'video/mp4',
      hasAudio: true,
      hasVideo: true,
      isVideo: true,
      audioBitrate: 128,
      videoCodec: 'h264',
      audioCodec: 'aac',
      container: ext,
      contentLength: 0,
    });
  }

  return {
    success: true,
    platform,
    mediaType: formats.some(f => f.hasVideo) ? 'video' : 'audio',
    title,
    duration: info?.duration || null,
    thumbnails: info?.thumbnails?.length
      ? [{ url: info.thumbnails[info.thumbnails.length - 1].url }]
      : (info?.thumbnail ? [{ url: info.thumbnail }] : []),
    formats,
    directUrl: formats[0]?.url || null,
  };
}

// ---------- Core "get info" (auto platform) ----------
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  const platform = detectPlatform(url);

  try {
    let out;
    if (platform === 'instagram' && typeof ig.downloadInstagramMedia === 'function') {
      console.log('Using Instagram controller for:', url);
      out = normalizeToUnified('instagram', await ig.downloadInstagramMedia(url));
    } else if (platform === 'youtube' && typeof yt.downloadYouTubeVideo === 'function') {
      out = normalizeToUnified('youtube', await yt.downloadYouTubeVideo(url));
    } else if (platform === 'facebook' && typeof fb.downloadFacebookVideo === 'function') {
      out = normalizeToUnified('facebook', await fb.downloadFacebookVideo(url));
    } else if (platform === 'twitter' && typeof tw.downloadTwitterVideo === 'function') {
      out = normalizeToUnified('twitter', await tw.downloadTwitterVideo(url));
    } else if (platform === 'tiktok' && typeof tk.downloadTikTok === 'function') {
      out = normalizeToUnified('tiktok', await tk.downloadTikTok(url));
    } else if (platform === 'threads' && typeof th.downloadThreads === 'function') {
      out = normalizeToUnified('threads', await th.downloadThreads(url));
    } else if (platform === 'pinterest' && typeof pi.getPinterestInfo === 'function') {
      out = normalizeToUnified('pinterest', await pi.getPinterestInfo(url));
    } else if (platform === 'vimeo' && typeof vm.downloadVimeoMedia === 'function') {
      out = normalizeToUnified('vimeo', await vm.downloadVimeoMedia(url));
    } else if (platform === 'dailymotion' && typeof dm.downloadDailymotionMedia === 'function') {
      out = normalizeToUnified('dailymotion', await dm.downloadDailymotionMedia(url));
    } else if (platform === 'twitch' && typeof tc.downloadTwitchMedia === 'function') {
      out = normalizeToUnified('twitch', await tc.downloadTwitchMedia(url));
    } else if (platform === 'soundcloud' && typeof sc.downloadSoundcloud === 'function') {
      out = normalizeToUnified('soundcloud', await sc.downloadSoundcloud(url));
    } else if (platform === 'spotify' && typeof sp.downloadSpotify === 'function') {
      out = normalizeToUnified('spotify', await sp.downloadSpotify(url));
    } else if (platform === 'music' && typeof mp.downloadMusic === 'function') {
      out = normalizeToUnified('music', await mp.downloadMusic(url));
    } else {
      console.log(`Using yt-dlp fallback for platform: ${platform}`);
      out = await extractWithYtdlp(url, platform);
    }

    if (!out?.formats?.length && !out?.directUrl) {
      return res.status(422).json({
        error: 'No playable media found',
        errorDetail: 'Extractor found no usable URLs (MP4/HLS/DASH).',
        platform,
      });
    }
    return res.json(out);
  } catch (e) {
    console.error('INFO error:', e);
    return res.status(500).json({
      error: 'Failed to process media',
      errorDetail: String(e.message || e),
      platform,
    });
  }
});

// ---------- Enhanced Instagram endpoint ----------
app.get('/api/instagram', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  if (!url.includes('instagram.com')) {
    return res.status(400).json({ error: 'Invalid Instagram URL' });
  }

  try {
    console.log('Instagram endpoint called for:', url);
    const result = await ig.downloadInstagramMedia(url);
    const normalized = normalizeToUnified('instagram', result);

    if (!normalized?.formats?.length && !normalized?.directUrl) {
      return res.status(422).json({
        error: 'No playable Instagram media found',
        errorDetail: 'This Instagram post may be private, deleted, or contain no downloadable media.',
        platform: 'Instagram'
      });
    }

    res.json(normalized);
  } catch (error) {
    console.error('Instagram endpoint error:', error);
    res.status(500).json({
      error: 'Instagram processing failed',
      errorDetail: String(error.message || error),
      platform: 'Instagram'
    });
  }
});

// ---------- Enhanced Direct proxy with Instagram support ----------
app.get('/api/direct', async (req, res) => {
  const { url, filename, referer, platform } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  console.log(`Direct proxy request: ${url} (platform: ${platform || 'unknown'})`);

  try {
    let headers = {};

    if (platform === 'instagram' || url.includes('cdninstagram.com') || url.includes('fbcdn.net')) {
      headers = getInstagramHeaders(url);
      console.log('Using Instagram-specific headers');
    } else {
      headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
      };

      if (referer) {
        headers['Referer'] = referer.startsWith('http') ? referer : `https://${referer}`;
        try {
          headers['Origin'] = new URL(headers['Referer']).origin;
        } catch {}
      } else {
        try {
          const origin = new URL(url).origin;
          headers['Referer'] = origin;
          headers['Origin'] = origin;
        } catch {}
      }
    }

    // Handle range requests for better streaming
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    console.log('Making request with headers:', Object.keys(headers));

    const upstream = await axios.get(url, {
      headers,
      responseType: 'stream',
      maxRedirects: 5,
      timeout: 45000,
      validateStatus: status => status < 400 || status === 206, // Accept partial content
    });

    if (upstream.status >= 400) {
      console.error(`Upstream error: ${upstream.status}`);
      return res.status(502).json({
        error: 'Upstream error',
        status: upstream.status,
        details: 'The media server returned an error'
      });
    }

    const ctype = upstream.headers['content-type'] || 'application/octet-stream';
    const clen = upstream.headers['content-length'];
    const acceptRanges = upstream.headers['accept-ranges'];
    const contentRange = upstream.headers['content-range'];

    let outputFilename = filename || 'download';
    if (!outputFilename.includes('.')) {
      if (ctype.includes('video')) outputFilename += '.mp4';
      else if (ctype.includes('audio')) outputFilename += '.mp3';
      else if (ctype.includes('image/png')) outputFilename += '.png';
      else if (ctype.includes('image/webp')) outputFilename += '.webp';
      else if (ctype.includes('image')) outputFilename += '.jpg';
      else outputFilename += '.bin';
    }

    // Set response headers
    res.setHeader('Content-Type', ctype);
    if (clen) res.setHeader('Content-Length', clen);
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
    if (contentRange) res.setHeader('Content-Range', contentRange);

    // Set status code for partial content
    if (upstream.status === 206) {
      res.status(206);
    }

    res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');

    console.log(`Streaming ${outputFilename} (${ctype})`);
    upstream.data.pipe(res);

    // Handle stream errors
    upstream.data.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream error', details: err.message });
      }
    });

  } catch (err) {
    console.error('DIRECT error:', err?.message || err);

    // Provide more specific error messages
    let errorMessage = 'Download failed';
    let errorDetail = String(err?.message || err);

    if (err?.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused';
      errorDetail = 'Could not connect to the media server';
    } else if (err?.code === 'ETIMEDOUT') {
      errorMessage = 'Request timeout';
      errorDetail = 'The media server took too long to respond';
    } else if (err?.response?.status === 403) {
      errorMessage = 'Access forbidden';
      errorDetail = 'The media server denied access to this content';
    } else if (err?.response?.status === 404) {
      errorMessage = 'Media not found';
      errorDetail = 'The requested media could not be found';
    }

    res.status(500).json({
      error: errorMessage,
      details: errorDetail,
      platform: platform || 'unknown'
    });
  }
});

// ---------- Other platform endpoints (similar to original) ----------
function endpointFor(name, handler) {
  app.get(`/api/${name}`, async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing url' });
    try {
      const out = await handler(url);
      if (!out?.formats?.length && !out?.directUrl) {
        return res.status(422).json({ error: `No playable ${name} formats` });
      }
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: `${name} processing failed`, errorDetail: String(e.message || e) });
    }
  });
}

endpointFor('youtube', async (url) =>
  typeof yt.downloadYouTubeVideo === 'function'
    ? normalizeToUnified('youtube', await yt.downloadYouTubeVideo(url))
    : extractWithYtdlp(url, 'youtube')
);

endpointFor('facebook', async (url) =>
  typeof fb.downloadFacebookVideo === 'function'
    ? normalizeToUnified('facebook', await fb.downloadFacebookVideo(url))
    : extractWithYtdlp(url, 'facebook')
);

endpointFor('twitter', async (url) =>
  typeof tw.downloadTwitterVideo === 'function'
    ? normalizeToUnified('twitter', await tw.downloadTwitterVideo(url))
    : extractWithYtdlp(url, 'twitter')
);

endpointFor('tiktok', async (url) =>
  typeof tk.downloadTikTok === 'function'
    ? normalizeToUnified('tiktok', await tk.downloadTikTok(url))
    : extractWithYtdlp(url, 'tiktok')
);

// Short redirects
app.get('/api/download', (req, res) => {
  const { url, filename, referer, platform } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  const q = [`url=${encodeURIComponent(url)}`];
  if (filename) q.push(`filename=${encodeURIComponent(filename)}`);
  if (referer) q.push(`referer=${encodeURIComponent(referer)}`);
  if (platform) q.push(`platform=${encodeURIComponent(platform)}`);
  res.redirect(302, `/api/direct?${q.join('&')}`);
});

app.get('/api/audio', (req, res) => {
  const { url, referer, platform } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  const q = [`url=${encodeURIComponent(url)}`, `filename=${encodeURIComponent('audio.mp3')}`];
  if (referer) q.push(`referer=${encodeURIComponent(referer)}`);
  if (platform) q.push(`platform=${encodeURIComponent(platform)}`);
  res.redirect(302, `/api/direct?${q.join('&')}`);
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('UNCAUGHT', err);
  res.status(500).json({ error: 'Server error', errorDetail: String(err?.message || err) });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ UniSaver backend listening on http://localhost:${PORT}`);
  console.log('✅ Enhanced Instagram support with proper proxy headers');
  console.log('✅ All media routed through /api/direct for maximum compatibility');
});