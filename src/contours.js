// Traces the regions of a label grid into outlines.
//
// Every border between two labels is stored once, as a "chain" running between junction
// points (where three labels meet). The polygons of the regions on both sides of a border
// are built from that same chain, so neighbouring colors share their edges exactly: no
// gaps, no overlaps, and no T-junctions in the meshes built from them.
//
// Coordinates are in pixels with y pointing up: the pixel in row r, column c of the image
// covers x in [c, c+1] and y in [H-1-r, H-r].
(function (L3D) {
  'use strict';

  // How far into a pixel a corner is pulled when pixels only touch diagonally.
  const SPLIT = 0.2;
  // Douglas-Peucker tolerance, in pixels, used when smoothing.
  const SMOOTH_TOL = 0.3;

  // Directions: 0 = N, 1 = E, 2 = S, 3 = W.
  const DX = [0, 1, 0, -1];
  const DY = [1, 0, -1, 0];
  const OPP = [2, 3, 0, 1];

  // labels: Int16Array (row-major, top row first, -1 = empty), W x H.
  // Returns { W, H, px, py, chains, polys }:
  //   px/py   point coordinates, indexed by point id
  //   chains  [{ ids, closed, left, right, startV, endV }]: ids are point ids; `left` is the
  //           label on the left when walking the chain forwards. Open chains start and end
  //           at junction points (startV / endV).
  //   polys   Map label -> [{ outer: ids, holes: [ids] }]: outer is counter-clockwise,
  //           holes clockwise.
  function trace(labels, W, H, opts) {
    const smooth = !opts || opts.smooth !== false;

    function lab(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return -1;
      return labels[(H - 1 - y) * W + x];
    }
    // [left, right] labels of the unit edge leaving corner (i, j) in direction d.
    function sides(i, j, d) {
      switch (d) {
        case 0: return [lab(i - 1, j), lab(i, j)];
        case 1: return [lab(i, j), lab(i, j - 1)];
        case 2: return [lab(i, j - 1), lab(i - 1, j - 1)];
        default: return [lab(i - 1, j - 1), lab(i - 1, j)];
      }
    }
    function isBoundary(i, j, d) {
      const s = sides(i, j, d);
      return s[0] !== s[1];
    }

    // Visited flags for vertical edges (i,j)-(i,j+1) and horizontal edges (i,j)-(i+1,j).
    const vVis = new Uint8Array((W + 1) * H);
    const hVis = new Uint8Array(W * (H + 1));
    function edgeSlot(i, j, d) {
      if (d === 0) return [vVis, j * (W + 1) + i];
      if (d === 2) return [vVis, (j - 1) * (W + 1) + i];
      if (d === 1) return [hVis, j * W + i];
      return [hVis, j * W + i - 1];
    }

    let maxLabel = -1;
    for (let k = 0; k < labels.length; k++) if (labels[k] > maxLabel) maxLabel = labels[k];
    const counts = new Float64Array(maxLabel + 1);
    for (let k = 0; k < labels.length; k++) if (labels[k] >= 0) counts[labels[k]]++;

    // When two labels touch only diagonally, decide which one stays connected: material
    // over empty, then the rarer label (thin lines are usually the minority color).
    function connectFirst(a, b) {
      if (a < 0) return false;
      if (b < 0) return true;
      if (counts[a] !== counts[b]) return counts[a] < counts[b];
      return a < b;
    }

    const px = [], py = [];
    function addPoint(x, y) { px.push(x); py.push(y); return px.length - 1; }

    // Junction corners: key -> point id for each of the 4 directions (-1 = no border there).
    // A corner with four borders (pixels touching only diagonally) is split into two points,
    // each pulled into one of the pixels on the separated diagonal; the other diagonal then
    // connects through the gap. Every point ends up with exactly 2 or 3 borders, which keeps
    // the regions simple polygons and the meshes manifold.
    const junction = new Map();
    const bridges = [];
    for (let j = 0; j <= H; j++) {
      for (let i = 0; i <= W; i++) {
        const ne = lab(i, j), nw = lab(i - 1, j), sw = lab(i - 1, j - 1), se = lab(i, j - 1);
        const bN = nw !== ne, bE = ne !== se, bS = sw !== se, bW = nw !== sw;
        const deg = bN + bE + bS + bW;
        if (deg < 3) continue;
        const key = j * (W + 1) + i;
        if (deg === 3) {
          const p = addPoint(i, j);
          junction.set(key, [bN ? p : -1, bE ? p : -1, bS ? p : -1, bW ? p : -1]);
          continue;
        }
        let connectNESW;
        if (ne === sw && nw === se) connectNESW = connectFirst(ne, nw);
        else connectNESW = ne === sw;
        if (connectNESW) {
          const a = addPoint(i - SPLIT, j + SPLIT); // inside NW pixel: borders N and W
          const b = addPoint(i + SPLIT, j - SPLIT); // inside SE pixel: borders E and S
          junction.set(key, [a, b, b, a]);
        } else {
          const a = addPoint(i + SPLIT, j + SPLIT); // inside NE pixel: borders N and E
          const b = addPoint(i - SPLIT, j - SPLIT); // inside SW pixel: borders S and W
          junction.set(key, [a, a, b, b]);
          // Four different labels: NW and SE meet along a short diagonal border.
          if (nw !== se) bridges.push({ i, j, a, b, left: se, right: nw });
        }
      }
    }

    const chains = [];

    function walk(i, j, d, startPid) {
      const [left, right] = sides(i, j, d);
      const i0 = i, j0 = j;
      const cs = [i, j];
      let endPid = -1;
      for (;;) {
        const [arr, k] = edgeSlot(i, j, d);
        arr[k] = 1;
        i += DX[d];
        j += DY[d];
        const jn = junction.get(j * (W + 1) + i);
        if (jn) { cs.push(i, j); endPid = jn[OPP[d]]; break; }
        if (startPid < 0 && i === i0 && j === j0) break;
        cs.push(i, j);
        let nd = -1;
        for (let k2 = 0; k2 < 4; k2++) if (k2 !== OPP[d] && isBoundary(i, j, k2)) { nd = k2; break; }
        d = nd;
      }
      chains.push(finishChain(cs, startPid, endPid, left, right));
    }

    for (const [key, jn] of junction) {
      const i = key % (W + 1), j = (key - i) / (W + 1);
      for (let d = 0; d < 4; d++) {
        if (jn[d] < 0) continue;
        const [arr, k] = edgeSlot(i, j, d);
        if (!arr[k]) walk(i, j, d, jn[d]);
      }
    }
    // Whatever is left are closed borders with no junction on them.
    for (let j = 0; j < H; j++) {
      for (let i = 0; i <= W; i++) {
        if (!vVis[j * (W + 1) + i] && isBoundary(i, j, 0)) walk(i, j, 0, -1);
      }
    }
    for (const b of bridges) {
      chains.push({ ids: Int32Array.of(b.a, b.b), cs: [b.i, b.j, b.i, b.j], closed: false,
        left: b.left, right: b.right, startV: b.a, endV: b.b });
    }

    // Turn a walked chain of pixel corners into its final points.
    function finishChain(cs, startPid, endPid, left, right) {
      const closed = startPid < 0;
      const n = cs.length / 2;
      let xs = [], ys = [];
      if (closed) {
        if (smooth) {
          for (let k = 0; k < n; k++) {
            const k2 = (k + 1) % n;
            xs.push((cs[2 * k] + cs[2 * k2]) / 2);
            ys.push((cs[2 * k + 1] + cs[2 * k2 + 1]) / 2);
          }
          [xs, ys] = simplifyClosed(xs, ys, SMOOTH_TOL);
        } else {
          for (let k = 0; k < n; k++) { xs.push(cs[2 * k]); ys.push(cs[2 * k + 1]); }
          [xs, ys] = dropCollinear(xs, ys, true);
        }
        const ids = new Int32Array(xs.length);
        for (let k = 0; k < xs.length; k++) ids[k] = addPoint(xs[k], ys[k]);
        return { ids, cs, closed: true, left, right, startV: -1, endV: -1 };
      }
      xs.push(px[startPid]);
      ys.push(py[startPid]);
      if (smooth) {
        for (let k = 0; k < n - 1; k++) {
          xs.push((cs[2 * k] + cs[2 * k + 2]) / 2);
          ys.push((cs[2 * k + 1] + cs[2 * k + 3]) / 2);
        }
      } else {
        for (let k = 1; k < n - 1; k++) { xs.push(cs[2 * k]); ys.push(cs[2 * k + 1]); }
      }
      xs.push(px[endPid]);
      ys.push(py[endPid]);
      [xs, ys] = smooth ? simplifyOpen(xs, ys, SMOOTH_TOL) : dropCollinear(xs, ys, false);
      const ids = new Int32Array(xs.length);
      ids[0] = startPid;
      ids[xs.length - 1] = endPid;
      for (let k = 1; k < xs.length - 1; k++) ids[k] = addPoint(xs[k], ys[k]);
      return { ids, cs, closed: false, left, right, startV: startPid, endV: endPid };
    }

    const polys = buildPolygons(chains);
    return { W, H, px: Float64Array.from(px), py: Float64Array.from(py), chains, polys };
  }

  // Group chains into closed loops per label, then sort loops into outlines and holes.
  function buildPolygons(chains) {
    const byLabel = new Map();
    chains.forEach((c, ci) => {
      for (const [l, rev] of [[c.left, false], [c.right, true]]) {
        if (l < 0) continue;
        if (!byLabel.has(l)) byLabel.set(l, []);
        byLabel.get(l).push({ c: ci, rev });
      }
    });

    const polys = new Map();
    for (const [l, refs] of byLabel) {
      const loops = [];
      const out = new Map();
      for (const r of refs) {
        const c = chains[r.c];
        if (c.closed) loops.push([r]);
        else out.set(r.rev ? c.endV : c.startV, r);
      }
      for (const start of Array.from(out.keys())) {
        let r = out.get(start);
        if (!r) continue;
        const loop = [];
        for (;;) {
          const c = chains[r.c];
          out.delete(r.rev ? c.endV : c.startV);
          loop.push(r);
          const v = r.rev ? c.startV : c.endV;
          if (v === start) break;
          r = out.get(v);
          if (!r) throw new Error('Unclosed outline for label ' + l);
        }
        loops.push(loop);
      }

      const outers = [], holes = [];
      for (const loop of loops) {
        const raw = loopCorners(chains, loop);
        const area = signedArea(raw);
        const item = { ids: loopIds(chains, loop), raw, area: Math.abs(area), box: bbox(raw) };
        (area > 0 ? outers : holes).push(item);
      }
      outers.sort((a, b) => a.area - b.area);
      const list = outers.map(o => ({ o, holes: [] }));
      for (const h of holes) {
        const t = holeTestPoint(h.raw);
        if (!t) continue;
        const parent = list.find(e => inBox(t, e.o.box) && pointInPolygon(t[0], t[1], e.o.raw));
        if (parent) parent.holes.push(h.ids);
      }
      polys.set(l, list.map(e => ({ outer: e.o.ids, holes: e.holes })));
    }
    return polys;
  }

  // Point ids around a loop, without repeating the shared end points of consecutive chains.
  function loopIds(chains, loop) {
    const ids = [];
    for (const r of loop) {
      const a = chains[r.c].ids, n = a.length;
      if (chains[r.c].closed) {
        if (r.rev) for (let k = n - 1; k >= 0; k--) ids.push(a[k]);
        else for (let k = 0; k < n; k++) ids.push(a[k]);
      } else if (r.rev) {
        for (let k = n - 1; k > 0; k--) ids.push(a[k]);
      } else {
        for (let k = 0; k < n - 1; k++) ids.push(a[k]);
      }
    }
    return ids;
  }

  // The loop's original pixel corners (flat x,y list), used for exact area and containment.
  function loopCorners(chains, loop) {
    const raw = [];
    for (const r of loop) {
      const cs = chains[r.c].cs, n = cs.length / 2;
      if (chains[r.c].closed) {
        for (let k = 0; k < n; k++) {
          const m = r.rev ? n - 1 - k : k;
          raw.push(cs[2 * m], cs[2 * m + 1]);
        }
      } else {
        for (let k = 0; k < n - 1; k++) {
          const m = r.rev ? n - 1 - k : k;
          raw.push(cs[2 * m], cs[2 * m + 1]);
        }
      }
    }
    return raw;
  }

  function signedArea(raw) {
    let a = 0;
    const n = raw.length / 2;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      a += raw[2 * k] * raw[2 * k2 + 1] - raw[2 * k2] * raw[2 * k + 1];
    }
    return a / 2;
  }

  function bbox(raw) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < raw.length; k += 2) {
      x0 = Math.min(x0, raw[k]); x1 = Math.max(x1, raw[k]);
      y0 = Math.min(y0, raw[k + 1]); y1 = Math.max(y1, raw[k + 1]);
    }
    return [x0, y0, x1, y1];
  }

  function inBox(t, b) {
    return t[0] > b[0] && t[0] < b[2] && t[1] > b[1] && t[1] < b[3];
  }

  // Centre of the pixel just inside a hole (to the right of its first edge). Pixel centres
  // never lie on an outline, so the containment test below is never ambiguous.
  function holeTestPoint(raw) {
    const n = raw.length / 2;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const dx = raw[2 * k2] - raw[2 * k], dy = raw[2 * k2 + 1] - raw[2 * k + 1];
      if (dx === 0 && dy === 0) continue;
      return [(raw[2 * k] + raw[2 * k2]) / 2 + dy / 2, (raw[2 * k + 1] + raw[2 * k2 + 1]) / 2 - dx / 2];
    }
    return null;
  }

  function pointInPolygon(x, y, raw) {
    let inside = false;
    const n = raw.length / 2;
    for (let k = 0, m = n - 1; k < n; m = k++) {
      const xk = raw[2 * k], yk = raw[2 * k + 1], xm = raw[2 * m], ym = raw[2 * m + 1];
      if ((yk > y) !== (ym > y) && x < (xm - xk) * (y - yk) / (ym - yk) + xk) inside = !inside;
    }
    return inside;
  }

  function dropCollinear(xs, ys, closed) {
    const n = xs.length;
    const keep = [];
    for (let k = 0; k < n; k++) {
      if (!closed && (k === 0 || k === n - 1)) { keep.push(k); continue; }
      const a = (k - 1 + n) % n, b = (k + 1) % n;
      const cross = (xs[k] - xs[a]) * (ys[b] - ys[k]) - (ys[k] - ys[a]) * (xs[b] - xs[k]);
      if (Math.abs(cross) > 1e-9) keep.push(k);
    }
    if (closed && keep.length < 3) return [xs, ys];
    return [keep.map(k => xs[k]), keep.map(k => ys[k])];
  }

  function segDist(x, y, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((x - x0) * dx + (y - y0) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = x0 + t * dx - x, ey = y0 + t * dy - y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  // Douglas-Peucker: marks in `keep` the points between a and b needed to stay within tol.
  function dpMark(xs, ys, a, b, tol, keep) {
    const stack = [a, b];
    while (stack.length) {
      const e = stack.pop(), s = stack.pop();
      let maxD = -1, idx = -1;
      for (let k = s + 1; k < e; k++) {
        const d = segDist(xs[k], ys[k], xs[s], ys[s], xs[e], ys[e]);
        if (d > maxD) { maxD = d; idx = k; }
      }
      if (idx >= 0 && maxD > tol) {
        keep[idx] = 1;
        stack.push(s, idx, idx, e);
      }
    }
  }

  function simplifyOpen(xs, ys, tol) {
    const n = xs.length;
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    dpMark(xs, ys, 0, n - 1, tol, keep);
    const ox = [], oy = [];
    for (let k = 0; k < n; k++) if (keep[k]) { ox.push(xs[k]); oy.push(ys[k]); }
    return [ox, oy];
  }

  function simplifyClosed(xs, ys, tol) {
    const n = xs.length;
    let far = 0, farD = -1;
    for (let k = 1; k < n; k++) {
      const d = Math.hypot(xs[k] - xs[0], ys[k] - ys[0]);
      if (d > farD) { farD = d; far = k; }
    }
    const ex = xs.concat(xs[0]), ey = ys.concat(ys[0]);
    const keep = new Uint8Array(n + 1);
    keep[0] = keep[far] = keep[n] = 1;
    dpMark(ex, ey, 0, far, tol, keep);
    dpMark(ex, ey, far, n, tol, keep);
    const ox = [], oy = [];
    for (let k = 0; k < n; k++) if (keep[k]) { ox.push(xs[k]); oy.push(ys[k]); }
    if (ox.length < 3) return [xs, ys];
    return [ox, oy];
  }

  L3D.contours = { trace };
})(globalThis.L3D = globalThis.L3D || {});
