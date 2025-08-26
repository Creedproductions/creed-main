// utils/check-dependencies.js
// Quick environment sanity check.
const { execSync } = require('child_process');

function check(cmd, ok) {
  try {
    execSync(cmd, { stdio: 'ignore' });
    console.log(`✔ ${ok}`);
  } catch {
    console.warn(`⚠ Missing: ${ok}`);
  }
}

console.log('Checking optional tools:');
check('ffmpeg -version', 'ffmpeg');
check('yt-dlp --version', 'yt-dlp (youtube-dl-exec can download it automatically)');

console.log('If yt-dlp is missing, the first run will download a local copy automatically.');
