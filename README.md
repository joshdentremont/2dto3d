# 2D to 3D

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

The container is hardened: its filesystem is read-only, it can't gain extra privileges, and
it keeps only the Linux capabilities nginx needs to start. Pages are served with a strict
Content-Security-Policy, so browsers only run the app's own files, and HTTPS is enforced with
HSTS for a year on `APP_HOST`.

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

1. In `.env`, uncomment `COMPOSE_FILE=docker-compose.yml:docker-compose.traefik.yml`. This
   adds the Traefik container from `docker-compose.traefik.yml`, and Compose creates the shared
   network itself. Optionally set `ACME_EMAIL` for certificate notices.
2. Start it:

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
   Under the image are tools to adjust it, which keep any colors you've picked:
   - **Rotate** a quarter turn left or right, and **Flip** left to right or top to bottom.
   - **Crop**: press it, then drag a box on the image. Press Esc or **Crop** again to cancel.
   - **Trim margins** removes empty space around the image. That's transparent margins, or
     on an image with no transparency, margins in the color at least 3 corners share, such as
     a white JPG background.
   - **Reset image** undoes all of these.

   **Width** applies to the edited image, so trimming or cropping makes what's left bigger.
2. **Colors.** Click the image once on each color you want in the model.
   - Or press **Suggest colors** to add the image's main colors, biggest area first. It skips
     colors you've already picked and the soft edges between colors, so you can use it at any
     point, then delete what you don't want or click to add more. It doesn't tick
     **No material** for you, so a white background is suggested like any other color.
   - Every pixel is assigned to the closest picked color, judged the way the eye sees color.
   - Switch to **Mapped** to see exactly what will be printed, seen from the front, including
     any outline, rounded corners, rectangular base plate and keychain loop. You can still
     click to pick colors there, anywhere on the image.
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

   The settings in this step are remembered in your browser between visits, apart from the
   color dropdowns. **Reset settings** puts them back to the defaults. The image and its
   colors aren't saved.

   Other settings:
   - **Width** sets the size of the model.
   - **Detail** is the size of one image pixel in the model.
   - **Smooth edges** turns pixel staircases into smooth curves, while keeping sharp corners
     (where two straight edges at least 3 pixels long meet) sharp.
   - **Remove specks** cleans up noise from compressed images.
   - **Bed width** and **Bed depth** are your printer's bed (default 256 × 256 mm). The
     preview draws it to scale, and you get a warning if the print or frame won't fit, or
     only fits turned 90°. Each part is checked on its own, since they print separately.
   - **Base plate** (optional) adds a backing under the photo or a full rectangle, in a color
     you choose.
   - **Outline** gives the model a shape and fills the empty area inside it with a color you
     choose. The fill is a normal color part at that color's height, and a base plate can
     still be added underneath. Use it for badges, coasters and keychains.
     - **Round / oval:** the smallest oval that contains the whole image, or a circle if the
       image is square. **Width** is the width of the whole oval. It passes through the
       image's corners, so the image inside it is about 71% of that width.
     - **Rounded corners:** the image's own rectangle with its corners rounded to the
       **Corner radius** you set. The size doesn't change; anything in the corners, logo
       included, is cut away. A radius of 0 gives sharp corners. The largest radius is half
       the shorter side, which gives fully rounded ends; bigger values are capped, with a
       warning.
   - **Frame** (optional) makes a separate front-lip frame that follows the shape of your
     print. A lip covers the print's edge from the front, and the print pushes into a recess
     from the back, face first. You set:
     - **Border width**: how wide the frame is outside the print (default 10 mm);
     - **Lip overlap**: how far the lip reaches over the print's edge (default 1 mm);
     - **Frame depth**: the frame's total depth, front to back (default 15 mm);
     - **Lip depth**: from the back of the frame to the lip (default 13 mm). Frame depth minus
       lip depth is how far the print sits behind the front of the frame (2 mm by default);
     - **Outer edge radius**: rounds the outside edge of the frame's front (default 1 mm; 0
       gives a square edge). It's built from 0.2 mm steps, matching a typical layer height;
     - **Inner edge radius**: rounds the front edge of the opening in the same way (default
       1 mm). It has to fit on the lip, so it's limited to the lip overlap plus the fit
       clearance, and it leaves at least 0.2 mm of lip thickness at the opening;
     - **Fit clearance**: the gap between the print and the recess (default 0.3 mm);
     - **Hanging pocket**: a pocket in the back of the top border, close to the top edge, for
       hanging on a nail or screw. It doesn't go through to the front, so nothing shows. Set
       the **Head diameter** of the nail or screw. Push the head into the round opening, then lower the frame: a thin lip at the
       top of the pocket rests on the shank with the head trapped behind it, and its arched
       edge centres the frame. Leave just over 1 mm of shank showing, so the head sits close
       to the wall.

       The pocket always has 1 mm of frame around it, so the border must be at least 1.5 ×
       the head diameter plus 2.5 mm: 10 mm for a 5 mm head. The frame must be at least 3.2 mm deep.

       **Pocket depth** is measured from the back of the frame. Leave it blank for as deep as
       it can go, keeping 1 mm of frame in front of it (14 mm in a 15 mm frame). Values are
       limited to what fits, down to 2.2 mm. Where a rounded front reaches the pocket, the
       pocket's floor moves back too, so the 1 mm stays. If it doesn't fit, it's left out and the app says why. On a bare logo the frame's top edge follows the
       logo, so there may be no room at the top centre; an Outline shape avoids that.

     **Retaining bumps** are added automatically when there's room for them: when the lip
     depth is more than the print's depth + 0.3 mm + 1 mm. They sit 0.3 mm behind the print.
     Each side (top, bottom, left and right) gets one in its middle, or two at the third
     points if the side is longer than 200 mm. A print made of separate shapes gets bumps on
     each shape. They reach 0.5 mm past the print's edge. Their back edge is sloped, so the print snaps past them on the way in, and their
     flat front edge holds it there. Without room for bumps, use glue or tape; the app tells
     you what lip depth would leave room.

     The recess outline is mirrored left to right because the print goes in face down. Holes
     inside the print, such as the inside of letters, show through the opening.

     In the preview, the frame appears next to your print, seen from the back as it prints,
     with its top edge at the top. Switch to **Assembled** at the top of the viewer to see the
     print sitting in the frame, as it will look finished.
   - **Keychain loop** (optional) adds a ring with a hole for a key ring, centred on the top,
     bottom, left or right of the logo, in a color you choose. You set the outer and hole
     diameters. A short tab joins the ring to the logo across small gaps. If nothing is within
     reach on that side, the loop is left off and the app suggests another side. The loop
     sits outside the image, so it adds to the size shown in the preview.
