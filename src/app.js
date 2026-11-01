// UI wiring: image loading and colour picking, settings, the build pipeline and exports.
(function (L3D) {
  'use strict';

  const MAX_GRID = 1600;        // longest side of the print grid, in pixels
  const MAX_ORIGINAL = 2048;    // longest side kept for display and picking
  const SAME_COLOR_DE = 3;      // picks closer than this (CIELAB ΔE) select the existing colour
  const MIN_CROP = 4;           // smallest crop drag (CSS pixels); anything less is a click
  const PICK_HINT = 'Click the image to add each color you want in the model. Every pixel uses the closest picked color.';

  const $ = id => document.getElementById(id);
  const el = {
    stage: $('stage'), canvas: $('imageCanvas'), dropHint: $('dropHint'), loupe: $('loupe'),
    imageTools: $('imageTools'), cropBtn: $('cropBtn'), resetImage: $('resetImage'),
    fileInput: $('fileInput'), fileInput2: $('fileInput2'), replaceBtn: $('replaceBtn'), pickHint: $('pickHint'),
    exportProject: $('exportProject'),
    suggestColors: $('suggestColors'), viewToggle: $('viewToggle'), palette: $('palette'), paletteEmpty: $('paletteEmpty'),
    thickness: $('thickness'), layerHeight: $('layerHeight'), widthMm: $('widthMm'), heightMm: $('heightMm'),
    detail: $('detail'), speck: $('speck'), smooth: $('smooth'), bedWidth: $('bedWidth'), bedDepth: $('bedDepth'),
    baseType: $('baseType'), baseThickness: $('baseThickness'), baseColor: $('baseColor'),
    outlineShape: $('outlineShape'), cornerRadius: $('cornerRadius'), outlineColor: $('outlineColor'),
    borderOn: $('borderOn'), borderWidth: $('borderWidth'), borderHeight: $('borderHeight'), borderColor: $('borderColor'),
    loopOn: $('loopOn'), loopSide: $('loopSide'), loopOuter: $('loopOuter'), loopHole: $('loopHole'), loopColor: $('loopColor'),
    frameOn: $('frameOn'), frameBorder: $('frameBorder'), frameLip: $('frameLip'),
    frameDepth: $('frameDepth'), frameLipDepth: $('frameLipDepth'), frameClearance: $('frameClearance'), frameColor: $('frameColor'),
    frameExport: $('frameExport'), exportFrame: $('exportFrame'), framePocket: $('framePocket'), frameHead: $('frameHead'),
    framePocketDepth: $('framePocketDepth'), frameOuterRadius: $('frameOuterRadius'), frameInnerRadius: $('frameInnerRadius'),
    viewerHome: $('viewerHome'), frameView: $('frameView'),
    frameHowTo: $('frameHowTo'), frameStand: $('frameStand'), frameStandAngle: $('frameStandAngle'),
    frameStandWidth: $('frameStandWidth'), frameStandLength: $('frameStandLength'), exportStand: $('exportStand'), standHowTo: $('standHowTo'),
    viewer: $('viewer'), viewerMsg: $('viewerMsg'), busy: $('busy'), stats: $('stats'),
    warnings: $('warnings'), export3mf: $('export3mf'), exportZip: $('exportZip'), exportStl: $('exportStl'),
    estimate: $('estimate'), swapsEstimate: $('swapsEstimate'), frameEstimate: $('frameEstimate'),
    resetSettings: $('resetSettings'), swapsBox: $('swapsBox'), swaps: $('swaps'), perColor: $('perColor'),
    singleOn: $('singleOn'), singleOff: $('singleOff'),
  };

  const S = {
    base: null,         // the image as loaded { img, w, h, isSvg, url }
    work: null,         // canvas holding the image with any edits, or null
    src: null,          // what everything else uses: base, or work once edited
    cropping: false,    // Crop pressed, waiting for a drag
    cropBox: null,      // the drag so far { x0, y0, x1, y1 }, in CSS pixels
    cropClick: false,   // the click that ends a drag is not a colour pick
    orig: null,         // { canvas, data, w, h } for display and picking
    name: 'logo',
    palette: [],        // [{ id, rgb, filament, name, none, height }]
    nextId: 1,
    view: 'original',
    frameView: 'apart', // or 'assembled'
    hover: -1,          // palette index highlighted from the list
    model: null,
    settings: {
      mode: 'flat', thickness: 2, layerHeight: 0.2, widthMm: 80, detail: 0.15, speckMm2: 0.3, smooth: true, bedWidth: 256, bedDepth: 256,
      base: { type: 'none', thickness: 1, colorId: null },
      loop: { on: false, side: 'top', outer: 10, hole: 5, colorId: null },
      outline: { shape: 'none', radius: 5, colorId: null },
      border: { on: false, width: 2, height: 3, colorId: null },
      frame: {
        on: false, border: 10, lip: 1, depth: 15, lipDepth: 13, clearance: 0.3, color: '#3A3A3A',
        pocket: false, head: 5, pocketDepth: 0, outerRadius: 1, innerRadius: 1, stand: false, standAngle: 20, standWidth: 30, standLength: 0,
      },
    },
  };
  const cache = {};
  const viewer = L3D.viewer.createViewer(el.viewer);

  // ---------- image loading ----------

  async function loadFile(file) {
    if (!file) return;
    try {
      if (L3D.project.isProject(file.name)) {
        await openProject(file);
      } else {
        showImage(await L3D.raster.loadImage(file), null, file.name);
        renderPalette();
        schedule(0);
      }
    } catch (err) {
      alert(err.message);
    }
  }

  // Starts afresh with this image. work: a canvas of the image with edits, or null.
  function showImage(src, work, fileName) {
    if (S.base) URL.revokeObjectURL(S.base.url);
    S.base = src;
    S.work = work;
    useImage(work ? { img: work, w: work.width, h: work.height, isSvg: false } : src);
    S.name = L3D.exporters.safeName(fileName.replace(/\.[^.]+$/, '')) || 'logo';
    S.palette = [];
    el.dropHint.hidden = true;
    el.replaceBtn.hidden = false;
    el.imageTools.hidden = false;
    el.suggestColors.disabled = false;
    el.exportProject.disabled = false;
    el.canvas.classList.remove('empty');
    endCrop();
    setView('original');
  }

  // Makes this the image everything works from, and clears what was worked out from the last.
  function useImage(src) {
    S.src = src;
    S.orig = L3D.raster.originalPixels(src, MAX_ORIGINAL);
    for (const k of Object.keys(cache)) delete cache[k];
    el.resetImage.disabled = !S.work;
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

  // ---------- image tools ----------

  function editImage(op) {
    S.work = L3D.raster.editCanvas(S.work || L3D.raster.toCanvas(S.base), op);
    useImage({ img: S.work, w: S.work.width, h: S.work.height, isSvg: false });
    drawImage();
    schedule(0);
  }

  function trimMargins() {
    const o = S.orig, b = L3D.labels.trimBox(o.data.data, o.w, o.h);
    if (!b) { flashHint('There are no empty margins to trim.'); return; }
    editImage({ type: 'crop', u0: b.x / o.w, v0: b.y / o.h, u1: (b.x + b.w) / o.w, v1: (b.y + b.h) / o.h });
  }

  function resetImage() {
    S.work = null;
    useImage(S.base);
    drawImage();
    schedule(0);
  }

  function startCrop() {
    setView('original');
    S.cropping = true;
    el.loupe.hidden = true;
    el.canvas.classList.add('cropping');
    el.cropBtn.classList.add('primary');
    el.pickHint.textContent = 'Drag a box on the image to crop it. Press Esc or Crop to cancel.';
  }

  function endCrop() {
    S.cropping = false;
    S.cropBox = null;
    el.canvas.classList.remove('cropping');
    el.cropBtn.classList.remove('primary');
    el.pickHint.textContent = PICK_HINT;
    drawImage();
  }

  el.imageTools.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !S.base) return;
    const tool = b.dataset.tool;
    if (tool === 'crop') { if (S.cropping) endCrop(); else startCrop(); return; }
    if (S.cropping) endCrop();
    if (tool === 'rotate-left') editImage({ type: 'rotate', dir: -1 });
    else if (tool === 'rotate-right') editImage({ type: 'rotate', dir: 1 });
    else if (tool === 'flip-h') editImage({ type: 'flip', axis: 'h' });
    else if (tool === 'flip-v') editImage({ type: 'flip', axis: 'v' });
    else if (tool === 'trim') trimMargins();
    else resetImage();
  });

  // Pointer position on the canvas, kept inside the image.
  function cropPoint(e) {
    const rect = el.canvas.getBoundingClientRect(), r = fitRect();
    return {
      x: Math.max(r.x, Math.min(r.x + r.w, e.clientX - rect.left)),
      y: Math.max(r.y, Math.min(r.y + r.h, e.clientY - rect.top)),
    };
  }

  el.canvas.addEventListener('pointerdown', e => {
    S.cropClick = false; // not every browser sends the click after a drag ends off the canvas
    if (!S.cropping) return;
    e.preventDefault();
    el.canvas.setPointerCapture(e.pointerId);
    const p = cropPoint(e);
    S.cropBox = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  });
  el.canvas.addEventListener('pointermove', e => {
    if (!S.cropBox) return;
    const p = cropPoint(e);
    S.cropBox.x1 = p.x;
    S.cropBox.y1 = p.y;
    drawImage();
  });
  el.canvas.addEventListener('pointerup', () => {
    if (!S.cropBox) return;
    const b = S.cropBox, r = fitRect();
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    S.cropBox = null;
    S.cropClick = true;
    if (x1 - x0 < MIN_CROP || y1 - y0 < MIN_CROP) { drawImage(); return; } // keep waiting for a drag
    endCrop();
    editImage({ type: 'crop', u0: (x0 - r.x) / r.w, v0: (y0 - r.y) / r.h, u1: (x1 - r.x) / r.w, v1: (y1 - r.y) / r.h });
  });
  el.canvas.addEventListener('pointercancel', () => { S.cropBox = null; drawImage(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.cropping) endCrop(); });

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
      if (S.cropBox) drawCropBox(ctx, r);
    }
  }

  // Dims everything outside the box being dragged.
  function drawCropBox(ctx, r) {
    const b = S.cropBox;
    const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.rect(x, y, w, h);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
  }

  // The final grid drawn in filament colours, seen from the front: exactly what will be
  // printed, with any outline, keychain loop and rectangular base plate included.
  function mappedCanvas() {
    const { labels, W: gw, H: gh, border = -1 } = cache.shown;
    const base = S.palette.find(p => p.id === S.settings.base.colorId);
    const baseColor = base ? base.filament : '#808080';
    const key = cache.shownId + '|' + S.palette.map(p => p.filament).join() + '|' + baseColor + '|' + S.hover;
    if (cache.mapped && cache.mappedKey === key) return cache.mapped;
    const c = cache.mapped || document.createElement('canvas');
    c.width = gw;
    c.height = gh;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(gw, gh);
    // After the palette's labels come a border's, if there is one, then a rectangular base plate's.
    const K = S.palette.length;
    const borderColor = border >= 0 ? S.palette[border] : null;
    const extra = borderColor ? [borderColor.filament, baseColor] : [baseColor];
    const cols = S.palette.map(p => p.filament).concat(extra).map(L3D.color.hexToRgb);
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      if (l < 0) continue;
      const o = i * 4, col = cols[l];
      if (!col) continue; // a colour removed since this grid was built
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2];
      const lit = S.hover < 0 || S.hover === l || (borderColor && l === K && S.hover === border);
      img.data[o + 3] = lit ? 255 : 40;
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
    if (S.cropping || S.cropClick) { S.cropClick = false; return; }
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
    addColor(rgb);
    renderPalette();
    flashRow(S.palette.length - 1);
    schedule(0);
  });

  el.suggestColors.addEventListener('click', () => {
    if (!S.orig) return;
    const found = L3D.labels.suggestColors(S.orig.data.data, S.orig.w * S.orig.h, S.palette.map(c => c.rgb));
    if (!found.length) { flashHint('There are no more main colors to add.'); return; }
    found.forEach(addColor);
    renderPalette();
    schedule(0);
  });

  el.canvas.addEventListener('mousemove', e => {
    const p = S.cropping ? null : imagePixel(e);
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

  function addColor(rgb) {
    S.palette.push({
      id: S.nextId++, rgb, filament: L3D.color.rgbToHex(rgb), name: '', autoName: true,
      none: false, height: +(1.2 + 0.6 * S.palette.length).toFixed(2),
    });
    renumber();
  }

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
    for (const [select, setting] of [[el.baseColor, S.settings.base], [el.loopColor, S.settings.loop], [el.outlineColor, S.settings.outline], [el.borderColor, S.settings.border]]) {
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
    s.bedWidth = Math.max(50, +el.bedWidth.value || 256);
    s.bedDepth = Math.max(50, +el.bedDepth.value || 256);
    s.base.type = el.baseType.value;
    s.outline.shape = el.outlineShape.value;
    s.outline.radius = Math.max(0, +el.cornerRadius.value || 0);
    s.outline.colorId = +el.outlineColor.value || s.outline.colorId;
    s.border.on = el.borderOn.checked;
    s.border.width = Math.max(0.5, +el.borderWidth.value || 2);
    s.border.height = Math.max(0.1, +el.borderHeight.value || 3);
    s.border.colorId = +el.borderColor.value || s.border.colorId;
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
    s.frame.stand = el.frameStand.checked;
    s.frame.standAngle = Math.min(40, Math.max(5, +el.frameStandAngle.value || 20));
    s.frame.standWidth = Math.max(5, +el.frameStandWidth.value || 30);
    s.frame.standLength = Math.max(0, +el.frameStandLength.value || 0); // 0 = from the frame's height
  }

  function applyVisibility() {
    const mode = S.settings.mode;
    document.querySelectorAll('[data-show]').forEach(n => { n.hidden = n.dataset.show !== mode; });
    document.querySelectorAll('[data-base]').forEach(n => { n.hidden = S.settings.base.type === 'none'; });
    document.querySelectorAll('[data-loop]').forEach(n => { n.hidden = !S.settings.loop.on; });
    document.querySelectorAll('[data-border]').forEach(n => { n.hidden = !S.settings.border.on; });
    document.querySelectorAll('[data-frame]').forEach(n => { n.hidden = !S.settings.frame.on; });
    el.frameExport.hidden = !S.settings.frame.on;
    el.frameView.hidden = !S.settings.frame.on;
    viewer.setBed(S.settings.bedWidth, S.settings.bedDepth);
    el.framePocketDepth.placeholder = L3D.frame.maxPocketDepth(S.settings.frame.depth).toFixed(1).replace(/\.0$/, '');
    document.querySelectorAll('[data-frame-pocket]').forEach(n => { n.hidden = !(S.settings.frame.on && S.settings.frame.pocket); });
    document.querySelectorAll('[data-frame-stand]').forEach(n => { n.hidden = !(S.settings.frame.on && S.settings.frame.stand); });
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
  const settingInputs = [el.thickness, el.layerHeight, el.widthMm, el.detail, el.speck, el.smooth, el.bedWidth, el.bedDepth,
    el.baseType, el.baseThickness, el.outlineShape, el.cornerRadius, el.outlineColor, el.borderOn, el.borderWidth, el.borderHeight, el.borderColor, el.baseColor, el.loopOn, el.loopSide, el.loopOuter, el.loopHole, el.loopColor,
    el.frameOn, el.frameBorder, el.frameLip, el.frameDepth, el.frameLipDepth, el.frameClearance, el.frameColor,
    el.framePocket, el.frameHead, el.framePocketDepth, el.frameOuterRadius, el.frameInnerRadius, el.frameStand, el.frameStandAngle, el.frameStandWidth, el.frameStandLength];
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
  const colorInputs = [el.baseColor, el.loopColor, el.outlineColor, el.borderColor];
  const remembered = [el.perColor].concat(settingInputs.filter(input => !colorInputs.includes(input)));

  function defaultOption(select) {
    return Array.from(select.options).find(o => o.defaultSelected) || select.options[0];
  }

  function readValues(inputs) {
    const values = {};
    for (const input of inputs) values[input.id] = input.type === 'checkbox' ? input.checked : input.value;
    return values;
  }

  function writeValues(inputs, values) {
    for (const input of inputs) {
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

  function setDefaults(inputs) {
    for (const input of inputs) {
      if (input.type === 'checkbox') input.checked = input.defaultChecked;
      else if (input.tagName === 'SELECT') input.value = defaultOption(input).value;
      else input.value = input.defaultValue;
    }
  }

  // Storage can be unavailable (a private window, for example): settings just aren't kept.
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(readValues(remembered))); } catch (err) { /* not kept */ }
  }

  function restoreSettings() {
    let values = null;
    try { values = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (err) { /* nothing to restore */ }
    if (values) writeValues(remembered, values);
  }

  function resetSettings() {
    try { localStorage.removeItem(SETTINGS_KEY); } catch (err) { /* nothing to remove */ }
    setDefaults(remembered);
    readSettings();
    applyVisibility();
    renderPalette();
    schedule(0);
  }
  el.resetSettings.addEventListener('click', resetSettings);

  // ---------- project files ----------

  // Everything but the bed size travels with a project: that belongs to whoever is printing.
  const projectInputs = remembered.filter(input => input !== el.bedWidth && input !== el.bedDepth);

  async function saveProject() {
    try {
      const file = S.base.file;
      readSettings();
      L3D.exporters.download(L3D.project.pack({
        name: S.name, imageName: file.name, imageType: file.type,
        image: new Uint8Array(await file.arrayBuffer()),
        edited: S.work ? await L3D.raster.canvasPng(S.work) : null,
        palette: S.palette,
        colorIds: { base: S.settings.base.colorId, loop: S.settings.loop.colorId, outline: S.settings.outline.colorId, border: S.settings.border.colorId },
        values: readValues(projectInputs),
      }), S.name + L3D.project.EXTENSION, 'application/zip');
    } catch (err) {
      alert(err.message);
    }
  }

  // Opening a project doesn't change the settings remembered in this browser, until the next
  // time one is changed here.
  async function openProject(file) {
    const p = L3D.project.unpack(new Uint8Array(await file.arrayBuffer()));
    const src = await L3D.raster.loadImage(new File([p.image], p.imageName || 'image', { type: p.imageType }));
    let work = null;
    if (p.edited) {
      const edited = await L3D.raster.loadImage(new File([p.edited], 'edited.png', { type: 'image/png' }));
      work = L3D.raster.toCanvas(edited);
      URL.revokeObjectURL(edited.url);
    }
    showImage(src, work, p.name || file.name);
    S.palette = p.palette;
    S.nextId = Math.max(S.nextId, ...p.palette.map(c => c.id + 1));
    setDefaults(projectInputs);
    writeValues(projectInputs, p.values);
    readSettings();
    // The color dropdowns are filled in from these by renderPalette.
    S.settings.base.colorId = p.colorIds.base;
    S.settings.loop.colorId = p.colorIds.loop;
    S.settings.outline.colorId = p.colorIds.outline;
    S.settings.border.colorId = p.colorIds.border;
    applyVisibility();
    renderPalette();
    schedule(0);
    flashHint('Opened the project. Your bed size is unchanged.');
  }

  el.exportProject.addEventListener('click', saveProject);

  // ---------- build pipeline ----------

  let timer = 0, building = false, dirty = false;
  let worker = null, local = null;

  // Builds run in a background worker, so the page stays usable during them. A browser may not
  // allow one, as with a page opened from a file, or it may fail to load. Then they run on the
  // page, which freezes while they do.
  function buildOnPage() {
    if (worker) worker.terminate();
    worker = null;
    local = L3D.pipeline.create();
    cache.imageSent = false;
  }
  try {
    worker = new Worker('src/worker.js');
    worker.onmessage = event => finishBuild(event.data);
    worker.onerror = event => {
      event.preventDefault();
      console.warn('The background worker failed, so builds will run on the page.', event.message);
      buildOnPage();
      building = false;
      if (S.src) schedule(0);
    };
  } catch (err) {
    buildOnPage();
  }

  function schedule(delay) {
    clearTimeout(timer);
    dirty = true;
    timer = setTimeout(startBuild, delay);
  }

  // Only one build runs at a time. If something changes meanwhile, finishBuild starts another.
  function startBuild() {
    if (building || !S.src) return;
    building = true;
    dirty = false;
    el.busy.hidden = false;
    // Let the "Building…" badge paint first, for when the build holds up the page.
    setTimeout(() => {
      try {
        const job = makeJob();
        if (worker) worker.postMessage(job);
        else finishBuild({ result: local.run(job) });
      } catch (err) {
        console.error(err);
        finishBuild({ error: err.message });
      }
    }, 20);
  }

  // message: { result } or { error }. A build that's already out of date isn't shown.
  function finishBuild(message) {
    building = false;
    if (dirty) { schedule(0); return; }
    el.busy.hidden = true;
    try {
      if (message.error) throw new Error(message.error);
      showBuild(message.result);
    } catch (err) {
      console.error(err);
      showError(err);
    }
  }

  // Sets what the Mapped view shows, and redraws.
  function showGrid(grid, key) {
    if (cache.shownKey !== key) {
      cache.shown = grid;
      cache.shownKey = key;
      cache.shownId = (cache.shownId || 0) + 1;
    }
    drawImage();
  }

  function gridSize() {
    const s = S.settings;
    // Width is the finished width, so the image is smaller to leave room for an oval or border.
    const hasFill = S.palette.some(c => c.id === s.outline.colorId && !c.none);
    const growth = hasFill ? L3D.model.outlineGrowth(s.outline.shape) : 1;
    const hasBorder = s.border.on && S.palette.some(c => c.id === s.border.colorId && !c.none);
    const border = hasBorder ? Math.min(s.border.width, s.widthMm / 4) : 0;
    const imageWidth = (s.widthMm - 2 * border) / growth;
    let gw = Math.max(2, Math.round(imageWidth / s.detail));
    let gh = Math.max(2, Math.round(gw * S.src.h / S.src.w));
    let capped = false;
    if (Math.max(gw, gh) > MAX_GRID) {
      const k = MAX_GRID / Math.max(gw, gh);
      gw = Math.max(2, Math.round(gw * k));
      gh = Math.max(2, Math.round(gh * k));
      capped = true;
    }
    return { gw, gh, scale: imageWidth / gw, capped, growth, border };
  }

  // What the pipeline needs for the current settings. Resampling needs a canvas, so it happens
  // here, and the pixels are only sent when they've changed.
  function makeJob() {
    const { gw, gh, scale, capped, growth, border } = gridSize();
    el.heightMm.textContent = (gh * scale * growth + 2 * border).toFixed(1) + ' mm';
    const gridKey = gw + 'x' + gh;
    if (cache.gridKey !== gridKey) {
      cache.grid = { gw, gh, data: L3D.raster.resample(S.src, gw, gh) };
      cache.gridKey = gridKey;
      cache.imageSent = false;
    }
    const job = { gw, gh, scale, capped, borderMm: border, palette: S.palette, settings: S.settings };
    if (!cache.imageSent) {
      job.image = cache.grid.data.data;
      cache.imageSent = true;
    }
    return job;
  }

  // Shows a finished build.
  function showBuild(r) {
    cache.counts = r.counts;
    updateCoverage();
    showGrid(r.shown, r.shownKey);
    S.model = r.model;
    S.frame = r.frame;
    S.openEdges = r.openEdges;
    if (!r.model) {
      viewer.setParts([]);
      el.viewerMsg.hidden = false;
      el.viewerMsg.textContent = S.palette.length
        ? 'Every picked color is set to “No material”. Pick or enable at least one color to print.'
        : 'Click the image to pick the colors you want to print.';
      showOutput(r.warnings);
      return;
    }
    if (r.frame) {
      el.frameHowTo.textContent = 'Print it as exported, face down, in any color. Then ' + (r.frame.bumps
        ? 'push your print into the back of the frame, face first, until it snaps past the bumps.'
        : 'put your print into the back of the frame, face first, and glue or tape it in place.');
      if (r.frame.standLength) el.frameStandLength.placeholder = r.frame.standLength.toFixed(0);
    }
    el.viewerMsg.hidden = r.model.parts.length > 0;
    showParts();
    showOutput(r.warnings);
  }

  // Puts the model in the 3D view. A frame goes next to the print, 10 mm to the right, as it
  // prints; or around it, as it will look finished. (They're printed separately, so a pair
  // running off the bed side by side doesn't mean either part won't fit.) A stand goes next
  // to the frame, and isn't shown in the assembled view, which has the frame lying on its back.
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
    // Side by side, with the pair centred on the bed.
    const printBox = L3D.mesh.bounds([S.model.body]), frameBox = L3D.mesh.bounds([frame.mesh]);
    const frameAt = printBox.max[0] - frameBox.min[0] + 10;
    const standAt = frameAt + frameBox.max[0] + 10;
    const right = frame.stand ? standAt + L3D.mesh.bounds([frame.stand]).max[0] : frameAt + frameBox.max[0];
    const centre = (printBox.min[0] + right) / 2;
    const extras = [{ name: 'Frame', color, mesh: frame.mesh, offset: [frameAt - centre, 0, 0] }];
    if (frame.stand) extras.push({ name: 'Stand', color, mesh: frame.stand, offset: [standAt - centre, 0, 0] });
    viewer.setParts(parts.map(p => Object.assign({}, p, { offset: [-centre, 0, 0] })).concat(extras));
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
    const stand = has && S.frame ? S.frame.stand : null;
    el.exportStand.disabled = el.exportStand.hidden = el.standHowTo.hidden = !stand;
    el.stats.innerHTML = '';
    el.swapsBox.hidden = true;
    el.estimate.hidden = true;
    el.frameEstimate.textContent = '';
    if (!has) return;

    const b = L3D.mesh.bounds(m.parts.map(p => p.mesh));
    const tris = m.parts.reduce((a, p) => a + p.mesh.indices.length / 3, 0);
    let check = '';
    if (S.openEdges !== null) {
      check = S.openEdges ? `<span class="bad">✗ ${S.openEdges} open edges</span>` : '<span class="ok">✓ watertight</span>';
    }
    const dim = i => (b.max[i] - b.min[i]).toFixed(1);
    el.stats.innerHTML = `${dim(0)} × ${dim(1)} × ${dim(2)} mm · ${tris.toLocaleString()} triangles ${check ? '· ' + check : ''}`;

    showEstimates(m);

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
        li.append(` (about ${L3D.estimate.formatGrams(sw.volume * m.bodyRatio)})`);
        el.swaps.appendChild(li);
      });
      el.swapsBox.hidden = false;
    }
  }

  // Rough filament figures. A multi-color print uses each part's plastic; a single
  // extruder prints the one body, so its filaments are bands of layers scaled to its plastic.
  function showEstimates(m) {
    const E = L3D.estimate, line = v => `${E.formatGrams(v)}, ${E.formatMetres(v)}`;
    const rows = m.parts.map(p => ({ name: p.name, color: p.color, plastic: E.plastic(p.mesh) }));
    const total = rows.reduce((a, r) => a + r.plastic, 0);
    const list = document.createElement('ul');
    for (const r of rows) {
      const li = document.createElement('li');
      const dot = document.createElement('span'), name = document.createElement('span'), amount = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = r.color;
      name.textContent = r.name;
      amount.className = 'amount';
      amount.textContent = line(r.plastic);
      li.append(dot, name, amount);
      list.append(li);
    }
    const sum = document.createElement('div'), note = document.createElement('p');
    sum.className = 'total';
    sum.textContent = `About ${line(total)}`;
    note.className = 'muted small';
    note.textContent = 'A rough guide for PLA at 15% infill. Your slicer knows your real settings. Filament purged at color changes isn\'t included.';
    el.estimate.replaceChildren(list, sum, note);
    el.estimate.hidden = false;

    const body = E.plastic(m.body);
    m.bodyRatio = body / L3D.mesh.volume(m.body);
    el.swapsEstimate.textContent = `About ${line(body)} in all.`;
    if (S.frame) {
      const frame = E.plastic(S.frame.mesh);
      const stand = S.frame.stand ? ` The stand adds about ${line(E.plastic(S.frame.stand))}.` : '';
      el.frameEstimate.textContent = `About ${line(frame)}.${stand}`;
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
  el.exportStand.addEventListener('click', () => {
    if (!S.frame || !S.frame.stand) return;
    L3D.exporters.download(L3D.exporters.stl([S.frame.stand]), S.name + '-stand.stl', 'model/stl');
  });
  el.exportStl.addEventListener('click', () => {
    if (!S.model) return;
    L3D.exporters.download(L3D.exporters.stl([S.model.body]), S.name + '.stl', 'model/stl');
  });

  restoreSettings();
  readSettings();
  applyVisibility();
})(globalThis.L3D = globalThis.L3D || {});
