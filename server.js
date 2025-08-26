// server.js
// Unified media-info API for Flutter client (YouTube, Facebook, Threads, Pinterest,
// TikTok, Twitter/X, Vimeo, Dailymotion, Twitch, and music sites).
// It never stores media and only returns playable direct URLs or safe embed fallbacks.

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');

const config = require('./utils/config');

// Controllers (use the ones we created earlier)
const { downloadYouTubeVideo } = require('./controllers/youtubeController');
const { downloadFacebookVideo } = require('./controllers/facebookController');
const { downloadInstagramMedia } = require('./controllers/instagramController');
const { downloadTwitterVideo } = require('./controllers/twitterController');
const { downloadTikTok } = require('./controllers/tiktokController');
const { downloadThreads } = require('./controllers/threadsController');
const { getPinterestInfo } = require('./controllers/pinterestController');
const { downloadVimeoMedia } = require('./controllers/vimeoController');
const { downloadDailymotionMedia } = require('./controllers/dailymotionController');
const { downloadTwitchMedia } = require('./controllers/twitchController');
const { downloadMusic, platformOf } = require('./controllers/musicPlatformController');

// ---------------------------------------------------------------------------
// App bootstrap
// ---------------------------------------------------------------------------
const app = express();

app.set('trust proxy', 1);

// Security + basics
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({
  origin: (origin, cb) => cb(null, true), // flutter/desktop/mobile OK
  credentials: false,
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Global rate limit
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.RATE_LIMIT_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Health
app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'UniSaver Backend', version: '1.0.0' });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ALLOWED_CT = [
  /^video\//i,
  /^audio\//i,
  /^application\/(dash\+xml|vnd\.apple\.mpegurl|x-mpegURL)$/i,
];

function looksPlayableByExtension(u) {
  return /\.(mp4|m4v|mov|webm|m3u8|mpd|mp3|m4a|aac|ogg|wav)(\?|#|$)/i.test(u);
}

async function headPlayable(url) {
  try {
    const r = await axios.head(url, {
      maxRedirects: 3,
      timeout: 12000,
      validateStatus: () => true,
    });
    if (r.status >= 200 && r.status < 400) {
      const ct = String(r.headers['content-type'] || '');
      return ALLOWED_CT.some(rx => rx.test(ct));
    }
  } catch (_) {}
  return false;
}

async function filterPlayableFormats(formats) {
  if (!Array.isArray(formats)) return [];
  const out = [];
  for (const f of formats) {
    const u = f?.url;
    if (!u) continue;

    const quick = looksPlayableByExtension(u);
    let ok = quick;
    if (!ok && config.STRICT_VALIDATE) {
      ok = await headPlayable(u);
    }
    if (ok) out.push(f);
  }
  return out;
}

function normalize(platform, raw) {
  // Accept both shapes: { success, data: {...} } or { success, ...topLevel }
  const data = raw?.data && (raw.title || raw.formats || raw.platform) ? raw : raw?.data ? raw.data : raw;

  const title = data?.title || 'Media';
  const thumbnail = data?.thumbnail || (data?.thumbnails?.[0]?.url) || '';
  const mediaType = data?.mediaType || (data?.audio ? 'audio' : 'video');
  const directUrl = data?.url || data?.directUrl || null;
  const src = platform || data?.source || 'unknown';

  let formats = data?.formats || [];
  if ((!formats || !formats.length) && directUrl) {
    formats = [{
      itag: 'best',
      quality: data?.quality || 'Original Quality',
      url: directUrl,
      mimeType: mediaType === 'audio' ? 'audio/mpeg' : 'video/mp4',
      hasAudio: mediaType !== 'video-only',
      hasVideo: mediaType !== 'audio',
    }];
  }

  return {
    success: true,
    platform: src,
    mediaType,
    title,
    duration: data?.duration || null,
    thumbnails: thumbnail ? [{ url: thumbnail }] : [],
    formats,
    directUrl,
  };
}

function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('facebook.com') || u.includes('fb.watch') || u.includes('fb.com')) return 'facebook';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  if (u.includes('threads.net')) return 'threads';
  if (u.includes('pinterest.com')) return 'pinterest';
  if (u.includes('vimeo.com')) return 'vimeo';
  if (u.includes('dailymotion.com')) return 'dailymotion';
  if (u.includes('twitch.tv')) return 'twitch';

  // Music platforms (handled by music controller)
  const music = platformOf(url);
  if (music !== 'unknown') return 'music';

  return 'generic';
}

// yt-dlp generic extractor as the last resort
const ytdl = require('youtube-dl-exec');
async function genericExtract(url) {
  const info = await ytdl(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
  });

  // Prefer playable with both audio & video, or HLS/DASH
  let best = null;
  if (info?.formats?.length) {
    const candidates = info.formats.filter(f => {
      const u = f.url || '';
      const ct = f.vcodec !== 'none' || /\.m3u8|\.mpd/i.test(u);
      return ct && (looksPlayableByExtension(u) || /\.m3u8|\.mpd/i.test(u));
    });
    best = candidates[0] || info.formats[0];
  }

  return {
    success: true,
    title: info.title || 'Media',
    thumbnail: info.thumbnail || '',
    formats: best ? [{
      itag: String(best.itag || 'best'),
      quality: best.format_note || best.format || 'Original Quality',
      url: best.url,
      mimeType: best.mimeType || 'video/mp4',
      hasAudio: best.acodec !== 'none',
      hasVideo: best.vcodec !== 'none',
    }] : [],
    platform: 'generic',
    mediaType: (best && best.acodec !== 'none' && best.vcodec === 'none') ? 'audio' : 'video',
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// YouTube
app.get('/api/youtube', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const raw = await downloadYouTubeVideo(url);
    const uni = normalize('YouTube', raw);
    uni.formats = await filterPlayableFormats(uni.formats);
    if (!uni.formats.length) throw new Error('No playable YouTube formats');
    res.json(uni);
  } catch (e) {
    res.status(500).json({ error: 'YouTube processing failed', errorDetail: String(e.message || e) });
  }
});

