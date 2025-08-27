// controllers/instagramController.js
// Complete Instagram controller that downloads actual playable media

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const youtubeDl = require('youtube-dl-exec');

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

// URL and media detection utilities
function extractUrlsFromData(data) {
    const urls = new Set();

    function traverse(obj, path = '') {
        if (!obj) return;

        if (typeof obj === 'string') {
            if (/^https?:\/\//i.test(obj) &&
                (obj.includes('cdninstagram.com') ||
                 obj.includes('fbcdn.net') ||
                 obj.includes('scontent') ||
                 /\.(mp4|m4v|jpg|jpeg|png|webp)(\?|#|$)/i.test(obj))) {
                urls.add(obj);
                console.log(`Found URL at ${path}: ${obj.substring(0, 80)}...`);
            }
            return;
        }

        if (Array.isArray(obj)) {
            obj.forEach((item, index) => traverse(item, `${path}[${index}]`));
        } else if (typeof obj === 'object') {
            // Check Instagram-specific API fields
            const mediaFields = ['video_url', 'display_url', 'src', 'url'];
            mediaFields.forEach(field => {
                if (obj[field] && typeof obj[field] === 'string') {
                    urls.add(obj[field]);
                    console.log(`Found ${field}: ${obj[field].substring(0, 80)}...`);
                }
            });

            Object.entries(obj).forEach(([key, value]) => {
                traverse(value, path ? `${path}.${key}` : key);
            });
        }
    }

    traverse(data);
    return Array.from(urls);
}

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

function extractMetadata(data) {
    let title = 'Instagram Media';
    let thumbnail = '';

    // Extract title from various possible locations
    const titleSources = [
        data?.caption?.text,
        data?.edge_media_to_caption?.edges?.[0]?.node?.text,
        data?.accessibility_caption,
        data?.alt_text,
        data?.title
    ];

    for (const source of titleSources) {
        if (source && typeof source === 'string' && source.trim()) {
            title = source.trim().substring(0, 100);
            break;
        }
    }

    // Extract thumbnail from various possible locations
    const thumbnailSources = [
        data?.thumbnail_url,
        data?.display_url,
        data?.image_versions2?.candidates?.[0]?.url,
        data?.thumbnail,
        data?.image
    ];

    for (const source of thumbnailSources) {
        if (source && typeof source === 'string' && source.startsWith('http')) {
            thumbnail = source;
            break;
        }
    }

    return { title, thumbnail };
}

// Method 1: Instagram API approach
async function tryInstagramAPI(url) {
    try {
        console.log('Attempting Instagram API method...');

        const shortcodeMatch = url.match(/(?:instagram\.com\/(?:p|reel|tv)\/|instagram\.com\/stories\/[^\/]+\/)([A-Za-z0-9_\-]+)/);
        if (!shortcodeMatch) {
            throw new Error('Could not extract shortcode from URL');
        }

        const shortcode = shortcodeMatch[1];
        console.log(`Extracted shortcode: ${shortcode}`);

        const baseHeaders = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'X-IG-App-ID': '936619743392459',
            'X-ASBD-ID': '129477',
            'X-IG-WWW-Claim': '0',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
        };

        const cookieStr = getCookieString();
        if (cookieStr) {
            baseHeaders['Cookie'] = cookieStr;
        }

        // Try multiple API endpoints
        const endpoints = [
            `https://www.instagram.com/api/v1/media/${shortcode}/info/`,
            `https://i.instagram.com/api/v1/media/${shortcode}/info/`,
            `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`
        ];

        for (const endpoint of endpoints) {
            try {
                console.log(`Trying API endpoint: ${endpoint}`);
                const response = await axios.get(endpoint, {
                    headers: baseHeaders,
                    timeout: 15000,
                    maxRedirects: 3
                });

                if (response.data) {
                    const urls = extractUrlsFromData(response.data);
                    if (urls.length > 0) {
                        console.log(`API method found ${urls.length} URLs`);
                        const metadata = extractMetadata(response.data);
                        return {
                            success: true,
                            urls,
                            title: metadata.title,
                            thumbnail: metadata.thumbnail,
                            method: 'instagram-api'
                        };
                    }
                }
            } catch (endpointError) {
                console.log(`API endpoint failed: ${endpoint} - ${endpointError.message}`);
                continue;
            }
        }

        return null;
    } catch (error) {
        console.log(`Instagram API method failed: ${error.message}`);
        return null;
    }
}

// Method 2: Page scraping approach
async function tryPageScraping(url) {
    try {
        console.log('Attempting page scraping method...');

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        };

        const cookieStr = getCookieString();
        if (cookieStr) {
            headers['Cookie'] = cookieStr;
        }

        const response = await axios.get(url, {
            headers,
            timeout: 20000
        });

        const html = response.data;

        // Extract JSON data from page
        const jsonPatterns = [
            /window\._sharedData\s*=\s*({.+?});/,
            /{"config":.+?"graphql":.+?}(?=;<\/script>)/,
            /"gql_data":\s*({.+?})/
        ];

        for (const pattern of jsonPatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                try {
                    const jsonData = JSON.parse(match[1]);
                    const urls = extractUrlsFromData(jsonData);

                    if (urls.length > 0) {
                        console.log(`Page scraping found ${urls.length} URLs`);
                        const metadata = extractMetadata(jsonData);
                        return {
                            success: true,
                            urls,
                            title: metadata.title,
                            thumbnail: metadata.thumbnail,
                            method: 'page-scraping'
                        };
                    }
                } catch (parseError) {
                    console.log(`Failed to parse JSON from page: ${parseError.message}`);
                    continue;
                }
            }
        }

        return null;
    } catch (error) {
        console.log(`Page scraping method failed: ${error.message}`);
        return null;
    }
}

