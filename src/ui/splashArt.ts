/**
 * The splash illustration: a striped sun over mountains, a neon grid, and the legion
 * charging at you. Drawn as SVG sized to the screen's shape, so it never gets awkwardly
 * cropped on tall phones or wide monitors.
 */
export function splashArt(width: number, height: number): string {
  const W = 400;
  const H = Math.round(Math.min(900, Math.max(240, (W * height) / width)));
  const hz = Math.round(H * (H > W ? 0.6 : 0.56)); // horizon
  const sunR = Math.min(W * 0.2, H * 0.24);
  const sunY = hz - sunR * 0.35;

  // Mountains: jagged ridge, low in the middle.
  const ridge: string[] = [];
  for (let i = 0; i <= 20; i++) {
    const x = (i / 20) * W;
    const side = Math.abs(x - W / 2) / (W / 2);
    const h = 6 + side * side * H * 0.13 + ((i * 37) % 11) * (2 + side * 4);
    ridge.push(`${x.toFixed(1)} ${(hz - h).toFixed(1)}`);
  }
  const ridgePath = `M${ridge.join(' L')}`;

  // Floor grid in perspective from the vanishing point.
  const floorH = H - hz;
  let grid = '';
  for (let k = 1; k <= 7; k++) {
    const y = hz + floorH * Math.pow(k / 7, 1.9);
    grid += `M0 ${y.toFixed(1)}H${W}`;
  }
  for (let k = -6; k <= 6; k++) grid += `M${W / 2} ${hz}L${W / 2 + k * 90} ${H}`;

  // Sun stripes: gaps widening towards the horizon.
  let clip = `<rect x="0" y="0" width="${W}" height="${sunY.toFixed(1)}" />`;
  let y = sunY + 4;
  for (let k = 0; k < 6; k++) {
    const band = 9 - k * 1.3;
    clip += `<rect x="0" y="${y.toFixed(1)}" width="${W}" height="${band.toFixed(1)}" />`;
    y += band + 3 + k;
  }

  // The legion: rows of squad members, bigger as they get closer.
  let legion = '';
  let guns = '';
  const rows = 5;
  // Keep the figures in proportion to the floor on wide screens.
  const k = Math.max(0.45, Math.min(1, floorH / 190));
  for (let r = 0; r < rows; r++) {
    const t = (r + 1) / rows;
    const ry = hz + floorH * (0.06 + 0.42 * Math.pow(t, 1.4));
    const w = (6 + 13 * t) * k;
    const n = 2 + r;
    const spread = w * 1.9;
    for (let i = 0; i < n; i++) {
      const x = W / 2 + (i - (n - 1) / 2) * spread - w / 2;
      legion += `<rect x="${x.toFixed(1)}" y="${ry.toFixed(1)}" width="${w.toFixed(1)}" height="${(w * 1.8).toFixed(1)}" rx="${(w / 2).toFixed(1)}" />`;
      if ((i + r) % 2 === 0) guns += `<rect x="${(x + w * 0.85).toFixed(1)}" y="${(ry + w * 0.3).toFixed(1)}" width="${(w * 0.22).toFixed(1)}" height="${(w * 0.7).toFixed(1)}" />`;
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" class="splash-scene" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sp-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#140728" /><stop offset="${((hz * 0.7) / H).toFixed(2)}" stop-color="#3d0f58" /><stop offset="${(hz / H).toFixed(2)}" stop-color="#ff4f8b" />
    </linearGradient>
    <linearGradient id="sp-sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe066" /><stop offset="1" stop-color="#ff2e8c" /></linearGradient>
    <linearGradient id="sp-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0c48" /><stop offset="1" stop-color="#0d0420" /></linearGradient>
    <radialGradient id="sp-glow"><stop offset="0" stop-color="#ff4f8b" stop-opacity=".5" /><stop offset="1" stop-color="#ff4f8b" stop-opacity="0" /></radialGradient>
    <clipPath id="sp-sunclip">${clip}</clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sp-sky)" />
  <circle cx="${W / 2}" cy="${sunY.toFixed(1)}" r="${(sunR * 2.2).toFixed(1)}" fill="url(#sp-glow)" />
  <g clip-path="url(#sp-sunclip)"><circle cx="${W / 2}" cy="${sunY.toFixed(1)}" r="${sunR.toFixed(1)}" fill="url(#sp-sun)" /></g>
  <path d="${ridgePath} L${W} ${hz} L0 ${hz}Z" fill="#1b0733" />
  <path d="${ridgePath}" fill="none" stroke="#ff4fd8" stroke-width="2" stroke-linejoin="round" />
  <rect y="${hz}" width="${W}" height="${floorH}" fill="url(#sp-floor)" />
  <path d="${grid}" stroke="#ff2bd6" stroke-width="1.1" opacity=".5" fill="none" />
  <path d="M${W / 2} ${hz}L${W / 2 - 130} ${H}M${W / 2} ${hz}L${W / 2 + 130} ${H}" stroke="#29f0ff" stroke-width="2.5" />
  <g class="sp-legion" style="transform-origin:${W / 2}px ${hz + floorH * 0.6}px">
    <g fill="#3fd2ff" stroke="#0b2a3d" stroke-width="1.4">${legion}</g>
    <g fill="#ffd23f">${guns}</g>
  </g>
</svg>`;
}
