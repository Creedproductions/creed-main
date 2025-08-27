// controllers/instagramController.js
// Enhanced Instagram controller with better error handling and playable media support

const snapsave = require('metadownloader');
const fs = require('fs');
const path = require('path');
const ytdlp = require('youtube-dl-exec');
const axios = require('axios');

function extFromUrl(url = '') {
  const u = url.toLowerCase();
  if (u.includes('.png') || u.includes('format=png')) return 'png';
  if (u.includes('.webp') || u.includes('format=webp')) return 'webp';
  if (u.includes('.jpg') || u.includes('.jpeg') || u.includes('format=jpg')) return 'jpg';
  if (u.includes('.mp4') || u.includes('format=mp4')) return 'mp4';
  if (u.includes('.m4v')) return 'm4v';

  // Check for Instagram CDN patterns
  if (u.includes('cdninstagram.com') && u.includes('video')) return 'mp4';
  if (u.includes('cdninstagram.com') && u.includes('photo')) return 'jpg';
  if (u.includes('fbcdn.net') && u.includes('video')) return 'mp4';

  return 'mp4'; // Default for Instagram videos
}

function isVideoUrl(url = '') {
  const u = url.toLowerCase();
  return u.includes('video') ||
         u.includes('.mp4') ||
         u.includes('.m4v') ||
         u.includes('format=mp4') ||
         (!u.includes('photo') && !u.includes('.jpg') && !u.includes('.png') && !u.includes('.webp'));
}

function collectUrlsFromResponse(raw) {
  const urls = new Set();

  function extractUrls(obj) {
    if (!obj) return;

    if (typeof obj === 'string') {
      if (/^https?:\/\//i.test(obj)) {
        // Check if it's a media URL
        if (obj.includes('cdninstagram.com') ||
            obj.includes('fbcdn.net') ||
            obj.includes('scontent') ||
            /\.(mp4|m4v|jpg|jpeg|png|webp)(\?|#|$)/i.test(obj)) {
          urls.add(obj);
        }
      }
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach(extractUrls);
    } else if (typeof obj === 'object') {
      // Look for specific Instagram API fields
      if (obj.video_url) urls.add(obj.video_url);
      if (obj.display_url) urls.add(obj.display_url);
      if (obj.src) urls.add(obj.src);
      if (obj.url) urls.add(obj.url);

      // Recursively check all values
      Object.values(obj).forEach(extractUrls);
    }
  }

  extractUrls(raw);
  return Array.from(urls).filter(url => url && url.length > 10);
}

function determineMediaType(urls) {
  if (!urls || urls.length === 0) return 'unknown';

  const hasVideo = urls.some(url => isVideoUrl(url));
  const hasImage = urls.some(url => !isVideoUrl(url));

  if (hasVideo && hasImage) return 'mixed';
  if (hasVideo) return 'video';
  if (hasImage) return 'image';
  return 'unknown';
}

function extractTitle(raw, fallback = 'Instagram Media') {
  if (!raw) return fallback;

  // Try different possible title fields
  const possibleTitles = [
    raw.title,
    raw.caption,
    raw.edge_media_to_caption?.edges?.[0]?.node?.text,
    raw.accessibility_caption,
    raw.alt_text
  ];

  for (const title of possibleTitles) {
    if (title && typeof title === 'string' && title.trim()) {
      return title.trim().substring(0, 100); // Limit length
    }
  }

  // Try from nested structures
  if (Array.isArray(raw) && raw[0]) {
    return extractTitle(raw[0], fallback);
  }

  return fallback;
}

function extractThumbnail(raw) {
  if (!raw) return '';

  const possibleThumbs = [
    raw.thumbnail,
    raw.thumbnail_url,
    raw.display_url,
    raw.image,
    raw.src
  ];

  for (const thumb of possibleThumbs) {
    if (thumb && typeof thumb === 'string' && thumb.startsWith('http')) {
      return thumb;
    }
  }

  if (Array.isArray(raw) && raw[0]) {
    return extractThumbnail(raw[0]);
  }

  return '';
}

function getCookieString() {
  return (process.env.IG_COOKIE_STRING || '').trim() || null;
}

function ensureCookieFile() {
  const configured = process.env.IG_COOKIES_FILE;
  if (configured && fs.existsSync(configured)) return configured;

  const cookieStr = getCookieString();
  if (!cookieStr) return null;

  const tmp = path.join('/tmp', `ig_cookies_${Date.now()}.txt`);
  const lines = [
    '# Netscape HTTP Cookie File',
    '# Generated from IG_COOKIE_STRING',
  ];

  cookieStr.split(';').forEach(pair => {
    const cleanPair = pair.trim();
    const [key, ...valueParts] = cleanPair.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=');
      lines.push(`.instagram.com\tTRUE\t/\tFALSE\t0\t${key}\t${value}`);
    }
  });

  fs.writeFileSync(tmp, lines.join('\n'));
  return tmp;
}

