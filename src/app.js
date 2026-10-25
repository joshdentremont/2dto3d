// UI wiring: image loading and colour picking, settings, the build pipeline and exports.
(function (L3D) {
  'use strict';

  const MAX_GRID = 1600;        // longest side of the print grid, in pixels
  const MAX_ORIGINAL = 2048;    // longest side kept for display and picking
  const SAME_COLOR_DE = 3;      // picks closer than this (CIELAB ΔE) select the existing colour
  const CHECK_LIMIT = 1500000;  // skip the watertight check above this many triangles

  const $ = id => document.getElementById(id);
  const el = {
    stage: $('stage'), canvas: $('imageCanvas'), dropHint: $('dropHint'), loupe: $('loupe'),
    fileInput: $('fileInput'), fileInput2: $('fileInput2'), replaceBtn: $('replaceBtn'), pickHint: $('pickHint'),
    viewToggle: $('viewToggle'), palette: $('palette'), paletteEmpty: $('paletteEmpty'),
    thickness: $('thickness'), layerHeight: $('layerHeight'), widthMm: $('widthMm'), heightMm: $('heightMm'),
    detail: $('detail'), speck: $('speck'), smooth: $('smooth'),
    baseType: $('baseType'), baseThickness: $('baseThickness'), baseColor: $('baseColor'),
    viewer: $('viewer'), viewerMsg: $('viewerMsg'), busy: $('busy'), stats: $('stats'),
    warnings: $('warnings'), export3mf: $('export3mf'), exportZip: $('exportZip'), exportStl: $('exportStl'),
    swapsBox: $('swapsBox'), swaps: $('swaps'),
  };

  const S = {
    src: null,          // loaded image { img, w, h, isSvg }
    orig: null,         // { canvas, data, w, h } for display and picking
    name: 'logo',
    palette: [],        // [{ id, rgb, filament, name, none, height }]
    nextId: 1,
    view: 'original',
    hover: -1,          // palette index highlighted from the list
    model: null,
    settings: {
      mode: 'flat', thickness: 2, layerHeight: 0.2, widthMm: 80, detail: 0.15, speckMm2: 0.3, smooth: true,
      base: { type: 'none', thickness: 1, colorId: null },
    },
  };
  const cache = {};
  const viewer = L3D.viewer.createViewer(el.viewer);

  // ---------- image loading ----------

  async function loadFile(file) {
    if (!file) return;
    try {
      const src = await L3D.raster.loadImage(file);
      if (S.src) URL.revokeObjectURL(S.src.url);
      S.src = src;
      S.orig = L3D.raster.originalPixels(src, MAX_ORIGINAL);
      S.name = L3D.exporters.safeName(file.name.replace(/\.[^.]+$/, '')) || 'logo';
      S.palette = [];
      for (const k of Object.keys(cache)) delete cache[k];
      el.dropHint.hidden = true;
      el.replaceBtn.hidden = false;
      el.canvas.classList.remove('empty');
      el.pickHint.textContent = 'Click the image to add each color you want in the model. Every pixel uses the closest picked color.';
      setView('original');
      renderPalette();
      schedule(0);
    } catch (err) {
      alert(err.message);
    }
  }

  el.fileInput.addEventListener('change', e => loadFile(e.target.files[0]));
  el.fileInput2.addEventListener('change', e => loadFile(e.target.files[0]));
  el.stage.addEventListener('dragover', e => { e.preventDefault(); el.stage.classList.add('drag'); });
  el.stage.addEventListener('dragleave', () => el.stage.classList.remove('drag'));
  el.stage.addEventListener('drop', e => {
    e.preventDefault();
    el.stage.classList.remove('drag');
    loadFile(e.dataTransfer.files[0]);
  });
  el.canvas.classList.add('empty');

  // ---------- image panel ----------

  // Where the image sits inside the canvas (CSS pixels).
  function fitRect() {
    const cw = el.canvas.clientWidth, ch = el.canvas.clientHeight;
    const k = Math.min(cw / S.orig.w, ch / S.orig.h);
    const w = S.orig.w * k, h = S.orig.h * k;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  function drawImage() {
    const c = el.canvas, dpr = window.devicePixelRatio || 1;
    const cw = c.clientWidth, ch = c.clientHeight;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!S.orig) return;
    const r = fitRect();
    const showMapped = (S.view === 'mapped' || S.hover >= 0) && cache.labels;
    if (showMapped) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(mappedCanvas(), r.x, r.y, r.w, r.h);
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(S.orig.canvas, r.x, r.y, r.w, r.h);
    }
  }

  // The label grid drawn in filament colours: exactly what will be printed.
  function mappedCanvas() {
    const { gw, gh } = cache.grid;
    const key = cache.labelsKey + '|' + S.palette.map(p => p.filament).join() + '|' + S.hover;
    if (cache.mapped && cache.mappedKey === key) return cache.mapped;
    const c = cache.mapped || document.createElement('canvas');
    c.width = gw;
    c.height = gh;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(gw, gh);
    const cols = S.palette.map(p => L3D.color.hexToRgb(p.filament));
    const labels = cache.labels;
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      if (l < 0) continue;
      const o = i * 4, col = cols[l];
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2];
      img.data[o + 3] = S.hover < 0 || S.hover === l ? 255 : 40;
    }
    ctx.putImageData(img, 0, 0);
    cache.mapped = c;
    cache.mappedKey = key;
    return c;
  }

  function setView(v) {
    S.view = v;
    for (const b of el.viewToggle.querySelectorAll('button')) b.classList.toggle('on', b.dataset.view === v);
    drawImage();
  }
  el.viewToggle.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && S.orig) setView(b.dataset.view);
  });
  new ResizeObserver(drawImage).observe(el.canvas);

  // Canvas position -> original image pixel, or null outside the image.
  function imagePixel(e) {
    if (!S.orig) return null;
    const rect = el.canvas.getBoundingClientRect();
    const r = fitRect();
    const x = Math.floor((e.clientX - rect.left - r.x) / r.w * S.orig.w);
    const y = Math.floor((e.clientY - rect.top - r.y) / r.h * S.orig.h);
    if (x < 0 || y < 0 || x >= S.orig.w || y >= S.orig.h) return null;
    return { x, y };
  }

  el.canvas.addEventListener('click', e => {
    const p = imagePixel(e);
    if (!p) return;
    const rgb = L3D.raster.sampleColor(S.orig, p.x, p.y);
    if (!rgb) {
      flashHint('That spot is transparent, so it already has no material.');
      return;
    }
    const lab = L3D.color.rgbToLab(...rgb);
    const existing = S.palette.findIndex(c => L3D.color.deltaE(lab, L3D.color.rgbToLab(...c.rgb)) < SAME_COLOR_DE);
    if (existing >= 0) {
      flashRow(existing);
      return;
    }
    const n = S.palette.length;
    S.palette.push({
      id: S.nextId++, rgb, filament: L3D.color.rgbToHex(rgb), name: 'Color ' + (n + 1),
      none: false, height: +(1.2 + 0.6 * n).toFixed(2),
    });
    renderPalette();
    flashRow(S.palette.length - 1);
    schedule(0);
  });

  el.canvas.addEventListener('mousemove', e => {
    const p = imagePixel(e);
    if (!p) { el.loupe.hidden = true; return; }
    drawLoupe(p);
    const rect = el.stage.getBoundingClientRect();
    let lx = e.clientX - rect.left + 18, ly = e.clientY - rect.top + 18;
    if (lx + el.loupe.width > rect.width) lx -= el.loupe.width + 36;
    if (ly + el.loupe.height > rect.height) ly -= el.loupe.height + 36;
    el.loupe.style.left = lx + 'px';
    el.loupe.style.top = ly + 'px';
    el.loupe.hidden = false;
  });
  el.canvas.addEventListener('mouseleave', () => { el.loupe.hidden = true; });

  function drawLoupe(p) {
    const ctx = el.loupe.getContext('2d');
    const size = 96, n = 9, cell = size / n;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, el.loupe.height);
    // Only ask for pixels inside the image (Safari draws nothing otherwise).
    const sx = Math.max(0, p.x - 4), sy = Math.max(0, p.y - 4);
    const sw = Math.min(S.orig.w, p.x + 5) - sx, sh = Math.min(S.orig.h, p.y + 5) - sy;
    ctx.drawImage(S.orig.canvas, sx, sy, sw, sh, (sx - p.x + 4) * cell, (sy - p.y + 4) * cell, sw * cell, sh * cell);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(4 * cell, 4 * cell, cell, cell);
    const rgb = L3D.raster.sampleColor(S.orig, p.x, p.y);
    ctx.fillStyle = '#fff';
    ctx.font = '12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(rgb ? L3D.color.rgbToHex(rgb) : 'transparent', size / 2, size + 17);
  }

  let hintTimer = 0;
  function flashHint(text) {
    const old = el.pickHint.textContent;
    el.pickHint.textContent = text;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { el.pickHint.textContent = old; }, 2500);
  }

  // ---------- palette ----------

  function renderPalette() {
    el.palette.innerHTML = '';
    el.paletteEmpty.hidden = S.palette.length > 0;
    const layered = S.settings.mode === 'layered';
    S.palette.forEach((c, i) => {
      const li = document.createElement('li');
      li.classList.toggle('excluded', c.none);
      li.innerHTML = `
        <span class="swatch" title="Picked color ${L3D.color.rgbToHex(c.rgb)}"></span>
        <input type="color" class="filament" title="Filament color for this part">
        <input type="text" class="name" aria-label="Name">
        <label class="chk" title="Pixels closest to this color are left empty (for example a white background)"><input type="checkbox" class="none"> No material</label>
        <label class="h" ${layered && !c.none ? '' : 'hidden'}>Height <input type="number" class="height" min="0.04" step="${S.settings.layerHeight || 0.2}"> mm</label>
        <span class="pct"></span>
        <button type="button" class="del" title="Remove color" aria-label="Remove color">×</button>`;
      li.querySelector('.swatch').style.background = L3D.color.rgbToHex(c.rgb);
      const fil = li.querySelector('.filament');
      fil.value = c.filament.toLowerCase();
      fil.addEventListener('input', () => { c.filament = fil.value.toUpperCase(); drawImage(); schedule(150); });
      const name = li.querySelector('.name');
      name.value = c.name;
      name.addEventListener('input', () => { c.name = name.value || 'Color ' + (i + 1); renderBaseColors(); schedule(400); });
      const none = li.querySelector('.none');
      none.checked = c.none;
      none.addEventListener('change', () => { c.none = none.checked; renderPalette(); schedule(0); });
      const h = li.querySelector('.height');
      h.value = c.height;
      h.addEventListener('input', () => { if (+h.value > 0) { c.height = +h.value; schedule(250); } });
      li.querySelector('.del').addEventListener('click', () => {
        S.palette.splice(i, 1);
        S.hover = -1;
        renderPalette();
        schedule(0);
      });
      li.addEventListener('mouseenter', () => { S.hover = i; drawImage(); });
      li.addEventListener('mouseleave', () => { S.hover = -1; drawImage(); });
      el.palette.appendChild(li);
    });
    updateCoverage();
    renderBaseColors();
  }

  function updateCoverage() {
    if (!cache.counts) return;
    const total = cache.counts.reduce((a, b) => a + b, 0) || 1;
    el.palette.querySelectorAll('.pct').forEach((span, i) => {
      const n = cache.counts[i];
      span.textContent = n === undefined ? '' : (n / total < 0.001 && n > 0 ? '<0.1%' : Math.round(n / total * 1000) / 10 + '%');
    });
  }

  function flashRow(i) {
    const li = el.palette.children[i];
    if (!li) return;
    li.classList.add('flash');
    li.scrollIntoView({ block: 'nearest' });
    setTimeout(() => li.classList.remove('flash'), 900);
  }

  function renderBaseColors() {
    const usable = S.palette.filter(c => !c.none);
    if (!usable.some(c => c.id === S.settings.base.colorId)) S.settings.base.colorId = usable.length ? usable[0].id : null;
    el.baseColor.innerHTML = '';
    for (const c of usable) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      o.selected = c.id === S.settings.base.colorId;
      el.baseColor.appendChild(o);
    }
  }

  // ---------- settings ----------

  function readSettings() {
    const s = S.settings;
    s.mode = document.querySelector('input[name=mode]:checked').value;
    s.thickness = Math.max(0.1, +el.thickness.value || 2);
    s.layerHeight = Math.max(0, +el.layerHeight.value || 0);
    s.widthMm = Math.max(5, +el.widthMm.value || 80);
    s.detail = +el.detail.value;
    s.speckMm2 = Math.max(0, +el.speck.value || 0);
    s.smooth = el.smooth.checked;
    s.base.type = el.baseType.value;
    s.base.thickness = Math.max(0.1, +el.baseThickness.value || 1);
    s.base.colorId = +el.baseColor.value || s.base.colorId;
  }

  function applyVisibility() {
    const mode = S.settings.mode;
    document.querySelectorAll('[data-show]').forEach(n => { n.hidden = n.dataset.show !== mode; });
    document.querySelectorAll('[data-base]').forEach(n => { n.hidden = S.settings.base.type === 'none'; });
  }

  document.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', () => {
    readSettings();
    applyVisibility();
    renderPalette();
    schedule(0);
  }));
  for (const input of [el.thickness, el.layerHeight, el.widthMm, el.detail, el.speck, el.smooth,
    el.baseType, el.baseThickness, el.baseColor]) {
    input.addEventListener(input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input', () => {
      readSettings();
      applyVisibility();
      if (input === el.layerHeight) renderPalette();
      schedule(300);
    });
  }

  // ---------- build pipeline ----------

  let timer = 0;
  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      el.busy.hidden = false;
      // Let the "Building…" badge paint before the (synchronous) work starts.
      setTimeout(() => {
        try { rebuild(); } catch (err) { console.error(err); showError(err); }
        el.busy.hidden = true;
      }, 20);
    }, delay);
  }

  function gridSize() {
    const s = S.settings;
    let gw = Math.max(2, Math.round(s.widthMm / s.detail));
    let gh = Math.max(2, Math.round(gw * S.src.h / S.src.w));
    let capped = false;
    if (Math.max(gw, gh) > MAX_GRID) {
      const k = MAX_GRID / Math.max(gw, gh);
      gw = Math.max(2, Math.round(gw * k));
      gh = Math.max(2, Math.round(gh * k));
      capped = true;
    }
    return { gw, gh, scale: s.widthMm / gw, capped };
  }

  function rebuild() {
    if (!S.src) return;
    const s = S.settings;
    const { gw, gh, scale, capped } = gridSize();
    el.heightMm.textContent = (gh * scale).toFixed(1) + ' mm';

    const gridKey = gw + 'x' + gh;
    if (cache.gridKey !== gridKey) {
      cache.grid = { gw, gh, data: L3D.raster.resample(S.src, gw, gh) };
      cache.gridKey = gridKey;
    }

    const labelsKey = gridKey + '|' + S.palette.map(p => p.rgb.join(',') + (p.none ? 'x' : '')).join(';') + '|' + s.speckMm2;
    if (cache.labelsKey !== labelsKey) {
      const q = L3D.labels.quantize(cache.grid.data.data, gw * gh, S.palette);
      const minPx = Math.round(s.speckMm2 / (scale * scale));
      cache.labels = L3D.labels.removeSpecks(q.labels, gw, gh, minPx);
      cache.counts = q.counts;
      cache.labelsKey = labelsKey;
      updateCoverage();
    }
    drawImage();

    const warnings = [];
    if (capped) warnings.push(`Detail was reduced to ${scale.toFixed(2)} mm to keep the model a manageable size.`);

    const usable = S.palette.some(c => !c.none);
    if (!usable) {
      S.model = null;
      viewer.setParts([]);
      el.viewerMsg.hidden = false;
      el.viewerMsg.textContent = S.palette.length
        ? 'Every picked color is set to “No material”. Pick or enable at least one color to print.'
        : 'Click the image to pick the colors you want to print.';
      showOutput(warnings);
      return;
    }

    const traceKey = labelsKey + '|' + s.smooth + '|' + (s.base.type === 'rect');
    if (cache.traceKey !== traceKey) {
      const labels = L3D.model.traceLabels(cache.labels, S.palette.length, s);
      cache.graph = L3D.contours.trace(labels, gw, gh, { smooth: s.smooth });
      cache.traceKey = traceKey;
    }

    const baseIdx = Math.max(0, S.palette.findIndex(c => c.id === s.base.colorId));
    const model = L3D.model.build(cache.graph, S.palette, {
      mode: s.mode, thickness: s.thickness, layerHeight: s.layerHeight,
      base: { type: s.base.type, thickness: s.base.thickness, colorIndex: baseIdx },
    }, scale);
    S.model = model;
    warnings.push(...model.warnings);
    el.viewerMsg.hidden = model.parts.length > 0;
    viewer.setParts(model.parts);
    showOutput(warnings);
  }

  function showOutput(warnings) {
    const m = S.model;
    el.warnings.innerHTML = '';
    for (const w of warnings) {
      const d = document.createElement('div');
      d.className = 'warn';
      d.textContent = w;
      el.warnings.appendChild(d);
    }
    const has = !!(m && m.parts.length);
    el.export3mf.disabled = el.exportZip.disabled = el.exportStl.disabled = !has;
    el.stats.innerHTML = '';
    el.swapsBox.hidden = true;
    if (!has) return;

    const b = L3D.mesh.bounds(m.parts.map(p => p.mesh));
    const tris = m.parts.reduce((a, p) => a + p.mesh.indices.length / 3, 0);
    let check = '';
    if (tris <= CHECK_LIMIT) {
      const open = m.parts.reduce((a, p) => a + L3D.mesh.openEdges(p.mesh), 0) + L3D.mesh.openEdges(m.body);
      check = open ? `<span class="bad">✗ ${open} open edges</span>` : '<span class="ok">✓ watertight</span>';
    }
    const dim = i => (b.max[i] - b.min[i]).toFixed(1);
    el.stats.innerHTML = `${dim(0)} × ${dim(1)} × ${dim(2)} mm · ${tris.toLocaleString()} triangles ${check ? '· ' + check : ''}`;

    if (m.swaps.length) {
      el.swaps.innerHTML = '';
      m.swaps.forEach((sw, k) => {
        const li = document.createElement('li');
        const dot = `<span class="dot" style="background:${sw.color}"></span>`;
        li.innerHTML = k === 0
          ? `Start with ${dot}<strong></strong>`
          : `At the layer at <strong>${sw.z.toFixed(2)} mm</strong>, change to ${dot}<strong></strong>`;
        li.querySelectorAll('strong')[k === 0 ? 0 : 1].textContent = sw.name;
        el.swaps.appendChild(li);
      });
      el.swapsBox.hidden = false;
    }
  }

  function showError(err) {
    el.warnings.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'warn';
    d.textContent = 'Something went wrong while building the model: ' + err.message;
    el.warnings.appendChild(d);
  }

  // ---------- exports ----------

  el.export3mf.addEventListener('click', () => {
    if (!S.model) return;
    L3D.exporters.download(L3D.exporters.threeMF(S.model.parts, S.name), S.name + '.3mf', 'model/3mf');
  });
  el.exportZip.addEventListener('click', () => {
    if (!S.model) return;
    L3D.exporters.download(L3D.exporters.stlZip(S.model.parts, S.name), S.name + '-parts.zip', 'application/zip');
  });
  el.exportStl.addEventListener('click', () => {
    if (!S.model) return;
    L3D.exporters.download(L3D.exporters.stl([S.model.body]), S.name + '.stl', 'model/stl');
  });

  readSettings();
  applyVisibility();
})(globalThis.L3D = globalThis.L3D || {});
