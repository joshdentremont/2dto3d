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

  // Suggesting colours. Colours closer than SUGGEST_SAME_DE count as one, a colour must cover
  // at least SUGGEST_MIN_SHARE of the image, and at most SUGGEST_SAMPLES pixels are looked at.
  // A colour under SUGGEST_BLEND_SHARE that lies within SUGGEST_BLEND_DE of the line between
  // two chosen colours is taken as the soft edge between them, not a colour of its own.
  const SUGGEST_SAME_DE = 15;
  const SUGGEST_MIN_SHARE = 0.003;
  const SUGGEST_SAMPLES = 300000;
  const SUGGEST_BLEND_SHARE = 0.05;
  const SUGGEST_BLEND_DE = 6;
  const SUGGEST_MAX = 8;

  // Distance in CIELAB from colour p to the line segment between colours a and b.
  function distToBlend(p, a, b) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    if (!len2) return L3D.color.deltaE(p, a);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2));
    return L3D.color.deltaE(p, [a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]]);
  }

  // The image's main colours as [[r, g, b], ...], biggest area first. existing: colours
  // already picked, which are skipped along with anything too close to them.
  function suggestColors(rgba, pixelCount, existing) {
    const step = Math.max(1, Math.ceil(pixelCount / SUGGEST_SAMPLES));
    const buckets = new Map();
    let total = 0;
    for (let i = 0; i < pixelCount; i += step) {
      const o = i * 4;
      if (rgba[o + 3] < 128) continue;
      total++;
      const key = ((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3);
      let b = buckets.get(key);
      if (!b) buckets.set(key, b = { n: 0, r: 0, g: 0, b: 0 });
      b.n++; b.r += rgba[o]; b.g += rgba[o + 1]; b.b += rgba[o + 2];
    }
    const chosen = (existing || []).map(rgb => rgbToLab(rgb[0], rgb[1], rgb[2]));
    const found = [];
    const list = Array.from(buckets.values()).sort((a, b) => b.n - a.n);
    for (const b of list) {
      const share = b.n / total;
      if (share < SUGGEST_MIN_SHARE || found.length === SUGGEST_MAX) break;
      const rgb = [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)];
      const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
      if (chosen.some(c => L3D.color.deltaE(lab, c) < SUGGEST_SAME_DE)) continue;
      let blend = false;
      if (share < SUGGEST_BLEND_SHARE) {
        for (let i = 0; i < chosen.length && !blend; i++) {
          for (let j = i + 1; j < chosen.length && !blend; j++) {
            blend = distToBlend(lab, chosen[i], chosen[j]) < SUGGEST_BLEND_DE;
          }
        }
      }
      if (blend) continue;
      chosen.push(lab);
      found.push(rgb);
    }
    return found;
  }

  L3D.labels = { quantize, removeSpecks, trimBox, suggestColors };
})(globalThis.L3D = globalThis.L3D || {});
