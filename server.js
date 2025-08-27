// server.js — Complete UniSaver Backend with Enhanced Multi-Platform Support
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

// Load configuration
let config = {};
try {
  config = require('./utils/config');
} catch {
  config = {};
}

const PORT = Number(config.PORT || process.env.PORT || 5000);
const RATE = Number(config.RATE_LIMIT_PER_MINUTE || process.env.RATE_LIMIT_PER_MINUTE || 120);

// Safe require utility
function safeRequire(modulePath) {
  try {
    return require(modulePath) || {};
  } catch (e) {
    console.warn(`[warn] could not load ${modulePath}: ${e.message}`);
    return {};
  }
}

// Load controllers safely
const controllers = {
  youtube: safeRequire('./controllers/youtubeController'),
  facebook: safeRequire('./controllers/facebookController'),
  instagram: safeRequire('./controllers/instagramController'),
  twitter: safeRequire('./controllers/twitterController'),
  tiktok: safeRequire('./controllers/tiktokController'),
  threads: safeRequire('./controllers/threadsController'),
  pinterest: safeRequire('./controllers/pinterestController'),
  vimeo: safeRequire('./controllers/vimeoController'),
  dailymotion: safeRequire('./controllers/dailymotionController'),
  twitch: safeRequire('./controllers/twitchController'),
  spotify: safeRequire('./controllers/spotifyController'),
  soundcloud: safeRequire('./controllers/soundcloudController'),
  musicPlatform: safeRequire('./controllers/musicPlatformController')
};

// Initialize Express app
const app = express();

// Security and middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: true,
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

// Health check
app.get('/', (req, res) => {
  res.json({
    ok: true,
    name: 'UniSaver Backend',
    version: '3.0.0',
    features: ['multi-platform', 'streaming-proxy', 'format-normalization']
  });
});

// Platform detection
function detectPlatform(url) {
  const u = (url || '').toLowerCase();

  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('facebook.com') || u.includes('fb.watch') || u.includes('fb.com')) return 'facebook';
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
  if (u.includes('bandcamp.com')) return 'bandcamp';
  if (u.includes('deezer.com')) return 'deezer';
  if (u.includes('music.apple.com')) return 'apple_music';
  if (u.includes('music.amazon.com')) return 'amazon_music';
  if (u.includes('mixcloud.com')) return 'mixcloud';
  if (u.includes('audiomack.com')) return 'audiomack';
  if (u.includes('reddit.com')) return 'reddit';
  if (u.includes('linkedin.com')) return 'linkedin';
  if (u.includes('tumblr.com')) return 'tumblr';
  if (u.includes('vk.com')) return 'vk';
  if (u.includes('bilibili.com')) return 'bilibili';
  if (u.includes('snapchat.com')) return 'snapchat';

  return 'generic';
}

