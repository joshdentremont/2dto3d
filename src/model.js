// Turns traced outlines plus the user's settings into printable parts.
(function (L3D) {
  'use strict';

  const round = z => Math.round(z * 1e4) / 1e4;

  // Label grid to trace, as { labels, W, H }. With a rectangular base plate, empty pixels
  // become an extra label (index = palette length) so the plate is built from the same
  // outlines as the logo.
  function traceLabels(labels, W, H, paletteLength, settings) {
    if (settings.base.type !== 'rect') return { labels, W, H };
    return { labels: Int16Array.from(labels, l => (l < 0 ? paletteLength : l)), W, H };
  }

  // How much wider and taller an outline makes the model than the image. An oval passes
  // through the image's corners, so it's √2 times the image's size. Rounded corners cut into
  // the image, so they don't change it.
  function outlineGrowth(shape) {
    return shape === 'oval' ? Math.SQRT2 : 1;
  }

  // Largest corner radius (pixels) for rounded corners on a W x H image: at this radius the
  // short sides are fully rounded.
  function maxCornerRadius(W, H) {
    return Math.min(W, H) / 2;
  }

  // Outline shape filled with `fill` (a palette index) wherever the image is empty, so it is
  // the same height as that colour. Returns { labels, W, H, ox, oy }: (ox, oy) is where the
  // image starts in the new grid.
  //   shape 'oval':    the smallest ellipse containing the image. It passes through the
  //                    image's corners, with semi-axes W/√2 and H/√2 (a circle if square).
  //                    The grid is enlarged to fit, with the image centred.
  //   shape 'rounded': the image's own rectangle with its corners rounded to radiusPx. The
  //                    corners are cut away, including any of the image that was there.
  function addOutline(labels, W, H, fill, shape, radiusPx) {
    if (shape === 'rounded') {
      const r = Math.max(0, Math.min(radiusPx || 0, maxCornerRadius(W, H)));
      const out = new Int16Array(W * H);
      for (let y = 0; y < H; y++) {
        // Distance into the corner zone, or 0 along the straight sides.
        const qy = Math.max(Math.abs(y + 0.5 - H / 2) - (H / 2 - r), 0);
        for (let x = 0; x < W; x++) {
          const qx = Math.max(Math.abs(x + 0.5 - W / 2) - (W / 2 - r), 0);
          const l = labels[y * W + x];
          out[y * W + x] = qx * qx + qy * qy > r * r ? -1 : l >= 0 ? l : fill;
        }
      }
      return { labels: out, W, H, ox: 0, oy: 0 };
    }

    const a = W / Math.SQRT2, b = H / Math.SQRT2;
    const NW = Math.ceil(2 * a) + 2, NH = Math.ceil(2 * b) + 2;
    const ox = Math.floor((NW - W) / 2), oy = Math.floor((NH - H) / 2);
    const cx = ox + W / 2, cy = oy + H / 2;
    const out = new Int16Array(NW * NH).fill(-1);
    for (let y = 0; y < NH; y++) {
      const dy = (y + 0.5 - cy) / b;
      for (let x = 0; x < NW; x++) {
        const dx = (x + 0.5 - cx) / a;
        const ix = x - ox, iy = y - oy;
        const inImage = ix >= 0 && iy >= 0 && ix < W && iy < H;
        const l = inImage ? labels[iy * W + ix] : -1;
        // Image pixels are always inside the ellipse; this keeps their colours either way.
        if (l >= 0) out[y * NW + x] = l;
        else if (inImage || dx * dx + dy * dy <= 1) out[y * NW + x] = fill;
      }
    }
    return { labels: out, W: NW, H: NH, ox, oy };
  }

  // Print grid size for an image: { gw, gh, scale (mm per pixel), capped }. width is the width in
  // mm it should come out at, or with `square`, the side of the square it's centred on, which
  // is set by its longer side. capped says the detail was reduced to keep within maxGrid pixels.
  function gridSize(width, detail, imageW, imageH, maxGrid, square) {
    const upright = square && imageH > imageW; // height, not width, fills the given size
    let a = Math.max(2, Math.round(width / detail));
    let b = Math.max(2, Math.round(upright ? a * imageW / imageH : a * imageH / imageW));
    let capped = false;
    if (Math.max(a, b) > maxGrid) {
      const k = maxGrid / Math.max(a, b);
      a = Math.max(2, Math.round(a * k));
      b = Math.max(2, Math.round(b * k));
      capped = true;
    }
    return { gw: upright ? b : a, gh: upright ? a : b, scale: width / a, capped };
  }

  // The image centred on a square as wide as its longer side, with `fill` (a palette index)
  // wherever it's empty. Returns { labels, W, H, ox, oy }: (ox, oy) is where the image starts.
  function addSquare(labels, W, H, fill) {
    const side = Math.max(W, H);
    const ox = Math.floor((side - W) / 2), oy = Math.floor((side - H) / 2);
    const out = new Int16Array(side * side).fill(fill);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const l = labels[y * W + x];
        if (l >= 0) out[(y + oy) * side + x + ox] = l;
      }
    }
    return { labels: out, W: side, H: side, ox, oy };
  }

  // A band widthPx wide around the outside of the shape, labelled `label`. Openings enclosed by
  // the shape are left alone. Returns { labels, W, H, ox, oy }, enlarged to fit the band, with
  // (ox, oy) being where the old grid now starts.
  function addBorder(labels, W, H, label, widthPx) {
    const pad = Math.ceil(widthPx) + 1, NW = W + 2 * pad, NH = H + 2 * pad;
    const out = new Int16Array(NW * NH).fill(-1);
    for (let y = 0; y < H; y++) out.set(labels.subarray(y * W, (y + 1) * W), (y + pad) * NW + pad);
    // Flood the outside from the padding; anything it can't reach counts as part of the shape.
    const outside = new Uint8Array(NW * NH);
    const stack = [0];
    outside[0] = 1;
    while (stack.length) {
      const p = stack.pop(), x = p % NW;
      for (const q of [x > 0 ? p - 1 : -1, x < NW - 1 ? p + 1 : -1, p - NW, p + NW]) {
        if (q < 0 || q >= NW * NH || outside[q] || out[q] >= 0) continue;
        outside[q] = 1;
        stack.push(q);
      }
    }
    const toShape = L3D.frame.distanceSq(Uint8Array.from(outside, v => 1 - v), NW, NH);
    const limit = widthPx * widthPx;
    for (let i = 0; i < NW * NH; i++) if (outside[i] && toShape[i] <= limit) out[i] = label;
    return { labels: out, W: NW, H: NH, ox: pad, oy: pad };
  }

  // Tiles along a side `size` mm long, to fit a bed `bed` mm long with room for a brim, at most
  // MAX_TILES.
  const MAX_TILES = 10;
  const TILE_MARGIN = 5;
  function tilesFor(size, bed) {
    return Math.min(MAX_TILES, Math.max(1, Math.ceil(size / Math.max(bed - 2 * TILE_MARGIN, 1) - 1e-9)));
  }

  // Cuts a grid into cols x rows tiles by giving each tile its own run of labels, so that a
  // single trace shares every edge between neighbouring tiles. A label l becomes
  // l + count * tile, where count is more than any label. trim pixels are left out along every
  // edge where two tiles meet, and none along the outside. Returns { labels, tiles: [{ row, col,
  // x0, x1, y0, y1 }] } with tiles numbered row by row from the top left, in grid pixels.
  // joints (pixels, optional) adds jigsaw joints along the cuts: see addJoints.
  function tileLabels(labels, W, H, cols, rows, count, trim, joints) {
    const t = trim || 0;
    const xs = [], ys = [];
    for (let k = 0; k <= cols; k++) xs.push(Math.round(k * W / cols));
    for (let k = 0; k <= rows; k++) ys.push(Math.round(k * H / rows));
    const tiles = [];
    const owner = new Int16Array(W * H).fill(-1); // which tile each pixel belongs to
    for (let row = 0; row < rows; row++) {
      const y0 = ys[row] + (row > 0 ? t : 0), y1 = ys[row + 1] - (row < rows - 1 ? t : 0);
      for (let col = 0; col < cols; col++) {
        const x0 = xs[col] + (col > 0 ? t : 0), x1 = xs[col + 1] - (col < cols - 1 ? t : 0);
        const tile = tiles.length;
        tiles.push({ row, col, x0, x1, y0, y1 });
        for (let y = y0; y < y1; y++) owner.fill(tile, y * W + x0, y * W + x1);
      }
    }
    if (joints) addJoints(owner, labels, W, H, cols, rows, xs, ys, joints);
    const out = new Int16Array(W * H).fill(-1);
    for (let i = 0; i < W * H; i++) if (labels[i] >= 0 && owner[i] >= 0) out[i] = labels[i] + count * owner[i];
    return { labels: out, tiles };
  }

  // Jigsaw joints, in mm: a knob is a round head of radius `head` on a neck `neck` wide and
  // `neckLength` long, so it reaches neckLength + 2 * head across the cut. A cut longer than
  // `longSeam` gets two.
  const JOINT = { head: 3.5, neck: 4, neckLength: 2, longSeam: 150 };
  const jointReach = () => JOINT.neckLength + 2 * JOINT.head;

  // Moves knobs from one tile into the next along every cut between tiles, in owner (the tile
  // of each pixel). Knobs alternate in direction, shrink to fit short cuts and small tiles,
  // and are left out where either side is mostly empty. Then `gap` pixels are cleared along
  // one side of every join, so the pieces fit together. j: { head, neck, neckLength,
  // longSeam, gap }, in pixels.
  function addJoints(owner, labels, W, H, cols, rows, xs, ys, j) {
    const solid = (list, tile) => list.filter(p => owner[p] === tile && labels[p] >= 0).length >= 0.8 * list.length;

    // A knob on the cut at `line`, centred `centre` along it, belonging to tile a and reaching
    // into tile b, in direction dir (+1 = towards larger x or y), at k times full size.
    function knob(vertical, line, centre, a, b, dir, k) {
      const R = j.head * k, half = j.neck * k / 2, neck = j.neckLength * k, cu = neck + R, reach = neck + 2 * R;
      const inside = (u, v) => u >= 0 && u <= reach && ((u <= cu && Math.abs(v) <= half) || (u - cu) ** 2 + v ** 2 <= R * R);
      const into = [], behind = [];
      for (let du = -Math.ceil(reach) - 1; du <= Math.ceil(reach) + 1; du++) {
        for (let dv = -Math.ceil(R) - 1; dv <= Math.ceil(R) + 1; dv++) {
          const across = Math.floor(line) + du, along = Math.floor(centre) + dv;
          const x = vertical ? across : along, y = vertical ? along : across;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const u = dir * (across + 0.5 - line), v = along + 0.5 - centre, p = y * W + x;
          if (inside(u, v)) into.push(p);
          else if (inside(-u, v)) behind.push(p);
        }
      }
      if (!into.length || !solid(into, b) || !solid(behind, a)) return;
      for (const p of into) if (owner[p] === b) owner[p] = a;
    }

    function seam(vertical, line, from, to, lo, hi, across, parity) {
      const len = to - from, n = len > j.longSeam ? 2 : 1;
      const k = Math.min(1, 0.8 * len / (n + 1) / (2 * j.head), across / 3 / (j.neckLength + 2 * j.head));
      for (let i = 0; i < n; i++) {
        const dir = (parity + i) % 2 ? 1 : -1;
        knob(vertical, line, from + len * (i + 1) / (n + 1), dir > 0 ? lo : hi, dir > 0 ? hi : lo, dir, k);
      }
    }
    const width = (e, k) => Math.min(e[k] - e[k - 1], e[k + 1] - e[k]);
    for (let row = 0; row < rows; row++) {
      for (let col = 1; col < cols; col++) seam(true, xs[col], ys[row], ys[row + 1], row * cols + col - 1, row * cols + col, width(xs, col), row + col);
    }
    for (let row = 1; row < rows; row++) {
      for (let col = 0; col < cols; col++) seam(false, ys[row], xs[col], xs[col + 1], (row - 1) * cols + col, row * cols + col, width(ys, row), row + col);
    }

    // The gap: cleared from the lower-numbered tile's side of each join, within gap - 0.5
    // pixels of its edge, so one pixel is a one pixel gap.
    if (!(j.gap > 0)) return;
    const edges = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x, o = owner[p];
        if (o < 0 || labels[p] < 0) continue;
        for (const q of [x + 1 < W ? p + 1 : -1, y + 1 < H ? p + W : -1, x > 0 ? p - 1 : -1, y > 0 ? p - W : -1]) {
          if (q >= 0 && owner[q] > o && labels[q] >= 0) { edges.push(p, o); break; }
        }
      }
    }
    const r = j.gap - 0.5, ri = Math.ceil(r);
    for (let e = 0; e < edges.length; e += 2) {
      const p = edges[e], o = edges[e + 1], x = p % W, y = (p - x) / W;
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          if (dx * dx + dy * dy >= r * r) continue;
          const qx = x + dx, qy = y + dy;
          if (qx >= 0 && qy >= 0 && qx < W && qy < H && owner[qy * W + qx] === o) owner[qy * W + qx] = -1;
        }
      }
    }
  }

  // The trace of a tiled grid as seen by one tile, with its labels back to what they were and
  // everything else counting as empty, ready for build. Returns null if the tile is empty.
  function tileGraph(g, tile, count) {
    const own = l => (l >= 0 && Math.floor(l / count) === tile ? l % count : -1);
    const polys = new Map();
    for (const [l, list] of g.polys) if (own(l) >= 0) polys.set(own(l), list);
    if (!polys.size) return null;
    const chains = g.chains.filter(c => own(c.left) >= 0 || own(c.right) >= 0)
      .map(c => Object.assign({}, c, { left: own(c.left), right: own(c.right) }));
    return Object.assign({}, g, { polys, chains });
  }

  // A copy of a mesh moved by (dx, dy) mm.
  function moved(mesh, dx, dy) {
    const positions = Float32Array.from(mesh.positions);
    for (let k = 0; k < positions.length; k += 3) { positions[k] += dx; positions[k + 1] += dy; }
    return { positions, indices: mesh.indices };
  }

  // Whether a w x d part fits a bedW x bedD bed: 'fits', 'turn' (only if turned 90 degrees) or
  // 'no'.
  function fitsBed(w, d, bedW, bedD) {
    const within = (a, b, x, y) => a <= x + 0.01 && b <= y + 0.01;
    if (within(w, d, bedW, bedD)) return 'fits';
    return within(d, w, bedW, bedD) ? 'turn' : 'no';
  }

  // g: result of contours.trace on traceLabels(...).
  // palette: [{ name, filament: '#RRGGBB', height, ownHeight }]. A colour with ownHeight keeps
  // its height in a flat model too, as a border does. scale: mm per pixel.
  // settings: { mode: 'flat' | 'layered', thickness, layerHeight, base: { type, thickness, colorIndex } }
  // Returns { parts: [{ name, color, mesh }], body, zTop, swaps, warnings }.
  function build(g, palette, settings, scale) {
    const K = palette.length;
    const lh = settings.layerHeight > 0 ? settings.layerHeight : 0;
    const snap = z => round(lh ? Math.max(lh, Math.round(z / lh) * lh) : Math.max(z, 0.05));
    const hasBase = settings.base.type !== 'none';
    const z0 = hasBase ? snap(settings.base.thickness) : 0;
    const baseIdx = Math.min(Math.max(settings.base.colorIndex || 0, 0), K - 1);
    const warnings = [];

    const present = [];
    for (const l of g.polys.keys()) if (l < K) present.push(l);
    present.sort((a, b) => a - b);

    const zTop = [];
    for (const l of present) {
      zTop[l] = round(z0 + (settings.mode === 'flat' && !palette[l].ownHeight ? snap(settings.thickness) : snap(palette[l].height)));
    }

    const parts = [];
    const columns = []; // { from, to, area } of each part, for working out layer bands
    if (hasBase) {
      const zt = [];
      for (const l of g.polys.keys()) zt[l] = z0;
      const mesh = L3D.mesh.buildSolid(g, zt, 0, scale);
      parts.push({ name: 'Base', color: palette[baseIdx].filament, mesh });
      columns.push({ from: 0, to: z0, area: L3D.mesh.volume(mesh) / z0 });
    }
    for (const l of present) {
      const zt = [];
      zt[l] = zTop[l];
      const mesh = L3D.mesh.buildSolid(g, zt, z0, scale);
      parts.push({ name: palette[l].name, color: palette[l].filament, mesh });
      columns.push({ from: z0, to: zTop[l], area: L3D.mesh.volume(mesh) / (zTop[l] - z0) });
    }

    // One stepped solid holding every colour (and the plate), for single-extruder printing.
    const bodyTop = zTop.slice();
    if (settings.base.type === 'rect' && g.polys.has(K)) bodyTop[K] = z0;
    const body = L3D.mesh.buildSolid(g, bodyTop, 0, scale);

    // Filament changes for a single extruder: each colour must be loaded while its top
    // layers print, so colours are stacked in order of height. A change is reported as the
    // first layer printed in the new colour (identified by its top Z, as slicers show it),
    // i.e. one layer above where the previous colour ends. Each filament prints a whole band
    // of layers, so `volume` is that band of the single body (mm³), not one colour's part.
    const swaps = [];
    const nextLayer = z => round(z + lh);
    if (settings.mode === 'layered' && present.length) {
      const order = present.slice().sort((a, b) => zTop[a] - zTop[b]);
      const same = (a, b) => a.filament.toLowerCase() === b.filament.toLowerCase();
      let cur = hasBase ? palette[baseIdx] : palette[order[0]];
      swaps.push({ z: 0, from: 0, name: cur.name, color: cur.filament });
      let prevTop = z0;
      for (let k = 0; k < order.length; k++) {
        const p = palette[order[k]];
        if (!same(p, cur)) {
          swaps.push({ z: nextLayer(prevTop), from: prevTop, name: p.name, color: p.filament });
          cur = p;
        }
        prevTop = zTop[order[k]];
      }
      for (let k = 1; k < order.length; k++) {
        const a = palette[order[k - 1]], b = palette[order[k]];
        if (zTop[order[k - 1]] === zTop[order[k]] && !same(a, b)) {
          warnings.push(`“${a.name}” and “${b.name}” have the same height, so a single extruder can't show both colors. Give them different heights, or print on a multi-color printer.`);
        }
      }
    }

    swaps.forEach((sw, k) => {
      const end = k + 1 < swaps.length ? swaps[k + 1].from : Infinity;
      sw.volume = columns.reduce((v, c) => v + c.area * Math.max(0, Math.min(c.to, end) - Math.max(c.from, sw.from)), 0);
    });

    return { parts, body, zTop, z0, swaps, warnings };
  }

  L3D.model = { traceLabels, gridSize, addSquare, addOutline, addBorder, tilesFor, tileLabels, tileGraph, moved, JOINT, jointReach, outlineGrowth, maxCornerRadius, fitsBed, build };
})(globalThis.L3D = globalThis.L3D || {});
