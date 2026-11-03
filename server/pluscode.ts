// Google Plus Codes (Open Location Code, an open standard: https://github.com/google/open-location-code) — booking
// emails sometimes give an address as "8Q7X+2C, Sample Town, Antioquia". Decodes full codes, and short ones given a nearby
// reference point (the town after the code).

const ALPHABET = "23456789CFGHJMPQRVWX";
const RESOLUTIONS = [20, 1, 0.05, 0.0025, 0.000125];
export const PLUS_CODE = /\b([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,3})\b/i;

function decodeFull(code: string) {
  const digits = code.replace("+", "").toUpperCase();
  let lat = -90, lon = -180, res = 20;
  for (let i = 0; i < Math.min(digits.length, 10); i += 2) {
    res = RESOLUTIONS[i / 2];
    lat += ALPHABET.indexOf(digits[i]) * res;
    lon += ALPHABET.indexOf(digits[i + 1]) * res;
  }
  return { lat: lat + res / 2, lon: lon + res / 2 };
}

function encodePrefix(lat: number, lon: number, length: number) {
  let la = Math.min(Math.max(lat + 90, 0), 179.999999), lo = (((lon + 180) % 360) + 360) % 360;
  let out = "";
  for (const res of RESOLUTIONS) {
    const dl = Math.floor(la / res), dn = Math.floor(lo / res);
    out += ALPHABET[dl] + ALPHABET[dn];
    la -= dl * res;
    lo -= dn * res;
    if (out.length >= length) break;
  }
  return out.slice(0, length);
}

/** Decodes a full code, or a short code nearest to `ref`. */
export function decodePlusCode(code: string, ref?: { lat: number; lon: number }) {
  const at = code.indexOf("+");
  if (at === 8) return decodeFull(code);
  if (!ref || at < 2 || at % 2) return undefined;
  const padding = 8 - at;
  const resolution = Math.pow(20, 2 - padding / 2);
  const p = decodeFull(encodePrefix(ref.lat, ref.lon, padding) + code);
  // Pick the copy of the code's cell closest to the reference point.
  if (ref.lat + resolution / 2 < p.lat && p.lat - resolution >= -90) p.lat -= resolution;
  else if (ref.lat - resolution / 2 > p.lat && p.lat + resolution <= 90) p.lat += resolution;
  if (ref.lon + resolution / 2 < p.lon) p.lon -= resolution;
  else if (ref.lon - resolution / 2 > p.lon) p.lon += resolution;
  return p;
}