// Platform-specific configuration
function getPlatformConfig(platform, url) {
  const configs = {
    instagram: {
      referer: 'https://www.instagram.com/',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
      headers: {
        'X-IG-App-ID': '936619743392459',
        'X-ASBD-ID': '129477',
        'X-IG-WWW-Claim': '0'
      }
    },
    facebook: {
      referer: 'https://www.facebook.com/',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    pinterest: {
      referer: 'https://www.pinterest.com/',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    youtube: {
      referer: 'https://www.youtube.com/',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    twitter: {
      referer: 'https://twitter.com/',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    generic: {
      referer: null,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  };

  return configs[platform] || configs.generic;
}

// Utility functions
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
  return 'mp4';
}

function makeProxy(mediaUrl, options = {}) {
  const { title = 'Media', ext = 'mp4', referer = null, platform = null } = options;
  const safeTitle = String(title).replace(/[^\w\-\s]+/g, '_').trim().slice(0, 50);

  const params = new URLSearchParams({
    url: mediaUrl,
    filename: `${safeTitle}.${ext}`
  });

  if (referer) params.append('referer', referer);
  if (platform) params.append('platform', platform);

  return `/api/direct?${params.toString()}`;
}

// Format normalization
function normalizeToUnified(platform, rawData) {
  const data = rawData?.data || rawData;

  const title = data?.title || `${platform} Media`;
  const thumbnail = data?.thumbnail || data?.thumbnails?.[0]?.url || '';
  const platformConfig = getPlatformConfig(platform);
  const mediaType = data?.mediaType || (data?.audio ? 'audio' : 'video');

  let formats = data?.formats || [];

  // Handle single URL case
  if (!formats.length && (data?.url || data?.directUrl)) {
    formats = [{
      itag: 'best',
      quality: data?.quality || 'Original',
      url: data.url || data.directUrl,
      mimeType: mediaType === 'audio' ? 'audio/mp3' : 'video/mp4',
      hasAudio: mediaType !== 'video-only',
      hasVideo: mediaType !== 'audio',
      isVideo: mediaType !== 'audio',
      container: mediaType === 'audio' ? 'mp3' : 'mp4'
    }];
  }

  // Process formats
  const processedFormats = formats
    .filter(f => f?.url)
    .map((f, i) => {
      const ext = extFromFormat(f);
      return {
        itag: String(f.itag || f.format_id || i),
        quality: f.quality || f.format_note || 'Original',
        url: makeProxy(f.url, { title, ext, referer: platformConfig.referer, platform }),
        mimeType: f.mimeType || f.mime_type || (f.hasVideo || f.isVideo ? `video/${ext}` : `audio/${ext}`),
        hasAudio: f.hasAudio !== false,
        hasVideo: f.hasVideo === true || f.isVideo === true || !!(f.vcodec && f.vcodec !== 'none'),
        isVideo: f.hasVideo === true || f.isVideo === true || !!(f.vcodec && f.vcodec !== 'none'),
        audioBitrate: f.audioBitrate || f.abr || 0,
        videoCodec: f.videoCodec || f.vcodec || 'unknown',
        audioCodec: f.audioCodec || f.acodec || 'unknown',
        container: f.container || ext,
        contentLength: Number(f.contentLength || f.filesize || f.filesize_approx || 0)
      };
    });

  return {
    success: true,
    platform,
    mediaType,
    title,
    duration: data?.duration || null,
    thumbnails: thumbnail ? [{ url: thumbnail }] : [],
    formats: processedFormats,
    directUrl: processedFormats[0]?.url || null
  };
}

// Generic yt-dlp extractor
async function extractWithYtdlp(url, platform) {
  const platformConfig = getPlatformConfig(platform, url);

  const options = {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    userAgent: platformConfig.userAgent,
    timeout: 30
  };

  if (platformConfig.referer) {
    options.referer = platformConfig.referer;
  }

  const info = await ytdlp(url, options);
  const title = titleFromInfo(info, `${platform} Media`);

  // Process formats
  const allFormats = Array.isArray(info?.formats) ? info.formats : [];
  let chosenFormats = allFormats.filter(f => f.url);

  // Prefer progressive formats for better compatibility
  const progressive = allFormats.filter(f =>
    (f.ext === 'mp4' || f.ext === 'm4v') &&
    f.vcodec && f.vcodec !== 'none' &&
    f.acodec && f.acodec !== 'none' &&
    f.url
  );

  if (progressive.length) {
    chosenFormats = progressive;
  }

  const formats = chosenFormats.map((f, i) => {
    const ext = extFromFormat(f);
    const quality = f.format_note || (f.height ? `${f.height}p` : (f.abr ? `${f.abr}kbps` : 'Best'));
    const hasVideo = !!(f.vcodec && f.vcodec !== 'none');
    const hasAudio = !!(f.acodec && f.acodec !== 'none');

    return {
      itag: String(f.format_id || i),
      quality,
      url: makeProxy(f.url, { title, ext, referer: platformConfig.referer, platform }),
      mimeType: f.mime_type || (hasVideo ? `video/${ext}` : `audio/${ext}`),
      hasAudio,
      hasVideo,
      isVideo: hasVideo,
      audioBitrate: f.abr || (hasAudio ? 128 : 0),
      videoCodec: f.vcodec || (hasVideo ? 'h264' : 'none'),
      audioCodec: f.acodec || (hasAudio ? 'aac' : 'none'),
      container: ext,
      contentLength: Number(f.filesize || f.filesize_approx || 0)
    };
  });

  // Fallback if no formats found
  if (!formats.length && info?.url) {
    formats.push({
      itag: 'best',
      quality: 'Original',
      url: makeProxy(info.url, { title, ext: 'mp4', referer: platformConfig.referer, platform }),
      mimeType: 'video/mp4',
      hasAudio: true,
      hasVideo: true,
      isVideo: true,
      audioBitrate: 128,
      videoCodec: 'h264',
      audioCodec: 'aac',
      container: 'mp4',
      contentLength: 0
    });
  }

  return {
    success: true,
    platform,
    mediaType: formats.some(f => f.hasVideo) ? 'video' : 'audio',
    title,
    duration: info?.duration || null,
    thumbnails: info?.thumbnails?.length ?
      [{ url: info.thumbnails[info.thumbnails.length - 1].url }] :
      (info?.thumbnail ? [{ url: info.thumbnail }] : []),
    formats,
    directUrl: formats[0]?.url || null
  };
}

// Main info endpoint
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const platform = detectPlatform(url);
  console.log(`Processing ${platform} URL: ${url}`);

  try {
    let result;

    // Try controller first, fallback to yt-dlp
    const controllerMap = {
      youtube: 'downloadYouTubeVideo',
      facebook: 'downloadFacebookVideo',
      instagram: 'downloadInstagramMedia',
      twitter: 'downloadTwitterVideo',
      tiktok: 'downloadTikTok',
      threads: 'downloadThreads',
      pinterest: 'getPinterestInfo',
      vimeo: 'downloadVimeoMedia',
      dailymotion: 'downloadDailymotionMedia',
      twitch: 'downloadTwitchMedia',
      soundcloud: 'downloadSoundcloud',
      spotify: 'downloadSpotify'
    };

    const controllerMethod = controllerMap[platform];
    const controller = controllers[platform];

    if (controller && typeof controller[controllerMethod] === 'function') {
      console.log(`Using ${platform} controller`);
      try {
        const controllerResult = await controller[controllerMethod](url);
        result = normalizeToUnified(platform, controllerResult);
      } catch (controllerError) {
        console.warn(`Controller failed for ${platform}: ${controllerError.message}`);
        console.log('Falling back to yt-dlp');
        result = await extractWithYtdlp(url, platform);
      }
    } else {
      console.log(`No controller for ${platform}, using yt-dlp`);
      result = await extractWithYtdlp(url, platform);
    }

    if (!result?.formats?.length && !result?.directUrl) {
      return res.status(422).json({
        error: 'No playable media found',
        errorDetail: 'Could not extract any downloadable media from this URL',
        platform
      });
    }

    console.log(`Successfully processed ${platform} URL: ${result.formats.length} formats found`);
    res.json(result);

  } catch (error) {
    console.error(`Error processing ${platform} URL:`, error);
    res.status(500).json({
      error: 'Processing failed',
      errorDetail: String(error.message || error),
      platform
    });
  }
});

// Enhanced direct proxy endpoint
app.get('/api/direct', async (req, res) => {
  const { url, filename, referer, platform } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log(`Direct proxy: ${url.substring(0, 100)}... (${platform || 'auto'})`);

  try {
    // Auto-detect platform if not provided
    const detectedPlatform = platform || detectPlatform(url);
    const platformConfig = getPlatformConfig(detectedPlatform, url);

    // Build headers
    const headers = {
      'User-Agent': platformConfig.userAgent,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive'
    };

    // Add platform-specific headers
    if (platformConfig.referer) {
      headers['Referer'] = platformConfig.referer;
      try {
        headers['Origin'] = new URL(platformConfig.referer).origin;
      } catch {}
    }

    if (platformConfig.headers) {
      Object.assign(headers, platformConfig.headers);
    }

    // Add cookies for Instagram
    if (detectedPlatform === 'instagram') {
      const cookieStr = process.env.IG_COOKIE_STRING;
      if (cookieStr) {
        headers['Cookie'] = cookieStr;
      }
    }

    // Handle range requests
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    // Make request
    const response = await axios({
      method: 'GET',
      url: url,
      headers,
      responseType: 'stream',
      maxRedirects: 5,
      timeout: 45000,
      validateStatus: status => status < 400 || status === 206
    });

    if (response.status >= 400) {
      console.error(`Upstream error: ${response.status}`);
      return res.status(502).json({
        error: 'Upstream server error',
        status: response.status,
        platform: detectedPlatform
      });
    }

    // Process response headers
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const contentLength = response.headers['content-length'];
    const acceptRanges = response.headers['accept-ranges'];
    const contentRange = response.headers['content-range'];

    // Generate filename
    let outputFilename = filename || 'download';
    if (!outputFilename.includes('.')) {
      if (contentType.includes('video') || url.includes('.mp4')) {
        outputFilename += '.mp4';
      } else if (contentType.includes('audio') || url.includes('.mp3')) {
        outputFilename += '.mp3';
      } else if (contentType.includes('image/png') || url.includes('.png')) {
        outputFilename += '.png';
      } else if (contentType.includes('image/webp') || url.includes('.webp')) {
        outputFilename += '.webp';
      } else if (contentType.includes('image') || url.includes('.jpg')) {
        outputFilename += '.jpg';
      } else {
        outputFilename += '.mp4';
      }
    }

    // Set response headers
    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
    if (contentRange) res.setHeader('Content-Range', contentRange);

    if (response.status === 206) {
      res.status(206);
    }

    res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');

    console.log(`Streaming: ${outputFilename} (${contentType})`);

    // Stream response
    response.data.pipe(res);

    // Handle errors
    response.data.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Stream error',
          details: err.message,
          platform: detectedPlatform
        });
      }
    });

  } catch (error) {
    console.error('Direct proxy error:', error?.message || error);

    let errorMessage = 'Download failed';
    let errorDetail = String(error?.message || error);

    if (error?.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused';
      errorDetail = 'Could not connect to media server';
    } else if (error?.code === 'ETIMEDOUT') {
      errorMessage = 'Request timeout';
      errorDetail = 'Media server response timeout';
    } else if (error?.response?.status === 403) {
      errorMessage = 'Access forbidden';
      errorDetail = 'Media server denied access';
    } else if (error?.response?.status === 404) {
      errorMessage = 'Media not found';
      errorDetail = 'Requested media not found or expired';
    }

    res.status(500).json({
      error: errorMessage,
      details: errorDetail,
      platform: platform || 'unknown'
    });
  }
});

