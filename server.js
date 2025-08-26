// server.js — UniSaver (robust + playable outputs via /api/direct)
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

// --- utils/config (your file) ---
let config = {};
try {
  config = require('./utils/config');
} catch {
  config = {};
}
const PORT = Number(config.PORT || process.env.PORT || 5000);
const RATE = Number(config.RATE_LIMIT_PER_MINUTE || process.env.RATE_LIMIT_PER_MINUTE || 120);

// --- Safe require for controllers (so server still runs even if one export name changes) ---
function safeRequire(p) {
  try {
    return require(p) || {};
  } catch (e) {
    console.warn(`[warn] could not load ${p}: ${e.message}`);
    return {};
  }
}

// Controllers (your files)
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
const mp = safeRequire('./controllers/musicPlatformController'); // { downloadMusic, platformOf }

// --- App & middleware ---
const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: (_o, cb) => cb(null, true), credentials: false }));
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
  res.json({ ok: true, name: 'UniSaver Backend', version: '2.1.0', playableProxy: true });
});

// ---------- Platform helpers ----------
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
  // generic music resolver support
  if (typeof mp?.platformOf === 'function' && mp.platformOf(url) !== 'unknown') return 'music';
  return 'generic';
}

function platformReferer(platform) {
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
    default: return null;
  }
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
  }
  if (f.mime_type) {
    if (f.mime_type.includes('video/')) return 'mp4';
    if (f.mime_type.includes('audio/')) return 'mp3';
  }
  return 'mp4';
}

