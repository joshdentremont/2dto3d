// Rough filament estimates from a mesh, for PLA. A slicer knows the real settings;
// this is for a sense of scale before opening one.
(function (L3D) {
  'use strict';

  const DENSITY = 1.24;                         // g/cm³, PLA
  const FILAMENT_AREA = Math.PI * 0.875 * 0.875; // mm², 1.75 mm filament
  const SHELL = 0.8;                            // mm printed solid under every surface
  const INFILL = 0.15;                          // how full the inside is

  function surfaceArea(mesh) {
    const p = mesh.positions, t = mesh.indices;
    let area = 0;
    for (let k = 0; k < t.length; k += 3) {
      const a = 3 * t[k], b = 3 * t[k + 1], c = 3 * t[k + 2];
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
    return area;
  }

  // Volume of plastic (mm³) in a printed mesh: a solid shell, with sparse infill inside.
  // Thin parts are all shell, so they stay solid.
  function plastic(mesh) {
    const volume = L3D.mesh.volume(mesh);
    const shell = Math.min(volume, surfaceArea(mesh) * SHELL);
    return shell + (volume - shell) * INFILL;
  }

  const grams = mm3 => mm3 / 1000 * DENSITY;
  const metres = mm3 => mm3 / FILAMENT_AREA / 1000;

  const formatGrams = mm3 => {
    const g = grams(mm3);
    return (g < 10 ? g.toFixed(1) : Math.round(g)) + ' g';
  };
  const formatMetres = mm3 => metres(mm3).toFixed(1) + ' m';

  L3D.estimate = { surfaceArea, plastic, grams, metres, formatGrams, formatMetres };
})(globalThis.L3D = globalThis.L3D || {});
