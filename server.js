// server.js - Integrated with your existing controllers and packages
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');

const config = require('./utils/config');

// Import your existing controllers
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

// Your existing packages
const { alldown, threads } = require('herxa-media-downloader');
const { ttdl, twitter, igdl } = require('btch-downloader');
const youtubeDl = require('youtube-dl-exec');

const app = express();
const port = config.PORT;

// Security and middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: false,
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.RATE_LIMIT_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Health check
app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'UniSaver Backend', version: '1.0.0' });
});

// Platform detection function
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

  // Music platforms
  const music = platformOf(url);
  if (music !== 'unknown') return 'music';

  return 'generic';
}

// Response normalization to ensure consistency
// Enhanced response normalization
function normalize(platform, raw) {
  const data = raw?.data && (raw.title || raw.formats || raw.platform) ? raw : raw?.data ? raw.data : raw;

  const title = data?.title || 'Media';
  const thumbnail = data?.thumbnail || (data?.thumbnails?.[0]?.url) || '';
  const mediaType = data?.mediaType || (data?.audio ? 'audio' : 'video');
  const directUrl = data?.url || data?.directUrl || null;
  const src = platform || data?.source || 'unknown';

  let formats = data?.formats || [];

  // If no formats but we have a direct URL, create format entries
  if ((!formats || !formats.length) && directUrl) {
    formats = [{
      itag: 'best',
      quality: data?.quality || 'Original Quality',
      url: directUrl,
      mimeType: mediaType === 'audio' ? 'audio/mpeg' : 'video/mp4',
      hasAudio: mediaType !== 'video-only',
      hasVideo: mediaType !== 'audio-only',
      isVideo: mediaType !== 'audio-only',
      contentLength: 0,
    }];
  }

  // Ensure all formats have required fields for Flutter client
  formats = formats.map((f, index) => ({
    itag: f.itag || String(index),
    quality: f.quality || 'Unknown',
    url: f.url,
    mimeType: f.mimeType || (f.hasVideo ? 'video/mp4' : 'audio/mp3'),
    hasAudio: f.hasAudio !== false,
    hasVideo: f.hasVideo === true,
    isVideo: f.hasVideo === true || f.isVideo === true,
    audioBitrate: f.audioBitrate || (f.hasAudio ? 128 : 0),
    videoCodec: f.videoCodec || 'unknown',
    audioCodec: f.audioCodec || 'unknown',
    container: f.container || (f.hasVideo ? 'mp4' : 'mp3'),
    contentLength: f.contentLength || 0,
  }));

  return {
    success: true,
    platform: src,
    mediaType,
    title,
    duration: data?.duration || null,
    thumbnails: thumbnail ? [{ url: thumbnail }] : [],
    formats,
    directUrl: directUrl ? `/api/direct?url=${encodeURIComponent(directUrl)}` : null,
  };
}
// Validate if formats are playable
// Fixed format validation function
function validateFormats(formats) {
  if (!Array.isArray(formats)) return [];

  return formats.filter(f => {
    const url = f?.url;
    if (!url) return false;

    // More permissive validation - check for valid URLs
    try {
      new URL(url);

      // Skip obvious non-media URLs
      const lowerUrl = url.toLowerCase();
      const badPatterns = [
        '/ads/', '/ad/', '/tracker/', '/analytics/',
        '/pixel/', '/beacon/', '.js', '.css', '.html'
      ];

      if (badPatterns.some(pattern => lowerUrl.includes(pattern))) {
        return false;
      }

      // Accept if it has media indicators OR is from known media domains
      const hasMediaExtension = /\.(mp4|m4v|mov|webm|m3u8|mpd|mp3|m4a|aac|ogg|wav|jpg|jpeg|png|gif)(\?|#|$)/i.test(url);
      const isFromMediaDomain = /\b(twimg|fbcdn|cdninstagram|tiktok|youtube|googlevideo|pinimg|threads)\./i.test(url);
      const hasMediaParam = /[?&](video|audio|media|download)=/i.test(url);

      return hasMediaExtension || isFromMediaDomain || hasMediaParam;
    } catch (e) {
      return false;
    }
  });
}
// YouTube endpoint
app.get('/api/youtube', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const raw = await downloadYouTubeVideo(url);
    const uni = normalize('YouTube', raw);
    uni.formats = validateFormats(uni.formats);

    if (!uni.formats.length) {
      throw new Error('No playable YouTube formats');
    }

    res.json(uni);
  } catch (e) {
    res.status(500).json({
      error: 'YouTube processing failed',
      errorDetail: String(e.message || e)
    });
  }
});

