import sharp from 'sharp';
import { writeFileSync } from 'fs';

// Hamsun Inbox icon — WhatsApp-dark ground, gold chat bubble, "H." wordmark.
// maskable variant keeps everything inside the 80% safe zone.
const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#111b21"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)">
    <path d="M256 88c-97 0-176 70.4-176 157.3 0 49.6 25.9 93.8 66.3 122.6l-14.6 56.8 62.5-29.3c19.6 5 40.4 7.2 61.8 7.2 97 0 176-70.4 176-157.3S353 88 256 88z"
          fill="none" stroke="#d1a954" stroke-width="26" stroke-linejoin="round"/>
    <text x="238" y="292" font-family="Georgia, 'Times New Roman', serif" font-size="185"
          font-weight="bold" fill="#e9edef" text-anchor="middle">H</text>
    <circle cx="342" cy="272" r="17" fill="#d1a954"/>
  </g>
</svg>`;

const out = 'public/icons';
await sharp(Buffer.from(svg(0))).resize(192, 192).png().toFile(`${out}/icon-192.png`);
await sharp(Buffer.from(svg(0))).resize(512, 512).png().toFile(`${out}/icon-512.png`);
await sharp(Buffer.from(svg(0.22))).resize(512, 512).png().toFile(`${out}/icon-maskable-512.png`);
await sharp(Buffer.from(svg(0.06))).resize(180, 180).png().toFile(`${out}/apple-touch-icon.png`);
// small monochrome-ish badge for Android notification tray
const badge = `
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 512 512">
  <path d="M256 60c-108 0-196 78.4-196 175.2 0 55.2 28.8 104.5 73.8 136.5L117.5 435l69.6-32.6c21.8 5.6 45 8 68.9 8 108 0 196-78.4 196-175.2S364 60 256 60z" fill="#ffffff"/>
</svg>`;
await sharp(Buffer.from(badge)).resize(96, 96).png().toFile(`${out}/badge-96.png`);
console.log('icons written');