function makeProxy(mediaUrl, { title = 'Media', ext = 'mp4', referer = null } = {}) {
  const safe = String(title || 'Media').replace(/[^\w\-]+/g, '_').slice(0, 60);
  const base = `/api/direct?url=${encodeURIComponent(mediaUrl)}&filename=${encodeURIComponent(safe)}.${ext}`;
  return referer ? `${base}&referer=${encodeURIComponent(referer)}` : base;
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

// ---------- Normalization (wraps controller outputs to unified format) ----------
function normalizeToUnified(platform, raw) {
  // Try to detect the data block
  const data = raw?.data && (raw.title || raw.formats || raw.platform) ? raw : raw?.data ? raw.data : raw;

  const title = data?.title || 'Media';
  const thumbnail = data?.thumbnail || data?.thumbnails?.[0]?.url || '';
  const referer = platformReferer(platform);
  const mediaType = data?.mediaType || (data?.audio ? 'audio' : 'video');

  // Case 1: Already includes formats
  let inputFormats = data?.formats || [];

  // Case 2: Single direct URL provided
  if ((!inputFormats || !inputFormats.length) && (data?.url || data?.directUrl)) {
    const u = data.url || data.directUrl;
    inputFormats = [{
      itag: 'best',
      quality: data?.quality || 'Original Quality',
      url: u,
      mimeType: data?.mimeType || (mediaType === 'audio' ? 'audio/mp3' : 'video/mp4'),
      hasAudio: mediaType !== 'video-only',
      hasVideo: mediaType !== 'audio',
      container: extFromFormat({ ext: data?.ext, mimeType: data?.mimeType }) || (mediaType === 'audio' ? 'mp3' : 'mp4'),
      contentLength: 0,
    }];
  }

  // Map to final formats + PROXY through /api/direct
  const formats = (inputFormats || [])
    .filter(f => f?.url)
    .map((f, i) => {
      const ext = extFromFormat(f);
      return {
        itag: String(f.itag || f.format_id || i),
        quality: f.quality || f.format_note || 'Best',
        url: makeProxy(f.url, { title, ext, referer }),
        mimeType: f.mimeType || f.mime_type || (f.hasVideo ? `video/${ext}` : `audio/${ext}`),
        hasAudio: f.hasAudio !== false,
        hasVideo: f.hasVideo === true || !!(f.vcodec && f.vcodec !== 'none'),
        isVideo: f.hasVideo === true || !!(f.vcodec && f.vcodec !== 'none'),
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
    referer: platformReferer(platform) || new URL(url).origin,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  });

  const referer = platformReferer(platform) || new URL(url).origin;
  const title = titleFromInfo(info, `${platform} Media`);
  const chosen = pickPlayableFormatsFromYtdlp(info);

  const formats = chosen.map((f, i) => {
    const ext = extFromFormat(f);
    const proxied = makeProxy(f.url, { title, ext, referer });
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
      url: makeProxy(info.url, { title, ext, referer }),
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

// ---------- Core “get info” (auto platform) ----------
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  const platform = detectPlatform(url);

  try {
    // Try controller first (if available for that platform), else yt-dlp
    let out;
    if (platform === 'youtube' && typeof yt.downloadYouTubeVideo === 'function') {
      out = normalizeToUnified('youtube', await yt.downloadYouTubeVideo(url));
    } else if (platform === 'facebook' && typeof fb.downloadFacebookVideo === 'function') {
      out = normalizeToUnified('facebook', await fb.downloadFacebookVideo(url));
    } else if (platform === 'instagram' && typeof ig.downloadInstagramMedia === 'function') {
      out = normalizeToUnified('instagram', await ig.downloadInstagramMedia(url));
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

// ---------- Per-platform endpoints (thin wrappers over controller or generic) ----------
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

endpointFor('instagram', async (url) =>
  typeof ig.downloadInstagramMedia === 'function'
    ? normalizeToUnified('instagram', await ig.downloadInstagramMedia(url))
    : extractWithYtdlp(url, 'instagram')
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

endpointFor('threads', async (url) =>
  typeof th.downloadThreads === 'function'
    ? normalizeToUnified('threads', await th.downloadThreads(url))
    : extractWithYtdlp(url, 'threads')
);

endpointFor('pinterest', async (url) =>
  typeof pi.getPinterestInfo === 'function'
    ? normalizeToUnified('pinterest', await pi.getPinterestInfo(url))
    : extractWithYtdlp(url, 'pinterest')
);

endpointFor('vimeo', async (url) =>
  typeof vm.downloadVimeoMedia === 'function'
    ? normalizeToUnified('vimeo', await vm.downloadVimeoMedia(url))
    : extractWithYtdlp(url, 'vimeo')
);

endpointFor('dailymotion', async (url) =>
  typeof dm.downloadDailymotionMedia === 'function'
    ? normalizeToUnified('dailymotion', await dm.downloadDailymotionMedia(url))
    : extractWithYtdlp(url, 'dailymotion')
);

endpointFor('twitch', async (url) =>
  typeof tc.downloadTwitchMedia === 'function'
    ? normalizeToUnified('twitch', await tc.downloadTwitchMedia(url))
    : extractWithYtdlp(url, 'twitch')
);

endpointFor('soundcloud', async (url) =>
  typeof sc.downloadSoundcloud === 'function'
    ? normalizeToUnified('soundcloud', await sc.downloadSoundcloud(url))
    : extractWithYtdlp(url, 'soundcloud')
);

endpointFor('spotify', async (url) =>
  typeof sp.downloadSpotify === 'function'
    ? normalizeToUnified('spotify', await sp.downloadSpotify(url))
    : extractWithYtdlp(url, 'spotify')
);

endpointFor('music', async (url) =>
  typeof mp.downloadMusic === 'function'
    ? normalizeToUnified('music', await mp.downloadMusic(url))
    : extractWithYtdlp(url, 'generic')
);

// ---------- Direct proxy (guarantees playability) ----------
app.get('/api/direct', async (req, res) => {
  const { url, filename, referer } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Range': 'bytes=0-', // helps FB/IG/Pinterest/YT progressive
    };

    if (referer) {
      headers['Referer'] = referer.startsWith('http') ? referer : `https://${referer}`;
      try { headers['Origin'] = new URL(headers['Referer']).origin; } catch {}
    } else {
      try {
        const origin = new URL(url).origin;
        headers['Referer'] = origin;
        headers['Origin'] = origin;
      } catch {}
    }

    const upstream = await axios.get(url, {
      headers,
      responseType: 'stream',
      maxRedirects: 5,
      timeout: 45000,
      validateStatus: () => true,
    });

    if (upstream.status >= 400) {
      return res.status(502).json({ error: 'Upstream error', status: upstream.status });
    }

    const ctype = upstream.headers['content-type'] || 'application/octet-stream';
    const clen = upstream.headers['content-length'];

    let out = filename || 'download';
    if (!out.includes('.')) {
      if (ctype.includes('video')) out += '.mp4';
      else if (ctype.includes('audio')) out += '.mp3';
      else if (ctype.includes('image/png')) out += '.png';
      else if (ctype.includes('image')) out += '.jpg';
      else out += '.bin';
    }

    res.setHeader('Content-Type', ctype);
    if (clen) res.setHeader('Content-Length', clen);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `attachment; filename="${out}"`);
    res.setHeader('Cache-Control', 'no-cache');

    upstream.data.pipe(res);
  } catch (err) {
    console.error('DIRECT error:', err?.message || err);
    res.status(500).json({ error: 'Download failed', details: String(err?.message || err) });
  }
});

// Short redirects
app.get('/api/download', (req, res) => {
  const { url, filename, referer } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  const q = [`url=${encodeURIComponent(url)}`];
  if (filename) q.push(`filename=${encodeURIComponent(filename)}`);
  if (referer) q.push(`referer=${encodeURIComponent(referer)}`);
  res.redirect(302, `/api/direct?${q.join('&')}`);
});

app.get('/api/audio', (req, res) => {
  const { url, referer } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  const q = [`url=${encodeURIComponent(url)}`, `filename=${encodeURIComponent('audio.mp3')}`];
  if (referer) q.push(`referer=${encodeURIComponent(referer)}`);
  res.redirect(302, `/api/direct?${q.join('&')}`);
});

// Errors
app.use((err, _req, res, _next) => {
  console.error('UNCAUGHT', err);
  res.status(500).json({ error: 'Server error', errorDetail: String(err?.message || err) });
});

// Start
app.listen(PORT, () => {
  console.log(`✅ UniSaver backend listening on http://localhost:${PORT}`);
  console.log('Everything is routed through /api/direct with proper headers — outputs are playable.');
});