// Facebook endpoint
app.get('/api/facebook', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const raw = await downloadFacebookVideo(url);
    const uni = normalize('Facebook', raw);
    uni.formats = validateFormats(uni.formats);

    if (!uni.formats.length) {
      throw new Error('No playable Facebook formats');
    }

    res.json(uni);
  } catch (e) {
    res.status(500).json({
      error: 'Facebook processing failed',
      errorDetail: String(e.message || e)
    });
  }
});

// Instagram endpoint
app.get('/api/instagram', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const raw = await downloadInstagramMedia(url);
    const uni = normalize('Instagram', raw);
    uni.formats = validateFormats(uni.formats);

    if (!uni.formats.length) {
      throw new Error('No playable Instagram formats');
    }

    res.json(uni);
  } catch (e) {
    res.status(500).json({
      error: 'Instagram processing failed',
      errorDetail: String(e.message || e)
    });
  }
});

// TikTok endpoint
app.get('/api/tiktok', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const raw = await downloadTikTok(url);
    const uni = normalize('TikTok', raw);
    uni.formats = validateFormats(uni.formats);

    if (!uni.formats.length) {
      throw new Error('No playable TikTok formats');
    }

    res.json(uni);
  } catch (e) {
    res.status(500).json({
      error: 'TikTok processing failed',
      errorDetail: String(e.message || e)
    });
  }
});

// Twitter endpoint
app.get('/api/twitter', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const raw = await downloadTwitterVideo(url);
    const uni = normalize('Twitter', raw);
    uni.formats = validateFormats(uni.formats);

    if (!uni.formats.length) {
      throw new Error('No playable Twitter formats');
    }

    res.json(uni);
  } catch (e) {
    res.status(500).json({
      error: 'Twitter processing failed',
      errorDetail: String(e.message || e)
    });
  }
});

// Threads endpoint
app.get('/api/threads', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const raw = await downloadThreads(url);
    const uni = normalize('Threads', raw);
    uni.formats = validateFormats(uni.formats);

    if (!uni.formats.length && !uni.directUrl) {
      throw new Error('No playable Threads formats');
    }

    res.json(uni);
  } catch (e) {
    res.status(500).json({
      error: 'Threads processing failed',
      errorDetail: String(e.message || e)
    });
  }
});

// Pinterest endpoint
app.get('/api/pinterest', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const raw = await getPinterestInfo(url);
    if (!raw?.success) throw new Error('Pinterest extraction failed');

    const uni = normalize('Pinterest', raw);
    uni.formats = validateFormats(uni.formats);

    res.json(uni);
  } catch (e) {
    res.status(500).json({
      error: 'Pinterest processing failed',
      errorDetail: String(e.message || e)
    });
  }
});

// Music platforms endpoint
app.get('/api/music', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const raw = await downloadMusic(url);
    const uni = normalize('music', raw);
    uni.formats = validateFormats(uni.formats);

    if (!uni.formats.length) {
      throw new Error('No playable music formats');
    }

    res.json(uni);
  } catch (e) {
    res.status(500).json({
      error: 'Music processing failed',
      errorDetail: String(e.message || e)
    });
  }
});

// Vimeo endpoint
app.get('/api/vimeo', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const raw = await downloadVimeoMedia(url);
    const uni = normalize('Vimeo', raw);
    uni.formats = validateFormats(uni.formats);

    if (!uni.formats.length) {
      throw new Error('No playable Vimeo formats');
    }

    res.json(uni);
  } catch (e) {
    res.status(500).json({
      error: 'Vimeo processing failed',
      errorDetail: String(e.message || e)
    });
  }
});

// Main info endpoint - your existing implementation with fixes
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
      default:
        // Generic extractor as fallback
        const info = await youtubeDl(url, {
          dumpSingleJson: true,
          noWarnings: true,
          noCheckCertificates: true,
        });

        let best = null;
        if (info?.formats?.length) {
          const candidates = info.formats.filter(f => {
            const u = f.url || '';
            return /\.(mp4|m4v|mov|webm|m3u8|mpd|mp3|m4a|aac|ogg|wav)(\?|#|$)/i.test(u);
          });
          best = candidates[0] || info.formats[0];
        }

        raw = {
          success: true,
          data: {
            title: info.title || 'Media',
            url: best?.url || '',
            thumbnail: info.thumbnail || '',
            quality: best?.format_note || best?.format || 'Original Quality',
            source: 'generic',
            mediaType: (best && best.acodec !== 'none' && best.vcodec === 'none') ? 'audio' : 'video',
          }
        };
    }

    const uni = normalize(platform, raw);
    uni.formats = validateFormats(uni.formats);

    // If nothing playable, return graceful error
    if (!uni.formats.length && !uni.directUrl) {
      return res.status(422).json({
        error: 'No playable media found',
        errorDetail: 'The URL was parsed but produced no direct playable streams (MP4/HLS/DASH).',
        platform,
      });
    }

    res.json(uni);
  } catch (e) {
    res.status(500).json({
      error: 'Failed to process media',
      errorDetail: String(e.message || e),
      platform
    });
  }
});

