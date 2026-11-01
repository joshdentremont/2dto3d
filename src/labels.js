// Turns pixels into a "label grid": one palette index per pixel, or -1 for no material.
// Row-major, top row first, matching canvas ImageData.
(function (L3D) {
  'use strict';

  const { rgbToLab, nearestIndex } = L3D.color;

  // Map RGBA pixels to the nearest palette color.
  // palette: [{ rgb: [r, g, b], none: bool }]. Transparent pixels and pixels whose
  // nearest color is marked "none" become -1.
  // Returns { labels: Int16Array, counts: per-palette pixel counts before exclusion }.
  function quantize(rgba, pixelCount, palette) {
    const labs = palette.map(p => rgbToLab(p.rgb[0], p.rgb[1], p.rgb[2]));
    const labels = new Int16Array(pixelCount).fill(-1);
    const counts = new Array(palette.length).fill(0);
    if (!labs.length) return { labels, counts };
    let cache = new Map();
    for (let i = 0; i < pixelCount; i++) {
      const o = i * 4;
      if (rgba[o + 3] < 128) continue;
      const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
      let idx = cache.get(key);
      if (idx === undefined) {
        idx = nearestIndex(rgbToLab(rgba[o], rgba[o + 1], rgba[o + 2]), labs);
        if (cache.size > 65536) cache = new Map();
        cache.set(key, idx);
      }
      counts[idx]++;
      if (!palette[idx].none) labels[i] = idx;
    }
    return { labels, counts };
  }

  // Merge 4-connected regions smaller than minPx pixels into the neighbouring label they
  // share the longest border with. Removes JPEG noise and stray anti-aliasing pixels.
  function removeSpecks(labels, W, H, minPx) {
    if (minPx < 2) return labels;
    const out = Int16Array.from(labels);
    for (let pass = 0; pass < 2; pass++) {
      const seen = new Uint8Array(W * H);
      const list = new Int32Array(W * H);
      for (let start = 0; start < W * H; start++) {
        if (seen[start]) continue;
        const lab = out[start];
        // Flood fill; `list` holds the component's pixels and doubles as the queue.
        let n = 0, head = 0;
        list[n++] = start;
        seen[start] = 1;
        while (head < n) {
          const p = list[head++];
          const x = p % W;
          if (x > 0 && !seen[p - 1] && out[p - 1] === lab) { seen[p - 1] = 1; list[n++] = p - 1; }
          if (x < W - 1 && !seen[p + 1] && out[p + 1] === lab) { seen[p + 1] = 1; list[n++] = p + 1; }
          if (p >= W && !seen[p - W] && out[p - W] === lab) { seen[p - W] = 1; list[n++] = p - W; }
          if (p < W * (H - 1) && !seen[p + W] && out[p + W] === lab) { seen[p + W] = 1; list[n++] = p + W; }
        }
        if (n >= minPx) continue;
        const border = new Map();
        const bump = q => { if (out[q] !== lab) border.set(out[q], (border.get(out[q]) || 0) + 1); };
        for (let k = 0; k < n; k++) {
          const p = list[k], x = p % W;
          if (x > 0) bump(p - 1);
          if (x < W - 1) bump(p + 1);
          if (p >= W) bump(p - W);
          if (p < W * (H - 1)) bump(p + W);
        }
        let best = null, bestN = -1;
        for (const [l, c] of border) if (c > bestN || (c === bestN && l < best)) { best = l; bestN = c; }
        if (best === null) continue;
        for (let k = 0; k < n; k++) out[list[k]] = best;
      }
    }
    return out;
  }

  // How different from the background (CIELAB ΔE) a pixel must be to count as content. High
  // enough to ignore JPEG noise in a plain background.
  const TRIM_DE = 10;

  // The box around the image's content, for trimming empty margins: { x, y, w, h }, or null
  // if there's nothing to trim. Margins are transparent or, in an image without transparent
  // corners, the colour at least 3 of its corners share. No clear background means no trim.
  function trimBox(rgba, W, H) {
    const at = (x, y) => (y * W + x) * 4;
    const corners = [at(0, 0), at(W - 1, 0), at(0, H - 1), at(W - 1, H - 1)];
    const clear = corners.filter(o => rgba[o + 3] < 128).length;
    let isEmpty;
    if (clear >= 2) {
      isEmpty = o => rgba[o + 3] < 128;
    } else {
      const solid = corners.filter(o => rgba[o + 3] >= 128);
      const labs = solid.map(o => rgbToLab(rgba[o], rgba[o + 1], rgba[o + 2]));
      let bg = null, best = 2;
      for (const lab of labs) {
        const same = labs.filter(other => L3D.color.deltaE(lab, other) < TRIM_DE).length;
        if (same > best) { best = same; bg = lab; }
      }
      if (!bg) return null;
      const known = new Map();
      isEmpty = o => {
        if (rgba[o + 3] < 128) return true;
        const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
        let empty = known.get(key);
        if (empty === undefined) {
          empty = L3D.color.deltaE(rgbToLab(rgba[o], rgba[o + 1], rgba[o + 2]), bg) < TRIM_DE;
          known.set(key, empty);
        }
        return empty;
      };
    }
    const rowEmpty = y => { for (let x = 0; x < W; x++) if (!isEmpty(at(x, y))) return false; return true; };
    const colEmpty = (x, y0, y1) => { for (let y = y0; y <= y1; y++) if (!isEmpty(at(x, y))) return false; return true; };
    let top = 0, bottom = H - 1;
    while (top < H && rowEmpty(top)) top++;
    if (top === H) return null; // nothing but background
    while (rowEmpty(bottom)) bottom--;
    let left = 0, right = W - 1;
    while (colEmpty(left, top, bottom)) left++;
    while (colEmpty(right, top, bottom)) right--;
    const box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    return box.w === W && box.h === H ? null : box;
  }

  L3D.labels = { quantize, removeSpecks, trimBox };
})(globalThis.L3D = globalThis.L3D || {});
