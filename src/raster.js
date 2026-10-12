// Browser-side image handling: loading files, picking colours, resampling to the print grid.
(function (L3D) {
  'use strict';

  // Loads PNG / JPG / WebP / GIF / SVG into an <img>. SVGs without a size get 1024 px.
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { w = 1024; h = 1024; }
        resolve({ img, w, h, url, isSvg: /svg/i.test(file.type) || /\.svg$/i.test(file.name) });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This file could not be read as an image.')); };
      img.src = url;
    });
  }

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // Pixels of the original image, capped in size, used for colour picking and display.
  function originalPixels(src, maxSide) {
    const k = Math.min(1, maxSide / Math.max(src.w, src.h));
    const w = Math.max(1, Math.round(src.w * k)), h = Math.max(1, Math.round(src.h * k));
    const c = canvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src.img, 0, 0, w, h);
    return { canvas: c, data: ctx.getImageData(0, 0, w, h), w, h };
  }

  // Resample to the print grid. Large reductions are done in halving steps so thin lines
  // keep their colour instead of being skipped.
  function resample(src, gw, gh) {
    let cur = src.img, cw = src.w, ch = src.h;
    if (!src.isSvg) {
      while (cw / 2 >= gw * 1.5 && ch / 2 >= gh * 1.5) {
        const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
        const c = canvas(nw, nh);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(cur, 0, 0, nw, nh);
        cur = c; cw = nw; ch = nh;
      }
    }
    const c = canvas(gw, gh);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, gw, gh);
    return ctx.getImageData(0, 0, gw, gh);
  }

  // Median colour of the opaque pixels in the 3x3 block around (x, y), or null if the spot
  // is transparent.
  function sampleColor(pix, x, y) {
    const r = [], g = [], b = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= pix.w || py >= pix.h) continue;
        const o = (py * pix.w + px) * 4;
        if (pix.data.data[o + 3] < 128) continue;
        r.push(pix.data.data[o]); g.push(pix.data.data[o + 1]); b.push(pix.data.data[o + 2]);
      }
    }
    const o = (y * pix.w + x) * 4;
    if (pix.data.data[o + 3] < 128 || !r.length) return null;
    const med = a => a.sort((p, q) => p - q)[a.length >> 1];
    return [med(r), med(g), med(b)];
  }

  L3D.raster = { loadImage, originalPixels, resample, sampleColor };
})(globalThis.L3D = globalThis.L3D || {});