async function tryMetadownloader(url) {
  try {
    console.log('Trying metadownloader for:', url);
    const raw = await snapsave(url);
    const urls = collectUrlsFromResponse(raw);

    if (!urls.length) {
      console.log('Metadownloader: No URLs found');
      return null;
    }

    console.log(`Metadownloader: Found ${urls.length} URLs`);

    return {
      title: extractTitle(raw),
      thumbnail: extractThumbnail(raw),
      urls: urls,
      mediaType: determineMediaType(urls)
    };
  } catch (error) {
    console.log('Metadownloader failed:', error.message);
    return null;
  }
}

async function tryInstagramAPI(url) {
  try {
    console.log('Trying Instagram API for:', url);

    // Extract shortcode from URL
    const shortcodeMatch = url.match(/(?:instagram\.com\/(?:p|reel|tv)\/|instagram\.com\/stories\/[^\/]+\/)([A-Za-z0-9_\-]+)/);
    if (!shortcodeMatch) {
      console.log('Could not extract shortcode from URL');
      return null;
    }

    const shortcode = shortcodeMatch[1];
    console.log('Extracted shortcode:', shortcode);

    const headers = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0',
      'X-IG-App-ID': '936619743392459'
    };

    const cookieStr = getCookieString();
    if (cookieStr) {
      headers['Cookie'] = cookieStr;
    }

    // Try the GraphQL endpoint
    const apiUrl = `https://www.instagram.com/api/v1/media/${shortcode}/info/`;

    try {
      const response = await axios.get(apiUrl, {
        headers,
        timeout: 15000,
        maxRedirects: 3
      });

      const urls = collectUrlsFromResponse(response.data);
      if (urls.length > 0) {
        console.log(`Instagram API: Found ${urls.length} URLs`);
        return {
          title: extractTitle(response.data),
          thumbnail: extractThumbnail(response.data),
          urls: urls,
          mediaType: determineMediaType(urls)
        };
      }
    } catch (apiError) {
      console.log('Instagram API call failed:', apiError.message);
    }

    // Fallback: Try scraping the page directly
    const pageUrl = `https://www.instagram.com/p/${shortcode}/`;
    const pageResponse = await axios.get(pageUrl, {
      headers: {
        ...headers,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 20000
    });

    // Extract JSON data from the page
    const jsonMatches = pageResponse.data.match(/window\._sharedData\s*=\s*({.+?});/) ||
                       pageResponse.data.match(/{"config":.+?"graphql":.+?}(?=;<\/script>)/);

    if (jsonMatches) {
      try {
        const jsonData = JSON.parse(jsonMatches[1] || jsonMatches[0]);
        const urls = collectUrlsFromResponse(jsonData);

        if (urls.length > 0) {
          console.log(`Instagram page scraping: Found ${urls.length} URLs`);
          return {
            title: extractTitle(jsonData),
            thumbnail: extractThumbnail(jsonData),
            urls: urls,
            mediaType: determineMediaType(urls)
          };
        }
      } catch (parseError) {
        console.log('Failed to parse Instagram page JSON:', parseError.message);
      }
    }

    return null;
  } catch (error) {
    console.log('Instagram API method failed:', error.message);
    return null;
  }
}

