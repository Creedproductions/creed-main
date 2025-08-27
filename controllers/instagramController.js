// controllers/instagramController.js
// Enhanced Instagram controller using multiple reliable packages

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const youtubeDl = require('youtube-dl-exec');

// Import specialized Instagram downloaders
let igdl, metadownloader, instagramDl;

try {
    const btchDownloader = require('btch-downloader');
    igdl = btchDownloader.igdl;
} catch (e) {
    console.warn('btch-downloader not available:', e.message);
}

try {
    metadownloader = require('metadownloader');
} catch (e) {
    console.warn('metadownloader not available:', e.message);
}

try {
    instagramDl = require('instagram-dl');
} catch (e) {
    console.warn('instagram-dl not available:', e.message);
}

// Instagram authentication helpers
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

// Utility functions
function isVideoUrl(url) {
    const u = url.toLowerCase();
    return u.includes('video') ||
           u.includes('.mp4') ||
           u.includes('.m4v') ||
           (!u.includes('photo') && !u.includes('.jpg') && !u.includes('.png') && !u.includes('.webp'));
}

function getMediaExtension(url) {
    const u = url.toLowerCase();
    if (u.includes('.mp4') || u.includes('video')) return 'mp4';
    if (u.includes('.png')) return 'png';
    if (u.includes('.webp')) return 'webp';
    if (u.includes('.jpg') || u.includes('.jpeg')) return 'jpg';
    return isVideoUrl(url) ? 'mp4' : 'jpg';
}

