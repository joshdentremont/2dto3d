// Color helpers: hex / RGB / CIELAB conversion and nearest-palette matching.
// Distances are measured in CIELAB so "closest color" matches what the eye sees.
(function (L3D) {
  'use strict';

  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function labF(t) {
    return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  }

  // sRGB (0-255 per channel) -> CIELAB [L, a, b] under the D65 white point.
  function rgbToLab(r, g, b) {
    const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const fx = labF(x), fy = labF(y), fz = labF(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  // CIE76 color difference. About 2-3 is the smallest difference people notice.
  function deltaE(a, b) {
    const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  // Index of the closest color in `labs` (an array of Lab triples), or -1 if empty.
  function nearestIndex(lab, labs) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < labs.length; i++) {
      const c = labs[i];
      const dl = lab[0] - c[0], da = lab[1] - c[1], db = lab[2] - c[2];
      const d = dl * dl + da * da + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(full.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  L3D.color = { rgbToLab, deltaE, nearestIndex, rgbToHex, hexToRgb };
})(globalThis.L3D = globalThis.L3D || {});
