// Keychain loop: adds a ring (with a hole for a key ring) to one side of the label grid,
// joined to the logo by a short tab. Works on labels, before tracing, so the loop goes
// through the same outline and mesh code as the logo itself.
(function (L3D) {
  'use strict';

  // labels: Int16Array, W x H (row-major, top row first, -1 = empty).
  // opts: { side: 'top' | 'bottom' | 'left' | 'right', outerPx, innerPx (diameters in grid
  //         pixels), label (palette index for the loop) }
  // Returns { labels, W, H, connected } with the grid padded as needed to fit the loop.
  function addLoop(labels, W, H, opts) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (labels[y * W + x] < 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { labels, W, H, connected: false };

    const Ro = opts.outerPx / 2, Ri = opts.innerPx / 2;
    const side = opts.side;
    // Ring centre sits just outside the logo's bounding box, so the hole never covers the
    // logo and the ring wall overlaps the box edge.
    const reach = Math.ceil(Ri + Ro) + 2;
    const pad = { t: 0, b: 0, l: 0, r: 0 };
    if (side === 'top') pad.t = Math.max(0, reach - y0);
    else if (side === 'bottom') pad.b = Math.max(0, reach - (H - 1 - y1));
    else if (side === 'left') pad.l = Math.max(0, reach - x0);
    else pad.r = Math.max(0, reach - (W - 1 - x1));
    // Also make sure the ring fits across the side it sits on.
    const across = Math.ceil(Ro) + 2;
    if (side === 'top' || side === 'bottom') {
      const c = (x0 + x1 + 1) / 2;
      pad.l = Math.max(pad.l, Math.ceil(across - c));
      pad.r = Math.max(pad.r, Math.ceil(c + across - W));
    } else {
      const c = (y0 + y1 + 1) / 2;
      pad.t = Math.max(pad.t, Math.ceil(across - c));
      pad.b = Math.max(pad.b, Math.ceil(c + across - H));
    }

    const NW = W + pad.l + pad.r, NH = H + pad.t + pad.b;
    const out = new Int16Array(NW * NH).fill(-1);
    for (let y = 0; y < H; y++) {
      out.set(labels.subarray(y * W, (y + 1) * W), (y + pad.t) * NW + pad.l);
    }
    x0 += pad.l; x1 += pad.l; y0 += pad.t; y1 += pad.t;

    // Ring centre and the direction from the ring towards the logo.
    let cx, cy, ix, iy;
    if (side === 'top') { cx = (x0 + x1 + 1) / 2; cy = y0 - Ri; ix = 0; iy = 1; }
    else if (side === 'bottom') { cx = (x0 + x1 + 1) / 2; cy = y1 + 1 + Ri; ix = 0; iy = -1; }
    else if (side === 'left') { cx = x0 - Ri; cy = (y0 + y1 + 1) / 2; ix = 1; iy = 0; }
    else { cx = x1 + 1 + Ri; cy = (y0 + y1 + 1) / 2; ix = -1; iy = 0; }

    const ring = new Uint8Array(NW * NH);
    const bx0 = Math.max(0, Math.floor(cx - Ro - 1)), bx1 = Math.min(NW - 1, Math.ceil(cx + Ro + 1));
    const by0 = Math.max(0, Math.floor(cy - Ro - 1)), by1 = Math.min(NH - 1, Math.ceil(cy + Ro + 1));
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const p = y * NW + x;
        if (d < Ri) out[p] = -1;
        else if (d <= Ro && out[p] < 0) { out[p] = opts.label; ring[p] = 1; }
      }
    }

    // Tab: lanes running from the ring towards the logo, filled up to the first logo pixel.
    // A lane may reach at most one ring radius into the logo's bounding box, so the tab
    // bridges small gaps (a rounded edge) but never fills an opening such as the inside of
    // a "U". Lanes that don't reach the logo are left empty.
    let connected = false;
    const half = Math.max(1, Math.round(Ro * 0.75));
    const maxDepth = Math.ceil(Ro);
    const depth = (x, y) => side === 'top' ? y - y0 : side === 'bottom' ? y1 - y : side === 'left' ? x - x0 : x1 - x;
    for (let k = -half; k < half; k++) {
      const lane = [];
      let hit = false;
      // Start at the outer edge of the hole and walk towards the logo.
      for (let s = Math.floor(Ri); ; s++) {
        const x = Math.floor(cx + ix * (s + 0.5) + (iy !== 0 ? k + 0.5 : 0));
        const y = Math.floor(cy + iy * (s + 0.5) + (ix !== 0 ? k + 0.5 : 0));
        if (x < 0 || y < 0 || x >= NW || y >= NH || depth(x, y) > maxDepth) break;
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < Ri) continue; // keep the hole open
        const p = y * NW + x;
        if (out[p] >= 0 && !ring[p]) { hit = true; break; }
        if (out[p] < 0) lane.push(p);
      }
      if (!hit) continue;
      connected = true;
      for (const p of lane) out[p] = opts.label;
    }
    // Ring overlapping the logo directly also counts as connected.
    if (!connected) {
      for (let p = 0; p < out.length && !connected; p++) {
        if (!ring[p]) continue;
        const x = p % NW;
        for (const q of [p - 1, p + 1, p - NW, p + NW]) {
          if (q < 0 || q >= out.length || (Math.abs((q % NW) - x) > 1)) continue;
          if (out[q] >= 0 && !ring[q]) { connected = true; break; }
        }
      }
    }
    return { labels: out, W: NW, H: NH, connected };
  }

  L3D.keychain = { addLoop };
})(globalThis.L3D = globalThis.L3D || {});
