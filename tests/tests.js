// Geometry checks on small synthetic label grids. Runs in tests.html (or any JS engine with
// three.min.js and the src/ core scripts loaded).
(function (L3D) {
  'use strict';

  // Grid from text rows: '.' = empty, 'a'..'z' = labels 0..25.
  function grid(rows) {
    const H = rows.length, W = rows[0].length;
    const labels = new Int16Array(W * H);
    rows.forEach((r, y) => {
      for (let x = 0; x < W; x++) labels[y * W + x] = r[x] === '.' ? -1 : r.charCodeAt(x) - 97;
    });
    return { labels, W, H };
  }

  function randomGrid(W, H, nLabels, seed) {
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const labels = new Int16Array(W * H);
    for (let k = 0; k < W * H; k++) labels[k] = Math.floor(rnd() * (nLabels + 1)) - 1;
    return { labels, W, H, rnd };
  }

  function countLabels(labels) {
    const c = [];
    for (const l of labels) if (l >= 0) c[l] = (c[l] || 0) + 1;
    return c;
  }

  const close = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-6) * Math.max(1, Math.abs(b));

  // Checks every per-label part and the stepped single body for one grid.
  // exactArea: compare against pixel counts (only valid without smoothing or split corners).
  function checkGrid(name, gd, heights, smooth, exactArea) {
    const errors = [];
    const g = L3D.contours.trace(gd.labels, gd.W, gd.H, { smooth });
    const counts = countLabels(gd.labels);
    let partsVolume = 0;
    for (const l of g.polys.keys()) {
      const zt = [];
      zt[l] = heights[l];
      const m = L3D.mesh.buildSolid(g, zt, 0, 1);
      const open = L3D.mesh.openEdges(m);
      if (open) errors.push(`label ${l}: ${open} open edges`);
      const vol = L3D.mesh.volume(m);
      if (!(vol > 0)) errors.push(`label ${l}: volume ${vol}`);
      if (exactArea && !close(vol, counts[l] * heights[l])) {
        errors.push(`label ${l}: volume ${vol}, expected ${counts[l] * heights[l]}`);
      }
      partsVolume += vol;
    }
    const body = L3D.mesh.buildSolid(g, heights, 0, 1);
    const open = L3D.mesh.openEdges(body);
    if (open) errors.push(`single body: ${open} open edges`);
    if (!close(L3D.mesh.volume(body), partsVolume, 1e-4)) {
      errors.push(`single body volume ${L3D.mesh.volume(body)} != parts ${partsVolume}`);
    }
    return { name: `${name} (smooth ${smooth ? 'on' : 'off'})`, ok: errors.length === 0, errors };
  }

  function run() {
    const results = [];
    const fixed = [
      ['square', ['....', '.aa.', '.aa.', '....'], [2], true],
      ['ring with island', ['aaaaa', 'a...a', 'a.b.a', 'a...a', 'aaaaa'], [2, 3], true],
      ['two colours side by side', ['aabb', 'aabb'], [1, 2], true],
      ['T-junction', ['aaaa', 'bbcc', 'bbcc'], [1, 2, 3], true],
      ['checkerboard', ['ab', 'ba'], [1, 2], false],
      ['diagonal line', ['a...', '.a..', '..a.', '...a'], [1], false],
      ['diagonal touch, 3 labels', ['ab', 'ca'], [3, 1, 2], false],
      ['four labels at a corner', ['ab', 'cd'], [1, 3, 4, 2], false],
      ['letter with hole', ['.aaa.', 'aa.aa', 'aaaaa', 'aa.aa', 'aa.aa'], [1.5], true],
    ];
    for (const [name, rows, heights, exact] of fixed) {
      for (const smooth of [false, true]) {
        results.push(checkGrid(name, grid(rows), heights, smooth, exact && !smooth));
      }
    }
    for (let seed = 1; seed <= 40; seed++) {
      const gd = randomGrid(9 + (seed % 7), 7 + (seed % 5), 1 + (seed % 4), seed);
      const heights = [];
      for (let l = 0; l < 4; l++) heights[l] = 0.4 + Math.round(gd.rnd() * 5) * 0.4;
      for (const smooth of [false, true]) results.push(checkGrid(`random #${seed}`, gd, heights, smooth, false));
    }

    // Nearest-colour mapping and "no material".
    const pal = [{ rgb: [255, 0, 0], none: false }, { rgb: [255, 255, 255], none: true }];
    const px = Uint8ClampedArray.of(250, 10, 10, 255, 240, 240, 240, 255, 200, 30, 30, 255, 0, 0, 0, 0);
    const q = L3D.labels.quantize(px, 4, pal);
    const qOk = Array.from(q.labels).join() === '0,-1,0,-1' && q.counts.join() === '2,1';
    results.push({ name: 'nearest colour mapping', ok: qOk, errors: qOk ? [] : [Array.from(q.labels).join()] });

    const speck = L3D.labels.removeSpecks(grid(['aaaa', 'abaa', 'aaaa']).labels, 4, 3, 2);
    const sOk = Array.from(speck).every(l => l === 0);
    results.push({ name: 'speck removal', ok: sOk, errors: sOk ? [] : [Array.from(speck).join()] });

    // Keychain loop on every side, on a solid block and on a "U" whose open side needs a tab.
    const block = ['..........', '.aaaaaaaa.', '.aaaaaaaa.', '.aaaaaaaa.', '.aaaaaaaa.', '..........'];
    // A "U" opening upwards, deeper than the loop radius: a top loop can't reach it.
    const notch = ['..................'].concat(Array(8).fill('.aa............aa.'), ['.aaaaaaaaaaaaaaaa.', '..................']);
    for (const [shape, rows] of [['block', block], ['U shape', notch]]) {
      for (const side of ['top', 'bottom', 'left', 'right']) {
        const g0 = grid(rows);
        const r = L3D.keychain.addLoop(g0.labels, g0.W, g0.H, { side, outerPx: 8, innerPx: 4, label: 1 });
        const res = checkGrid(`keychain ${side}, ${shape}`, r, [1.2, 2], true, false);
        const unreachable = shape === 'U shape' && side === 'top';
        if (r.connected === unreachable) res.errors.push(unreachable ? 'loop filled the opening' : 'loop not connected');
        if (!unreachable) {
          const merged = Int16Array.from(r.labels, l => (l < 0 ? -1 : 0));
          const polys = L3D.contours.trace(merged, r.W, r.H, { smooth: false }).polys.get(0) || [];
          const holes = polys.reduce((a, p) => a + p.holes.length, 0);
          if (polys.length !== 1) res.errors.push(`${polys.length} separate pieces, expected 1`);
          if (holes !== 1) res.errors.push(`${holes} holes, expected 1`);
        }
        res.ok = res.errors.length === 0;
        results.push(res);
      }
    }

    // Outline shapes filled with colour 0: the oval (grows to contain the whole image), and
    // rounded corners (cut into the image) with no rounding, some, and a radius too big
    // (capped at fully rounded ends).
    const images = [['wide image', ['..........', '..aaaa....', '..abba....', '..aaaa....', '..........']],
      ['square image', ['aa....', 'aa....', '..b...', '......', '......', '......']]];
    const outlines = [['oval', 0], ['rounded', 0], ['rounded', 2], ['rounded', 100]];
    for (const [shape, rows] of images) for (const [kind, radius] of outlines) {
      const g0 = grid(rows);
      const K = 0;
      const t = L3D.model.addOutline(g0.labels, g0.W, g0.H, K, kind, radius);
      const label = kind === 'oval' ? 'oval' : `rounded corners r=${radius}`;
      const errors = [];
      if (kind === 'oval') {
        const ox = Math.floor((t.W - g0.W) / 2), oy = Math.floor((t.H - g0.H) / 2);
        for (let y = 0; y < g0.H; y++) {
          for (let x = 0; x < g0.W; x++) {
            const want = g0.labels[y * g0.W + x];
            const got = t.labels[(y + oy) * t.W + x + ox];
            if (want >= 0 ? got !== want : got !== K) errors.push(`pixel ${x},${y}: ${got}, expected ${want >= 0 ? want : K}`);
          }
        }
        if (t.labels[0] !== -1 || t.labels[t.W * t.H - 1] !== -1) errors.push('corners of the enlarged grid should be outside the oval');
        if (shape === 'square image' && t.W !== t.H) errors.push(`square image gave ${t.W} x ${t.H}`);
      } else {
        if (t.W !== g0.W || t.H !== g0.H) errors.push(`rounded corners changed the size to ${t.W} x ${t.H}`);
        // Every pixel keeps its colour, gets the fill, or is cut away (empty).
        for (let k = 0; k < t.labels.length; k++) {
          const want = g0.labels[k] >= 0 ? g0.labels[k] : K;
          if (t.labels[k] !== want && t.labels[k] !== -1) errors.push(`pixel ${k}: ${t.labels[k]}, expected ${want} or cut`);
        }
        // The middle of each side is never cut; the corners are cut once there is a radius.
        const mid = [(g0.W >> 1), (g0.H - 1) * g0.W + (g0.W >> 1), (g0.H >> 1) * g0.W, (g0.H >> 1) * g0.W + g0.W - 1];
        if (mid.some(k => t.labels[k] < 0)) errors.push('the middle of a side was cut');
        const corners = [0, g0.W - 1, (g0.H - 1) * g0.W, g0.W * g0.H - 1];
        const cut = corners.filter(k => t.labels[k] < 0).length;
        if (radius > 0 && cut !== 4) errors.push(`${cut} of 4 corners cut`);
        if (radius === 0 && cut !== 0) errors.push('corners cut with radius 0');
      }
      const res = checkGrid(`${label} outline, ${shape}`, t, [2, 2.6], true, false);
      res.errors.push(...errors.slice(0, 5));
      const loop = L3D.keychain.addLoop(t.labels, t.W, t.H, { side: 'top', outerPx: 6, innerPx: 3, label: 1 });
      if (!loop.connected) res.errors.push('keychain loop did not attach to the outline');
      res.ok = res.errors.length === 0;
      results.push(res);
    }

    return results;
  }

  L3D.tests = { run, checkGrid, randomGrid };
})(globalThis.L3D = globalThis.L3D || {});
