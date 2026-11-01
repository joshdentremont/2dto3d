// UI wiring: image loading and colour picking, settings, the build pipeline and exports.
(function (L3D) {
  'use strict';

  const MAX_GRID = 1600;        // longest side of the print grid, in pixels
  const MAX_ORIGINAL = 2048;    // longest side kept for display and picking
  const SAME_COLOR_DE = 3;      // picks closer than this (CIELAB ΔE) select the existing colour
  const CHECK_LIMIT = 1500000;  // skip the watertight check above this many triangles
  const MIN_FRAME_LIP = 0.4;    // thinnest lip (mm) left at the front of a frame

  const $ = id => document.getElementById(id);
  const el = {
    stage: $('stage'), canvas: $('imageCanvas'), dropHint: $('dropHint'), loupe: $('loupe'),
    fileInput: $('fileInput'), fileInput2: $('fileInput2'), replaceBtn: $('replaceBtn'), pickHint: $('pickHint'),
    viewToggle: $('viewToggle'), palette: $('palette'), paletteEmpty: $('paletteEmpty'),
    thickness: $('thickness'), layerHeight: $('layerHeight'), widthMm: $('widthMm'), heightMm: $('heightMm'),
    detail: $('detail'), speck: $('speck'), smooth: $('smooth'),
    baseType: $('baseType'), baseThickness: $('baseThickness'), baseColor: $('baseColor'),
    outlineShape: $('outlineShape'), cornerRadius: $('cornerRadius'), outlineColor: $('outlineColor'),
    loopOn: $('loopOn'), loopSide: $('loopSide'), loopOuter: $('loopOuter'), loopHole: $('loopHole'), loopColor: $('loopColor'),
    frameOn: $('frameOn'), frameBorder: $('frameBorder'), frameLip: $('frameLip'),
    frameDepth: $('frameDepth'), frameLipDepth: $('frameLipDepth'), frameClearance: $('frameClearance'), frameColor: $('frameColor'),
    frameExport: $('frameExport'), exportFrame: $('exportFrame'), framePocket: $('framePocket'), frameHead: $('frameHead'),
    framePocketDepth: $('framePocketDepth'), frameOuterRadius: $('frameOuterRadius'), frameInnerRadius: $('frameInnerRadius'),
    viewerHome: $('viewerHome'), frameView: $('frameView'),
    frameHowTo: $('frameHowTo'),
    viewer: $('viewer'), viewerMsg: $('viewerMsg'), busy: $('busy'), stats: $('stats'),
    warnings: $('warnings'), export3mf: $('export3mf'), exportZip: $('exportZip'), exportStl: $('exportStl'),
    resetSettings: $('resetSettings'), swapsBox: $('swapsBox'), swaps: $('swaps'), perColor: $('perColor'),
    singleOn: $('singleOn'), singleOff: $('singleOff'),
  };

  const S = {
    src: null,          // loaded image { img, w, h, isSvg }
    orig: null,         // { canvas, data, w, h } for display and picking
    name: 'logo',
    palette: [],        // [{ id, rgb, filament, name, none, height }]
    nextId: 1,
    view: 'original',
    frameView: 'apart', // or 'assembled'
    hover: -1,          // palette index highlighted from the list
    model: null,
    settings: {
      mode: 'flat', thickness: 2, layerHeight: 0.2, widthMm: 80, detail: 0.15, speckMm2: 0.3, smooth: true,
      base: { type: 'none', thickness: 1, colorId: null },
      loop: { on: false, side: 'top', outer: 10, hole: 5, colorId: null },
      outline: { shape: 'none', radius: 5, colorId: null },
      frame: {
        on: false, border: 10, lip: 1, depth: 15, lipDepth: 13, clearance: 0.3, color: '#3A3A3A',
        pocket: false, head: 5, pocketDepth: 0, outerRadius: 1, innerRadius: 1,
      },
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

  const showingMapped = () => (S.view === 'mapped' || S.hover >= 0) && !!cache.shown;

  // Where the picture sits inside the canvas (CSS pixels). The final shape can be larger than
  // the image, with an outline or keychain loop added.
  function fitRect() {
    const cw = el.canvas.clientWidth, ch = el.canvas.clientHeight;
    const pw = showingMapped() ? cache.shown.W : S.orig.w, ph = showingMapped() ? cache.shown.H : S.orig.h;
    const k = Math.min(cw / pw, ch / ph);
    const w = pw * k, h = ph * k;
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
    if (showingMapped()) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(mappedCanvas(), r.x, r.y, r.w, r.h);
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(S.orig.canvas, r.x, r.y, r.w, r.h);
    }
  }

  // The final grid drawn in filament colours, seen from the front: exactly what will be
  // printed, with any outline, keychain loop and rectangular base plate included.
  function mappedCanvas() {
    const { labels, W: gw, H: gh } = cache.shown;
    const base = S.palette.find(p => p.id === S.settings.base.colorId);
    const baseColor = base ? base.filament : '#808080';
    const key = cache.shownId + '|' + S.palette.map(p => p.filament).join() + '|' + baseColor + '|' + S.hover;
    if (cache.mapped && cache.mappedKey === key) return cache.mapped;
    const c = cache.mapped || document.createElement('canvas');
    c.width = gw;
    c.height = gh;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(gw, gh);
    // The label after the palette's is the area of a rectangular base plate.
    const cols = S.palette.map(p => L3D.color.hexToRgb(p.filament)).concat([L3D.color.hexToRgb(baseColor)]);
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

  // Canvas position -> original image pixel, or null outside the image. In the Mapped view
  // that includes anything added around the image, such as an outline or keychain loop.
  function imagePixel(e) {
    if (!S.orig) return null;
    const rect = el.canvas.getBoundingClientRect();
    const r = fitRect();
    let u = (e.clientX - rect.left - r.x) / r.w, v = (e.clientY - rect.top - r.y) / r.h;
    if (showingMapped()) {
      const g = cache.shown;
      u = (u * g.W - g.ox) / cache.grid.gw;
      v = (v * g.H - g.oy) / cache.grid.gh;
    }
    const x = Math.floor(u * S.orig.w), y = Math.floor(v * S.orig.h);
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
      id: S.nextId++, rgb, filament: L3D.color.rgbToHex(rgb), name: '', autoName: true,
      none: false, height: +(1.2 + 0.6 * n).toFixed(2),
    });
    renumber();
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

  // Colours still using an automatic name are numbered 1, 2, 3… in list order, skipping
  // colours the user has renamed, so there are no gaps or duplicates and the newest is last.
  function renumber() {
    let n = 0;
    for (const c of S.palette) if (c.autoName) c.name = 'Color ' + (++n);
  }

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
      name.addEventListener('input', () => {
        // A typed name is kept; clearing it goes back to automatic numbering.
        c.autoName = !name.value.trim();
        if (!c.autoName) c.name = name.value;
        renumber();
        // Update the other rows' names in place, so this box keeps focus.
        el.palette.querySelectorAll('.name').forEach((input, k) => { if (input !== name) input.value = S.palette[k].name; });
        renderBaseColors();
        schedule(400);
      });
      const none = li.querySelector('.none');
      none.checked = c.none;
      none.addEventListener('change', () => { c.none = none.checked; renderPalette(); schedule(0); });
      const h = li.querySelector('.height');
      h.value = c.height;
      h.addEventListener('input', () => { if (+h.value > 0) { c.height = +h.value; schedule(250); } });
      li.querySelector('.del').addEventListener('click', () => {
        S.palette.splice(i, 1);
        S.hover = -1;
        renumber();
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

  // Colour dropdowns for the base plate and the keychain loop (colours with material only).
  function renderBaseColors() {
    const usable = S.palette.filter(c => !c.none);
    for (const [select, setting] of [[el.baseColor, S.settings.base], [el.loopColor, S.settings.loop], [el.outlineColor, S.settings.outline]]) {
      if (!usable.some(c => c.id === setting.colorId)) setting.colorId = usable.length ? usable[0].id : null;
      select.innerHTML = '';
      for (const c of usable) {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name;
        o.selected = c.id === setting.colorId;
        select.appendChild(o);
      }
    }
  }

  // ---------- settings ----------

  function readSettings() {
    const s = S.settings;
    s.mode = el.perColor.checked ? 'layered' : 'flat';
    s.thickness = Math.max(0.1, +el.thickness.value || 2);
    s.layerHeight = Math.max(0, +el.layerHeight.value || 0);
    s.widthMm = Math.max(5, +el.widthMm.value || 80);
    s.detail = +el.detail.value;
    s.speckMm2 = Math.max(0, +el.speck.value || 0);
    s.smooth = el.smooth.checked;
    s.base.type = el.baseType.value;
    s.outline.shape = el.outlineShape.value;
    s.outline.radius = Math.max(0, +el.cornerRadius.value || 0);
    s.outline.colorId = +el.outlineColor.value || s.outline.colorId;
    s.base.thickness = Math.max(0.1, +el.baseThickness.value || 1);
    s.base.colorId = +el.baseColor.value || s.base.colorId;
    s.loop.on = el.loopOn.checked;
    s.loop.side = el.loopSide.value;
    s.loop.outer = Math.max(4, +el.loopOuter.value || 10);
    // Keep at least a 1 mm wall around the hole.
    s.loop.hole = Math.min(Math.max(1, +el.loopHole.value || 5), s.loop.outer - 2);
    s.loop.colorId = +el.loopColor.value || s.loop.colorId;
    s.frame.on = el.frameOn.checked;
    s.frame.border = Math.max(1, +el.frameBorder.value || 10);
    s.frame.lip = Math.max(0.5, +el.frameLip.value || 1);
    s.frame.depth = Math.max(1, +el.frameDepth.value || 15);
    s.frame.lipDepth = Math.max(0.5, +el.frameLipDepth.value || 13);
    s.frame.clearance = Math.max(0, +el.frameClearance.value || 0);
    s.frame.color = el.frameColor.value;
    s.frame.pocket = el.framePocket.checked;
    s.frame.head = Math.max(2, +el.frameHead.value || 5);
    s.frame.pocketDepth = Math.max(0, +el.framePocketDepth.value || 0); // 0 = as deep as it can go
    s.frame.outerRadius = Math.max(0, +el.frameOuterRadius.value || 0);
    s.frame.innerRadius = Math.max(0, +el.frameInnerRadius.value || 0);
  }

  function applyVisibility() {
    const mode = S.settings.mode;
    document.querySelectorAll('[data-show]').forEach(n => { n.hidden = n.dataset.show !== mode; });
    document.querySelectorAll('[data-base]').forEach(n => { n.hidden = S.settings.base.type === 'none'; });
    document.querySelectorAll('[data-loop]').forEach(n => { n.hidden = !S.settings.loop.on; });
    document.querySelectorAll('[data-frame]').forEach(n => { n.hidden = !S.settings.frame.on; });
    el.frameExport.hidden = !S.settings.frame.on;
    el.frameView.hidden = !S.settings.frame.on;
    el.framePocketDepth.placeholder = L3D.frame.maxPocketDepth(S.settings.frame.depth).toFixed(1).replace(/\.0$/, '');
    document.querySelectorAll('[data-frame-pocket]').forEach(n => { n.hidden = !(S.settings.frame.on && S.settings.frame.pocket); });
    document.querySelectorAll('[data-outline]').forEach(n => { n.hidden = !n.dataset.outline.split(' ').includes(S.settings.outline.shape); });
    el.singleOn.hidden = mode !== 'layered';
    el.singleOff.hidden = mode === 'layered';
  }

  el.perColor.addEventListener('change', () => {
    readSettings();
    applyVisibility();
    renderPalette();
    saveSettings();
    schedule(0);
  });
  const settingInputs = [el.thickness, el.layerHeight, el.widthMm, el.detail, el.speck, el.smooth,
    el.baseType, el.baseThickness, el.outlineShape, el.cornerRadius, el.outlineColor, el.baseColor, el.loopOn, el.loopSide, el.loopOuter, el.loopHole, el.loopColor,
    el.frameOn, el.frameBorder, el.frameLip, el.frameDepth, el.frameLipDepth, el.frameClearance, el.frameColor,
    el.framePocket, el.frameHead, el.framePocketDepth, el.frameOuterRadius, el.frameInnerRadius];
  for (const input of settingInputs) {
    input.addEventListener(input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input', () => {
      readSettings();
      applyVisibility();
      if (input === el.layerHeight) renderPalette();
      saveSettings();
      schedule(300);
    });
  }

  // ---------- remembered settings ----------

  // Settings are kept in this browser between visits. The colour dropdowns are left out:
  // their choices belong to the current image's colours, which aren't saved.
  const SETTINGS_KEY = '2d-to-3d-settings';
  const colorInputs = [el.baseColor, el.loopColor, el.outlineColor];
  const remembered = [el.perColor].concat(settingInputs.filter(input => !colorInputs.includes(input)));

  function defaultOption(select) {
    return Array.from(select.options).find(o => o.defaultSelected) || select.options[0];
  }

  // Storage can be unavailable (a private window, for example): settings just aren't kept.
  function saveSettings() {
    const values = {};
    for (const input of remembered) values[input.id] = input.type === 'checkbox' ? input.checked : input.value;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(values)); } catch (err) { /* not kept */ }
  }

  function restoreSettings() {
    let values = null;
    try { values = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (err) { /* nothing to restore */ }
    if (!values) return;
    for (const input of remembered) {
      if (!(input.id in values)) continue;
      if (input.type === 'checkbox') {
        input.checked = !!values[input.id];
      } else {
        input.value = values[input.id];
        // A choice that's no longer offered goes back to the default.
        if (input.tagName === 'SELECT' && input.selectedIndex < 0) input.value = defaultOption(input).value;
      }
    }
  }

  function resetSettings() {
    try { localStorage.removeItem(SETTINGS_KEY); } catch (err) { /* nothing to remove */ }
    for (const input of remembered) {
      if (input.type === 'checkbox') input.checked = input.defaultChecked;
      else if (input.tagName === 'SELECT') input.value = defaultOption(input).value;
      else input.value = input.defaultValue;
    }
    readSettings();
    applyVisibility();
    renderPalette();
    schedule(0);
  }
  el.resetSettings.addEventListener('click', resetSettings);

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

  // Sets what the Mapped view shows, and redraws.
  function showGrid(grid) {
    if (cache.shown !== grid) {
      cache.shown = grid;
      cache.shownId = (cache.shownId || 0) + 1;
    }
    drawImage();
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

    const warnings = [];
    if (capped) warnings.push(`Detail was reduced to ${scale.toFixed(2)} mm to keep the model a manageable size.`);

    const usable = S.palette.some(c => !c.none);
    if (!usable) {
      S.model = null;
      showGrid({ labels: cache.labels, W: gw, H: gh, ox: 0, oy: 0 });
      viewer.setParts([]);
      el.viewerMsg.hidden = false;
      el.viewerMsg.textContent = S.palette.length
        ? 'Every picked color is set to “No material”. Pick or enable at least one color to print.'
        : 'Click the image to pick the colors you want to print.';
      showOutput(warnings);
      return;
    }

    const loopIdx = S.palette.findIndex(c => c.id === s.loop.colorId && !c.none);
    const loopOn = s.loop.on && loopIdx >= 0;
    const loopKey = loopOn ? [s.loop.side, s.loop.outer, s.loop.hole, loopIdx].join() : 'off';
    const outlineIdx = S.palette.findIndex(c => c.id === s.outline.colorId && !c.none);
    const outlineOn = s.outline.shape !== 'none' && outlineIdx >= 0;
    const maxRadius = L3D.model.maxCornerRadius(gw, gh) * scale;
    const radius = Math.min(s.outline.radius, maxRadius);
    const outlineKey = outlineOn ? [s.outline.shape, outlineIdx, s.outline.shape === 'rounded' ? radius : ''].join() : '';
    if (outlineOn && s.outline.shape === 'rounded' && s.outline.radius > maxRadius) {
      warnings.push(`The corner radius was limited to ${maxRadius.toFixed(1)} mm, where the short sides become fully rounded.`);
    }
    const traceKey = labelsKey + '|' + s.smooth + '|' + (s.base.type === 'rect') + '|' + outlineKey + '|' + loopKey;
    if (cache.traceKey !== traceKey) {
      let grid = { labels: cache.labels, W: gw, H: gh, ox: 0, oy: 0 };
      if (outlineKey) grid = L3D.model.addOutline(grid.labels, gw, gh, outlineIdx, s.outline.shape, radius / scale);
      let { labels, W, H } = L3D.model.traceLabels(grid.labels, grid.W, grid.H, S.palette.length, s);
      let { ox, oy } = grid;
      cache.loopMissed = false;
      if (loopOn) {
        const r = L3D.keychain.addLoop(labels, W, H, {
          side: s.loop.side, outerPx: s.loop.outer / scale, innerPx: s.loop.hole / scale, label: loopIdx,
        });
        // A loop that doesn't touch the logo would print as a loose ring, so leave it out.
        if (r.connected) { labels = r.labels; W = r.W; H = r.H; ox += r.ox; oy += r.oy; }
        cache.loopMissed = !r.connected;
      }
      cache.finalGrid = { labels, W, H, ox, oy };
      cache.graph = L3D.contours.trace(labels, W, H, { smooth: s.smooth });
      cache.traceKey = traceKey;
    }
    showGrid(cache.finalGrid);
    if (loopOn && cache.loopMissed) {
      warnings.push(`The keychain loop can't reach the logo from the ${s.loop.side}, so it isn't attached. Try another side, or a larger loop.`);
    }

    const baseIdx = Math.max(0, S.palette.findIndex(c => c.id === s.base.colorId));
    const model = L3D.model.build(cache.graph, S.palette, {
      mode: s.mode, thickness: s.thickness, layerHeight: s.layerHeight,
      base: { type: s.base.type, thickness: s.base.thickness, colorIndex: baseIdx },
    }, scale);
    S.model = model;
    warnings.push(...model.warnings);

    // Frame: a separate part shaped around the print.
    S.frame = null;
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
      const frameKey = [traceKey, scale, printDepth, f.border, f.lip, f.depth, lipDepth, f.clearance, head, f.pocketDepth, outerRadius, innerRadius].join('|');
      if (cache.frameKey !== frameKey) {
        const fg = cache.finalGrid;
        const built = L3D.frame.buildFrame(fg.labels, fg.W, fg.H, {
          border: f.border, lip: f.lip, clearance: f.clearance, frameDepth: f.depth, lipDepth, printDepth,
          head, pocketDepth: f.pocketDepth, outerRadius, innerRadius, smooth: s.smooth,
        }, scale);
        cache.frameMesh = built.mesh;
        cache.framePocket = built.pocket;
        cache.frameBumps = built.bumps;
        cache.frameKey = frameKey;
      }
      if (cache.framePocket === 'border') {
        const need = L3D.frame.pocketBorder(head);
        warnings.push(f.border >= need
          ? 'The hanging pocket doesn\'t fit at the top centre of the frame, because of the shape of your print there, so it was left out. An Outline shape gives the frame a clean top edge.'
          : `The hanging pocket doesn't fit in the top of the frame, so it was left out. A ${head} mm head needs a border of at least ${need} mm.`);
      } else if (cache.framePocket === 'thin') {
        warnings.push(`The frame is too thin for a hanging pocket, so it was left out. It needs a frame depth of at least ${L3D.frame.pocketThickness().toFixed(1)} mm.`);
      }
      if (printDepth > lipDepth) {
        warnings.push(`Your print is ${printDepth.toFixed(1)} mm deep, more than the ${lipDepth.toFixed(1)} mm lip depth, so it will stick out of the back of the frame.`);
      } else if (!cache.frameBumps) {
        warnings.push(`There's no room for the bumps that hold the print in, so it will need glue or tape. A lip depth over ${L3D.frame.bumpDepth(printDepth).toFixed(1)} mm leaves room for them.`);
      }
      el.frameHowTo.textContent = 'Print it as exported, face down, in any color. Then ' + (cache.frameBumps
        ? 'push your print into the back of the frame, face first, until it snaps past the bumps.'
        : 'put your print into the back of the frame, face first, and glue or tape it in place.');
      S.frame = { mesh: cache.frameMesh, depth: f.depth, lipDepth, printDepth };
    }

    el.viewerMsg.hidden = model.parts.length > 0;
    showParts();
    showOutput(warnings);
  }

  // Puts the model in the 3D view. A frame goes next to the print, 10 mm to the right, as it
  // prints; or around it, as it will look finished.
  function showParts() {
    const parts = S.model.parts, frame = S.frame;
    if (!frame) { viewer.setParts(parts); return; }
    const color = S.settings.frame.color;
    if (S.frameView === 'assembled') {
      const at = L3D.frame.assembled(frame.depth, frame.lipDepth, frame.printDepth);
      viewer.setParts(parts.map(p => Object.assign({}, p, { offset: [0, 0, at.printZ] })).concat(
        [{ name: 'Frame', color, mesh: frame.mesh, turned: true, offset: [0, 0, at.frameZ] }]));
      return;
    }
    const printBox = L3D.mesh.bounds([S.model.body]), frameBox = L3D.mesh.bounds([frame.mesh]);
    viewer.setParts(parts.concat([{ name: 'Frame', color, mesh: frame.mesh, offset: [printBox.max[0] - frameBox.min[0] + 10, 0, 0] }]));
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
    el.exportFrame.disabled = !(has && S.frame);
    el.stats.innerHTML = '';
    el.swapsBox.hidden = true;
    if (!has) return;

    const b = L3D.mesh.bounds(m.parts.map(p => p.mesh));
    const tris = m.parts.reduce((a, p) => a + p.mesh.indices.length / 3, 0);
    let check = '';
    if (tris <= CHECK_LIMIT) {
      const open = m.parts.reduce((a, p) => a + L3D.mesh.openEdges(p.mesh), 0) + L3D.mesh.openEdges(m.body) +
        (S.frame ? L3D.mesh.openEdges(S.frame.mesh) : 0);
      check = open ? `<span class="bad">✗ ${open} open edges</span>` : '<span class="ok">✓ watertight</span>';
    }
    const dim = i => (b.max[i] - b.min[i]).toFixed(1);
    el.stats.innerHTML = `${dim(0)} × ${dim(1)} × ${dim(2)} mm · ${tris.toLocaleString()} triangles ${check ? '· ' + check : ''}`;

    if (m.swaps.length) {
      el.swaps.innerHTML = '';
      m.swaps.forEach((sw, k) => {
        const li = document.createElement('li');
        const dot = '<span class="dot"></span>';
        li.innerHTML = k === 0
          ? `Start with ${dot}<strong></strong>`
          : `At the layer at <strong>${sw.z.toFixed(2)} mm</strong>, change to ${dot}<strong></strong>`;
        li.querySelectorAll('strong')[k === 0 ? 0 : 1].textContent = sw.name;
        li.querySelector('.dot').style.background = sw.color;
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

  el.viewerHome.addEventListener('click', viewer.home);
  el.frameView.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    S.frameView = b.dataset.frameView;
    for (const other of el.frameView.querySelectorAll('button')) other.classList.toggle('on', other === b);
    if (S.model && S.frame) {
      showParts();
      viewer.home();
    }
  });

  // ---------- exports ----------

  el.export3mf.addEventListener('click', () => {
    if (!S.model) return;
    L3D.exporters.download(L3D.exporters.threeMF(S.model.parts, S.name), S.name + '.3mf', 'model/3mf');
  });
  el.exportZip.addEventListener('click', () => {
    if (!S.model) return;
    L3D.exporters.download(L3D.exporters.stlZip(S.model.parts, S.name), S.name + '-parts.zip', 'application/zip');
  });
  el.exportFrame.addEventListener('click', () => {
    if (!S.frame) return;
    L3D.exporters.download(L3D.exporters.stl([S.frame.mesh]), S.name + '-frame.stl', 'model/stl');
  });
  el.exportStl.addEventListener('click', () => {
    if (!S.model) return;
    L3D.exporters.download(L3D.exporters.stl([S.model.body]), S.name + '.stl', 'model/stl');
  });

  restoreSettings();
  readSettings();
  applyVisibility();
})(globalThis.L3D = globalThis.L3D || {});
