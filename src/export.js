// File writers: binary STL, 3MF, and a ZIP of per-colour STLs.
(function (L3D) {
  'use strict';

  // Binary STL holding all the given meshes (each stays a separate closed shell).
  function stl(meshes) {
    let count = 0;
    for (const m of meshes) count += m.indices.length / 3;
    const buf = new ArrayBuffer(84 + count * 50);
    const dv = new DataView(buf);
    const header = '2D to 3D';
    for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
    dv.setUint32(80, count, true);
    let o = 84;
    for (const m of meshes) {
      const p = m.positions, t = m.indices;
      for (let k = 0; k < t.length; k += 3) {
        const a = 3 * t[k], b = 3 * t[k + 1], c = 3 * t[k + 2];
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        for (const val of [nx, ny, nz]) { dv.setFloat32(o, val, true); o += 4; }
        for (const i of [a, b, c]) {
          dv.setFloat32(o, p[i], true);
          dv.setFloat32(o + 4, p[i + 1], true);
          dv.setFloat32(o + 8, p[i + 2], true);
          o += 12;
        }
        dv.setUint16(o, 0, true);
        o += 2;
      }
    }
    return new Uint8Array(buf);
  }

  const num = v => String(Math.round(v * 1e4) / 1e4);
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  // 3MF with one object made of one part per colour. Parts keep their names and display
  // colours; slicers that read them show the parts already coloured, the rest list them by
  // name so filaments can be assigned by hand.
  function threeMF(parts, name) {
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>\n',
      '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n',
      '<metadata name="Application">2D to 3D</metadata>\n',
      '<metadata name="Title">', esc(name), '</metadata>\n',
      '<resources>\n<basematerials id="1">\n');
    for (const part of parts) out.push(`<base name="${esc(part.name)}" displaycolor="${part.color.toUpperCase()}FF"/>\n`);
    out.push('</basematerials>\n');
    parts.forEach((part, k) => {
      const p = part.mesh.positions, t = part.mesh.indices;
      out.push(`<object id="${k + 2}" type="model" name="${esc(part.name)}" pid="1" pindex="${k}">\n<mesh>\n<vertices>\n`);
      for (let i = 0; i < p.length; i += 3) out.push(`<vertex x="${num(p[i])}" y="${num(p[i + 1])}" z="${num(p[i + 2])}"/>\n`);
      out.push('</vertices>\n<triangles>\n');
      for (let i = 0; i < t.length; i += 3) out.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>\n`);
      out.push('</triangles>\n</mesh>\n</object>\n');
    });
    const assembly = parts.length + 2;
    out.push(`<object id="${assembly}" type="model" name="${esc(name)}">\n<components>\n`);
    parts.forEach((part, k) => out.push(`<component objectid="${k + 2}"/>\n`));
    out.push('</components>\n</object>\n</resources>\n',
      `<build>\n<item objectid="${assembly}"/>\n</build>\n</model>\n`);

    const contentTypes = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
      '</Types>\n';
    const rels = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
      '</Relationships>\n';
    return fflate.zipSync({
      '[Content_Types].xml': fflate.strToU8(contentTypes),
      '_rels/.rels': fflate.strToU8(rels),
      '3D/3dmodel.model': fflate.strToU8(out.join('')),
    }, { level: 6 });
  }

  // ZIP with one STL per part. All files share one coordinate system, so loading them
  // together as "one object with multiple parts" lines them up.
  function stlZip(parts, baseName) {
    const files = {};
    parts.forEach((part, k) => {
      const n = String(k + 1).padStart(2, '0');
      files[`${baseName}-${n}-${safeName(part.name)}.stl`] = stl([part.mesh]);
    });
    return fflate.zipSync(files, { level: 6 });
  }

  // ZIP with one file per tile, named by row and column. kind: '3mf', 'stl' for one body per
  // tile, 'parts' for a folder per tile with an STL per colour, or 'frame' or 'stand' for
  // tiles' frames ({ row, col, mesh, stand }).
  function tilesZip(tiles, baseName, kind) {
    const files = {};
    for (const t of tiles) {
      const name = `${baseName}-row${t.row + 1}-col${t.col + 1}`;
      if (kind === 'frame') {
        files[name + '-frame.stl'] = stl([t.mesh]);
      } else if (kind === 'stand') {
        if (t.stand) files[name + '-stand.stl'] = stl([t.stand]);
      } else if (kind === '3mf') {
        files[name + '.3mf'] = [threeMF(t.parts, name), { level: 0 }];
      } else if (kind === 'stl') {
        files[name + '.stl'] = stl([t.body]);
      } else {
        t.parts.forEach((part, k) => {
          files[`${name}/${name}-${String(k + 1).padStart(2, '0')}-${safeName(part.name)}.stl`] = stl([part.mesh]);
        });
      }
    }
    return fflate.zipSync(files, { level: 6 });
  }

  // ZIP of a frame cut into pieces: an STL per piece, and one of all its butterfly keys. Pieces
  // are numbered as seen from the back, and named by row and column as seen from the front,
  // which swaps the columns round; cols is how many there are.
  function frameZip(pieces, keys, baseName, cols) {
    const files = {};
    for (const p of pieces) files[`${baseName}-frame-row${p.row + 1}-col${cols - p.col}.stl`] = stl([p.mesh]);
    if (keys) files[`${baseName}-frame-keys.stl`] = stl([keys]);
    return fflate.zipSync(files, { level: 6 });
  }

  function safeName(s) {
    return String(s).trim().replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'part';
  }

  function download(bytes, filename, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  L3D.exporters = { stl, threeMF, stlZip, tilesZip, frameZip, download, safeName };
})(globalThis.L3D = globalThis.L3D || {});
