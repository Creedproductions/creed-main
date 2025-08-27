// server.js — UniSaver Backend Compatible with Older Node.js
require('dotenv').config();
process.env.YTDL_NO_UPDATE = '1';

const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
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

// Create temp directory for media files
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  console.log('Creating temp directory...');
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    fs.chmodSync(TEMP_DIR, 0o777);
    console.log(`Temp directory created at ${TEMP_DIR}`);
  } catch (error) {
    console.error(`Error creating temp directory: ${error.message}`);
  }
}

// Clean up old files every hour
setInterval(() => {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    files.forEach(file => {
      const filePath = path.join(TEMP_DIR, file);
      const stats = fs.statSync(filePath);
      if (stats.mtime.getTime() < oneHourAgo) {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up old file: ${file}`);
      }
    });
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}, 60 * 60 * 1000); // Every hour

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

// Media download and caching functions
async function downloadAndCacheMedia(mediaUrl, filename, platform) {
  try {
    console.log(`Downloading media: ${mediaUrl.substring(0, 100)}...`);

    // Create unique filename to avoid conflicts
    const timestamp = Date.now();
    const ext = getExtensionFromUrl(mediaUrl) || 'mp4';
    const safeFilename = filename.replace(/[^\w\s\-_.]/g, '_').trim();
    const finalFilename = `${safeFilename}_${timestamp}.${ext}`;
    const filePath = path.join(TEMP_DIR, finalFilename);

    // Set up headers based on platform
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br'
    };

    if (platform === 'instagram') {
      headers['Referer'] = 'https://www.instagram.com/';
      headers['Origin'] = 'https://www.instagram.com';
      const cookieStr = process.env.IG_COOKIE_STRING;
      if (cookieStr) {
        headers['Cookie'] = cookieStr;
      }
    } else if (platform === 'facebook') {
      headers['Referer'] = 'https://www.facebook.com/';
    } else if (platform === 'pinterest') {
      headers['Referer'] = 'https://www.pinterest.com/';
    }

    // Download the media file
    const response = await axios({
      method: 'GET',
      url: mediaUrl,
      responseType: 'stream',
      headers: headers,
      timeout: 60000, // 60 seconds
      maxRedirects: 5
    });

    if (response.status >= 400) {
      throw new Error(`Failed to download media: ${response.status}`);
    }

    // Save to temp file
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        const stats = fs.statSync(filePath);
        console.log(`Media downloaded: ${finalFilename} (${stats.size} bytes)`);
        resolve({
          filename: finalFilename,
          path: filePath,
          size: stats.size,
          url: `/api/temp/${finalFilename}`
        });
      });
      writer.on('error', (error) => {
        console.error('Download error:', error);
        reject(error);
      });
    });

  } catch (error) {
    console.error('Media download failed:', error.message);
    throw error;
  }
}

function getExtensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase().substring(1);
    if (['mp4', 'm4v', 'mov', 'avi', 'webm'].includes(ext)) return 'mp4';
    if (['mp3', 'm4a', 'wav', 'aac'].includes(ext)) return 'mp3';
    if (['jpg', 'jpeg'].includes(ext)) return 'jpg';
    if (['png'].includes(ext)) return 'png';
    if (['webp'].includes(ext)) return 'webp';
    if (['gif'].includes(ext)) return 'gif';
    return 'mp4'; // default
  } catch (error) {
    return 'mp4';
  }
}
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
function titleFromInfo(info, fallback) {
  fallback = fallback || 'Media';
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

function makeProxy(mediaUrl, options) {
  options = options || {};
  const title = options.title || 'Media';
  const ext = options.ext || 'mp4';
  const referer = options.referer || null;
  const platform = options.platform || null;

  const safeTitle = String(title).replace(/[^\w\-\s]+/g, '_').trim().slice(0, 50);

  const params = new URLSearchParams({
    url: mediaUrl,
    filename: `${safeTitle}.${ext}`
  });

  if (referer) params.append('referer', referer);
  if (platform) params.append('platform', platform);

  return `/api/direct?${params.toString()}`;
}

// Format normalization with media downloading
async function normalizeToUnified(platform, rawData) {
  const data = rawData.data || rawData;

  let title = data.title || `${platform} Media`;
  let thumbnail = '';

  // Handle different thumbnail formats
  if (data.thumbnail) {
    thumbnail = data.thumbnail;
  } else if (data.thumbnails && Array.isArray(data.thumbnails) && data.thumbnails.length > 0) {
    thumbnail = data.thumbnails[0].url || '';
  }

  const mediaType = data.mediaType || (data.audio ? 'audio' : 'video');

  let formats = data.formats || [];

  // Handle single URL case
  if (!formats.length && (data.url || data.directUrl)) {
    formats = [{
      itag: 'best',
      quality: data.quality || 'Original',
      url: data.url || data.directUrl,
      mimeType: mediaType === 'audio' ? 'audio/mp3' : 'video/mp4',
      hasAudio: mediaType !== 'video-only',
      hasVideo: mediaType !== 'audio',
      isVideo: mediaType !== 'audio',
      container: mediaType === 'audio' ? 'mp3' : 'mp4'
    }];
  }

  // Process formats and download media files
  const processedFormats = [];

  for (let i = 0; i < formats.length; i++) {
    const f = formats[i];
    if (!f || !f.url) continue;

    try {
      const ext = extFromFormat(f);

      // Create a better filename from the title
      let cleanTitle = title.replace(/[^\w\s\-_]/g, '').trim();
      if (cleanTitle.length > 50) {
        cleanTitle = cleanTitle.substring(0, 50);
      }
      if (!cleanTitle || cleanTitle === `${platform} Media`) {
        const shortcodeMatch = data.originalUrl && data.originalUrl.match(/(?:p|reel|tv)\/([A-Za-z0-9_\-]+)/);
        if (shortcodeMatch) {
          cleanTitle = `${platform}_${shortcodeMatch[1]}`;
        } else {
          cleanTitle = `${platform}_media`;
        }
      }

      // Download and cache the media file
      console.log(`Downloading format ${i + 1}/${formats.length}: ${f.url.substring(0, 100)}...`);
      const downloadResult = await downloadAndCacheMedia(f.url, cleanTitle, platform);

      const processedFormat = {
        itag: String(f.itag || f.format_id || i),
        quality: f.quality || f.format_note || 'Original',
        url: downloadResult.url, // This now points to our temp file
        mimeType: f.mimeType || f.mime_type || (f.hasVideo || f.isVideo ? `video/${ext}` : `audio/${ext}`),
        hasAudio: f.hasAudio !== false,
        hasVideo: f.hasVideo === true || f.isVideo === true || !!(f.vcodec && f.vcodec !== 'none'),
        isVideo: f.hasVideo === true || f.isVideo === true || !!(f.vcodec && f.vcodec !== 'none'),
        audioBitrate: f.audioBitrate || f.abr || 0,
        videoCodec: f.videoCodec || f.vcodec || 'unknown',
        audioCodec: f.audioCodec || f.acodec || 'unknown',
        container: f.container || ext,
        contentLength: downloadResult.size,
        filename: downloadResult.filename
      };

      processedFormats.push(processedFormat);
      console.log(`Successfully processed format: ${downloadResult.filename}`);

    } catch (downloadError) {
      console.error(`Failed to download format ${i}: ${downloadError.message}`);
      // Continue with other formats instead of failing completely
    }
  }

  if (processedFormats.length === 0) {
    throw new Error('Failed to download any media files');
  }

  return {
    success: true,
    platform: platform,
    mediaType: mediaType,
    title: title,
    duration: data.duration || null,
    thumbnails: thumbnail ? [{ url: thumbnail }] : [],
    formats: processedFormats,
    directUrl: processedFormats.length > 0 ? processedFormats[0].url : null
  };
}

// Main info endpoint
app.get('/api/info', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const platform = detectPlatform(url);
  console.log(`Processing ${platform} URL: ${url}`);

  try {
    let result;

    // For Instagram, use only the controller (metadownloader)
    if (platform === 'instagram' && typeof controllers.instagram.downloadInstagramMedia === 'function') {
      console.log('Using Instagram controller (metadownloader only)');
      try {
        const controllerResult = await controllers.instagram.downloadInstagramMedia(url);
        // Add original URL for context
        if (controllerResult.data) {
          controllerResult.data.originalUrl = url;
        }
        result = await normalizeToUnified(platform, controllerResult);
      } catch (controllerError) {
        console.error(`Instagram controller failed: ${controllerError.message}`);
        throw controllerError;
      }
    }
    // For other platforms, try controller first
    else {
      const controllerMap = {
        youtube: 'downloadYouTubeVideo',
        facebook: 'downloadFacebookVideo',
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
          if (controllerResult.data) {
            controllerResult.data.originalUrl = url;
          }
          result = await normalizeToUnified(platform, controllerResult);
        } catch (controllerError) {
          console.warn(`Controller failed for ${platform}: ${controllerError.message}`);
          throw controllerError;
        }
      } else {
        console.log(`No controller available for ${platform}`);
        throw new Error(`Platform ${platform} is not supported yet`);
      }
    }

    if (!result || !result.formats || result.formats.length === 0) {
      return res.status(422).json({
        error: 'No playable media found',
        errorDetail: 'Could not extract any downloadable media from this URL',
        platform: platform
      });
    }

    console.log(`Successfully processed ${platform} URL: ${result.formats.length} formats found`);
    res.json(result);

  } catch (error) {
    console.error(`Error processing ${platform} URL:`, error);
    res.status(500).json({
      error: 'Processing failed',
      errorDetail: String(error.message || error),
      platform: platform
    });
  }
});

// Serve temporary media files
app.get('/api/temp/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(TEMP_DIR, filename);

  console.log(`Serving temp file: ${filename}`);

  if (!fs.existsSync(filePath)) {
    console.error(`Temp file not found: ${filename}`);
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const stats = fs.statSync(filePath);
    const ext = path.extname(filename).toLowerCase();

    let contentType = 'application/octet-stream';
    if (['.mp4', '.m4v', '.mov'].includes(ext)) {
      contentType = 'video/mp4';
    } else if (['.mp3', '.m4a'].includes(ext)) {
      contentType = 'audio/mpeg';
    } else if (['.jpg', '.jpeg'].includes(ext)) {
      contentType = 'image/jpeg';
    } else if (['.png'].includes(ext)) {
      contentType = 'image/png';
    } else if (['.webp'].includes(ext)) {
      contentType = 'image/webp';
    }

    // Handle range requests for video streaming
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunksize = (end - start) + 1;

      const stream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=3600'
      });

      stream.pipe(res);
    } else {
      // Regular download
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    }

  } catch (error) {
    console.error(`Error serving temp file ${filename}:`, error);
    res.status(500).json({ error: 'Error serving file' });
  }
});

// Enhanced direct proxy endpoint
app.get('/api/direct', async (req, res) => {
  const url = req.query.url;
  const filename = req.query.filename;
  const referer = req.query.referer;
  const platform = req.query.platform;

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
      } catch (e) {}
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
      headers: headers,
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
    console.error('Direct proxy error:', error.message || error);

    let errorMessage = 'Download failed';
    let errorDetail = String(error.message || error);

    if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused';
      errorDetail = 'Could not connect to media server';
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'Request timeout';
      errorDetail = 'Media server response timeout';
    } else if (error.response && error.response.status === 403) {
      errorMessage = 'Access forbidden';
      errorDetail = 'Media server denied access';
    } else if (error.response && error.response.status === 404) {
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
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
      // Forward to main info endpoint
      const response = await axios.get(`http://localhost:${PORT}/api/info?url=${encodeURIComponent(url)}`);
      res.json(response.data);
    } catch (error) {
      console.error(`${platform} endpoint error:`, error);
      res.status(500).json({
        error: `${platform} processing failed`,
        errorDetail: String(error.message || error),
        platform: platform
      });
    }
  });
});