// Method 3: yt-dlp approach
async function tryYtDlp(url) {
    const cookieFile = ensureCookieFile();

    try {
        console.log('Attempting yt-dlp method...');

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

        const info = await youtubeDl(url, options);

        // Extract URLs from yt-dlp response
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
        console.log(`yt-dlp method found ${urlArray.length} URLs`);

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
        console.log(`yt-dlp method failed: ${errorMsg}`);

        if (errorMsg.includes('Sign in to confirm') ||
            errorMsg.includes('private') ||
            errorMsg.includes('login_required')) {
            throw new Error(
                'This Instagram content requires authentication. Please set IG_COOKIE_STRING environment variable with valid Instagram cookies from your browser.'
            );
        }

        throw error;
    } finally {
        if (cookieFile && cookieFile.startsWith('/tmp/ig_cookies_') && fs.existsSync(cookieFile)) {
            fs.unlink(cookieFile, () => {});
        }
    }
}

// Main extraction function
async function downloadInstagramMedia(url) {
    console.log(`Starting Instagram extraction for: ${url}`);

    if (!url.includes('instagram.com')) {
        throw new Error('Invalid Instagram URL');
    }

    let result = null;
    let lastError = null;

    // Try methods in order of reliability
    const methods = [
        { name: 'Instagram API', fn: tryInstagramAPI },
        { name: 'Page Scraping', fn: tryPageScraping },
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

            // If this is an auth error from yt-dlp, don't try other methods
            if (error.message.includes('authentication') ||
                error.message.includes('IG_COOKIE_STRING')) {
                throw error;
            }
        }
    }

    if (!result || !result.urls || result.urls.length === 0) {
        throw lastError || new Error('All Instagram extraction methods failed - no playable media found');
    }

    // Process URLs and create format objects
    const formats = result.urls.map((mediaUrl, index) => {
        const isVideo = isVideoUrl(mediaUrl);
        const ext = getMediaExtension(mediaUrl);

        return {
            itag: `ig_${index}`,
            quality: 'Original',
            mimeType: isVideo ? `video/${ext}` : `image/${ext}`,
            url: mediaUrl, // Raw URL - will be proxied by server
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