function extractUrlsFromData(data) {
    const urls = new Set();

    function traverse(obj) {
        if (!obj) return;

        if (typeof obj === 'string') {
            if (/^https?:\/\//i.test(obj) &&
                (obj.includes('cdninstagram.com') ||
                 obj.includes('fbcdn.net') ||
                 obj.includes('scontent') ||
                 /\.(mp4|m4v|jpg|jpeg|png|webp)(\?|#|$)/i.test(obj))) {
                urls.add(obj);
            }
            return;
        }

        if (Array.isArray(obj)) {
            obj.forEach(traverse);
        } else if (typeof obj === 'object') {
            // Check common Instagram fields
            const mediaFields = ['video_url', 'display_url', 'src', 'url'];
            mediaFields.forEach(field => {
                if (obj[field] && typeof obj[field] === 'string') {
                    urls.add(obj[field]);
                }
            });

            Object.values(obj).forEach(traverse);
        }
    }

    traverse(data);
    return Array.from(urls);
}

// Method 1: btch-downloader (most reliable for Instagram)
async function tryBtchDownloader(url) {
    if (!igdl) {
        console.log('btch-downloader not available, skipping');
        return null;
    }

    try {
        console.log('Attempting btch-downloader method...');
        const data = await igdl(url);

        if (data && Array.isArray(data) && data.length > 0) {
            const urls = data.map(item => item.url).filter(Boolean);

            if (urls.length > 0) {
                console.log(`btch-downloader found ${urls.length} URLs`);
                return {
                    success: true,
                    urls,
                    title: data[0]?.wm || 'Instagram Media',
                    thumbnail: data[0]?.thumbnail || '',
                    method: 'btch-downloader'
                };
            }
        }

        return null;
    } catch (error) {
        console.log(`btch-downloader failed: ${error.message}`);
        return null;
    }
}

// Method 2: metadownloader (good fallback)
async function tryMetadownloader(url) {
    if (!metadownloader) {
        console.log('metadownloader not available, skipping');
        return null;
    }

    try {
        console.log('Attempting metadownloader method...');
        const data = await metadownloader(url);

        if (data) {
            let urls = [];
            let title = 'Instagram Media';
            let thumbnail = '';

            // Handle different response formats
            if (data.media && Array.isArray(data.media)) {
                urls = data.media.map(item => item.url).filter(Boolean);
                title = data.title || title;
                thumbnail = data.thumbnail || '';
            } else {
                urls = extractUrlsFromData(data);
                if (data.title) title = data.title;
                if (data.thumbnail) thumbnail = data.thumbnail;
            }

            if (urls.length > 0) {
                console.log(`metadownloader found ${urls.length} URLs`);
                return {
                    success: true,
                    urls,
                    title,
                    thumbnail,
                    method: 'metadownloader'
                };
            }
        }

        return null;
    } catch (error) {
        console.log(`metadownloader failed: ${error.message}`);
        return null;
    }
}

// Method 3: instagram-dl package
async function tryInstagramDl(url) {
    if (!instagramDl) {
        console.log('instagram-dl not available, skipping');
        return null;
    }

    try {
        console.log('Attempting instagram-dl method...');
        const data = await instagramDl(url);

        if (data && data.url) {
            console.log('instagram-dl found media URL');
            return {
                success: true,
                urls: [data.url],
                title: data.title || 'Instagram Media',
                thumbnail: data.thumbnail || '',
                method: 'instagram-dl'
            };
        }

        return null;
    } catch (error) {
        console.log(`instagram-dl failed: ${error.message}`);
        return null;
    }
}

// Method 4: Direct API scraping (enhanced)
async function tryDirectAPI(url) {
    try {
        console.log('Attempting direct API method...');

        // Handle stories differently
        if (url.includes('/stories/')) {
            return await tryStoryExtraction(url);
        }

        const shortcodeMatch = url.match(/(?:instagram\.com\/(?:p|reel|tv)\/)([A-Za-z0-9_\-]+)/);
        if (!shortcodeMatch) {
            throw new Error('Could not extract shortcode from URL');
        }

        const shortcode = shortcodeMatch[1];
        console.log(`Extracted shortcode: ${shortcode}`);

        const headers = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'X-IG-App-ID': '936619743392459'
        };

        const cookieStr = getCookieString();
        if (cookieStr) {
            headers['Cookie'] = cookieStr;
        }

        // Try multiple endpoints
        const endpoints = [
            `https://www.instagram.com/api/v1/media/${shortcode}/info/`,
            `https://i.instagram.com/api/v1/media/${shortcode}/info/`,
            `https://www.instagram.com/p/${shortcode}/embed/captioned/`
        ];

        for (const endpoint of endpoints) {
            try {
                console.log(`Trying endpoint: ${endpoint}`);
                const response = await axios.get(endpoint, {
                    headers,
                    timeout: 15000
                });

                if (response.data) {
                    const urls = extractUrlsFromData(response.data);
                    if (urls.length > 0) {
                        console.log(`Direct API found ${urls.length} URLs`);
                        return {
                            success: true,
                            urls,
                            title: response.data.title || 'Instagram Media',
                            thumbnail: '',
                            method: 'direct-api'
                        };
                    }
                }
            } catch (endpointError) {
                console.log(`Endpoint failed: ${endpoint} - ${endpointError.message}`);
                continue;
            }
        }

        return null;
    } catch (error) {
        console.log(`Direct API method failed: ${error.message}`);
        return null;
    }
}

// Enhanced story extraction
async function tryStoryExtraction(url) {
    try {
        console.log('Attempting enhanced story extraction...');

        const headers = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
        };

        const cookieStr = getCookieString();
        if (cookieStr) {
            headers['Cookie'] = cookieStr;
        } else {
            console.log('Warning: No Instagram cookies - stories may require authentication');
            throw new Error('Instagram stories require authentication. Please set IG_COOKIE_STRING environment variable.');
        }

        const response = await axios.get(url, {
            headers,
            timeout: 20000
        });

        const html = response.data;

        // Enhanced story media extraction patterns
        const storyPatterns = [
            /"video_url":"([^"]+)"/g,
            /"display_url":"([^"]+)"/g,
            /https:\/\/scontent[^"'\s]*\.(?:mp4|jpg|png|webp)(?:\?[^"'\s]*)?/g,
            /https:\/\/[^"'\s]*fbcdn\.net[^"'\s]*\.(?:mp4|jpg|png|webp)(?:\?[^"'\s]*)?/g
        ];

        const urls = new Set();

        for (const pattern of storyPatterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                const mediaUrl = (match[1] || match[0]).replace(/\\u002F/g, '/').replace(/\\/g, '');
                if (mediaUrl && mediaUrl.startsWith('http')) {
                    urls.add(mediaUrl);
                    console.log(`Found story media: ${mediaUrl.substring(0, 80)}...`);
                }
            }
        }

        if (urls.size > 0) {
            return {
                success: true,
                urls: Array.from(urls),
                title: 'Instagram Story',
                thumbnail: '',
                method: 'story-extraction'
            };
        }

        return null;
    } catch (error) {
        console.log(`Story extraction failed: ${error.message}`);
        throw error;
    }
}