// Facebook
app.get('/api/facebook', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const raw = await downloadFacebookVideo(url);
    const uni = normalize('Facebook', raw);
    uni.formats = await filterPlayableFormats(uni.formats);
    if (!uni.formats.length) throw new Error('No playable Facebook formats');
    res.json(uni);
  } catch (e) {
    res.status(500).json({ error: 'Facebook processing failed', errorDetail: String(e.message || e) });
  }
});

// Threads
app.get('/api/threads', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const raw = await downloadThreads(url);
    const uni = normalize('Threads', raw);
    uni.formats = await filterPlayableFormats(uni.formats);
    if (!uni.formats.length && !uni.directUrl) throw new Error('No playable Threads formats');
    res.json(uni);
  } catch (e) {
    res.status(500).json({ error: 'Threads processing failed', errorDetail: String(e.message || e) });
  }
});

// Pinterest
app.get('/api/pinterest', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const raw = await getPinterestInfo(url);
    if (!raw?.success) throw new Error('Pinterest extraction failed');
    const uni = normalize('Pinterest', raw);
    uni.formats = await filterPlayableFormats(uni.formats);
    res.json(uni);
  } catch (e) {
    res.status(500).json({ error: 'Pinterest processing failed', errorDetail: String(e.message || e) });
  }
});

// General media router used by Flutter's /api/info
app.get('/api/info', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const platform = detectPlatform(url);
  try {
    let raw;

    switch (platform) {
      case 'youtube': raw = await downloadYouTubeVideo(url); break;
      case 'facebook': raw = await downloadFacebookVideo(url); break;
      case 'instagram': raw = await downloadInstagramMedia(url); break;
      case 'tiktok': raw = await downloadTikTok(url); break;
      case 'twitter': raw = await downloadTwitterVideo(url); break;
      case 'threads': raw = await downloadThreads(url); break;
      case 'pinterest': raw = await getPinterestInfo(url); break;
      case 'vimeo': raw = await downloadVimeoMedia(url); break;
      case 'dailymotion': raw = await downloadDailymotionMedia(url); break;
      case 'twitch': raw = await downloadTwitchMedia(url); break;
      case 'music': raw = await downloadMusic(url); break;
      default: raw = await genericExtract(url);
    }

    const uni = normalize(platform, raw);
    uni.formats = await filterPlayableFormats(uni.formats);

    // If nothing playable, return a graceful error (Flutter shows detail)
    if (!uni.formats.length && !uni.directUrl && !uni.embed_url) {
      return res.status(422).json({
        error: 'No playable media found',
        errorDetail: 'The URL was parsed but produced no direct playable streams (MP4/HLS/DASH).',
        platform,
      });
    }

    res.json(uni);
  } catch (e) {
    res.status(500).json({ error: 'Failed to process media', errorDetail: String(e.message || e), platform });
  }
});

// Special-media endpoint (music + secondary video sites)
app.get('/api/special-media', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const platform = detectPlatform(url);
    let raw;
    if (platform === 'music') {
      raw = await downloadMusic(url);
    } else if (platform === 'vimeo') {
      raw = await downloadVimeoMedia(url);
    } else if (platform === 'dailymotion') {
      raw = await downloadDailymotionMedia(url);
    } else if (platform === 'twitch') {
      raw = await downloadTwitchMedia(url);
    } else {
      raw = await genericExtract(url);
    }

    const uni = normalize(platform, raw);
    uni.formats = await filterPlayableFormats(uni.formats);
    res.json(uni);
  } catch (e) {
    res.status(500).json({ error: 'Failed to process special media', errorDetail: String(e.message || e) });
  }
});

// ---------------------------------------------------------------------------
// Download helpers – 302 redirect to the real media URL
// (keeps the server light; client saves/plays from source)
// ---------------------------------------------------------------------------
function redirectTo(req, res, url) {
  if (!url) return res.status(400).send('Missing url');
  // Guard: never redirect to non-http(s)
  if (!/^https?:\/\//i.test(url)) return res.status(400).send('Invalid url');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  // We don't set Content-Disposition here (we’re not proxying the file)
  return res.redirect(302, url);
}

app.get('/api/direct', (req, res) => {
  const url = req.query.url;
  redirectTo(req, res, url);
});

app.get('/api/download', (req, res) => {
  const url = req.query.url;
  redirectTo(req, res, url);
});

app.get('/api/audio', (req, res) => {
  const url = req.query.url;
  redirectTo(req, res, url);
});

app.get('/api/facebook-download', (req, res) => {
  const url = req.query.url;
  redirectTo(req, res, url);
});

app.get('/api/threads-download', (req, res) => {
  const url = req.query.url || req.query.originalUrl;
  redirectTo(req, res, url);
});

// ---------------------------------------------------------------------------
// Error handler (last)
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('UNCAUGHT', err);
  res.status(500).json({ error: 'Server error', errorDetail: String(err.message || err) });
});

const port = config.PORT;
app.listen(port, () => {
  console.log(`✅ UniSaver backend listening on http://localhost:${port}`);
});
