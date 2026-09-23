#!/usr/bin/env node
// Writes (or with --check, verifies) each page's Content-Security-Policy
// <meta>. GitHub Pages can't send response headers, so the policy lives in
// the page itself, and inline <script> blocks are allowed by their SHA-256
// hash. Any edit to an inline script changes its hash: run
// `node scripts/csp.js` afterwards (verify-site.sh fails until you do).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');

const DATA_HOSTS = [
  'https://nowcoast.noaa.gov',
  'https://mesonet.agron.iastate.edu',
  'https://mapservices.weather.noaa.gov',
  'https://tiles.openfreemap.org'
];

function policy(hashes) {
  return [
    "default-src 'self'",
    `script-src 'self' https://cdn.jsdelivr.net ${hashes.map(h => `'sha256-${h}'`).join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    `img-src 'self' data: blob: ${DATA_HOSTS.join(' ')}`,
    `connect-src 'self' https://api.weather.gov https://photon.komoot.io https://api.open-meteo.com ${DATA_HOSTS.join(' ')}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "font-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');
}

const META_RE = /<meta http-equiv="Content-Security-Policy" content="[^"]*">\n\s*/;
let stale = [];
for (const name of fs.readdirSync(root).filter(n => n.endsWith('.html')).sort()) {
  const file = path.join(root, name);
  const source = fs.readFileSync(file, 'utf8');
  const hashes = [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => crypto.createHash('sha256').update(m[1], 'utf8').digest('base64'));
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy([...new Set(hashes)])}">`;
  // Directly after <meta charset> (which must stay in the first 1024 bytes)
  // and before any script, so it governs the inline theme script too.
  const without = source.replace(META_RE, '');
  const updated = without.replace(/(<meta charset="utf-8">\n)(\s*)/, (m, charset, indent) => `${charset}${indent}${meta}\n${indent}`);
  if (updated === source) continue;
  if (check) stale.push(name);
  else fs.writeFileSync(file, updated);
}
if (stale.length) {
  console.error(`Content-Security-Policy is out of date in: ${stale.join(', ')}. Run: node scripts/csp.js`);
  process.exit(1);
}
