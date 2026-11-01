# Static web server for 2D to 3D. The repo stays plain HTML/JS; this image serves it minified,
# with every script combined into one file. Node is only used here, in the first stage, and
# isn't in the final image.
FROM node:22-alpine AS build

WORKDIR /app
COPY index.html styles.css ./
COPY src/ src/
COPY vendor/ vendor/

RUN npm install --global --ignore-scripts terser@5.36.0 clean-css-cli@5.6.3

# The script tags in index.html give the files and their order. --comments keeps the libraries'
# licence headers. Top-level names aren't mangled, so the files still share the same globals.
RUN scripts=$(sed -n 's/.*<script src="\([^"]*\)".*/\1/p' index.html) \
 && test -n "$scripts" \
 && terser $scripts --compress --mangle --comments /@license/ --output app.min.js \
 && sed -i -e '/<script src=/d' -e 's#</body>#<script src="app.min.js"></script></body>#' index.html \
 && grep -q 'src="app.min.js"' index.html \
 && cleancss -o styles.min.css styles.css \
 && mv styles.min.css styles.css

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/index.html /app/styles.css /app/app.min.js /usr/share/nginx/html/
COPY vendor/LICENSES.md /usr/share/nginx/html/LICENSES.md
COPY samples/ /usr/share/nginx/html/samples/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