// Utility endpoints
app.get('/api/download', (req, res) => {
  const url = req.query.url;
  const filename = req.query.filename;
  const referer = req.query.referer;
  const platform = req.query.platform;

  if (!url) return res.status(400).json({ error: 'URL is required' });

  console.log(`Download endpoint called with URL: ${url}`);
  console.log(`Filename: ${filename}, Platform: ${platform}`);

  const params = new URLSearchParams({ url: url });
  if (filename) params.append('filename', filename);
  if (referer) params.append('referer', referer);
  if (platform) params.append('platform', platform);

  res.redirect(302, `/api/direct?${params.toString()}`);
});

// Debug endpoint to see what URLs are being processed
app.get('/api/debug', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  console.log(`Debug endpoint called with: ${url}`);

  res.json({
    receivedUrl: url,
    platform: detectPlatform(url),
    isMediaUrl: url.includes('rapidcdn.app') || url.includes('cdninstagram.com') || url.includes('fbcdn.net'),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/audio', (req, res) => {
  const url = req.query.url;
  const referer = req.query.referer;
  const platform = req.query.platform;

  if (!url) return res.status(400).json({ error: 'URL is required' });

  const params = new URLSearchParams({
    url: url,
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
    errorDetail: String(err.message || err)
  });
});

app.listen(PORT, () => {
  console.log(`🚀 UniSaver Backend running on http://localhost:${PORT}`);
  console.log(`📱 Multi-platform media downloader ready`);
  console.log(`⚡ Enhanced streaming proxy enabled`);
});