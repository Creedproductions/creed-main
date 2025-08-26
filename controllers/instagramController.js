// controllers/instagramController.js
// Tries lightweight extractors first; supports cookies for private/limited content.
// Always returns proxied, playable URLs in formats[].url

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const youtubeDl = require('youtube-dl-exec'); // wraps yt-dlp if present
const { igdl } = require('btch-downloader');

function makeProxy(mediaUrl, title = 'Instagram', ext = 'mp4') {
  const safe = String(title || 'Instagram').replace(/[^\w\-]+/g, '_').slice(0, 60);
  return `/api/direct?url=${encodeURIComponent(mediaUrl)}&referer=instagram.com&filename=${encodeURIComponent(safe)}.${ext}`;
}

function getCookieString() {
  // Preferred: one-liner cookie string (e.g. "sessionid=...; ds_user_id=...; csrftoken=...")
  if (process.env.IG_COOKIE_STRING && process.env.IG_COOKIE_STRING.trim()) {
    return process.env.IG_COOKIE_STRING.trim();
  }
  return null;
}

function ensureCookieFile() {
  // Alternative: full Netscape cookie file path via IG_COOKIES_FILE
  const file = process.env.IG_COOKIES_FILE;
  if (file && fs.existsSync(file)) return file;

  // Or write a minimal cookie file from IG_COOKIE_STRING (best effort)
  const cookieStr = getCookieString();
  if (!cookieStr) return null;

  const tmp = path.join('/tmp', `ig_cookies_${Date.now()}.txt`);
  const lines = [
    '# Netscape HTTP Cookie File',
    '# This file was generated from IG_COOKIE_STRING',
  ];
  // Convert "a=b; c=d" into lines: .instagram.com TRUE / FALSE 0 a b
  cookieStr.split(';').map(s => s.trim()).forEach(pair => {
    const [k, ...rest] = pair.split('=');
    if (!k || !rest.length) return;
    const v = rest.join('=');
    lines.push(`.instagram.com\tTRUE\t/\tFALSE\t0\t${k}\t${v}`);
  });
  fs.writeFileSync(tmp, lines.join('\n'));
  return tmp;
}

function normalizeFormats(title, urls) {
  // Map a list of direct media URLs into your app’s expected shape (all proxied)
  const unique = Array.from(new Set(urls.filter(Boolean)));
  const formats = unique.map((u, i) => {
    const isImage = /\.(jpe?g|png|webp)(\?|#|$)/i.test(u);
    const ext = isImage ? (u.toLowerCase().includes('.png') ? 'png' : 'jpg') : 'mp4';
    return {
      itag: String(i),
      quality: isImage ? 'Original Image' : 'Original Quality',
      url: makeProxy(u, title, ext),
      mimeType: isImage ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'video/mp4',
      hasAudio: !isImage,
      hasVideo: !isImage,
      isVideo: !isImage,
      container: ext,
      contentLength: 0,
    };
  });
  return formats;
}

// Try simple extractor first
async function tryIgdl(url) {
  try {
    const data = await igdl(url);
    if (Array.isArray(data) && data.length) {
      const first = data[0];
      const title = (first?.title || first?.wm || 'Instagram').toString();
      const urls = data.map(d => d?.url).filter(Boolean);
      const thumb = first?.thumbnail || first?.thumb || '';
      return {
        title,
        thumbnail: thumb,
        urls
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Fallback: HTML scrape (works for many public posts without login)
async function tryHtml(url) {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': 'https://www.instagram.com/',
    };
    const cookie = getCookieString();
    if (cookie) headers['Cookie'] = cookie;

    const res = await axios.get(url, { headers, timeout: 20000 });
    const html = res.data || '';

    const urls = [];
    // Common meta tags
    const ogVid = html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/i);
    if (ogVid && ogVid[1]) urls.push(ogVid[1].replace(/&amp;/g, '&'));

    const ogImg = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    if (ogImg && ogImg[1]) urls.push(ogImg[1].replace(/&amp;/g, '&'));

    // JSON blobs sometimes include "video_url" or "display_url"
    const jMatches = html.match(/"video_url":"([^"]+)"/g) || [];
    jMatches.forEach(m => {
      const u = m.split('"video_url":"')[1].replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/\\\//g, '/');
      urls.push(u);
    });
    const iMatches = html.match(/"display_url":"([^"]+)"/g) || [];
    iMatches.forEach(m => {
      const u = m.split('"display_url":"')[1].replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/\\\//g, '/');
      urls.push(u);
    });

    // Title
    let title = 'Instagram';
    const t1 = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    if (t1 && t1[1]) title = t1[1];

    const thumb = ogImg ? ogImg[1] : '';

    const uniq = Array.from(new Set(urls.filter(Boolean)));
    if (!uniq.length) return null;

    return { title, thumbnail: thumb, urls: uniq };
  } catch {
    return null;
  }
}

