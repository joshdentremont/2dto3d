// Front-lip frame: a separate part the finished print drops into from the back, face first.
// Printed face down: a lip (z = 0 .. lip thickness) covers the print's edge from the front,
// and a wall around a recess shaped like the print holds it in place.
//
// Built as a label grid, so it goes through the same tracing and meshing as the print:
//   label 0 = lip only (inside the recess, outside the visible opening)
//   label 1 = full-height wall (outside the recess, inside the frame's outer edge)
(function (L3D) {
  'use strict';

  const FAR = 1e20;

  // 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher).
  function edt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -FAR; z[1] = FAR;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q; z[k] = s; z[k + 1] = FAR;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
    }
  }

  // Squared distance (in pixels) from every pixel to the nearest pixel where mask is set.
  function distanceSq(mask, W, H) {
    const out = new Float64Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = mask[i] ? 0 : FAR;
    const n = Math.max(W, H);
    const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) f[y] = out[y * W + x];
      edt1d(f, H, d, v, z);
      for (let y = 0; y < H; y++) out[y * W + x] = d[y];
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) f[x] = out[y * W + x];
      edt1d(f, W, d, v, z);
      for (let x = 0; x < W; x++) out[y * W + x] = d[x];
    }
    return out;
  }

  // Footprint of the print with enclosed holes filled (the frame only cares about the
  // outside edge), mirrored top-to-bottom because the print goes in face down.
  function footprint(labels, W, H, pad) {
    const NW = W + 2 * pad, NH = H + 2 * pad;
    const F = new Uint8Array(NW * NH);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (labels[y * W + x] >= 0) F[(pad + H - 1 - y) * NW + pad + x] = 1;
      }
    }
    // Flood the outside from the border; any empty pixel it can't reach is a hole.
    const outside = new Uint8Array(NW * NH);
    const stack = [0];
    outside[0] = 1;
    while (stack.length) {
      const p = stack.pop(), x = p % NW;
      for (const q of [x > 0 ? p - 1 : -1, x < NW - 1 ? p + 1 : -1, p - NW, p + NW]) {
        if (q < 0 || q >= NW * NH || outside[q] || F[q]) continue;
        outside[q] = 1;
        stack.push(q);
      }
    }
    for (let i = 0; i < NW * NH; i++) if (!outside[i]) F[i] = 1;
    return { F, W: NW, H: NH };
  }

  // labels: the print's final label grid (W x H). opts (all in pixels): border (frame width
  // outside the recess), lip (how far the lip overlaps the print's edge), clearance (gap
  // between print and recess). Returns { labels, W, H } for tracing.
  function frameGrid(labels, W, H, opts) {
    const pad = Math.ceil(opts.border + opts.clearance) + 2;
    const { F, W: NW, H: NH } = footprint(labels, W, H, pad);
    const notF = Uint8Array.from(F, v => 1 - v);
    const toPrint = distanceSq(F, NW, NH);      // distance to the print
    const toEdge = distanceSq(notF, NW, NH);    // distance (inside the print) to its edge
    const recess = new Uint8Array(NW * NH);
    const c2 = opts.clearance * opts.clearance;
    for (let i = 0; i < NW * NH; i++) recess[i] = toPrint[i] <= c2 ? 1 : 0;
    const toRecess = distanceSq(recess, NW, NH);
    const out = new Int16Array(NW * NH).fill(-1);
    const l2 = opts.lip * opts.lip, b2 = opts.border * opts.border;
    for (let i = 0; i < NW * NH; i++) {
      if (recess[i]) {
        // Inside the recess: the lip, except the visible opening in the middle.
        const opening = F[i] && toEdge[i] > l2;
        out[i] = opening ? -1 : 0;
      } else if (toRecess[i] <= b2) {
        out[i] = 1;
      }
    }
    return { labels: out, W: NW, H: NH };
  }

  // The frame mesh. depth = how deep the recess is (mm), lipThickness in mm, scale = mm per
  // pixel. Distances in opts are in mm.
  function buildFrame(labels, W, H, opts, scale) {
    const grid = frameGrid(labels, W, H, {
      border: opts.border / scale, lip: opts.lip / scale, clearance: opts.clearance / scale,
    });
    const g = L3D.contours.trace(grid.labels, grid.W, grid.H, { smooth: opts.smooth });
    const lipTop = opts.lipThickness, wallTop = opts.lipThickness + opts.depth;
    return L3D.mesh.buildSolid(g, [lipTop, wallTop], 0, scale);
  }

  L3D.frame = { distanceSq, frameGrid, buildFrame };
})(globalThis.L3D = globalThis.L3D || {});
