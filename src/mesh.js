// Builds closed triangle meshes from traced outlines (see contours.js).
(function (L3D) {
  'use strict';

  // Earcut occasionally leaves an outline point in the middle of a triangle edge (a crack)
  // when many points share an x coordinate, as pixel outlines do. A complete triangulation
  // has exactly points + 2 * holes - 2 triangles, so retry on slightly rotated copies of the
  // coordinates until the count is right; the rotation doesn't change the indices returned.
  const RETRY_ANGLES = [0, 0.001, 0.0137, 0.1, 0.37, 0.71];

  function triangulate(g, poly) {
    const all = poly.outer.concat(...poly.holes);
    const expected = all.length + 2 * poly.holes.length - 2;
    let faces = null;
    for (const ang of RETRY_ANGLES) {
      const c = Math.cos(ang), s = Math.sin(ang);
      const toVecs = ids => ids.map(id => new THREE.Vector2(g.px[id] * c - g.py[id] * s, g.px[id] * s + g.py[id] * c));
      faces = THREE.ShapeUtils.triangulateShape(toVecs(poly.outer), poly.holes.map(toVecs));
      if (faces.length === expected) break;
    }
    return { faces, all };
  }

  // Triangulates a polygon (outer outline + holes, as point ids) once and caches it on the
  // polygon. Triangles are counter-clockwise seen from above.
  function capTriangles(g, poly) {
    if (poly.tris) return poly.tris;
    const { faces, all } = triangulate(g, poly);
    const tris = new Int32Array(faces.length * 3);
    let area = 0;
    faces.forEach((f, k) => {
      const a = all[f[0]], b = all[f[1]], c = all[f[2]];
      tris[3 * k] = a; tris[3 * k + 1] = b; tris[3 * k + 2] = c;
      area += (g.px[b] - g.px[a]) * (g.py[c] - g.py[a]) - (g.px[c] - g.px[a]) * (g.py[b] - g.py[a]);
    });
    if (area < 0) {
      for (let k = 0; k < tris.length; k += 3) { const t = tris[k + 1]; tris[k + 1] = tris[k + 2]; tris[k + 2] = t; }
    }
    removeSlivers(g, tris);
    poly.tris = tris;
    return tris;
  }

  function cross2(g, a, b, c) {
    return (g.px[b] - g.px[a]) * (g.py[c] - g.py[a]) - (g.px[c] - g.px[a]) * (g.py[b] - g.py[a]);
  }

  // Three outline points in a straight line give earcut a zero-area triangle. Its long edge
  // then appears in the cap twice, which breaks the edge pairing when two caps meet there.
  // Flip that long edge with the neighbouring triangle: (a, m, c) + (c, a, x) become
  // (a, m, x) + (m, c, x), both with real area.
  function removeSlivers(g, tris) {
    const d2 = (p, q) => (g.px[p] - g.px[q]) ** 2 + (g.py[p] - g.py[q]) ** 2;
    for (let pass = 0; pass < 8; pass++) {
      let flipped = false;
      for (let k = 0; k < tris.length; k += 3) {
        const t = [tris[k], tris[k + 1], tris[k + 2]];
        if (Math.abs(cross2(g, t[0], t[1], t[2])) > 1e-9) continue;
        // Long edge a -> c (in triangle order), middle point m.
        let e = 0, best = -1;
        for (let i = 0; i < 3; i++) {
          const len = d2(t[i], t[(i + 1) % 3]);
          if (len > best) { best = len; e = i; }
        }
        const a = t[e], c = t[(e + 1) % 3], m = t[(e + 2) % 3];
        let nk = -1, x = -1;
        for (let j = 0; j < tris.length && nk < 0; j += 3) {
          for (let i = 0; i < 3; i++) {
            if (tris[j + i] === c && tris[j + (i + 1) % 3] === a) { nk = j; x = tris[j + (i + 2) % 3]; break; }
          }
        }
        if (nk < 0 || Math.abs(cross2(g, a, m, x)) < 1e-9 || Math.abs(cross2(g, m, c, x)) < 1e-9) continue;
        tris[k] = a; tris[k + 1] = m; tris[k + 2] = x;
        tris[nk] = m; tris[nk + 1] = c; tris[nk + 2] = x;
        for (const o of [k, nk]) {
          if (cross2(g, tris[o], tris[o + 1], tris[o + 2]) < 0) { const s = tris[o + 1]; tris[o + 1] = tris[o + 2]; tris[o + 2] = s; }
        }
        flipped = true;
      }
      if (!flipped) break;
    }
  }

  // One closed mesh for the labels that have a height in zTop (zTop[label] = top height in
  // mm; null/undefined leaves that label out). Every included region spans z0..zTop.
  // Walls are only built where the height changes, so a single call can produce one
  // colour's part, a base plate, or one stepped body holding all colours.
  // scale = mm per pixel. The result is centred on x/y = 0.
  function buildSolid(g, zTop, z0, scale) {
    const top = l => (l >= 0 && l < zTop.length && zTop[l] != null) ? zTop[l] : null;
    const levels = [z0];
    for (const z of zTop) if (z != null && levels.indexOf(z) < 0) levels.push(z);
    const levelIndex = new Map(levels.map((z, k) => [z, k]));
    const nL = levels.length;
    const cx = g.W / 2, cy = g.H / 2;

    const pos = [];
    const idx = [];
    const vmap = new Map();
    function v(pid, z) {
      const key = pid * nL + levelIndex.get(z);
      let k = vmap.get(key);
      if (k === undefined) {
        k = pos.length / 3;
        pos.push((g.px[pid] - cx) * scale, (g.py[pid] - cy) * scale, z);
        vmap.set(key, k);
      }
      return k;
    }

    // Top and bottom faces.
    for (const [l, list] of g.polys) {
      const zt = top(l);
      if (zt == null) continue;
      for (const poly of list) {
        const t = capTriangles(g, poly);
        for (let k = 0; k < t.length; k += 3) {
          idx.push(v(t[k], zt), v(t[k + 1], zt), v(t[k + 2], zt));
          idx.push(v(t[k], z0), v(t[k + 2], z0), v(t[k + 1], z0));
        }
      }
    }

    // Heights present at each junction. Walls meeting there are split at every one of them
    // so neighbouring faces always share whole edges.
    const jl = new Map();
    const addLevel = (pid, z) => {
      let s = jl.get(pid);
      if (!s) jl.set(pid, s = []);
      if (s.indexOf(z) < 0) s.push(z);
    };
    for (const c of g.chains) {
      if (c.closed) continue;
      const a = top(c.left), b = top(c.right);
      if (a == null && b == null) continue;
      for (const pid of [c.startV, c.endV]) {
        addLevel(pid, z0);
        if (a != null) addLevel(pid, a);
        if (b != null) addLevel(pid, b);
      }
    }
    for (const s of jl.values()) s.sort((p, q) => p - q);
    const clip = (s, lo, hi) => s.filter(z => z >= lo && z <= hi);

    // Walls, facing the lower (or empty) side.
    for (const c of g.chains) {
      const a = top(c.left), b = top(c.right);
      let lo, hi, faceRight;
      if (a != null && b != null) {
        if (a === b) continue;
        lo = Math.min(a, b); hi = Math.max(a, b); faceRight = a > b;
      } else if (a != null) {
        lo = z0; hi = a; faceRight = true;
      } else if (b != null) {
        lo = z0; hi = b; faceRight = false;
      } else {
        continue;
      }
      const ids = c.ids, n = ids.length;
      const segs = c.closed ? n : n - 1;
      const span = [lo, hi];
      for (let k = 0; k < segs; k++) {
        const p = ids[k], q = ids[(k + 1) % n];
        const Lz = !c.closed && k === 0 ? clip(jl.get(p), lo, hi) : span;
        const Rz = !c.closed && k === segs - 1 ? clip(jl.get(q), lo, hi) : span;
        wallStrip(p, Lz, q, Rz, faceRight);
      }
    }

    // Triangulates the vertical strip between point p (heights Lz) and q (heights Rz).
    function wallStrip(p, Lz, q, Rz, faceRight) {
      let i = 0, j = 0;
      while (i < Lz.length - 1 || j < Rz.length - 1) {
        let t;
        if (j < Rz.length - 1 && (i === Lz.length - 1 || Rz[j + 1] <= Lz[i + 1])) {
          t = [v(p, Lz[i]), v(q, Rz[j]), v(q, Rz[j + 1])];
          j++;
        } else {
          t = [v(p, Lz[i]), v(q, Rz[j]), v(p, Lz[i + 1])];
          i++;
        }
        if (faceRight) idx.push(t[0], t[1], t[2]);
        else idx.push(t[0], t[2], t[1]);
      }
    }

    return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
  }

  // Number of directed edges that are not matched by exactly one opposite edge.
  // 0 means the mesh is closed (watertight) and consistently oriented.
  function openEdges(mesh) {
    const t = mesh.indices, nV = mesh.positions.length / 3;
    const m = new Map();
    for (let k = 0; k < t.length; k += 3) {
      for (let e = 0; e < 3; e++) {
        const key = t[k + e] * nV + t[k + (e + 1) % 3];
        m.set(key, (m.get(key) || 0) + 1);
      }
    }
    let bad = 0;
    for (const [key, n] of m) {
      const a = Math.floor(key / nV), b = key - a * nV;
      if (n !== 1 || m.get(b * nV + a) !== 1) bad++;
    }
    return bad;
  }

  function volume(mesh) {
    const p = mesh.positions, t = mesh.indices;
    let vol = 0;
    for (let k = 0; k < t.length; k += 3) {
      const a = 3 * t[k], b = 3 * t[k + 1], c = 3 * t[k + 2];
      vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
           - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
           + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    return vol / 6;
  }

  function bounds(meshes) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const m of meshes) {
      const p = m.positions;
      for (let k = 0; k < p.length; k += 3) {
        for (let a = 0; a < 3; a++) {
          if (p[k + a] < min[a]) min[a] = p[k + a];
          if (p[k + a] > max[a]) max[a] = p[k + a];
        }
      }
    }
    return { min, max };
  }

  L3D.mesh = { buildSolid, openEdges, volume, bounds };
})(globalThis.L3D = globalThis.L3D || {});
