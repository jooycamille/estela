import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import opentype from "opentype.js";
import sharp from "sharp";

// Estela's logo files, all from this script: a serif "E" with a fine curve beneath it (estela: the trail a ship leaves on
// the water), the name in Cormorant Garamond and the tagline in Inter. Letters are outlined, so the files never depend
// on installed fonts. Run: npm run brand. It writes public/brand, the favicon and the home-screen icons.

const INK = "#1A1917";
const IVORY = "#F7F5F1";
const CHAMPAGNE = "#C9A97F";
const MUTED = "#6E6960";
const MUTED_DARK = "#9B958B";

const load = (file) => {
  const b = readFileSync(file);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const serif = load("node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-500-normal.woff");
const serifBold = load("node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-700-normal.woff");
const sans = load("node_modules/@fontsource/inter/files/inter-latin-500-normal.woff");

/** Text as outlined path data, with optional letter spacing (tracking, in em). */
function text(font, str, x, baseline, size, tracking = 0) {
  const parts = [];
  let cursor = x;
  for (const ch of str) {
    const p = font.getPath(ch, cursor, baseline, size);
    parts.push(p.toPathData(2));
    cursor += font.getAdvanceWidth(ch, size) + tracking * size;
  }
  return { d: parts.join(" "), width: cursor - x - tracking * size };
}

/** The mark: an "E" in the serif, centred, with the wake curving beneath it. `bg` fills the square (or none). */
function markSvg(size, { bg = INK, fg = IVORY, wake = CHAMPAGNE, radius = 0, inset = 0, small = false } = {}) {
  // Small (a browser tab): a bigger, bolder letter and a thicker line, so they still read at 16 pixels.
  const font = small ? serifBold : serif;
  const inner = size - inset * 2;
  const letterSize = inner * (small ? 0.8 : 0.62);
  const e = font.getPath("E", 0, 0, letterSize);
  const bb = e.getBoundingBox();
  const x = inset + (inner - (bb.x2 - bb.x1)) / 2 - bb.x1;
  const y = inset + inner * 0.5 - (bb.y1 + bb.y2) / 2 - inner * 0.04;
  const letter = font.getPath("E", x, y, letterSize).toPathData(2);
  // The wake: a long, shallow curve under the letter, thinning towards its end.
  // Nearly flat, rising gently at the end like a wake behind a boat (a deeper curve reads as a smile).
  const wy = inset + inner * (small ? 0.86 : 0.76), wx1 = inset + inner * (small ? 0.24 : 0.3), wx2 = inset + inner * (small ? 0.78 : 0.72);
  const curve = `M${wx1.toFixed(1)} ${wy.toFixed(1)} Q${(inset + inner * 0.55).toFixed(1)} ${(wy + inner * 0.012).toFixed(1)} ${wx2.toFixed(1)} ${(wy - inner * 0.03).toFixed(1)}`;
  const square = bg ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${square}<path d="${letter}" fill="${fg}"/><path d="${curve}" fill="none" stroke="${wake}" stroke-width="${(inner * (small ? 0.06 : 0.011)).toFixed(2)}" stroke-linecap="round"/></svg>`;
}

/** The wordmark, with the tagline under it if asked. */
function logoSvg({ dark = false, tagline = false } = {}) {
  const size = 120, pad = 8;
  const name = text(serif, "Estela", pad, pad + size * 0.78, size, 0.01);
  const tag = tagline ? text(sans, "YOUR JOURNEY, COMPOSED.", pad + 3, pad + size * 0.78 + 46, 20, 0.2) : null;
  const width = Math.ceil(Math.max(name.width, tag?.width ?? 0) + pad * 2);
  const height = Math.ceil(pad + size * 0.78 + (tagline ? 62 : 30));
  const fg = dark ? IVORY : INK;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><path d="${name.d}" fill="${fg}"/>${tag ? `<path d="${tag.d}" fill="${dark ? MUTED_DARK : MUTED}"/>` : ""}</svg>`;
}

/** An .ico file holding PNG images: a 6-byte header, a 16-byte entry per image, then the images. */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // icon
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(([size, data], n) => {
    const at = 6 + 16 * n;
    head.writeUInt8(size % 256, at);
    head.writeUInt8(size % 256, at + 1);
    head.writeUInt16LE(1, at + 4); // colour planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map(([, data]) => data)]);
}

const png = (svg, file, size) => sharp(Buffer.from(svg), { density: 300 }).resize(size ? { width: size } : undefined).png().toFile(file);
const write = (file, svg) => writeFileSync(file, svg);

mkdirSync("public/brand", { recursive: true });
mkdirSync("public/icons", { recursive: true });

// Icon: the favicon (rounded), the app icon (square: phones round the corners themselves), and a maskable one with room
// around the letter for phones that cut icons into circles.
const mark = markSvg(128, { radius: 28 });
const favicon = markSvg(64, { radius: 12, small: true });
const appIcon = markSvg(1024);
write("public/brand/estela-mark.svg", mark);
write("public/favicon.svg", favicon);
// PNG and .ico copies for browsers that don't show SVG favicons (Safari among them). An .ico can hold PNGs as they are.
const fav16 = await sharp(Buffer.from(favicon), { density: 600 }).resize(16).png().toBuffer();
const fav32 = await sharp(Buffer.from(favicon), { density: 600 }).resize(32).png().toBuffer();
const fav48 = await sharp(Buffer.from(favicon), { density: 600 }).resize(48).png().toBuffer();
writeFileSync("public/favicon-32.png", fav32);
writeFileSync("public/favicon.ico", ico([[16, fav16], [32, fav32], [48, fav48]]));
write("public/brand/estela-app-icon.svg", appIcon);
await png(mark, "public/brand/estela-mark-512.png", 512);
await png(appIcon, "public/brand/estela-app-icon-1024.png", 1024);
await png(appIcon, "public/apple-touch-icon.png", 180);
await png(appIcon, "public/icons/icon-192.png", 192);
await png(appIcon, "public/icons/icon-512.png", 512);
await png(markSvg(512, { inset: 72 }), "public/icons/maskable-512.png", 512);

// Wordmark, for light and dark backgrounds, with and without the tagline.
for (const dark of [false, true]) {
  for (const tagline of [false, true]) {
    const name = `public/brand/estela-logo${tagline ? "-tagline" : ""}${dark ? "-dark" : ""}`;
    const svg = logoSvg({ dark, tagline });
    write(`${name}.svg`, svg);
    await png(svg, `${name}.png`);
  }
}
console.log("Estela brand files written: public/brand, public/favicon.svg, public/apple-touch-icon.png, public/icons.");
