// Front-lip frame: a separate part the finished print pushes into from the back, face first.
// Printed face down: a lip at the front (z = 0 up) covers the print's edge, a wall surrounds a
// recess shaped like the print, and small bumps behind the print hold it in.
//
// Built as a label grid, so it goes through the same tracing and meshing as the print:
//   label 0 = lip only (inside the recess, outside the visible opening)
//   label 1 = full-height wall (outside the recess, inside the frame's outer edge)
//   label 2 = hanging pocket opening (solid up to the pocket floor, open to the back)
//   label 3 = hanging pocket under its lip (solid to the floor, a gap for the head, the lip)
//   labels 4, 5, 6 = retaining bump: lip, a gap for the print, then a bump, tallest by the wall
(function (L3D) {
  'use strict';

  const FAR = 1e20;
  // Hanging pocket sizes, in mm. The opening is HEAD_CLEARANCE wider than the nail or screw
  // head, and the pocket's lip is RETAIN thick. Behind the lip there is HEAD_SPACE for the
  // head, or less in a thin frame: at least MIN_GAP, leaving a closed front at least SKIN thick.
  const HEAD_CLEARANCE = 0.5;
  const RETAIN = 1;
  const HEAD_SPACE = 2.5;
  const SKIN = 0.8;
  const MIN_GAP = 1.2;
  // Wall (mm) left all around the pocket. These frames are light, so this is enough.
  const POCKET_WALL = 1;

  // Retaining bumps, in mm. Each starts BUMP_GAP behind the print and is BUMP_HEIGHT tall,
  // sloping down away from the wall so the print can snap past it. They reach BUMP_OVERLAP
  // past the print's edge and are BUMP_WIDTH wide. Each side of the print gets one, in its
  // middle, or two if the side is longer than BUMP_LONG_SIDE.
  const BUMP_GAP = 0.3;
  const BUMP_HEIGHT = 1;
  const BUMP_OVERLAP = 0.5;
  const BUMP_WIDTH = 4;
  const BUMP_LONG_SIDE = 200;
  const BUMP_STEPS = 3;

  // Frame depth and border width (mm) a pocket for this head needs.
  const pocketThickness = () => SKIN + MIN_GAP + RETAIN;
  function pocketBorder(head) {
    return Math.ceil((head + HEAD_CLEARANCE + head / 2 + 2 * POCKET_WALL) * 2) / 2;
  }

  // Lip depth (mm) must be more than this for a print of this depth to get bumps.
  const bumpDepth = printDepth => printDepth + BUMP_GAP + BUMP_HEIGHT;

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
  // outside edge), mirrored left-to-right because the print goes in face down. The frame is
  // modelled as seen from its back: top stays top, left and right swap.
  function footprint(labels, W, H, pad) {
    const NW = W + 2 * pad, NH = H + 2 * pad;
    const F = new Uint8Array(NW * NH);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (labels[y * W + x] >= 0) F[(pad + y) * NW + pad + W - 1 - x] = 1;
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

  // Cuts a hanging pocket into the wall at the top of the frame, centred left-to-right on the
  // frame, `wall` pixels from its top edge. Seen from the back: a round opening (radius r)
  // for the head, and above it a cavity of the same width, `rise` higher, under a lip. The
  // lip's arched lower edge rests on the shank, with the head behind it.
  // Returns false, leaving the grid alone, unless `wall` pixels of wall remain all around.
  function cutPocket(grid, W, H, r, rise, wall) {
    let x0 = W, x1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grid[y * W + x] < 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    if (x1 < 0) return false;
    const cx = (x0 + x1 + 1) / 2, col = Math.floor(cx);
    let top = 0;
    while (top < H && grid[top * W + col] !== 1) top++;
    if (top === H) return false;
    // Rows run downwards, so the cavity's centre is `rise` rows above the opening's.
    const capY = top + wall + r, openY = capY + rise, reach = r + wall;
    const bx0 = Math.floor(cx - reach), bx1 = Math.ceil(cx + reach);
    const by0 = Math.floor(capY - reach), by1 = Math.ceil(openY + reach);
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        // Measured to the nearest edge of the pixel, not its centre, so that a pixel only
        // counts as clear of the pocket's wall if all of it is. The one-pixel allowance covers
        // borders that round down to whole pixels.
        const spine = Math.max(capY, Math.min(openY, y + 0.5));
        const dx = Math.max(Math.abs(x + 0.5 - cx) - 0.5, 0), dy = Math.max(Math.abs(y + 0.5 - spine) - 0.5, 0);
        if (Math.hypot(dx, dy) >= reach - 1) continue;
        if (x < 0 || y < 0 || x >= W || y >= H || grid[y * W + x] !== 1) return false;
      }
    }
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const px = x + 0.5 - cx, py = y + 0.5;
        if (Math.hypot(px, py - openY) <= r) grid[y * W + x] = 2;
        else if (Math.hypot(px, py - Math.max(capY, Math.min(openY, py))) <= r && py < openY) grid[y * W + x] = 3;
      }
    }
    return true;
  }

  // Adds retaining bumps to the lip around the inside of the recess, side by side: top,
  // bottom, left and right of each outline. reach = how far a bump comes out from the wall,
  // width = its width, longSide = side length above which a side gets two, clearance = gap
  // between print and recess (all in pixels).
  function addBumps(grid, recess, W, H, reach, width, longSide, clearance) {
    const toWall = distanceSq(Uint8Array.from(recess, v => 1 - v), W, H);
    const half = width / 2;

    function bumpAt(cx, cy) {
      for (let y = Math.floor(cy - half); y <= Math.ceil(cy + half); y++) {
        for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i = y * W + x;
          if (grid[i] !== 0 || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > half) continue;
          const d = Math.sqrt(toWall[i]);
          // d is measured from the centre of the nearest wall pixel, so it runs from 1 (next
          // to the wall) up to reach: spread the steps over that range.
          const along = (d - 1) / Math.max(reach - 1, 1);
          if (d <= reach) grid[i] = 4 + Math.min(BUMP_STEPS - 1, Math.floor(along * BUMP_STEPS));
        }
      }
    }

    // First recess pixel looking in from one side along row or column `line`, within the
    // outline's box. Returns its position along the look direction, or -1.
    function firstHit(line, from, to, horizontal) {
      const step = from < to ? 1 : -1;
      for (let k = from; k !== to + step; k += step) {
        if (recess[horizontal ? line * W + k : k * W + line]) return k;
      }
      return -1;
    }

    // Puts a bump on one side, at position `at` along it: looks in from that side, moving to
    // the nearest row or column with some recess in it if needed (a logo may have a gap).
    function placeOnSide(side, at, box) {
      const horizontal = side === 'left' || side === 'right';
      const lo = horizontal ? box.y0 : box.x0, hi = horizontal ? box.y1 : box.x1;
      const start = horizontal ? box.x0 : box.y0, stop = horizontal ? box.x1 : box.y1;
      const from = side === 'top' || side === 'left' ? start : stop;
      const to = side === 'top' || side === 'left' ? stop : start;
      const mid = Math.floor(at);
      for (let off = 0; off <= hi - lo; off++) {
        for (const line of off ? [mid - off, mid + off] : [mid]) {
          if (line < lo || line > hi) continue;
          const hit = firstHit(line, from, to, horizontal);
          if (hit < 0) continue;
          const face = side === 'top' || side === 'left' ? hit : hit + 1; // the wall's face
          if (horizontal) bumpAt(face, line + 0.5);
          else bumpAt(line + 0.5, face);
          return;
        }
      }
    }

    const g = L3D.contours.trace(Int16Array.from(recess, v => (v ? 0 : -1)), W, H, { smooth: false });
    for (const poly of g.polys.get(0) || []) {
      let x0 = Infinity, x1 = -Infinity, ytop = Infinity, ybot = -Infinity;
      for (const id of poly.outer) {
        const row = H - g.py[id]; // outlines have y up, rows go down
        x0 = Math.min(x0, g.px[id]); x1 = Math.max(x1, g.px[id]);
        ytop = Math.min(ytop, row); ybot = Math.max(ybot, row);
      }
      const box = { x0, x1: x1 - 1, y0: ytop, y1: ybot - 1 };
      const spots = (length, lo) => (length - 2 * clearance > longSide
        ? [lo + length / 3, lo + 2 * length / 3] : [lo + length / 2]);
      for (const at of spots(x1 - x0, x0)) { placeOnSide('top', at, box); placeOnSide('bottom', at, box); }
      for (const at of spots(ybot - ytop, ytop)) { placeOnSide('left', at, box); placeOnSide('right', at, box); }
    }
  }

  // labels: the print's final label grid (W x H). opts (all in pixels): border (frame width
  // outside the recess), lip (how far the lip overlaps the print's edge), clearance (gap
  // between print and recess); optionally pocketRadius, pocketRise and pocketWall for a
  // hanging pocket, and bumpReach, bumpWidth and bumpLongSide for retaining bumps.
  // Returns { labels, W, H, pocketCut } for tracing.
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
    const pocketCut = opts.pocketRadius > 0 &&
      cutPocket(out, NW, NH, opts.pocketRadius, opts.pocketRise, opts.pocketWall || 0);
    if (opts.bumpReach > 0) addBumps(out, recess, NW, NH, opts.bumpReach, opts.bumpWidth, opts.bumpLongSide, opts.clearance);
    return { labels: out, W: NW, H: NH, pocketCut };
  }

  // The frame, as { mesh, pocket, bumps }. pocket is 'none', 'ok', 'thin' (frame too thin) or
  // 'border' (no room in the top border); bumps says whether they were added. Distances in
  // opts are in mm: frameDepth (front to back), lipDepth (back of the frame to the lip),
  // printDepth, head (0 = no pocket). scale = mm per pixel.
  function buildFrame(labels, W, H, opts, scale) {
    const total = opts.frameDepth, lipTop = total - opts.lipDepth;
    const head = opts.head || 0;
    const room = total >= pocketThickness() - 1e-6;
    const bumps = opts.lipDepth > bumpDepth(opts.printDepth) + 1e-6;
    const grid = frameGrid(labels, W, H, {
      border: opts.border / scale, lip: opts.lip / scale, clearance: opts.clearance / scale,
      pocketRadius: head > 0 && room ? (head + HEAD_CLEARANCE) / 2 / scale : 0,
      pocketRise: head / 2 / scale, pocketWall: POCKET_WALL / scale,
      bumpReach: bumps ? (opts.clearance + BUMP_OVERLAP) / scale : 0,
      bumpWidth: BUMP_WIDTH / scale, bumpLongSide: BUMP_LONG_SIDE / scale,
    });
    const g = L3D.contours.trace(grid.labels, grid.W, grid.H, { smooth: opts.smooth });
    const floor = Math.max(SKIN, total - RETAIN - HEAD_SPACE);
    const layers = [
      [[0, lipTop]],
      [[0, total]],
      [[0, floor]],
      [[0, floor], [total - RETAIN, total]],
    ];
    const bumpFrom = lipTop + opts.printDepth + BUMP_GAP;
    for (let s = 0; s < BUMP_STEPS; s++) {
      layers.push([[0, lipTop], [bumpFrom, bumpFrom + BUMP_HEIGHT * (BUMP_STEPS - s) / BUMP_STEPS]]);
    }
    const mesh = L3D.mesh.buildLayers(g, layers, scale);
    const pocket = !head ? 'none' : !room ? 'thin' : grid.pocketCut ? 'ok' : 'border';
    return { mesh, pocket, bumps };
  }

  L3D.frame = { distanceSq, frameGrid, buildFrame, pocketBorder, pocketThickness, bumpDepth };
})(globalThis.L3D = globalThis.L3D || {});
