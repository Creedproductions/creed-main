// controllers/instagramController.js
// Simple Instagram controller using metadownloader only

const metadownloader = require('metadownloader');

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

async function downloadInstagramMedia(url) {
    console.log(`Starting Instagram extraction with metadownloader for: ${url}`);

    if (!url.includes('instagram.com')) {
        throw new Error('Invalid Instagram URL');
    }

    try {
        console.log('Using metadownloader...');
        const data = await metadownloader(url);

        if (!data) {
            throw new Error('No data returned from metadownloader');
        }

        console.log('Metadownloader response:', JSON.stringify(data, null, 2));

        let urls = [];
        let title = 'Instagram Media';
        let thumbnail = '';

        // Handle metadownloader response format
        if (data.status === true && data.data && Array.isArray(data.data)) {
            // New metadownloader format: { status: true, data: [{ url: "...", thumbnail: "..." }] }
            data.data.forEach(item => {
                if (item.url) urls.push(item.url);
                if (item.thumbnail && !thumbnail) thumbnail = item.thumbnail;
            });

            // Try to extract a better title from the URL
            const shortcodeMatch = url.match(/(?:p|reel|tv)\/([A-Za-z0-9_\-]+)/);
            if (shortcodeMatch) {
                title = `Instagram_${shortcodeMatch[1]}`;
            }

            console.log(`Metadownloader found ${urls.length} URLs with new format`);
        }
        else if (data.media && Array.isArray(data.media)) {
            // Old format: { media: [{ url: "...", type: "video/image" }], title: "...", thumbnail: "..." }
            urls = data.media.map(item => item.url).filter(Boolean);
            title = data.title || title;
            thumbnail = data.thumbnail || '';
        }
        else if (data.url) {
            // Format: { url: "...", title: "...", thumbnail: "..." }
            urls = [data.url];
            title = data.title || title;
            thumbnail = data.thumbnail || '';
        }
        else if (Array.isArray(data)) {
            // Format: [{ url: "..." }, ...]
            urls = data.map(item => item.url || item).filter(Boolean);
        }
        else if (typeof data === 'string') {
            // Direct URL string
            urls = [data];
        }
        else {
            // Try to extract URLs from any other format
            const extractUrls = (obj) => {
                const found = [];
                if (typeof obj === 'string' && obj.startsWith('http')) {
                    found.push(obj);
                } else if (Array.isArray(obj)) {
                    obj.forEach(item => found.push(...extractUrls(item)));
                } else if (typeof obj === 'object' && obj !== null) {
                    Object.values(obj).forEach(value => found.push(...extractUrls(value)));
                }
                return found;
            };
            urls = extractUrls(data);
        }

        if (!urls || urls.length === 0) {
            throw new Error('No media URLs found in metadownloader response');
        }

        console.log(`Metadownloader found ${urls.length} URLs`);
        console.log('URLs:', urls.map(u => u.substring(0, 100) + '...'));

        // Create format objects
        const formats = urls.map((mediaUrl, index) => {
            const isVideo = isVideoUrl(mediaUrl);
            const ext = getMediaExtension(mediaUrl);

            return {
                itag: `ig_${index}`,
                quality: 'Original',
                mimeType: isVideo ? `video/${ext}` : `image/${ext}`,
                url: mediaUrl, // This is the actual media URL from metadownloader
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

        console.log(`Instagram extraction complete: ${formats.length} formats, type: ${mediaType}`);

        return {
            success: true,
            data: {
                platform: 'Instagram',
                title: title,
                thumbnail: thumbnail,
                duration: null,
                mediaType: mediaType,
                formats: formats,
                extractedBy: 'metadownloader'
            }
        };

    } catch (error) {
        console.error('Metadownloader Instagram extraction failed:', error);
        throw new Error(`Instagram download failed: ${error.message}`);
    }
}

module.exports = { downloadInstagramMedia };