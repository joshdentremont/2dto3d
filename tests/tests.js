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
  const rowsCount = (labels, l) => labels.reduce((a, v) => a + (v === l ? 1 : 0), 0);

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

    // Distance map against brute force.
    {
      const W = 9, H = 7, rnd = randomGrid(W, H, 1, 7).rnd, mask = new Uint8Array(W * H);
      for (let k = 0; k < W * H; k++) mask[k] = rnd() < 0.15 ? 1 : 0;
      mask[0] = 1;
      const d = L3D.frame.distanceSq(mask, W, H);
      const errors = [];
      for (let p = 0; p < W * H; p++) {
        let best = Infinity;
        for (let q = 0; q < W * H; q++) {
          if (mask[q]) best = Math.min(best, (p % W - q % W) ** 2 + (Math.floor(p / W) - Math.floor(q / W)) ** 2);
        }
        if (d[p] !== best) errors.push(`pixel ${p}: ${d[p]}, expected ${best}`);
      }
      results.push({ name: 'frame distance map', ok: !errors.length, errors: errors.slice(0, 5) });
    }

    // Frames: around a block, around an L (opening must be mirrored), around a ring (hole
    // ignored).
    const frameCases = [
      ['block', ['aaaaaa', 'aaaaaa', 'aaaaaa', 'aaaaaa']],
      ['L shape', ['aaa.......', 'aaa.......', 'aaa.......', 'aaaaaaaaaa', 'aaaaaaaaaa', 'aaaaaaaaaa']],
      ['ring', ['aaaaaa', 'a....a', 'a....a', 'aaaaaa']],
    ];
    for (const [shape, rows] of frameCases) {
      const g0 = grid(rows);
      const opts = { border: 2, lip: 1, clearance: 0.5 };
      const f = L3D.frame.frameGrid(g0.labels, g0.W, g0.H, opts);
      const res = checkGrid(`frame around ${shape}`, f, [1.2, 3.4], true, false);
      const count = l => f.labels.reduce((a, v) => a + (v === l ? 1 : 0), 0);
      if (!count(0) || !count(1)) res.errors.push(`lip ${count(0)} px, wall ${count(1)} px`);
      // Opening = empty pixels not connected to the outside of the frame grid.
      const pad = (f.W - g0.W) / 2;
      const at = (x, y) => f.labels[(y + pad) * f.W + x + pad];
      // A ring's hole is part of the print's face, so it must be in the opening, not lip.
      if (shape === 'ring' && (at(2, 1) !== -1 || at(3, 2) !== -1)) res.errors.push('ring hole was not ignored');
      if (shape === 'L shape') {
        // Mirrored left-to-right: the L's narrow arm ends up at the top right, so the opening
        // is there and the top left (the missing corner) is frame.
        if (at(8, 1) !== -1 || at(1, 1) === -1) res.errors.push('frame opening is not mirrored');
      }
      res.ok = res.errors.length === 0;
      results.push(res);
    }

    // Hanging pocket: blind opening plus a cavity under a lip, in the top border.
    {
      const g0 = grid(Array(16).fill('a'.repeat(30)));
      const base = { border: 12, lip: 1, clearance: 0.5 };
      const plain = L3D.frame.frameGrid(g0.labels, g0.W, g0.H, base);
      const pocket = { pocketRadius: 3, pocketRise: 2, pocketWall: 1 };
      const f = L3D.frame.frameGrid(g0.labels, g0.W, g0.H, Object.assign({}, pocket, base));
      const res = { name: 'frame with hanging pocket', errors: [] };
      if (!f.pocketCut) res.errors.push('pocket was not cut');
      const rowsOf = l => { const r = []; f.labels.forEach((v, k) => { if (v === l) r.push(Math.floor(k / f.W)); }); return r; };
      const opening = rowsOf(2), lip = rowsOf(3);
      if (!opening.length || !lip.length) res.errors.push(`opening ${opening.length} px, lip ${lip.length} px`);
      else if (Math.min(...lip) >= Math.min(...opening)) res.errors.push('the lip should be above the opening');
      if (Math.max(...opening.concat(lip)) >= f.H / 2) res.errors.push('pocket is not in the top half');
      const changed = [];
      for (let k = 0; k < f.labels.length; k++) if (f.labels[k] !== plain.labels[k]) changed.push(k);
      if (changed.some(k => plain.labels[k] !== 1)) res.errors.push('pocket cut into something other than the wall');
      const xs = changed.map(k => k % f.W);
      const midX = (Math.min(...xs) + Math.max(...xs) + 1) / 2;
      if (Math.abs(midX - f.W / 2) > 0.5) res.errors.push(`pocket centred at ${midX}, frame centre ${f.W / 2}`);
      // lip thickness 1, wall to 4; pocket: front skin 0.8, lip 3..4.
      const layers = [[[0, 1]], [[0, 4]], [[0, 0.8]], [[0, 0.8], [3, 4]]];
      const expected = [0, 1, 2, 3].reduce((a, l) => a + rowsCount(f.labels, l) * layers[l].reduce((s, [p, q]) => s + q - p, 0), 0);
      for (const smooth of [false, true]) {
        const g = L3D.contours.trace(f.labels, f.W, f.H, { smooth });
        const m = L3D.mesh.buildLayers(g, layers, 1);
        const open = L3D.mesh.openEdges(m);
        if (open) res.errors.push(`${open} open edges (smooth ${smooth})`);
        const vol = L3D.mesh.volume(m);
        if (!close(vol, expected, 0.03)) res.errors.push(`volume ${vol.toFixed(1)}, expected about ${expected.toFixed(1)} (smooth ${smooth})`);
      }
      const big = L3D.frame.frameGrid(g0.labels, g0.W, g0.H, Object.assign({}, pocket, { pocketRadius: 5 }, base));
      if (big.pocketCut) res.errors.push('oversized pocket was cut');
      if (big.labels.some((l, k) => l !== plain.labels[k])) res.errors.push('refused pocket still changed the frame');
      res.ok = res.errors.length === 0;
      results.push(res);
    }

    // Pocket position, and retaining bumps.
    {
      const g0 = grid(Array(40).fill('a'.repeat(60)));
      const base = { border: 14, lip: 3, clearance: 1 };
      const plain = L3D.frame.frameGrid(g0.labels, g0.W, g0.H, base);
      const res = { name: 'frame pocket position and bumps', errors: [] };

      const p = L3D.frame.frameGrid(g0.labels, g0.W, g0.H, Object.assign({ pocketRadius: 3, pocketRise: 2, pocketWall: 1 }, base));
      const firstRow = (arr, test) => { for (let k = 0; k < arr.length; k++) if (test(arr[k])) return Math.floor(k / p.W); return -1; };
      const gap = firstRow(p.labels, l => l === 2 || l === 3) - firstRow(p.labels, l => l === 1);
      if (Math.abs(gap - 1) > 1) res.errors.push(`pocket is ${gap} rows from the top edge, expected about 1`);

      const f = L3D.frame.frameGrid(g0.labels, g0.W, g0.H, Object.assign({ bumpReach: 4, bumpWidth: 6, bumpLongSide: 200 }, base));
      const bump = [];
      f.labels.forEach((l, k) => { if (l >= 4) bump.push(k); });
      if (!bump.length) res.errors.push('no bumps');
      if (bump.some(k => plain.labels[k] !== 0)) res.errors.push('a bump is outside the lip');
      for (const l of [4, 5, 6]) if (!f.labels.includes(l)) res.errors.push(`bump step ${l} missing`);
      // Each bump as its centre: flood fill the bump pixels.
      const spotsOf = fr => {
        const seen = new Set(), found = [];
        fr.labels.forEach((l, start) => {
          if (l < 4 || seen.has(start)) return;
          const stack = [start], px = [];
          seen.add(start);
          while (stack.length) {
            const k = stack.pop();
            px.push(k);
            for (const q of [k - 1, k + 1, k - fr.W, k + fr.W]) {
              if (fr.labels[q] >= 4 && !seen.has(q)) { seen.add(q); stack.push(q); }
            }
          }
          const xs = px.map(k => k % fr.W + 0.5), ys = px.map(k => Math.floor(k / fr.W) + 0.5);
          found.push({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
        });
        return found;
      };
      const near = (a, b) => Math.abs(a - b) <= 1.5;
      const cen = { x: f.W / 2, y: f.H / 2 };
      const one = spotsOf(f);
      if (one.length !== 4) res.errors.push(`${one.length} bumps, expected 4`);
      const onTopBottom = one.filter(b => near(b.x, cen.x)), onLeftRight = one.filter(b => near(b.y, cen.y));
      if (onTopBottom.length !== 2 || onLeftRight.length !== 2) res.errors.push('bumps are not in the middle of each side');

      // Sides over the limit get two, at the third points; shorter sides keep one.
      const long = spotsOf(L3D.frame.frameGrid(g0.labels, g0.W, g0.H, Object.assign({ bumpReach: 4, bumpWidth: 6, bumpLongSide: 50 }, base)));
      if (long.length !== 6) res.errors.push(`${long.length} bumps with long sides, expected 6`);
      const third = 62 / 6; // recess is 62 wide: third points are this far either side of centre
      for (const sign of [-1, 1]) {
        if (long.filter(b => Math.abs(b.x - (cen.x + sign * third)) <= 2).length !== 2) res.errors.push('long sides should have bumps at the third points');
      }
      if (long.filter(b => near(b.y, cen.y)).length !== 2) res.errors.push('short sides should keep one centred bump');

      // A side exactly at the limit keeps one: the fit clearance doesn't count.
      const exact = spotsOf(L3D.frame.frameGrid(g0.labels, g0.W, g0.H, Object.assign({ bumpReach: 4, bumpWidth: 6, bumpLongSide: 60 }, base)));
      if (exact.length !== 4) res.errors.push(`${exact.length} bumps at the limit, expected 4`);

      // Curved outlines get one per side too.
      const ov = L3D.model.addOutline(g0.labels, g0.W, g0.H, 0, 'oval', 0);
      const ovalSpots = spotsOf(L3D.frame.frameGrid(ov.labels, ov.W, ov.H, Object.assign({ bumpReach: 4, bumpWidth: 6, bumpLongSide: 200 }, base)));
      if (ovalSpots.length !== 4) res.errors.push(`${ovalSpots.length} bumps on an oval, expected 4`);
      // Every side of the recess has some, and the tallest step touches the wall.
      const rows = bump.map(k => Math.floor(k / f.W)), cols = bump.map(k => k % f.W);
      const midR = f.H / 2, midC = f.W / 2;
      if (!(rows.some(r => r < midR - 15) && rows.some(r => r > midR + 15) && cols.some(c => c < midC - 25) && cols.some(c => c > midC + 25))) {
        res.errors.push('bumps are not on all four sides');
      }
      if (!bump.some(k => f.labels[k] === 4 && [k - 1, k + 1, k - f.W, k + f.W].some(q => f.labels[q] === 1))) {
        res.errors.push('the tallest bump step does not touch the wall');
      }

      const opts = { border: 14, lip: 3, clearance: 1, frameDepth: 15, printDepth: 2, head: 4, smooth: true };
      const heights = m => { const z = new Set(); for (let i = 2; i < m.positions.length; i += 3) z.add(m.positions[i].toFixed(2)); return z; };
      const yes = L3D.frame.buildFrame(g0.labels, g0.W, g0.H, Object.assign({ lipDepth: 13 }, opts), 1);
      if (!yes.bumps) res.errors.push('bumps missing with room for them');
      const open = L3D.mesh.openEdges(yes.mesh);
      if (open) res.errors.push(`${open} open edges with bumps`);
      if (!(L3D.mesh.volume(yes.mesh) > 0)) res.errors.push('frame volume');
      const z = heights(yes.mesh);
      // Lip to 2; print 2..4; bump from 4.3 to 5.3; pocket floor 1 (as deep as it can go), lip from 14.
      for (const want of ['1.00', '2.00', '4.30', '5.30', '14.00', '15.00']) if (!z.has(want)) res.errors.push(`no surface at ${want} mm`);
      if (L3D.frame.buildFrame(g0.labels, g0.W, g0.H, Object.assign({ lipDepth: 3.3 }, opts), 1).bumps) res.errors.push('bumps added with no room (exactly at the limit)');
      if (!L3D.frame.buildFrame(g0.labels, g0.W, g0.H, Object.assign({ lipDepth: 3.4 }, opts), 1).bumps) res.errors.push('bumps missing just above the limit');
      res.ok = res.errors.length === 0;
      results.push(res);
    }

    // Pocket depth, and the rounded front.
    {
      const g0 = grid(Array(120).fill('a'.repeat(160)));
      const res = { name: 'frame pocket depth and rounded front', errors: [] };
      const opts = { border: 12, lip: 1, clearance: 0.3, frameDepth: 15, lipDepth: 13, printDepth: 2, head: 5, smooth: true };
      const scale = 0.25;
      const build = extra => L3D.frame.buildFrame(g0.labels, g0.W, g0.H, Object.assign({}, opts, extra), scale);
      const heights = m => { const z = new Set(); for (let i = 2; i < m.positions.length; i += 3) z.add(m.positions[i].toFixed(2)); return z; };

      const floors = [[undefined, '1.00'], [3.5, '11.50'], [99, '1.00'], [1, '12.80']];
      for (const [pocketDepth, want] of floors) {
        if (!heights(build({ pocketDepth }).mesh).has(want)) res.errors.push(`pocket depth ${pocketDepth}: no floor at ${want} mm`);
      }
      if (L3D.frame.maxPocketDepth(15) !== 14) res.errors.push('deepest pocket on a 15 mm frame should be 14 mm');

      const square = build({}).mesh;
      if (L3D.mesh.volume(square) <= 0) res.errors.push('square frame volume');
      if ([...heights(square)].some(z => z === '0.20' || z === '0.40')) res.errors.push('a square edge should have no steps');
      for (const smooth of [false, true]) {
        const m = build({ outerRadius: 2, smooth }).mesh;
        const open = L3D.mesh.openEdges(m);
        if (open) res.errors.push(`${open} open edges with a rounded front (smooth ${smooth})`);
        if (L3D.mesh.volume(m) >= L3D.mesh.volume(square)) res.errors.push('rounding should remove material');
        const box = L3D.mesh.bounds([m]);
        const p = m.positions;
        let frontMax = -Infinity;
        for (let i = 0; i < p.length; i += 3) if (p[i + 2] === 0 && p[i] > frontMax) frontMax = p[i];
        const inset = box.max[0] - frontMax;
        if (Math.abs(inset - 2) > 0.5) res.errors.push(`front face inset ${inset.toFixed(2)} mm, expected about 2`);
        const z = heights(m);
        for (const want of ['0.20', '0.40', '1.00']) if (!z.has(want)) res.errors.push(`no rounding step at ${want} mm`);
      }
      const big = L3D.mesh.openEdges(build({ outerRadius: 8 }).mesh);
      if (big) res.errors.push(`${big} open edges with rounding reaching the pocket`);

      // Inner edge: across the lip, the set-back rises steadily towards the opening and is
      // zero more than the radius away from it. (7 kinds of column per ring.)
      const across = L3D.frame.frameGrid(g0.labels, g0.W, g0.H, { border: 48, lip: 8, clearance: 2, innerRadius: 6, roundStep: 0.5 });
      const row = Math.floor(across.H / 2) * across.W;
      let edge = 0;
      while (across.labels[row + edge] < 0) edge++;  // the empty space outside the frame
      while (across.labels[row + edge] >= 0) edge++; // the frame, up to the opening
      const rings = [];
      for (let x = edge - 8; x < edge; x++) rings.push(Math.floor(across.labels[row + x] / 7));
      if (rings.some((r, k) => k > 0 && r < rings[k - 1])) res.errors.push(`set-back does not rise towards the opening: ${rings}`);
      if (!(rings[rings.length - 1] > 0)) res.errors.push(`no set-back at the opening: ${rings}`);
      if (rings[0] !== 0) res.errors.push(`set-back reaches further than the radius: ${rings}`);
      for (let x = edge - 8; x < edge; x++) if (across.labels[row + x] % 7 !== 0) res.errors.push('rounding changed the lip column');

      for (const smooth of [false, true]) {
        const m = build({ innerRadius: 1, outerRadius: 1, smooth }).mesh;
        const open = L3D.mesh.openEdges(m);
        if (open) res.errors.push(`${open} open edges with both edges rounded (smooth ${smooth})`);
        if (L3D.mesh.volume(m) >= L3D.mesh.volume(build({ outerRadius: 1, smooth }).mesh)) res.errors.push('inner rounding should remove material');
      }
      if (L3D.frame.maxInnerRadius(1.3, 2) !== 1.3) res.errors.push('inner radius should be limited by the lip width');
      if (Math.abs(L3D.frame.maxInnerRadius(5, 1) - 0.8) > 1e-9) res.errors.push('inner radius should leave some lip thickness');
      if (L3D.frame.maxInnerRadius(1, 0.1) !== 0) res.errors.push('a very thin lip should allow no inner radius');
      const capped = build({ innerRadius: 99 });
      if (L3D.mesh.openEdges(capped.mesh)) res.errors.push('open edges with an oversized inner radius');
      const thin = build({ innerRadius: 1, lipDepth: 14.9 });
      if (L3D.mesh.openEdges(thin.mesh)) res.errors.push('open edges with a very thin lip');
      res.ok = res.errors.length === 0;
      results.push(res);
    }

    // Offsets: where the image ends up inside a grid enlarged by an outline or a loop.
    {
      const res = { name: 'image offset in enlarged grids', errors: [] };
      const g0 = grid(['b...', '....', '....']); // a marker in the image's top left pixel
      const at = (g, x, y) => g.labels[y * g.W + x];
      const oval = L3D.model.addOutline(g0.labels, g0.W, g0.H, 0, 'oval', 0);
      if (at(oval, oval.ox, oval.oy) !== 1) res.errors.push('oval offset is wrong');
      const rounded = L3D.model.addOutline(g0.labels, g0.W, g0.H, 0, 'rounded', 0);
      if (rounded.ox !== 0 || rounded.oy !== 0) res.errors.push('rounded corners should not move the image');
      const block = grid(['baaaaaaa', 'aaaaaaaa', 'aaaaaaaa']);
      for (const side of ['top', 'bottom', 'left', 'right']) {
        const r = L3D.keychain.addLoop(block.labels, block.W, block.H, { side, outerPx: 6, innerPx: 3, label: 0 });
        if (at(r, r.ox, r.oy) !== 1) res.errors.push(`loop on the ${side}: offset is wrong`);
      }
      res.ok = res.errors.length === 0;
      results.push(res);
    }

    // Assembled view: turning the frame and raising both parts seats the print against the lip.
    {
      const res = { name: 'assembled frame preview', errors: [] };
      const g0 = grid(['aaa.......', 'aaa.......', 'aaa.......', 'aaaaaaaaaa', 'aaaaaaaaaa', 'aaaaaaaaaa']);
      const scale = 1, printDepth = 2, frameDepth = 15, lipDepth = 13;
      const opts = { border: 4, lip: 1, clearance: 0.3, frameDepth, lipDepth, printDepth, smooth: false };
      const frame = L3D.frame.buildFrame(g0.labels, g0.W, g0.H, opts, scale).mesh;
      const print = L3D.mesh.buildSolid(L3D.contours.trace(g0.labels, g0.W, g0.H, { smooth: false }), [printDepth], 0, scale);
      const at = L3D.frame.assembled(frameDepth, lipDepth, printDepth);
      // The turn the viewer applies: x and z flip, then the frame is raised.
      const turned = { positions: Float32Array.from(frame.positions), indices: frame.indices };
      for (let i = 0; i < turned.positions.length; i += 3) {
        turned.positions[i] = -turned.positions[i];
        turned.positions[i + 2] = at.frameZ - turned.positions[i + 2];
      }
      const box = L3D.mesh.bounds([turned]), printBox = L3D.mesh.bounds([print]);
      if (box.min[2] < -1e-6 || Math.abs(box.max[2] - frameDepth) > 1e-6) res.errors.push(`frame spans z ${box.min[2]} to ${box.max[2]}`);
      if (Math.abs(printBox.max[2] + at.printZ - lipDepth) > 1e-6) res.errors.push('the print face should meet the back of the lip');
      if (printBox.min[2] + at.printZ < -1e-6) res.errors.push('the print should stay above the bed');
      // The print's top right corner is missing. After the turn, that corner of the frame's
      // recess must be solid: no surface there at the height the print would need.
      const inCorner = (x, y) => x > 0 && y > 0; // missing corner, in mm from centre (y up)
      let onLip = 0;
      const p = turned.positions;
      for (let i = 0; i < p.length; i += 3) {
        if (Math.abs(p[i + 2] - lipDepth) < 1e-6 && Math.abs(p[i]) < g0.W / 2 && Math.abs(p[i + 1]) < g0.H / 2 && inCorner(p[i] - 2, p[i + 1] - 1)) onLip++;
      }
      if (onLip) res.errors.push(`${onLip} lip points inside the missing corner: the frame isn't lined up with the print`);
      const deep = L3D.frame.assembled(15, 2, 3);
      if (deep.printZ !== 0 || deep.frameZ !== 16) res.errors.push('a print deeper than the recess should lift everything above the bed');
      res.ok = res.errors.length === 0;
      results.push(res);
    }

    // Trimming empty margins.
    {
      const res = { name: 'trim margins', errors: [] };
      const image = (W, H, f) => {
        const px = new Uint8ClampedArray(W * H * 4);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) px.set(f(x, y), (y * W + x) * 4);
        }
        return { px, W, H };
      };
      const WHITE = [255, 255, 255, 255], RED = [200, 20, 30, 255], CLEAR = [0, 0, 0, 0];
      const box = (x0, y0, x1, y1) => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
      const expectBox = (name, im, want) => {
        const got = L3D.labels.trimBox(im.px, im.W, im.H);
        if (JSON.stringify(got) !== JSON.stringify(want)) res.errors.push(`${name}: ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
      };
      const logo = box(5, 4, 15, 9);
      expectBox('transparent margins', image(20, 12, (x, y) => (logo(x, y) ? RED : CLEAR)), { x: 5, y: 4, w: 10, h: 5 });
      expectBox('white background', image(20, 12, (x, y) => (logo(x, y) ? RED : WHITE)), { x: 5, y: 4, w: 10, h: 5 });
      const noise = (x, y) => [250 + (x * 7 + y * 3) % 6, 250 + (x * 3 + y * 5) % 6, 250 + (x + y) % 6, 255];
      expectBox('noisy background', image(20, 12, (x, y) => (logo(x, y) ? RED : noise(x, y))), { x: 5, y: 4, w: 10, h: 5 });
      expectBox('logo touching the top edge', image(20, 12, (x, y) => (box(5, 0, 15, 9)(x, y) ? RED : WHITE)), { x: 5, y: 0, w: 10, h: 9 });
      expectBox('three white corners, one covered', image(20, 12, (x, y) => (box(10, 6, 20, 12)(x, y) ? RED : WHITE)), { x: 10, y: 6, w: 10, h: 6 });
      expectBox('white logo on red', image(20, 12, (x, y) => (logo(x, y) ? WHITE : RED)), { x: 5, y: 4, w: 10, h: 5 });
      expectBox('no margins', image(20, 12, (x, y) => (x < 10 ? RED : [20, 40, 160, 255])), null);
      expectBox('solid image', image(20, 12, () => RED), null);
      expectBox('fully transparent', image(20, 12, () => CLEAR), null);
      expectBox('every corner a different color', image(4, 4, (x, y) => [x * 80, y * 80, 100, 255]), null);
      res.ok = res.errors.length === 0;
      results.push(res);
    }

    // Width means the finished width: a built oval comes out at the width asked for.
    {
      const res = { name: 'oval width', errors: [] };
      for (const [width, aspect] of [[80, 0.75], [60, 1], [100, 0.5]]) {
        const detail = 0.25, growth = L3D.model.outlineGrowth('oval');
        const imageWidth = width / growth;
        const gw = Math.round(imageWidth / detail), gh = Math.round(gw * aspect), scale = imageWidth / gw;
        const o = L3D.model.addOutline(new Int16Array(gw * gh), gw, gh, 0, 'oval', 0);
        const g = L3D.contours.trace(o.labels, o.W, o.H, { smooth: true });
        const box = L3D.mesh.bounds([L3D.mesh.buildSolid(g, [2], 0, scale)]);
        const w = box.max[0] - box.min[0], h = box.max[1] - box.min[1];
        if (Math.abs(w - width) > 0.5) res.errors.push(`asked for ${width} mm wide, got ${w.toFixed(2)}`);
        if (Math.abs(h - gh * scale * growth) > 0.5) res.errors.push(`height readout ${(gh * scale * growth).toFixed(2)}, built ${h.toFixed(2)}`);
      }
      if (L3D.model.outlineGrowth('rounded') !== 1 || L3D.model.outlineGrowth('none') !== 1) res.errors.push('only the oval should grow');
      res.ok = res.errors.length === 0;
      results.push(res);
    }

    // Suggesting colours.
    {
      const res = { name: 'suggest colors', errors: [] };
      const image = (W, H, f) => {
        const px = new Uint8ClampedArray(W * H * 4);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px.set(f(x, y), (y * W + x) * 4);
        return { px, count: W * H };
      };
      const WHITE = [255, 255, 255, 255], BLACK = [10, 10, 10, 255], RED = [200, 20, 30, 255], BLUE = [20, 40, 160, 255], CLEAR = [0, 0, 0, 0];
      const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 30;
      const expectColors = (name, im, want, existing) => {
        const got = L3D.labels.suggestColors(im.px, im.count, existing);
        if (got.length !== want.length || want.some((w, k) => !near(got[k], w))) {
          res.errors.push(`${name}: ${JSON.stringify(got)}, expected ${JSON.stringify(want.map(w => w.slice(0, 3)))}`);
        }
      };
      // Flat logo: white background, a red block, a blue block.
      const flat = (x, y) => (x > 20 && x < 80 && y > 10 && y < 40 ? RED : x > 20 && x < 80 && y > 50 && y < 80 ? BLUE : WHITE);
      expectColors('flat colors, biggest first', image(100, 100, flat), [WHITE, RED, BLUE]);
      expectColors('solid image', image(50, 50, () => RED), [RED]);
      expectColors('transparent pixels ignored', image(100, 100, (x, y) => (x < 80 ? CLEAR : RED)), [RED]);
      expectColors('fully transparent', image(20, 20, () => CLEAR), []);

      // Soft edges: a black shape on white, with a 2 pixel ramp of greys around it.
      const soft = (x, y) => {
        const d = Math.max(Math.abs(x - 50), Math.abs(y - 50));
        const v = d < 25 ? 10 : d >= 27 ? 255 : d === 25 ? 90 : 175;
        return [v, v, v, 255];
      };
      expectColors('soft edges are not colors', image(100, 100, soft), [WHITE, BLACK]);

      // A real grey covering a good share of the image stays.
      expectColors('real grey kept', image(100, 100, (x, y) => (x < 40 ? WHITE : x < 75 ? BLACK : [128, 128, 128, 255])), [WHITE, BLACK, [128, 128, 128]]);

      // Noise like a JPEG's still gives one color each.
      const noisy = (x, y) => { const c = x < 50 ? WHITE : RED, n = ((x * 7 + y * 13) % 9) - 4; return [c[0] + n, c[1] + n, c[2] + n, 255]; };
      const noisyGot = L3D.labels.suggestColors(image(100, 100, noisy).px, 10000);
      if (noisyGot.length !== 2) res.errors.push(`noisy image: ${JSON.stringify(noisyGot)}`);

      // A small accent color is found.
      expectColors('small accent', image(100, 100, (x, y) => (x < 5 && y < 20 ? RED : WHITE)), [WHITE, RED]);

      // Already picked colors aren't suggested again, and a second press adds nothing.
      expectColors('skips existing', image(100, 100, flat), [RED, BLUE], [[255, 255, 255]]);
      expectColors('nothing left', image(100, 100, flat), [], [[255, 255, 255], [200, 20, 30], [20, 40, 160]]);

      // A photo-like gradient stops at the limit.
      const many = L3D.labels.suggestColors(image(256, 256, (x, y) => [x, y, (x + y) >> 1, 255]).px, 65536);
      if (many.length > 8) res.errors.push(`${many.length} colors from a gradient`);
      res.ok = res.errors.length === 0;
      results.push(res);
    }

    // Printer bed fit.
    {
      const fit = L3D.model.fitsBed;
      const cases = [
        [100, 80, 256, 256, 'fits'], [256, 256, 256, 256, 'fits'], [257, 100, 256, 256, 'no'],
        [300, 100, 400, 200, 'fits'], [100, 300, 400, 200, 'turn'], [300, 300, 400, 200, 'no'],
      ];
      const errors = cases.filter(c => fit(c[0], c[1], c[2], c[3]) !== c[4]).map(c => `${c.join(' ')}: got ${fit(c[0], c[1], c[2], c[3])}`);
      results.push({ name: 'printer bed fit', ok: !errors.length, errors });
    }

    // Filament estimates.
    {
      const res = { name: 'filament estimates', errors: [] };
      const E = L3D.estimate;
      const solidOf = (W, H, top, scale) => L3D.mesh.buildSolid(L3D.contours.trace(new Int16Array(W * H), W, H, { smooth: false }), [top], 0, scale);
      // 100 x 100 x 2 mm plate: 20 cm³ of nearly solid plastic.
      const plate = solidOf(100, 100, 2, 1);
      if (Math.abs(E.surfaceArea(plate) - (2 * 10000 + 400 * 2)) > 1) res.errors.push(`plate surface ${E.surfaceArea(plate)}`);
      const plasticShare = m => E.plastic(m) / L3D.mesh.volume(m);
      if (plasticShare(plate) < 0.75) res.errors.push(`plate is only ${plasticShare(plate).toFixed(2)} solid`);
      // A deep block is mostly infill, and nothing is ever more than solid.
      const block = solidOf(60, 60, 60, 1);
      if (plasticShare(block) > 0.3) res.errors.push(`block is ${plasticShare(block).toFixed(2)} solid`);
      if (plasticShare(solidOf(5, 5, 1, 1)) > 1) res.errors.push('more than solid');
      if (Math.abs(E.grams(20000) - 24.8) > 1e-9) res.errors.push(`20 cm³ of PLA is ${E.grams(20000)} g`);
      if (Math.abs(E.metres(2405) - 1) > 0.01) res.errors.push(`2405 mm³ is ${E.metres(2405)} m`);

      // Layer bands of a stepped body: 2 x 4 grid, heights 1, 2 and 3 over a 1 mm base.
      const g0 = grid(['aabb', 'aacc']);
      const g = L3D.contours.trace(g0.labels, g0.W, g0.H, { smooth: false });
      const palette = [['A', '#111111', 1], ['B', '#222222', 2], ['C', '#333333', 3]].map(([name, filament, height]) => ({ name, filament, height }));
      const settings = { mode: 'layered', thickness: 2, layerHeight: 0, base: { type: 'shape', thickness: 1, colorIndex: 0 } };
      const m = L3D.model.build(g, palette, settings, 1);
      const sum = m.swaps.reduce((a, sw) => a + sw.volume, 0);
      if (!close(sum, L3D.mesh.volume(m.body), 1e-3)) res.errors.push(`bands add up to ${sum}, body is ${L3D.mesh.volume(m.body)}`);
      // Base and A: all 8 cells up to z 2 = 16. B: 4 cells for z 2-3 = 4. C: 2 cells for z 3-4 = 2.
      const want = [16, 4, 2], got = m.swaps.map(sw => Math.round(sw.volume * 10) / 10);
      if (got.join() !== want.join()) res.errors.push(`band volumes ${got}, expected ${want}`);
      res.ok = res.errors.length === 0;
      results.push(res);
    }

    return results;
  }

  L3D.tests = { run, checkGrid, randomGrid };
})(globalThis.L3D = globalThis.L3D || {});
