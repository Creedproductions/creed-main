// controllers/vimeoController.js
const fetch = require('node-fetch');

async function downloadVimeoMedia(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Vimeo fetch failed: ${r.status}`);
  const html = await r.text();

  const title = (html.match(/<meta property="og:title" content="([^"]+)"/i) || [])[1] || 'Vimeo Video';
  const thumb = (html.match(/<meta property="og:image" content="([^"]+)"/i) || [])[1];

  const conf = (html.match(/var config = ({.*?});/s) || [])[1];
  if (conf) {
    const config = JSON.parse(conf.replace(/'/g, '"'));
    const prog = config?.video?.play?.progressive || [];
    if (Array.isArray(prog) && prog.length) {
      prog.sort((a, b) => (b.height || 0) - (a.height || 0));
      const best = prog[0];
      return {
        success: true,
        data: {
          title,
          url: best.url,
          thumbnail: thumb || 'https://via.placeholder.com/300x150',
          sizes: [`${best.height || 'Original'}p`],
          source: 'vimeo',
        },
      };
    }
  }
  // fallback to og:video if present
  const ogV = (html.match(/<meta property="og:video" content="([^"]+)"/i) || [])[1];
  if (ogV) {
    return { success: true, data: { title, url: ogV, thumbnail: thumb, sizes: ['Original Quality'], source: 'vimeo' } };
  }
  throw new Error('No downloadable Vimeo media found');
}

module.exports = { downloadVimeoMedia };
