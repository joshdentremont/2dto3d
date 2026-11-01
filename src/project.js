// Project files: a design saved to send to someone else, such as a friend with a 3D printer. A
// .2d3d file is a ZIP holding project.json, the image as it was loaded, and the edited image if
// there is one. Files come from other people, so everything in one is checked before it's used.
(function (L3D) {
  'use strict';

  const FORMAT = '2d-to-3d-project';
  const VERSION = 1;
  const EXTENSION = '.2d3d';
  const MAX_COLORS = 256;
  const MAX_ENTRY = 200 * 1024 * 1024;  // bytes, unpacked, for any one file inside a project
  const MAX_TEXT = 200;                 // characters kept of a name
  const IMAGE_TYPES = ['', 'image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml'];
  const ENTRIES = ['project.json', 'image', 'edited'];

  const NOT_A_PROJECT = 'This isn\'t a 2D to 3D project file, or it\'s damaged.';

  const isProject = fileName => String(fileName).toLowerCase().endsWith(EXTENSION);

  // p: { name, imageName, imageType, image (bytes), edited (PNG bytes, or null), palette,
  // colorIds: { base, loop, outline, border }, values: { input id: value } }. Returns the file's
  // bytes.
  function pack(p) {
    const meta = {
      format: FORMAT, version: VERSION, name: p.name, imageName: p.imageName, imageType: p.imageType,
      palette: p.palette, colorIds: p.colorIds, values: p.values,
    };
    // Images are already compressed, so they're stored as they are.
    const files = { 'project.json': fflate.strToU8(JSON.stringify(meta)), image: [p.image, { level: 0 }] };
    if (p.edited) files.edited = [p.edited, { level: 0 }];
    return fflate.zipSync(files);
  }

  const isByte = v => Number.isInteger(v) && v >= 0 && v <= 255;
  const isId = v => Number.isInteger(v) && v > 0;
  const text = v => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');

  function checkColor(c) {
    const good = c && typeof c === 'object' && isId(c.id) &&
      Array.isArray(c.rgb) && c.rgb.length === 3 && c.rgb.every(isByte) &&
      typeof c.filament === 'string' && /^#[0-9a-f]{6}$/i.test(c.filament) &&
      typeof c.name === 'string' && typeof c.height === 'number' && c.height > 0 && c.height < 1000;
    if (!good) throw new Error(NOT_A_PROJECT);
    return {
      id: c.id, rgb: c.rgb.slice(), filament: c.filament.toUpperCase(), name: text(c.name),
      autoName: !!c.autoName, none: !!c.none, height: c.height,
    };
  }

  // Returns what was packed, all checked, or throws an Error with a message for the user.
  function unpack(bytes) {
    let files, meta;
    try {
      files = fflate.unzipSync(bytes, { filter: f => ENTRIES.includes(f.name) && f.originalSize <= MAX_ENTRY });
      meta = JSON.parse(fflate.strFromU8(files['project.json']));
    } catch (err) {
      throw new Error(NOT_A_PROJECT);
    }
    if (!meta || meta.format !== FORMAT) throw new Error(NOT_A_PROJECT);
    if (meta.version > VERSION) throw new Error('This project was made with a newer version of 2D to 3D. Reload the page and try again.');
    if (!files.image || !files.image.length || !IMAGE_TYPES.includes(meta.imageType)) throw new Error(NOT_A_PROJECT);
    if (!Array.isArray(meta.palette) || meta.palette.length > MAX_COLORS) throw new Error(NOT_A_PROJECT);

    const palette = meta.palette.map(checkColor);
    if (new Set(palette.map(c => c.id)).size !== palette.length) throw new Error(NOT_A_PROJECT);

    const given = meta.colorIds && typeof meta.colorIds === 'object' ? meta.colorIds : {};
    const colorIds = {};
    for (const k of ['base', 'loop', 'outline', 'border']) colorIds[k] = isId(given[k]) ? given[k] : null;

    // Settings are typed into the page's own inputs, which reject anything unusable, so
    // they only need to be plain values.
    const values = {};
    if (meta.values && typeof meta.values === 'object') {
      for (const k of Object.keys(meta.values)) {
        const v = meta.values[k];
        if (typeof v === 'boolean' || typeof v === 'string') values[k] = v.length > MAX_TEXT ? '' : v;
      }
    }

    return {
      name: text(meta.name), imageName: text(meta.imageName), imageType: meta.imageType, image: files.image,
      edited: files.edited || null, palette, colorIds, values,
    };
  }

  L3D.project = { EXTENSION, isProject, pack, unpack };
})(globalThis.L3D = globalThis.L3D || {});
