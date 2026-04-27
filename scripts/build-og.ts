/**
 * Generates public/og-default.png — the social-card image used when the site
 * is shared on Slack/iMessage/Twitter/etc. 1200×630 (the standard OG ratio).
 *
 * Run via: npm run build:og
 */

import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(SCRIPT_DIR, '..', 'public', 'og-default.png');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#faf7f1"/>

  <!-- Top + bottom rules -->
  <rect x="80" y="80" width="1040" height="2" fill="#0a0908"/>
  <rect x="80" y="548" width="1040" height="2" fill="#0a0908"/>

  <!-- Issue label, top-left -->
  <text x="80" y="124"
        font-family="-apple-system, 'Segoe UI', sans-serif"
        font-size="20" letter-spacing="3.5" fill="#0a0908" font-weight="500">
    AN EDITORIAL  ·  EST. 2025
  </text>

  <!-- "The" italic small above wordmark -->
  <text x="600" y="280"
        text-anchor="middle"
        font-family="'Bodoni 72','Bodoni Moda','Didot',Georgia,serif"
        font-style="italic" font-weight="400"
        font-size="56" fill="#5a5147">
    The
  </text>

  <!-- Wordmark -->
  <text x="600" y="400"
        text-anchor="middle"
        font-family="'Bodoni 72','Bodoni Moda','Didot',Georgia,serif"
        font-weight="700"
        font-size="128" fill="#0a0908"
        letter-spacing="-3">
    Last Romantic<tspan fill="#a8132a">.</tspan>
  </text>

  <!-- Series listing -->
  <text x="600" y="478"
        text-anchor="middle"
        font-family="-apple-system, 'Segoe UI', sans-serif"
        font-size="20" letter-spacing="4" fill="#0a0908" font-weight="500">
    MEMOIR  ·  BOURDAINISM  ·  THE FOUR C&apos;S  ·  ESSAYS &amp; LETTERS
  </text>

  <!-- Byline -->
  <text x="1120" y="600"
        text-anchor="end"
        font-family="'Bodoni 72','Bodoni Moda','Didot',Georgia,serif"
        font-style="italic" font-weight="400"
        font-size="22" fill="#0a0908">
    by Suki Song
  </text>

  <!-- URL, bottom-left -->
  <text x="80" y="600"
        font-family="-apple-system, 'Segoe UI', sans-serif"
        font-size="18" letter-spacing="2.5" fill="#5a5147" font-weight="500">
    THELASTROMANTIC.CO
  </text>
</svg>
`;

await sharp(Buffer.from(svg))
  .png()
  .toFile(OUT);

console.log(`Wrote ${OUT}`);