// Method 5: yt-dlp fallback (fixed options)
async function tryYtDlp(url) {
    const cookieFile = ensureCookieFile();

    try {
        console.log('Attempting yt-dlp method...');

        const options = {
            dumpSingleJson: true,
            noWarnings: true,
            noCheckCertificates: true,
            referer: 'https://www.instagram.com/',
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
        };

        if (cookieFile) {
            options.cookies = cookieFile;
        }

        const info = await youtubeDl(url, options);

        const urls = new Set();
        if (info.url) urls.add(info.url);
        if (info.formats && Array.isArray(info.formats)) {
            info.formats.forEach(format => {
                if (format.url) urls.add(format.url);
            });
        }

        if (urls.size === 0) {
            throw new Error('No URLs found in yt-dlp response');
        }

        const urlArray = Array.from(urls);
        console.log(`yt-dlp found ${urlArray.length} URLs`);

        return {
            success: true,
            urls: urlArray,
            title: info.title || info.fulltitle || 'Instagram Media',
            thumbnail: info.thumbnail || '',
            duration: info.duration || null,
            method: 'yt-dlp'
        };

    } catch (error) {
        const errorMsg = error.message || String(error);
        console.log(`yt-dlp failed: ${errorMsg}`);

        if (errorMsg.includes('Sign in to confirm') ||
            errorMsg.includes('private') ||
            errorMsg.includes('login_required')) {
            throw new Error(
                'This Instagram content requires authentication. Please set IG_COOKIE_STRING environment variable.'
            );
        }

        throw error;
    } finally {
        if (cookieFile && cookieFile.startsWith('/tmp/ig_cookies_') && fs.existsSync(cookieFile)) {
            fs.unlink(cookieFile, () => {});
        }
    }
}

// Main extraction function with multiple methods
async function downloadInstagramMedia(url) {
    console.log(`Starting Instagram extraction for: ${url}`);

    if (!url.includes('instagram.com')) {
        throw new Error('Invalid Instagram URL');
    }

    let result = null;
    let lastError = null;

    // Try methods in order of reliability
    const methods = [
        { name: 'btch-downloader', fn: tryBtchDownloader },
        { name: 'metadownloader', fn: tryMetadownloader },
        { name: 'instagram-dl', fn: tryInstagramDl },
        { name: 'direct-api', fn: tryDirectAPI },
        { name: 'yt-dlp', fn: tryYtDlp }
    ];

    for (const method of methods) {
        try {
            console.log(`Trying ${method.name}...`);
            result = await method.fn(url);

            if (result && result.urls && result.urls.length > 0) {
                console.log(`✓ ${method.name} succeeded with ${result.urls.length} URLs`);
                result.extractedBy = method.name;
                break;
            } else {
                console.log(`× ${method.name} returned no URLs`);
            }
        } catch (error) {
            console.log(`× ${method.name} failed: ${error.message}`);
            lastError = error;

            // For auth errors, stop trying other methods
            if (error.message.includes('authentication') ||
                error.message.includes('IG_COOKIE_STRING')) {
                throw error;
            }
        }
    }

    if (!result || !result.urls || result.urls.length === 0) {
        throw lastError || new Error('All Instagram extraction methods failed - no playable media found');
    }

    // Process URLs into format objects
    const formats = result.urls.map((mediaUrl, index) => {
        const isVideo = isVideoUrl(mediaUrl);
        const ext = getMediaExtension(mediaUrl);

        return {
            itag: `ig_${index}`,
            quality: 'Original',
            mimeType: isVideo ? `video/${ext}` : `image/${ext}`,
            url: mediaUrl,
            hasAudio: isVideo,
            hasVideo: isVideo,
            isVideo: isVideo,
            container: ext,
            contentLength: 0,
            audioBitrate: isVideo ? 128 : 0,
            videoCodec: isVideo ? 'h264' : 'none',
            audioCodec: isVideo ? 'aac' : 'none'
        };
    });

    // Determine media type
    const hasVideo = formats.some(f => f.isVideo);
    const hasImage = formats.some(f => !f.isVideo);
    let mediaType = 'unknown';

    if (hasVideo && hasImage) mediaType = 'mixed';
    else if (hasVideo) mediaType = 'video';
    else if (hasImage) mediaType = 'image';

    console.log(`Instagram extraction complete: ${formats.length} formats, type: ${mediaType}, method: ${result.extractedBy}`);

    return {
        success: true,
        data: {
            platform: 'Instagram',
            title: result.title || 'Instagram Media',
            thumbnail: result.thumbnail || '',
            duration: result.duration || null,
            mediaType: mediaType,
            formats: formats,
            extractedBy: result.extractedBy
        }
    };
}

module.exports = { downloadInstagramMedia };