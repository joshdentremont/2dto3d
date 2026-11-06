// The build: from the image's pixels and the settings to printable parts and warnings. It never
// touches the page, so it can run in a background worker (src/worker.js) or on the page itself.
(function (L3D) {
  'use strict';

  const MIN_FRAME_LIP = 0.4;    // thinnest lip (mm) left at the front of a frame
  const CHECK_LIMIT = 1500000;  // skip the watertight check above this many triangles
  const TILE_GAP = 10;          // space (mm) between tiles in the 3D view, and between frames unless set

  // A pipeline remembers its results and only redoes the steps whose inputs have changed.
  function create() {
    const cache = {};
    let imageId = 0;

    // job: { gw, gh, scale, capped, borderMm, palette, settings }, plus image (RGBA pixels,
    // gw x gh) whenever they've changed. Returns { counts, shown, shownKey, warnings, model,
    // frame, tiles, openEdges }. shown is the grid for the Mapped view, and shownKey changes
    // when it does. model and frame are null if there's nothing to build. tiles is null unless
    // the print is being split, then { cols, rows, trim, list: [{ row, col, offset, parts, body }] },
    // where trim is how much (mm) was cut away along each edge where two tiles meet,
    // with each tile centred on x/y = 0 and offset being where it sits in the whole print.
    // frame.pieces lists the frames as { row, col, mesh, stand }: one, or one per tile when
    // frame.perTile, each centred like its tile, or with frame.split the pieces of one frame,
    // each with an offset (seen from the back), joined by frame.keys and laid out frame.cols by
    // frame.rows. frame.mesh is the one frame's, or null when per tile or split. frame.stand
    // is the one frame's stand, or null when per tile.
    // openEdges is null if the model is too big to check. All of it can be posted between threads.
    function run(job) {
      const { gw, gh, scale, capped, borderMm, palette, settings: s } = job;
      if (job.image) {
        cache.image = job.image;
        imageId++;
      }

      const labelsKey = imageId + '|' + gw + 'x' + gh + '|' + palette.map(p => p.rgb.join(',') + (p.none ? 'x' : '')).join(';') + '|' + s.speckMm2;
      if (cache.labelsKey !== labelsKey) {
        const q = L3D.labels.quantize(cache.image, gw * gh, palette);
        const minPx = Math.round(s.speckMm2 / (scale * scale));
        cache.labels = L3D.labels.removeSpecks(q.labels, gw, gh, minPx);
        cache.counts = q.counts;
        cache.labelsKey = labelsKey;
      }

      const warnings = [];
      if (capped) warnings.push(`Detail was reduced to ${scale.toFixed(2)} mm to keep the model a manageable size.`);

      if (!palette.some(c => !c.none)) {
        return {
          counts: cache.counts, shown: { labels: cache.labels, W: gw, H: gh, ox: 0, oy: 0 }, shownKey: labelsKey,
          warnings, model: null, frame: null, tiles: null, openEdges: null,
        };
      }

      const loopIdx = palette.findIndex(c => c.id === s.loop.colorId && !c.none);
      const loopOn = s.loop.on && loopIdx >= 0;
      const loopKey = loopOn ? [s.loop.side, s.loop.outer, s.loop.hole, loopIdx].join() : 'off';
      const outlineIdx = palette.findIndex(c => c.id === s.outline.colorId && !c.none);
      const outlineOn = s.outline.shape !== 'none' && outlineIdx >= 0;
      const squareOn = !!s.outline.square && outlineIdx >= 0;
      const side = Math.max(gw, gh);
      const maxRadius = (squareOn ? side / 2 : L3D.model.maxCornerRadius(gw, gh)) * scale;
      const radius = Math.min(s.outline.radius, maxRadius);
      const outlineKey = outlineOn || squareOn ? [s.outline.shape, outlineIdx, s.outline.shape === 'rounded' ? radius : '', squareOn].join() : '';
      if (outlineOn && s.outline.shape === 'rounded' && s.outline.radius > maxRadius) {
        warnings.push(`The corner radius was limited to ${maxRadius.toFixed(1)} mm, where the short sides become fully rounded.`);
      }
      // A border is one more colour after the palette, with its own height. In the grid its
      // label comes before a rectangular base plate's.
      const borderIdx = palette.findIndex(c => c.id === s.border.colorId && !c.none);
      const borderOn = s.border.on && borderIdx >= 0;
      const borderKey = borderOn ? [borderIdx, borderMm].join() : '';
      const colors = borderOn
        ? palette.concat({ name: 'Border', filament: palette[borderIdx].filament, height: s.border.height, ownHeight: true })
        : palette;
      if (borderOn && borderMm < s.border.width) {
        warnings.push(`The border was limited to ${borderMm.toFixed(1)} mm, a quarter of the model's width.`);
      }
      const traceKey = labelsKey + '|' + scale + '|' + s.smooth + '|' + (s.base.type === 'rect') + '|' + outlineKey + '|' + borderKey + '|' + loopKey;
      if (cache.traceKey !== traceKey) {
        let grid = { labels: cache.labels, W: gw, H: gh, ox: 0, oy: 0 };
        if (squareOn) grid = L3D.model.addSquare(grid.labels, gw, gh, outlineIdx);
        if (outlineOn) {
          const o = L3D.model.addOutline(grid.labels, grid.W, grid.H, outlineIdx, s.outline.shape, radius / scale);
          grid = { labels: o.labels, W: o.W, H: o.H, ox: grid.ox + o.ox, oy: grid.oy + o.oy };
        }
        let { labels, W, H } = L3D.model.traceLabels(grid.labels, grid.W, grid.H, colors.length, s);
        let { ox, oy } = grid;
        if (borderOn) {
          const b = L3D.model.addBorder(labels, W, H, palette.length, borderMm / scale);
          labels = b.labels; W = b.W; H = b.H; ox += b.ox; oy += b.oy;
        }
        cache.loopMissed = false;
        if (loopOn) {
          const r = L3D.keychain.addLoop(labels, W, H, {
            side: s.loop.side, outerPx: s.loop.outer / scale, innerPx: s.loop.hole / scale, label: loopIdx,
          });
          // A loop that doesn't touch the logo would print as a loose ring, so leave it out.
          if (r.connected) { labels = r.labels; W = r.W; H = r.H; ox += r.ox; oy += r.oy; }
          cache.loopMissed = !r.connected;
        }
        cache.finalGrid = { labels, W, H, ox, oy, border: borderOn ? borderIdx : -1 };
        cache.graph = L3D.contours.trace(labels, W, H, { smooth: s.smooth });
        cache.traceKey = traceKey;
      }
      if (loopOn && cache.loopMissed) {
        warnings.push(`The keychain loop can't reach the logo from the ${s.loop.side}, so it isn't attached. Try another side, or a larger loop.`);
      }

      const baseIdx = Math.max(0, palette.findIndex(c => c.id === s.base.colorId));
      const model = L3D.model.build(cache.graph, colors, {
        mode: s.mode, thickness: s.thickness, layerHeight: s.layerHeight,
        base: { type: s.base.type, thickness: s.base.thickness, colorIndex: baseIdx },
      }, scale);
      warnings.push(...model.warnings);

      // Tiles: the same model again, cut up. The cut needs a trace of its own, as each tile
      // has its own labels. One more label than the colours leaves room for a base plate's.
      let tiles = null;
      const cells = []; // the grid area of each tile in tiles.list
      if (s.tiles.on && model.parts.length) {
        const fg = cache.finalGrid;
        // Jigsaw joints, for tiles without frames of their own. Their knobs reach past a
        // tile's edges, so automatic tile counts leave room for them.
        const joined = !!s.tiles.joints && !(s.frame.on && s.frame.perTile);
        const room = joined ? 2 * L3D.model.jointReach() : 0;
        const cols = s.tiles.cols || L3D.model.tilesFor(fg.W * scale, s.bedWidth - room);
        const rows = s.tiles.rows || L3D.model.tilesFor(fg.H * scale, s.bedDepth - room);
        const count = colors.length + 1;
        let joints = null;
        if (joined) {
          const J = L3D.model.JOINT, gap = s.tiles.clearance > 0 ? Math.max(1, Math.round(s.tiles.clearance / scale)) : 0;
          joints = { head: J.head / scale, neck: J.neck / scale, neckLength: J.neckLength / scale, longSeam: J.longSeam / scale, gap };
          if (gap && Math.abs(gap * scale - s.tiles.clearance) > 0.05) {
            warnings.push(`The joint clearance is ${(gap * scale).toFixed(2)} mm, the nearest this Detail allows.`);
          }
        }
        // Tiles with their own frames can lose a strip of image along the edges where they
        // meet, for what the frames cover between them. Unless set, that's the frames' border
        // and clearance, and half the gap they'll hang apart. It keeps a tile at least half as
        // wide as it was.
        let trim = 0;
        if (s.frame.on && s.frame.perTile && cols * rows > 1) {
          const f = s.frame, gap = f.tileGap != null ? f.tileGap : TILE_GAP;
          const asked = f.tileTrim != null ? f.tileTrim : f.border + f.clearance + gap / 2;
          const most = Math.floor(Math.min(fg.W / cols, fg.H / rows) / 4);
          trim = Math.min(Math.round(asked / scale), most);
          if (trim < Math.round(asked / scale)) warnings.push(`The trim at the tiles' inner edges was limited to ${(trim * scale).toFixed(1)} mm, to keep the tiles at least half their size.`);
        }
        tiles = { cols, rows, trim: trim * scale, list: [] };
        if (cols * rows > 1) {
          const tileKey = [traceKey, cols, rows, trim, joints ? joints.gap : 'none'].join('|');
          if (cache.tileKey !== tileKey) {
            const cut = L3D.model.tileLabels(fg.labels, fg.W, fg.H, cols, rows, count, trim, joints);
            cache.tileList = cut.tiles;
            cache.tileTrace = L3D.contours.trace(cut.labels, fg.W, fg.H, { smooth: s.smooth });
            cache.tileKey = tileKey;
          }
          const settings = {
            mode: s.mode, thickness: s.thickness, layerHeight: s.layerHeight,
            base: { type: s.base.type, thickness: s.base.thickness, colorIndex: baseIdx },
          };
          cache.tileList.forEach((t, k) => {
            const graph = L3D.model.tileGraph(cache.tileTrace, k, count);
            if (!graph) return;
            const built = L3D.model.build(graph, colors, settings, scale);
            if (!built.parts.length) return;
            const x = ((t.x0 + t.x1) / 2 - fg.W / 2) * scale, y = (fg.H / 2 - (t.y0 + t.y1) / 2) * scale;
            tiles.list.push({
              row: t.row, col: t.col, offset: [x, y],
              parts: built.parts.map(p => Object.assign({}, p, { mesh: L3D.model.moved(p.mesh, -x, -y) })),
              body: L3D.model.moved(built.body, -x, -y),
            });
            cells.push(t);
          });
        }
      }

      // Frame: a separate part shaped around the print, or one around each tile.
      let frame = null;
      if (s.frame.on && model.parts.length) {
        const printBox = L3D.mesh.bounds([model.body]);
        const printDepth = Math.round(printBox.max[2] * 1000) / 1000;
        const f = s.frame;
        const head = f.pocket ? f.head : 0;
        // The rounding can't reach past the border or the frame's depth, or off the lip.
        const outerRadius = Math.min(f.outerRadius, f.border, f.depth);
        if (outerRadius < f.outerRadius) warnings.push(`The outer edge radius was limited to ${outerRadius} mm, the size of the frame's border or depth.`);
        // Always leave some lip at the front.
        const lipDepth = Math.min(f.lipDepth, f.depth - MIN_FRAME_LIP);
        if (lipDepth < f.lipDepth) {
          warnings.push(`The lip depth was limited to ${lipDepth.toFixed(1)} mm, to leave a lip at least ${MIN_FRAME_LIP} mm thick at the front of the frame.`);
        }
        const innerRadius = Math.min(f.innerRadius, L3D.frame.maxInnerRadius(f.lip + f.clearance, f.depth - lipDepth));
        if (innerRadius < f.innerRadius) warnings.push(`The inner edge radius was limited to ${innerRadius.toFixed(1)} mm, to fit on the lip. A wider lip overlap or a thicker lip allows more.`);
        const frameKey = [traceKey, scale, printDepth, f.border, f.lip, f.depth, lipDepth, f.clearance, head, f.pocketDepth, outerRadius, innerRadius, f.stand, f.standWidth].join('|');
        if (cache.frameKey !== frameKey) {
          cache.frames = new Map();
          cache.frameKey = frameKey;
        }
        const opts = {
          border: f.border, lip: f.lip, clearance: f.clearance, frameDepth: f.depth, lipDepth, printDepth,
          head, pocketDepth: f.pocketDepth, outerRadius, innerRadius, stand: f.stand, standWidth: f.standWidth, smooth: s.smooth,
        };

        // One frame, with its stand, around the grid given. Its messages go in `notes`, so
        // each is given once however many frames it applies to.
        const notes = new Set();
        const makeFrame = (key, labels, W, H, split) => {
          let built = cache.frames.get(key);
          if (!built) {
            built = L3D.frame.buildFrame(labels, W, H, split ? Object.assign({ split }, opts) : opts, scale);
            cache.frames.set(key, built);
          }
          if (built.pocket === 'border') {
            const need = L3D.frame.pocketBorder(head);
            notes.add(f.border >= need
              ? 'The hanging pocket doesn\'t fit at the top centre of the frame, because of the shape of your print there, so it was left out. An Outline shape gives the frame a clean top edge.'
              : `The hanging pocket doesn't fit in the top of the frame, so it was left out. A ${head} mm head needs a border of at least ${need} mm.`);
          } else if (built.pocket === 'thin') {
            notes.add(`The frame is too thin for a hanging pocket, so it was left out. It needs a frame depth of at least ${L3D.frame.pocketThickness().toFixed(1)} mm.`);
          }
          // The stand is sized to its slot, so it's left out along with the slot.
          let stand = null, standLength = 0;
          if (built.stand.fit === 'ok') {
            const frameHeight = built.height;
            stand = L3D.frame.buildStand(Object.assign({ angle: f.standAngle, frameHeight, reach: f.standLength }, built.stand));
            standLength = L3D.frame.standReach(frameHeight);
            if (built.stand.width < f.standWidth - 0.01) notes.add(`The stand was narrowed to ${built.stand.width.toFixed(1)} mm, the widest that fits in the bottom of the frame.`);
            const lean = Math.ceil(L3D.frame.minLean(frameHeight, f.depth));
            if (f.standAngle < lean) notes.add(`At ${f.standAngle}° the frame may tip forwards, because it's deep for its height. A lean angle of at least ${lean}° keeps its balance behind the edge it stands on.`);
            const need = Math.ceil(L3D.frame.minReach(frameHeight, f.depth, f.standAngle));
            if ((f.standLength || standLength) < need) notes.add(`With a stand this short the frame may tip backwards. A stand length of at least ${need} mm keeps its balance in front of the stand's end.`);
          } else if (built.stand.fit === 'border') {
            const need = L3D.frame.standBorder();
            notes.add(f.border >= need
              ? 'The stand doesn\'t fit at the bottom centre of the frame, because of the shape of your print there, so it was left out. An Outline shape gives the frame a clean bottom edge.'
              : `The stand doesn't fit in the bottom of the frame, so it was left out. It needs a border of at least ${need} mm.`);
          } else if (built.stand.fit === 'thin') {
            notes.add(`The frame is too thin for the stand's slot, so the stand was left out. It needs a frame depth of at least ${L3D.frame.standDepth()} mm.`);
          }
          if (built.pieces && !built.keyRoom) {
            notes.add(`The frame is too thin for butterfly keys, so glue its pieces together. Keys need a frame depth of at least ${L3D.frame.standDepth()} mm.`);
          } else if (built.pieces && built.keysMissed) {
            notes.add(`${built.keysMissed === 1 ? 'One join' : built.keysMissed + ' joins'} in the frame ${built.keysMissed === 1 ? 'has' : 'have'} no room for a butterfly key, so glue ${built.keysMissed === 1 ? 'it' : 'them'}. A wider border makes room.`);
          }
          return { mesh: built.mesh, stand, standLength, bumps: built.bumps, split: built.pieces, cols: built.cols, rows: built.rows, keys: built.keys };
        };

        // A tile's frame is centred on the tile, as the tile is. One frame for the whole print
        // can be cut into pieces to fit the bed.
        const fg = cache.finalGrid;
        const perTile = !!f.perTile && !!tiles && tiles.list.length > 1;
        const splitFor = !perTile && f.split ? { bedWidth: s.bedWidth, bedDepth: s.bedDepth } : null;
        const one = perTile ? null : makeFrame('whole|' + (splitFor ? s.bedWidth + 'x' + s.bedDepth : ''), fg.labels, fg.W, fg.H, splitFor);
        const pieces = perTile
          ? tiles.list.map((t, k) => {
            const c = cells[k], w = c.x1 - c.x0, h = c.y1 - c.y0, labels = new Int16Array(w * h);
            for (let y = 0; y < h; y++) labels.set(fg.labels.subarray((c.y0 + y) * fg.W + c.x0, (c.y0 + y) * fg.W + c.x1), y * w);
            return Object.assign({ row: t.row, col: t.col }, makeFrame(`${cache.tileKey}|${t.row},${t.col}`, labels, w, h, null));
          })
          : one.split
            ? one.split.map(p => ({ row: p.row, col: p.col, offset: p.offset, mesh: p.mesh, stand: null, standLength: one.standLength, bumps: one.bumps }))
            : [Object.assign({ row: 0, col: 0 }, one)];
        warnings.push(...notes);
        const bumps = pieces.every(p => p.bumps);
        if (printDepth > lipDepth) {
          warnings.push(`Your print is ${printDepth.toFixed(1)} mm deep, more than the ${lipDepth.toFixed(1)} mm lip depth, so it will stick out of the back of the frame.`);
        } else if (!bumps) {
          warnings.push(`There's no room for the bumps that hold the print in, so it will need glue or tape. A lip depth over ${L3D.frame.bumpDepth(printDepth).toFixed(1)} mm leaves room for them.`);
        }
        const split = !!(one && one.split);
        frame = {
          mesh: perTile || split ? null : one.mesh, stand: one ? one.stand : null,
          standLength: (one || pieces[0]).standLength, bumps, perTile, split, cols: split ? one.cols : 1, rows: split ? one.rows : 1,
          keys: split ? one.keys : null, pieces, depth: f.depth, lipDepth, printDepth,
        };
      }

      // Each part has to fit on its own: they're printed separately. Tiles, and their frames,
      // are nearly all one size, so one warning covers each kind.
      const checkBed = (what, meshes) => {
        const b = L3D.mesh.bounds(meshes), w = b.max[0] - b.min[0], d = b.max[1] - b.min[1];
        const fit = L3D.model.fitsBed(w, d, s.bedWidth, s.bedDepth);
        if (fit === 'no') warnings.push(`The ${what} is ${w.toFixed(1)} × ${d.toFixed(1)} mm, too big for the ${s.bedWidth} × ${s.bedDepth} mm bed.`);
        else if (fit === 'turn') warnings.push(`The ${what} only fits the bed turned 90°, so rotate it in your slicer.`);
      };
      const checkEach = (list, what, meshesOf) => {
        const before = warnings.length;
        for (const item of list) {
          const meshes = meshesOf(item);
          if (meshes.length) checkBed(what(item), meshes);
          if (warnings.length > before) break;
        }
      };
      const where = t => `row ${t.row + 1}, column ${t.col + 1}`;
      if (tiles && tiles.list.length) checkEach(tiles.list, t => `tile in ${where(t)}`, t => t.parts.map(p => p.mesh));
      else if (model.parts.length) checkBed('print', model.parts.map(p => p.mesh));
      if (frame && frame.perTile) {
        checkEach(frame.pieces, p => `frame for the tile in ${where(p)}`, p => [p.mesh]);
        checkEach(frame.pieces, p => `stand for the tile in ${where(p)}`, p => (p.stand ? [p.stand] : []));
      } else if (frame && frame.split) {
        checkEach(frame.pieces, p => `frame piece in ${where(p)}`, p => [p.mesh]);
        if (frame.stand) checkBed('stand', [frame.stand]);
      } else if (frame) {
        checkBed('frame', [frame.mesh]);
        if (frame.stand) checkBed('stand', [frame.stand]);
      }

      let openEdges = null;
      if (model.parts.reduce((a, p) => a + p.mesh.indices.length / 3, 0) <= CHECK_LIMIT) {
        const meshes = model.parts.map(p => p.mesh).concat(model.body);
        if (frame) for (const p of frame.pieces) meshes.push(p.mesh, ...(p.stand ? [p.stand] : []));
        if (frame && frame.split) meshes.push(...(frame.stand ? [frame.stand] : []), ...(frame.keys ? [frame.keys] : []));
        if (tiles) for (const t of tiles.list) meshes.push(...t.parts.map(p => p.mesh), t.body);
        openEdges = meshes.reduce((a, mesh) => a + L3D.mesh.openEdges(mesh), 0);
      }

      return { counts: cache.counts, shown: cache.finalGrid, shownKey: traceKey, warnings, model, frame, tiles, openEdges };
    }

    return { run };
  }

  L3D.pipeline = { create, TILE_GAP };
})(globalThis.L3D = globalThis.L3D || {});
