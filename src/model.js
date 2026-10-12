// Turns traced outlines plus the user's settings into printable parts.
(function (L3D) {
  'use strict';

  const round = z => Math.round(z * 1e4) / 1e4;

  // Label grid to trace. With a rectangular base plate, empty pixels become an extra label
  // (index = palette length) so the plate can be built from the same outlines.
  function traceLabels(labels, paletteLength, settings) {
    if (settings.base.type !== 'rect') return labels;
    return Int16Array.from(labels, l => (l < 0 ? paletteLength : l));
  }

  // g: result of contours.trace on traceLabels(...).
  // palette: [{ name, filament: '#RRGGBB', height }]. scale: mm per pixel.
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
      zTop[l] = round(z0 + (settings.mode === 'flat' ? snap(settings.thickness) : snap(palette[l].height)));
    }

    const parts = [];
    if (hasBase) {
      const zt = [];
      for (const l of g.polys.keys()) zt[l] = z0;
      parts.push({ name: 'Base', color: palette[baseIdx].filament, mesh: L3D.mesh.buildSolid(g, zt, 0, scale) });
    }
    for (const l of present) {
      const zt = [];
      zt[l] = zTop[l];
      parts.push({ name: palette[l].name, color: palette[l].filament, mesh: L3D.mesh.buildSolid(g, zt, z0, scale) });
    }

    // One stepped solid holding every colour (and the plate), for single-extruder printing.
    const bodyTop = zTop.slice();
    if (settings.base.type === 'rect' && g.polys.has(K)) bodyTop[K] = z0;
    const body = L3D.mesh.buildSolid(g, bodyTop, 0, scale);

    // Filament changes for a single extruder: each colour must be loaded while its top
    // layers print, so colours are stacked in order of height.
    const swaps = [];
    if (settings.mode === 'layered' && present.length) {
      const order = present.slice().sort((a, b) => zTop[a] - zTop[b]);
      const same = (a, b) => a.filament.toLowerCase() === b.filament.toLowerCase();
      let cur = hasBase ? palette[baseIdx] : palette[order[0]];
      swaps.push({ z: 0, name: cur.name, color: cur.filament });
      let prevTop = z0;
      for (let k = 0; k < order.length; k++) {
        const p = palette[order[k]];
        if (!same(p, cur)) {
          swaps.push({ z: prevTop, name: p.name, color: p.filament });
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

    return { parts, body, zTop, z0, swaps, warnings };
  }

  L3D.model = { traceLabels, build };
})(globalThis.L3D = globalThis.L3D || {});
