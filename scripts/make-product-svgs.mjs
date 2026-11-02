// Generates self-made SVG product art (lipstick bullets, foundation bottles, dress
// silhouettes) for the fictional store, coloured with each product's shade.
// Run: node scripts/make-product-svgs.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { hexToLab, labToHex } from '../server/color/color.js';

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const outDir = new URL('../public/assets/products/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const shade = (hex, dL) => {
  const lab = hexToLab(hex);
  return labToHex({ ...lab, L: Math.max(0, Math.min(100, lab.L + dL)) });
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function lipstick(p) {
  const c = p.hex;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160" role="img" aria-label="${esc(p.productLine)} lipstick in ${esc(p.shadeName)}">
  <defs>
    <linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${shade(c, 10)}"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -14)}"/></linearGradient>
    <linearGradient id="m" x1="0" x2="1"><stop offset="0" stop-color="#e9e4dc"/><stop offset=".5" stop-color="#fbf9f5"/><stop offset="1" stop-color="#cfc8bd"/></linearGradient>
  </defs>
  <rect width="120" height="160" rx="14" fill="#f6f1ea"/>
  <path d="M46 40 L74 30 L74 80 L46 80 Z" fill="url(#g)"/>
  <rect x="42" y="78" width="36" height="16" rx="2" fill="url(#m)"/>
  <rect x="38" y="92" width="44" height="52" rx="4" fill="#2b2522"/>
  <rect x="41" y="96" width="4" height="44" rx="2" fill="#4a423d"/>
</svg>\n`;
}

function foundation(p) {
  const c = p.hex;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160" role="img" aria-label="${esc(p.productLine)} in shade ${esc(p.shadeName)}">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${shade(c, 6)}"/><stop offset=".6" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -10)}"/></linearGradient></defs>
  <rect width="120" height="160" rx="14" fill="#f6f1ea"/>
  <rect x="50" y="18" width="20" height="22" rx="3" fill="#2b2522"/>
  <rect x="44" y="38" width="32" height="10" rx="2" fill="#3b3430"/>
  <rect x="32" y="48" width="56" height="96" rx="10" fill="url(#g)"/>
  <rect x="32" y="48" width="56" height="96" rx="10" fill="none" stroke="#ffffff" stroke-opacity=".35"/>
  <text x="60" y="104" font-family="Georgia, serif" font-size="13" text-anchor="middle" fill="${hexToLab(c).L > 55 ? '#3b2f2a' : '#fbf6ef'}">${esc(p.shadeCode)}</text>
</svg>\n`;
}

function dress(p) {
  const c = p.hex;
  const wrap = p.style === 'wrap';
  const body = wrap
    ? 'M50 22 L42 24 L30 40 L36 47 L44 43 L47 58 L48 72 L36 128 L60 134 L84 128 L72 72 L73 58 L76 43 L84 47 L90 40 L78 24 L70 22 L60 52 Z'
    : 'M44 44 L52 40 L60 43 L68 40 L76 44 L74 72 L82 128 L60 134 L38 128 L46 72 Z';
  const straps = wrap ? '' : `<path d="M47 44 L50 22 M73 44 L70 22" stroke="${c}" stroke-width="2"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160" role="img" aria-label="${esc(p.productLine)} in ${esc(p.shadeName)}">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${shade(c, 8)}"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -12)}"/></linearGradient></defs>
  <rect width="120" height="160" rx="14" fill="#f6f1ea"/>
  <g transform="translate(0 6)">${straps}<path d="${body}" fill="url(#g)"/>${wrap ? `<path d="M73 72 L46 130" stroke="${shade(c, -16)}" stroke-width="1.2" opacity=".6"/><rect x="47" y="70" width="26" height="4" fill="${shade(c, -10)}"/>` : ''}</g>
</svg>\n`;
}

// Hair colour kit: a box with a lock of hair in the shade (drawn as flowing strands).
function hair(p) {
  const c = p.hex;
  const light = hexToLab(c).L > 60;
  const strands = [0, 1, 2, 3, 4]
    .map((i) => `<path d="M${44 + i * 7} 46 C ${38 + i * 7} 70, ${56 + i * 7} 86, ${46 + i * 7} 118" stroke="${shade(c, i % 2 ? 8 : -6)}" stroke-width="7" fill="none" stroke-linecap="round"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160" role="img" aria-label="${esc(p.productLine)} kit in ${esc(p.shadeName)}">
  <rect width="120" height="160" rx="14" fill="#f6f1ea"/>
  <rect x="24" y="22" width="72" height="120" rx="6" fill="#fbf9f5" stroke="#d9cfc3"/>
  <rect x="24" y="22" width="72" height="18" rx="6" fill="#2b2522"/>
  <text x="60" y="35" font-family="Georgia, serif" font-size="9" text-anchor="middle" fill="#fbf6ef">GLOSS</text>
  <rect x="32" y="44" width="56" height="78" rx="28" fill="${shade(c, light ? -4 : 10)}" opacity=".25"/>
  ${strands}
  <text x="60" y="134" font-family="Georgia, serif" font-size="10" text-anchor="middle" fill="#3b2f2a">${esc(p.shadeCode)}</text>
</svg>\n`;
}

// Moisturiser jar, tinted per texture variant.
function skincare(p) {
  const c = p.hex;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160" role="img" aria-label="${esc(p.productLine)}, ${esc(p.shadeName)}">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${shade(c, 4)}"/><stop offset=".6" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -8)}"/></linearGradient></defs>
  <rect width="120" height="160" rx="14" fill="#f6f1ea"/>
  <rect x="28" y="50" width="64" height="20" rx="6" fill="#2b2522"/>
  <rect x="24" y="68" width="72" height="66" rx="14" fill="url(#g)" stroke="#ffffff" stroke-opacity=".5"/>
  <text x="60" y="98" font-family="Georgia, serif" font-size="10" text-anchor="middle" fill="#3b2f2a">Cloud</text>
  <text x="60" y="114" font-family="Inter, Arial, sans-serif" font-size="8.5" text-anchor="middle" fill="#3b2f2a">${esc(p.shadeName.toUpperCase())}</text>
</svg>\n`;
}

const ART = { lipstick, foundation, dress, hair, skincare };

let n = 0;
for (const p of catalog.products) {
  const svg = ART[p.category](p);
  writeFileSync(new URL(`.${p.image.replace('/assets/products', '')}`, outDir), svg);
  n++;
}
// Store mark: a simple self-made wordmark tile (no real brand).
writeFileSync(
  new URL('../public/assets/logo.svg', import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Hue and Hem"><rect width="64" height="64" rx="16" fill="#2b2522"/><circle cx="26" cy="32" r="12" fill="#d98f7e"/><circle cx="38" cy="32" r="12" fill="#e8c9a0" fill-opacity=".85"/></svg>\n`,
);
console.log(`wrote ${n} product SVGs + logo`);