// Platform-specific endpoints
const platformEndpoints = [
  'youtube', 'facebook', 'instagram', 'twitter', 'tiktok',
  'threads', 'pinterest', 'vimeo', 'dailymotion', 'twitch',
  'soundcloud', 'spotify'
];

platformEndpoints.forEach(platform => {
  app.get(`/api/${platform}`, async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
      // Forward to main info endpoint with platform detection
      const response = await axios.get(`http://localhost:${PORT}/api/info?url=${encodeURIComponent(url)}`);
      res.json(response.data);
    } catch (error) {
      console.error(`${platform} endpoint error:`, error);
      res.status(500).json({
        error: `${platform} processing failed`,
        errorDetail: String(error.message || error),
        platform
      });
    }
  });
});

// Utility endpoints
app.get('/api/download', (req, res) => {
  const { url, filename, referer, platform } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const params = new URLSearchParams({ url });
  if (filename) params.append('filename', filename);
  if (referer) params.append('referer', referer);
  if (platform) params.append('platform', platform);

  res.redirect(302, `/api/direct?${params.toString()}`);
});

app.get('/api/audio', (req, res) => {
  const { url, referer, platform } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const params = new URLSearchParams({
    url,
    filename: 'audio.mp3'
  });
  if (referer) params.append('referer', referer);
  if (platform) params.append('platform', platform);

  res.redirect(302, `/api/direct?${params.toString()}`);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    errorDetail: String(err?.message || err)
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 UniSaver Backend running on http://localhost:${PORT}`);
  console.log(`📱 Multi-platform media downloader ready`);
  console.log(`🔧 Supported platforms: ${platformEndpoints.join(', ')}`);
  console.log(`⚡ Enhanced streaming proxy enabled`);
});