4. **Preview.** Check the 3D model: drag to rotate, scroll to zoom, right-drag to pan, and
   use the home button to get back to the default view. The
   panel shows the size and triangle count, and confirms the model is **watertight** (fully
   closed, which slicers need).
5. **Export.** Pick the group that matches your printer.
   - **Multi-color printer** (works with flat or stepped models):
     - **3MF (all colors)**: one object made of one part per color, each named after its color.
     - **STL per color (.zip)**: one STL per color, all sharing the same coordinates.
   - **Single extruder** (only when *Different height per color* is on):
     - **STL (single body)**: the whole model as one stepped solid.
     - A list of the layers where you change filament.
   - **Frame** (when *Make a frame* is on): **Frame (.stl)**. Print it as exported, lip down,
     in any color. Then push your print into the back, face first, until it snaps past the
     bumps. If there are no bumps, glue or tape it in.

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
| `src/keychain.js` | Adds the keychain loop to the color grid before tracing |
| `src/frame.js` | Builds the front-lip frame from the print's footprint |
| `src/export.js` | STL, 3MF and ZIP writers |
| `src/raster.js` | Image loading, resampling and color sampling (browser only) |
| `src/viewer.js` | three.js 3D preview |
| `tests.html`, `tests/tests.js` | Geometry checks on small test grids |
| `vendor/` | three.js r147, OrbitControls and fflate (MIT, see `vendor/LICENSES.md`) |
| `Dockerfile`, `nginx.conf` | Container image: nginx serving the app |
| `docker-compose.yml`, `.env.example` | Runs the container behind a Traefik you already run |
| `docker-compose.traefik.yml` | Optional bundled Traefik, switched on from `.env` |

### How the geometry stays printable

Each border between two colors is traced once and used by the regions on both sides, so
neighboring parts share their edges exactly, with no gaps or overlaps between colors.

Where two pixels of the same color touch only at a corner, that corner is split slightly, so
every outline is a simple polygon. Walls are split at every height where colors meet, so each
edge is shared by exactly two triangles.

With **Smooth edges** on, each border is smoothed once, before both sides use it, so the
borders still match exactly:
1. Each straight run of pixel edges is replaced by its centre point. On a curve, run centres
   lie very close to the true edge.
2. Corners between two runs of 3+ pixels are kept as they are. On a pixelated curve, one of
   any two neighbouring runs is always a single pixel, so this only happens at real corners.
3. The outline is resampled every half pixel and smoothed with a 2-pixel Gaussian along its
   length. Each stretch between corners is smoothed on its own.

`tests.html` checks all of this on fixed cases and on random grids.
