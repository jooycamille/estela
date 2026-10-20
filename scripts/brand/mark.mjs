// The Hey Joy mark: a speech bubble (Joy saying hey) with a winking face whose smile is a flight path ending in a paper plane.
export const COLORS = { from: "#FF8A3D", to: "#FF3D7F", ink: "#1E2140", inkDark: "#FFFFFF", muted: "#6B7385", mutedDark: "#B5BBC9" };

export function markSvgInner(id = "hj") {
  const bubble =
    "M40 8H88A32 32 0 0 1 120 40V72A32 32 0 0 1 88 104H58L33.5 121.6Q29 124.6 29.6 119.2L32 104.6A32 32 0 0 1 8 72V40A32 32 0 0 1 40 8Z";
  return `
  <defs>
    <linearGradient id="${id}-g" x1="12" y1="8" x2="116" y2="118" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${COLORS.from}"/>
      <stop offset="1" stop-color="${COLORS.to}"/>
    </linearGradient>
  </defs>
  <path d="${bubble}" fill="url(#${id}-g)"/>
  <circle cx="44" cy="44" r="8" fill="#fff"/>
  <path d="M69.5 46.5Q78 36.5 86.5 46.5" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
  <path d="M31 61C37 82 63 90 82 75" fill="none" stroke="#fff" stroke-width="8.5" stroke-linecap="round"/>
  <path d="M80.5 75.5L107 55L99.5 83L93 76.5Z" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
  <path d="M107 55L93 76.5" stroke="${COLORS.to}" stroke-width="2.4" stroke-linecap="round" opacity=".5"/>`;
}

export const markSvg = (size = 128) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128" role="img" aria-label="Hey Joy">${markSvgInner()}</svg>`;
