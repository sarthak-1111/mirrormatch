// Generates data/catalog.json for the fictional demo store "Hue & Hem".
// Foundation shades are authored in CIE LCh so depth and undertone are controlled
// precisely; lipstick and garment colours are authored as hex. Undertone/temperature
// labels are computed with the same rules the matcher uses, so the catalogue is
// internally consistent. Run: node scripts/build-catalog.mjs
import { writeFileSync } from 'node:fs';
import { lchToLab, labToHex, hexToLab, labToLch } from '../server/color/color.js';

const round = (n) => Math.round(n * 10) / 10;

function lipUndertone(hex) {
  const { h } = labToLch(hexToLab(hex));
  if (h < 18 || h >= 340) return 'cool';
  if (h >= 35) return 'warm';
  return 'neutral';
}

function garmentTemperature(hex) {
  const { h, C } = labToLch(hexToLab(hex));
  if (C < 15) return 'neutral';
  if (h >= 25 && h < 110) return 'warm';
  if (h >= 150 && h < 330) return 'cool';
  return 'neutral';
}

const lipsticks = [
  ['L01', 'Shell', '#C99089', 'nude', 14],
  ['L02', 'Bare Honey', '#B97A5E', 'nude', 22],
  ['L03', 'Toffee', '#8F5743', 'nude', 18],
  ['L04', 'Rosewood', '#A5585E', 'rose', 25],
  ['L05', 'Mauve Mist', '#9A6575', 'rose', 16],
  ['L06', 'Coral Bay', '#DC6A55', 'coral', 20],
  ['L07', 'Terracotta', '#B0503A', 'coral', 12],
  ['L08', 'Classic Red', '#B5162F', 'red', 0],
  ['L09', 'Berry Hush', '#8C3656', 'berry', 19],
  ['L10', 'Plum Velvet', '#5C2840', 'berry', 11],
  ['L11', 'Cinnamon', '#7E4636', 'brown', 15],
].map(([code, name, hex, family, stock]) => ({
  id: `lip-${code.toLowerCase()}`,
  sku: `HH-VL-${code}`,
  category: 'lipstick',
  productLine: 'Velvet Lip Matte',
  shadeName: name,
  shadeCode: code,
  hex,
  family,
  undertone: lipUndertone(hex),
  finish: 'matte',
  price: 22,
  stock,
  image: `/assets/products/${code.toLowerCase()}.svg`,
}));

const LEVELS = [
  [1, 'Linen', 84, 13],
  [2, 'Ivory', 78, 16],
  [3, 'Sand', 71, 19],
  [4, 'Honey', 64, 22],
  [5, 'Amber', 56, 24],
  [6, 'Chestnut', 47, 24],
  [7, 'Cocoa', 38, 22],
  [8, 'Espresso', 30, 19],
];
const UNDERTONES = [
  ['C', 'cool', 47],
  ['N', 'neutral', 56],
  ['W', 'warm', 65],
];
const outOfStock = new Set(['4N']);
const foundations = [];
for (const [lvl, levelName, L, C] of LEVELS) {
  for (const [u, undertone, h] of UNDERTONES) {
    const code = `${lvl}${u}`;
    const hex = labToHex(lchToLab({ L, C, h }));
    foundations.push({
      id: `fdn-${code.toLowerCase()}`,
      sku: `HH-SV-${code}`,
      category: 'foundation',
      productLine: 'Skin Veil Serum Foundation',
      shadeName: `${code} ${levelName}`,
      shadeCode: code,
      hex,
      undertone,
      depthLevel: lvl,
      lch: { L, C, h },
      finish: 'natural',
      price: 36,
      stock: outOfStock.has(code) ? 0 : 8 + ((lvl * 7 + h) % 17),
      image: `/assets/products/fdn-${code.toLowerCase()}.svg`,
    });
  }
}

const dresses = [
  ['wrap', 'Hem Wrap Dress', 68, [
    ['marigold', 'Marigold', '#E0A526', 9],
    ['coral', 'Coral', '#E5735C', 7],
    ['cobalt', 'Cobalt', '#2350A6', 11],
    ['emerald', 'Emerald', '#137A5B', 6],
    ['blush', 'Blush', '#E7BCB2', 10],
    ['camel', 'Camel', '#BF9468', 8],
    ['plum', 'Plum', '#5E2D50', 5],
    ['ivory', 'Ivory', '#EFE8D8', 12],
    ['black', 'Black', '#1E1E22', 0],
  ]],
  ['slip', 'Hem Slip Dress', 62, [
    ['sage', 'Sage', '#8FA58A', 6],
    ['navy', 'Navy', '#1F2D4D', 9],
    ['rust', 'Rust', '#A4492C', 4],
  ]],
].flatMap(([style, line, price, colours]) =>
  colours.map(([id, name, hex, stock]) => ({
    id: `dress-${style}-${id}`,
    sku: `HH-${style.toUpperCase()}-${id.slice(0, 3).toUpperCase()}`,
    category: 'dress',
    productLine: line,
    style,
    shadeName: name,
    shadeCode: name,
    hex,
    temperature: garmentTemperature(hex),
    lab: (() => {
      const l = hexToLab(hex);
      return { L: round(l.L), a: round(l.a), b: round(l.b) };
    })(),
    price,
    stock,
    image: `/assets/products/dress-${style}-${id}.svg`,
    garmentImage: `/assets/garments/dress-${style}-${id}.png`,
  })),
);