async function tryYtDlp(url) {
  const cookieFile = ensureCookieFile();

  try {
    console.log('Trying yt-dlp for:', url);

    const options = {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      referer: 'https://www.instagram.com/',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
      timeout: 30
    };

    if (cookieFile) {
      options.cookies = cookieFile;
    }

    const info = await ytdlp(url, options);

    const urls = new Set();

    // Collect URLs from different fields
    if (info.url) urls.add(info.url);
    if (info.formats && Array.isArray(info.formats)) {
      info.formats.forEach(format => {
        if (format.url) urls.add(format.url);
      });
    }

    if (urls.size === 0) {
      console.log('yt-dlp: No URLs found in response');
      return null;
    }

    const urlArray = Array.from(urls);
    console.log(`yt-dlp: Found ${urlArray.length} URLs`);

    return {
      title: info.title || info.fulltitle || 'Instagram Media',
      thumbnail: info.thumbnail || '',
      urls: urlArray,
      mediaType: determineMediaType(urlArray),
      duration: info.duration || null
    };

  } catch (error) {
    const errorMsg = error.message || String(error);
    console.log('yt-dlp failed:', errorMsg);

    if (errorMsg.includes('Sign in to confirm') ||
        errorMsg.includes('private') ||
        errorMsg.includes('login_required')) {
      throw new Error(
        'This Instagram content requires authentication. Please set IG_COOKIE_STRING or IG_COOKIES_FILE environment variable with valid Instagram cookies.'
      );
    }

    throw new Error(`Instagram download failed: ${errorMsg}`);
  } finally {
    // Clean up temporary cookie file
    if (cookieFile && cookieFile.startsWith('/tmp/ig_cookies_') && fs.existsSync(cookieFile)) {
      fs.unlink(cookieFile, () => {});
    }
  }
}

async function downloadInstagramMedia(url) {
  console.log('Starting Instagram download for:', url);

  // Validate Instagram URL
  if (!url.includes('instagram.com')) {
    throw new Error('Invalid Instagram URL');
  }

  let result = null;
  let lastError = null;

  // Try methods in order of reliability
  const methods = [
    { name: 'metadownloader', fn: tryMetadownloader },
    { name: 'instagram-api', fn: tryInstagramAPI },
    { name: 'yt-dlp', fn: tryYtDlp }
  ];

  for (const method of methods) {
    try {
      console.log(`Attempting ${method.name}...`);
      result = await method.fn(url);

      if (result && result.urls && result.urls.length > 0) {
        console.log(`✓ ${method.name} succeeded with ${result.urls.length} URLs`);
        break;
      } else {
        console.log(`× ${method.name} returned no URLs`);
      }
    } catch (error) {
      console.log(`× ${method.name} failed:`, error.message);
      lastError = error;

      // If this is an authentication error, don't try other methods
      if (error.message.includes('authentication') ||
          error.message.includes('IG_COOKIE_STRING')) {
        throw error;
      }
    }
  }

  if (!result || !result.urls || result.urls.length === 0) {
    throw lastError || new Error('All Instagram download methods failed - no playable media found');
  }

  // Convert to the expected format
  const formats = result.urls.map((mediaUrl, index) => {
    const isVideo = isVideoUrl(mediaUrl);
    const ext = extFromUrl(mediaUrl);

    return {
      itag: String(index),
      quality: 'Original',
      url: mediaUrl, // This will be proxied by server.js through /api/direct
      mimeType: isVideo ? `video/${ext}` : `image/${ext}`,
      hasAudio: isVideo,
      hasVideo: isVideo,
      isVideo: isVideo,
      container: ext,
      contentLength: 0, // Will be determined by the proxy
      audioBitrate: isVideo ? 128 : 0,
      videoCodec: isVideo ? 'h264' : 'none',
      audioCodec: isVideo ? 'aac' : 'none'
    };
  });

  return {
    success: true,
    data: {
      platform: 'Instagram',
      title: result.title || 'Instagram Media',
      thumbnail: result.thumbnail || '',
      duration: result.duration || null,
      mediaType: result.mediaType || (formats.some(f => f.isVideo) ? 'video' : 'image'),
      formats: formats
    }
  };
}

module.exports = { downloadInstagramMedia };