// Final fallback: yt-dlp with cookies when required
async function tryYtdlp(url) {
  const cookieFile = ensureCookieFile();
  try {
    const info = await youtubeDl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      referer: 'https://www.instagram.com/',
      "user-agent": 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      cookies: cookieFile || undefined, // --cookies <file>
      timeout: 30000,
    });

    const urls = [];
    if (info?.url) urls.push(info.url);
    if (Array.isArray(info?.formats)) {
      info.formats.forEach(f => { if (f?.url) urls.push(f.url); });
    }
    const title = info?.title || 'Instagram';
    const thumb = info?.thumbnail || '';

    const uniq = Array.from(new Set(urls.filter(Boolean)));
    if (!uniq.length) return null;

    return { title, thumbnail: thumb, urls: uniq };
  } catch (e) {
    // surface the typical login hint for clarity
    throw new Error(
      "Instagram download failed: " +
      (e?.message || e) +
      (cookieFile ? "" : " | Hint: set IG_COOKIE_STRING or IG_COOKIES_FILE in env for private/limited posts.")
    );
  } finally {
    if (cookieFile && cookieFile.startsWith('/tmp/ig_cookies_') && fs.existsSync(cookieFile)) {
      fs.unlink(cookieFile, () => {});
    }
  }
}

async function downloadInstagramMedia(url) {
  // 1) fast extractor
  const quick = await tryIgdl(url);
  if (quick?.urls?.length) {
    const formats = normalizeFormats(quick.title, quick.urls);
    return {
      success: true,
      data: {
        title: quick.title,
        url: formats[0].url,
        thumbnail: quick.thumbnail || '',
        quality: formats[0].quality,
        source: 'instagram',
        mediaType: /\.(jpe?g|png|webp)(\?|#|$)/i.test(quick.urls[0]) ? 'image' : 'video',
        formats,
      }
    };
  }

  // 2) html (public)
  const html = await tryHtml(url);
  if (html?.urls?.length) {
    const formats = normalizeFormats(html.title, html.urls);
    return {
      success: true,
      data: {
        title: html.title,
        url: formats[0].url,
        thumbnail: html.thumbnail || '',
        quality: formats[0].quality,
        source: 'instagram',
        mediaType: /\.(jpe?g|png|webp)(\?|#|$)/i.test(html.urls[0]) ? 'image' : 'video',
        formats,
      }
    };
  }

  // 3) yt-dlp (with cookies if provided)
  const ytdlp = await tryYtdlp(url);
  if (ytdlp?.urls?.length) {
    const formats = normalizeFormats(ytdlp.title, ytdlp.urls);
    return {
      success: true,
      data: {
        title: ytdlp.title,
        url: formats[0].url,
        thumbnail: ytdlp.thumbnail || '',
        quality: formats[0].quality,
        source: 'instagram',
        mediaType: /\.(jpe?g|png|webp)(\?|#|$)/i.test(ytdlp.urls[0]) ? 'image' : 'video',
        formats,
      }
    };
  }

  throw new Error("Instagram download failed: No playable media found");
}

module.exports = { downloadInstagramMedia };