// Direct download endpoint - enhanced version
app.get('/api/direct', async (req, res) => {
  const { url, filename } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    // Platform-specific headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    // Add platform-specific referers
    if (url.includes('facebook') || url.includes('fbcdn')) {
      headers['Referer'] = 'https://www.facebook.com/';
    } else if (url.includes('instagram') || url.includes('cdninstagram')) {
      headers['Referer'] = 'https://www.instagram.com/';
    } else if (url.includes('tiktok')) {
      headers['Referer'] = 'https://www.tiktok.com/';
    } else if (url.includes('pinterest') || url.includes('pinimg')) {
      headers['Referer'] = 'https://www.pinterest.com/';
      headers['Range'] = 'bytes=0-'; // Important for Pinterest videos
    } else if (url.includes('youtube') || url.includes('googlevideo')) {
      headers['Referer'] = 'https://www.youtube.com/';
    } else if (url.includes('twitter') || url.includes('twimg')) {
      headers['Referer'] = 'https://twitter.com/';
    }

    const response = await axios({
      method: 'GET',
      url: url,
      headers: headers,
      responseType: 'stream',
      maxRedirects: 5,
      timeout: 30000
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const contentLength = response.headers['content-length'];

    // Set response headers
    res.setHeader('Content-Type', contentType);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Determine filename
    let outputFilename = filename || 'download';
    if (!outputFilename.includes('.')) {
      if (contentType.includes('video')) outputFilename += '.mp4';
      else if (contentType.includes('audio')) outputFilename += '.mp3';
      else if (contentType.includes('image')) outputFilename += '.jpg';
      else outputFilename += '.mp4';
    }

    res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache');

    response.data.pipe(res);
  } catch (error) {
    console.error('Direct download error:', error);
    res.status(500).json({
      error: 'Download failed',
      details: error.message
    });
  }
});

// Download endpoint (uses direct)
app.get('/api/download', (req, res) => {
  const { url, filename } = req.query;
  const redirectUrl = `/api/direct?url=${encodeURIComponent(url)}${filename ? `&filename=${encodeURIComponent(filename)}` : ''}`;
  res.redirect(302, redirectUrl);
});

// Audio endpoint (uses direct)
app.get('/api/audio', (req, res) => {
  const { url } = req.query;
  const redirectUrl = `/api/direct?url=${encodeURIComponent(url)}&filename=audio.mp3`;
  res.redirect(302, redirectUrl);
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('UNCAUGHT', err);
  res.status(500).json({ error: 'Server error', errorDetail: String(err.message || err) });
});
// Add this endpoint to server.js after the existing endpoints
app.get('/api/special-media', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const platform = detectPlatform(url);

  try {
    let raw;

    if (platform === 'music') {
      raw = await downloadMusic(url);
    } else {
      // Use generic youtube-dl-exec for other special platforms
      const info = await youtubeDl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        extractFlat: false,
      });

      const formats = [];

      if (info?.formats?.length) {
        info.formats.forEach((f, index) => {
          if (f.url) {
            formats.push({
              itag: String(index),
              quality: f.format_note || f.quality || 'Unknown',
              url: f.url,
              mimeType: f.ext === 'mp3' || f.acodec !== 'none' && f.vcodec === 'none' ? 'audio/mp3' : 'video/mp4',
              hasAudio: f.acodec !== 'none',
              hasVideo: f.vcodec !== 'none',
              isVideo: f.vcodec !== 'none',
              audioBitrate: f.abr || 0,
              videoCodec: f.vcodec || 'unknown',
              audioCodec: f.acodec || 'unknown',
              container: f.ext || 'mp4',
              contentLength: f.filesize || 0,
            });
          }
        });
      }

      raw = {
        success: true,
        data: {
          title: info.title || 'Media',
          thumbnail: info.thumbnail || '',
          duration: info.duration || null,
          source: platform,
          mediaType: info.duration ? 'video' : 'audio',
          formats,
        }
      };
    }

    const uni = normalize(platform, raw);
    uni.formats = validateFormats(uni.formats);

    if (!uni.formats.length) {
      return res.status(422).json({
        error: 'No playable media found',
        errorDetail: 'The URL was processed but produced no playable streams.',
        platform,
      });
    }

    res.json(uni);
  } catch (e) {
    res.status(500).json({
      error: 'Special media processing failed',
      errorDetail: String(e.message || e),
      platform
    });
  }
});
app.listen(port, () => {
  console.log(`✅ UniSaver backend listening on http://localhost:${port}`);
  console.log('Supported platforms: YouTube, Facebook, Instagram, TikTok, Twitter, Threads, Pinterest, Vimeo, Music');
});