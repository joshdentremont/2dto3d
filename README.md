# Logo to 3D

A small browser app that turns a logo or icon with a few flat colors into a 3D-printable
model, with one part per color.

It is plain HTML and JavaScript. There is no build step and no server, and nothing to install.
Your images never leave your computer.

## Running it

Double-click `index.html`. It works from the file system in Chrome, Safari, Firefox and Edge.
The libraries it needs are bundled in `vendor/`.

To check that the geometry code works, open `tests.html`. It should report that all checks passed.

## How to use it

1. **Image.** Drop an image onto the panel or choose one with the button. PNG, JPG, WebP and SVG
   all work. `samples/sample-logo.svg` is there to try.
2. **Colors.** Click the image once on each color you want in the model.
   - Every pixel is assigned to the closest picked color, judged the way the eye sees color.
   - Switch to **Mapped** to see exactly what will be printed.
   - Hover over a color in the list to highlight its area.
   - The color box next to each swatch sets the filament color, so the preview and the
     exported files can match the filament you actually own.
   - Tick **No material** for colors that should be left empty, such as the white background
     of a JPG. Transparent pixels are always empty.
3. **Shape.** Pick a mode:
   - **Flat multi-color.** Every color has the same thickness. This is for printers that change
     filament automatically (Bambu AMS, Prusa MMU/XL, tool changers).
   - **Layered heights.** Each color gets its own height, so a printer with one extruder can
     print the colors by changing filament at set heights. Heights snap to the layer height.

   Other settings:
   - **Width** sets the size of the model.
   - **Detail** is the size of one image pixel in the model.
   - **Smooth edges** removes pixel staircases.
   - **Remove specks** cleans up noise from compressed images.
   - **Base plate** (optional) adds a backing under the logo or a full rectangle, in a color
     you choose.
4. **Export.**
   - **3MF (all colors)**: one object made of one part per color, each named after its color.
   - **STL per color (.zip)**: one STL per color, all sharing the same coordinates.
   - **STL single body**: the whole model as one stepped solid, for single-extruder printing.

The preview panel shows the size and triangle count, and confirms the model is **watertight**
(fully closed, which slicers need).

## Loading the model into a slicer

**Multi-color printer (flat or layered mode)**
- Open the **3MF**. You should get one object made of several parts, one per color. Then assign
  a filament to each part.
- Slicers differ in how they read the colors stored in a 3MF. If yours doesn't show the parts
  the way you expect, unzip the **STL per color** file and load all the STLs at once. When the
  slicer asks, choose to load them as a *single object with multiple parts*. The parts line up
  because they share the same coordinates.

**Single extruder (layered mode)**
- Load the **single-body STL**.
- Use the **Filament changes** list under Export. In the slicer's layer preview, add a filament
  change (called "Change filament", M600, or a pause) at the first layer above each height
  listed. Each color is visible from above where its height is the highest.
- Two colors with the same height can't both be shown this way; the app warns you when that
  happens.

## Project layout

| Path | What it does |
|---|---|
| `index.html`, `styles.css` | The page |
| `src/app.js` | UI: image loading, color picking, settings, build pipeline, exports |
| `src/color.js` | Color conversion (sRGB → CIELAB) and nearest-color matching |
| `src/labels.js` | Maps pixels to picked colors and removes specks |
| `src/contours.js` | Traces color regions into outlines that neighboring colors share exactly |
| `src/mesh.js` | Builds closed meshes from the outlines; watertight and volume checks |
| `src/model.js` | Applies the mode, heights and base plate, and works out filament changes |
| `src/export.js` | STL, 3MF and ZIP writers |
| `src/raster.js` | Image loading, resampling and color sampling (browser only) |
| `src/viewer.js` | three.js 3D preview |
| `tests.html`, `tests/tests.js` | Geometry checks on small test grids |
| `vendor/` | three.js r147, OrbitControls and fflate (MIT, see `vendor/LICENSES.md`) |

### How the geometry stays printable

Each border between two colors is traced once and used by the regions on both sides, so
neighboring parts share their edges exactly, with no gaps or overlaps between colors.

Where two pixels of the same color touch only at a corner, that corner is split slightly, so
every outline is a simple polygon. Walls are split at every height where colors meet, so each
edge is shared by exactly two triangles.

`tests.html` checks all of this on fixed cases and on random grids.
