# Logo to 3D

A small browser app that turns a logo or icon with a few flat colors into a 3D-printable
model, with one part per color.

It is plain HTML and JavaScript. There is no build step and no server, and nothing to install.
Your images never leave your computer.

## Running it

Double-click `index.html`. It works from the file system in Chrome, Safari, Firefox and Edge.
The libraries it needs are bundled in `vendor/`.

To check that the geometry code works, open `tests.html`. It should report that all checks passed.

## Running with Docker behind Traefik

The image is `nginx:alpine` serving the files as they are, on port 80 inside the container.

Copy `.env.example` to `.env` and set `APP_HOST` to the hostname you want. Then pick one of
the two setups below. Either way, after changing the app, run `docker compose up -d --build`
again.

### With a Traefik you already run

1. Check the three Traefik names in `.env` against your Traefik setup, and change them if
   yours differ:
   - `TRAEFIK_NETWORK`: the Docker network Traefik is attached to;
   - `TRAEFIK_ENTRYPOINT`: the HTTPS entrypoint (default `websecure`);
   - `TRAEFIK_CERTRESOLVER`: the certificate resolver (default `letsencrypt`).
2. Start it:

   ```sh
   docker compose up -d --build
   ```

The container joins your Traefik network, and Traefik routes `https://APP_HOST` to it using
the labels in `docker-compose.yml`. No ports are published on the host.

If your Traefik uses a wildcard or default certificate instead of a resolver, delete the
`tls.certresolver` label line in `docker-compose.yml`.

### With the bundled Traefik

Use this on a server that doesn't run Traefik yet. Ports 80 and 443 must be free, and
`APP_HOST` must point at the server in DNS so Let's Encrypt can issue the certificate.

1. In `.env`, uncomment `COMPOSE_PROFILES=traefik`. Optionally set `ACME_EMAIL` for
   certificate notices.
2. Create the shared network once:

   ```sh
   docker network create traefik
   ```

   Use the name from `TRAEFIK_NETWORK` if you changed it.
3. Start it:

   ```sh
   docker compose up -d --build
   ```

The bundled Traefik:
- redirects HTTP to HTTPS;
- gets certificates from Let's Encrypt;
- keeps the certificates in the `letsencrypt` Docker volume, so they survive restarts;
- reads the Docker socket read-only, to find the app's routing labels.

It only routes containers that opt in with `traefik.enable=true`.

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
3. **Shape.**
   - By default every color has the same **Thickness**, giving a flat model.
   - Tick **Different height per color** to raise each color to its own height, for a stepped
     look. Heights snap to the layer height. This is also what makes single-extruder color
     printing possible (see Export).

   Other settings:
   - **Width** sets the size of the model.
   - **Detail** is the size of one image pixel in the model.
   - **Smooth edges** removes pixel staircases.
   - **Remove specks** cleans up noise from compressed images.
   - **Base plate** (optional) adds a backing under the logo or a full rectangle, in a color
     you choose.
4. **Preview.** Check the 3D model: drag to rotate, scroll to zoom, right-drag to pan. The
   panel shows the size and triangle count, and confirms the model is **watertight** (fully
   closed, which slicers need).
5. **Export.** Pick the group that matches your printer.
   - **Multi-color printer** (works with flat or stepped models):
     - **3MF (all colors)**: one object made of one part per color, each named after its color.
     - **STL per color (.zip)**: one STL per color, all sharing the same coordinates.
   - **Single extruder** (only when *Different height per color* is on):
     - **STL (single body)**: the whole model as one stepped solid.
     - A list of the layers where you change filament.

## Loading the model into a slicer

**Multi-color printer**
- Open the **3MF**. You should get one object made of several parts, one per color. Then assign
  a filament to each part.
- Slicers differ in how they read the colors stored in a 3MF. If yours doesn't show the parts
  the way you expect, unzip the **STL per color** file and load all the STLs at once. When the
  slicer asks, choose to load them as a *single object with multiple parts*. The parts line up
  because they share the same coordinates.

**Single extruder (Different height per color on)**
- Load the **single-body STL**.
- Use the **Filament changes** list under Export. Each entry is the first layer printed in the
  new color, given as that layer's top height (as shown on the slicer's layer slider). In the
  slicer's layer preview, go to each listed layer and add a filament change there (called
  "Change filament", M600, or a pause). Each color is visible from above where its height is
  the highest.
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
| `Dockerfile`, `nginx.conf` | Container image: nginx serving the app |
| `docker-compose.yml`, `.env.example` | Runs the container behind your Traefik, or a bundled one |

### How the geometry stays printable

Each border between two colors is traced once and used by the regions on both sides, so
neighboring parts share their edges exactly, with no gaps or overlaps between colors.

Where two pixels of the same color touch only at a corner, that corner is split slightly, so
every outline is a simple polygon. Walls are split at every height where colors meet, so each
edge is shared by exactly two triangles.

`tests.html` checks all of this on fixed cases and on random grids.
