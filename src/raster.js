// Browser-side image handling: loading files, picking colours, resampling to the print grid.
(function (L3D) {
  'use strict';

  // Longest side (pixels) an SVG is drawn at when it's edited: twice the largest print grid.
  const SVG_EDIT_SIDE = 3200;

  // Loads PNG / JPG / WebP / GIF / SVG into an <img>. SVGs without a size get 1024 px.
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { w = 1024; h = 1024; }
        resolve({ img, w, h, url, file, isSvg: /svg/i.test(file.type) || /\.svg$/i.test(file.name) });
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

  // An editable copy of the image. SVGs stay sharp by being drawn at print size, which an edit
  // can't do, so they're drawn large here instead.
  function toCanvas(src) {
    const k = src.isSvg ? Math.max(1, SVG_EDIT_SIDE / Math.max(src.w, src.h)) : 1;
    const w = Math.round(src.w * k), h = Math.round(src.h * k);
    const c = canvas(w, h);
    c.getContext('2d').drawImage(src.img, 0, 0, w, h);
    return c;
  }

  // A new canvas with one edit applied. op: { type: 'rotate', dir: 1 (clockwise) or -1 },
  // { type: 'flip', axis: 'h' or 'v' }, or { type: 'crop', u0, v0, u1, v1 } as fractions of
  // the width and height.
  function editCanvas(c, op) {
    const w = c.width, h = c.height;
    if (op.type === 'rotate') {
      const out = canvas(h, w), ctx = out.getContext('2d');
      ctx.translate(op.dir > 0 ? h : 0, op.dir > 0 ? 0 : w);
      ctx.rotate(op.dir * Math.PI / 2);
      ctx.drawImage(c, 0, 0);
      return out;
    }
    if (op.type === 'flip') {
      const out = canvas(w, h), ctx = out.getContext('2d');
      ctx.translate(op.axis === 'h' ? w : 0, op.axis === 'h' ? 0 : h);
      ctx.scale(op.axis === 'h' ? -1 : 1, op.axis === 'h' ? 1 : -1);
      ctx.drawImage(c, 0, 0);
      return out;
    }
    const x = Math.round(op.u0 * w), y = Math.round(op.v0 * h);
    const cw = Math.max(1, Math.round(op.u1 * w) - x), ch = Math.max(1, Math.round(op.v1 * h) - y);
    const out = canvas(cw, ch);
    out.getContext('2d').drawImage(c, x, y, cw, ch, 0, 0, cw, ch);
    return out;
  }

  // A canvas as PNG bytes.
  function canvasPng(c) {
    return new Promise((resolve, reject) => {
      c.toBlob(blob => (blob ? blob.arrayBuffer().then(b => resolve(new Uint8Array(b)), reject) : reject(new Error('The edited image could not be saved.'))), 'image/png');
    });
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

  L3D.raster = { loadImage, toCanvas, editCanvas, canvasPng, originalPixels, resample, sampleColor };
})(globalThis.L3D = globalThis.L3D || {});
