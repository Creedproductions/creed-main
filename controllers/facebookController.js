// controllers/facebookController.js
// Uses "btch-downloader" for Facebook video downloads and returns only playable MP4 links.
const { fbdown } = require("btch-downloader");
const { shortenUrl } = require("../utils/urlShortener");

async function downloadFacebookVideo(url) {
  try {
    const result = await fbdown(url);

    if (!result || !result.result || !Array.isArray(result.result) || result.result.length === 0) {
      throw new Error("No downloadable links found for this Facebook video");
    }

    // Extract title and clean HTML entities
    const titleRaw = result.title || result.result[0]?.title || "Facebook Video";
    const title = titleRaw
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .trim() || "Facebook Video";

    // Get best quality link (usually first in array)
    const best = result.result[0];
    const bestShort = await shortenUrl(best.url);

    // Build formats array
    const formats = [];
    for (let i = 0; i < result.result.length; i++) {
      const link = result.result[i];
      const sUrl = await shortenUrl(link.url);
      formats.push({
        itag: String(i),
        quality: link.quality || link.resolution || "Unknown",
        url: sUrl,
        mimeType: "video/mp4",
        hasAudio: true,
        hasVideo: true,
        contentLength: 0,
      });
    }

    return {
      success: true,
      data: {
        title,
        url: bestShort,
        thumbnail: result.thumbnail || best.thumbnail || "https://via.placeholder.com/300x150",
        quality: best.quality || best.resolution || "Best Available",
        duration: result.duration || null,
        source: "facebook",
        formats,
      },
    };
  } catch (error) {
    console.error("Facebook download error:", error);
    throw new Error(`Failed to download Facebook video: ${error.message}`);
  }
}

// Alternative implementation using herxa-media-downloader as fallback
async function downloadFacebookVideoAlternative(url) {
  try {
    const { ndown } = require("herxa-media-downloader");
    const result = await ndown(url);

    if (!result || !result.status || !Array.isArray(result.data) || result.data.length === 0) {
      throw new Error("No downloadable links found for this Facebook video");
    }

    const titleRaw = result.title || "Facebook Video";
    const title = titleRaw
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .trim() || "Facebook Video";

    const best = result.data[0];
    const bestShort = await shortenUrl(best.url);

    const formats = [];
    for (let i = 0; i < result.data.length; i++) {
      const link = result.data[i];
      const sUrl = await shortenUrl(link.url);
      formats.push({
        itag: String(i),
        quality: link.resolution || "Unknown",
        url: sUrl,
        mimeType: "video/mp4",
        hasAudio: true,
        hasVideo: true,
        contentLength: 0,
      });
    }

    return {
      success: true,
      data: {
        title,
        url: bestShort,
        thumbnail: result.thumbnail || best.thumbnail || "https://via.placeholder.com/300x150",
        quality: best.resolution || "Best Available",
        duration: result.duration || null,
        source: "facebook",
        formats,
      },
    };
  } catch (error) {
    console.error("Facebook alternative download error:", error);
    throw new Error(`Failed to download Facebook video with alternative method: ${error.message}`);
  }
}

// Main function with fallback logic
async function downloadFacebookVideoWithFallback(url) {
  try {
    // Try primary method first
    return await downloadFacebookVideo(url);
  } catch (primaryError) {
    console.log("Primary method failed, trying alternative...");
    try {
      // Try alternative method
      return await downloadFacebookVideoAlternative(url);
    } catch (alternativeError) {
      console.error("Both methods failed:", {
        primary: primaryError.message,
        alternative: alternativeError.message
      });
      throw new Error("All Facebook download methods failed");
    }
  }
}

module.exports = {
  downloadFacebookVideo: downloadFacebookVideoWithFallback,
  downloadFacebookVideoPrimary: downloadFacebookVideo,
  downloadFacebookVideoAlternative: downloadFacebookVideoAlternative
};