// Hair colour kits: hex is the colour sent to YouCam hair-color; level is the colourist's
// 1 (black) … 10 (lightest blonde) scale; tone drives the undertone rules in server/color/hair.js.
const hairColours = [
  ['H01', 'Ash Blonde', '#B5A589', 8, 'ash', 9],
  ['H02', 'Honey Blonde', '#C79A5B', 8, 'golden', 11],
  ['H03', 'Caramel', '#A26E3E', 7, 'caramel', 8],
  ['H04', 'Copper', '#9E4F2A', 6, 'copper', 7],
  ['H05', 'Golden Brown', '#7A5230', 5, 'golden', 10],
  ['H06', 'Chestnut', '#6A4027', 5, 'natural', 12],
  ['H07', 'Ash Brown', '#66594D', 5, 'ash', 6],
  ['H08', 'Mocha', '#4B3426', 4, 'natural', 9],
  ['H09', 'Burgundy', '#5E2232', 4, 'burgundy', 5],
  ['H10', 'Espresso', '#2B201B', 2, 'natural', 14],
  ['H11', 'Platinum', '#D9D3C7', 10, 'ash', 0],
].map(([code, name, hex, level, tone, stock]) => ({
  id: `hair-${code.toLowerCase()}`,
  sku: `HH-GH-${code}`,
  category: 'hair',
  productLine: 'Gloss Hair Colour',
  shadeName: name,
  shadeCode: code,
  hex,
  hairLevel: level,
  hairTone: tone,
  undertone: { golden: 'warm', copper: 'warm', caramel: 'warm', ash: 'cool', burgundy: 'cool' }[tone] ?? 'neutral',
  finish: 'gloss',
  price: 18,
  stock,
  image: `/assets/products/${code.toLowerCase()}.svg`,
}));

// Skincare: one moisturiser in three textures. The hex is the packaging tint (no colour matching);
// the variant is chosen from YouCam skin analysis (server/color/skin.js).
const moisturisers = [
  ['light', 'Light gel', 'gel', '#CFE6E1', 'For skin with some shine: hydrates without heaviness.', 13],
  ['balanced', 'Balanced', 'lotion', '#EFE3D3', 'For comfortable, balanced skin.', 15],
  ['rich', 'Rich', 'cream', '#E6CFB0', 'For skin that wants more hydration.', 10],
].map(([variant, name, texture, hex, blurb, stock]) => ({
  id: `care-${variant}`,
  sku: `HH-CM-${variant.slice(0, 3).toUpperCase()}`,
  category: 'skincare',
  productLine: 'Cloud Moisturiser',
  shadeName: name,
  shadeCode: name,
  hex,
  variant,
  texture,
  blurb,
  finish: texture,
  price: 28,
  stock,
  image: `/assets/products/care-${variant}.svg`,
}));

const daysAgo = (d) => new Date(Date.UTC(2026, 10, 2) - d * 86400000).toISOString().slice(0, 10);

const catalog = {
  store: { name: 'Hue & Hem', note: 'Fictional demo store. All product names are invented.' },
  products: [...lipsticks, ...foundations, ...dresses, ...hairColours, ...moisturisers],
  orders: [
    {
      id: 'HH-10421',
      placedOn: daysAgo(9),
      deliveredOn: daysAgo(6),
      customer: { firstName: 'Alex' },
      lines: [{ lineId: 'HH-10421-1', productId: 'lip-l01', qty: 1, price: 22 }],
    },
    {
      id: 'HH-10388',
      placedOn: daysAgo(13),
      deliveredOn: daysAgo(10),
      customer: { firstName: 'Alex' },
      lines: [{ lineId: 'HH-10388-1', productId: 'fdn-3w', qty: 1, price: 36 }],
    },
    {
      id: 'HH-10307',
      placedOn: daysAgo(16),
      deliveredOn: daysAgo(12),
      customer: { firstName: 'Alex' },
      lines: [{ lineId: 'HH-10307-1', productId: 'dress-wrap-camel', qty: 1, price: 68 }],
    },
    {
      id: 'HH-10455',
      placedOn: daysAgo(8),
      deliveredOn: daysAgo(5),
      customer: { firstName: 'Alex' },
      lines: [{ lineId: 'HH-10455-1', productId: 'hair-h01', qty: 1, price: 18 }],
    },
    {
      id: 'HH-10462',
      placedOn: daysAgo(7),
      deliveredOn: daysAgo(4),
      customer: { firstName: 'Alex' },
      lines: [{ lineId: 'HH-10462-1', productId: 'care-rich', qty: 1, price: 28 }],
    },
  ],
};

writeFileSync(new URL('../data/catalog.json', import.meta.url), JSON.stringify(catalog, null, 2) + '\n');
console.log(`catalog: ${catalog.products.length} products, ${catalog.orders.length} orders`);
for (const p of catalog.products.filter((x) => x.category !== 'foundation')) {
  const { L, C, h } = labToLch(hexToLab(p.hex));
  console.log(p.id.padEnd(22), p.hex, `L${L.toFixed(0)} C${C.toFixed(0)} h${h.toFixed(0)}`, p.undertone ?? p.temperature);
}
