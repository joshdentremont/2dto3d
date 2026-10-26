# Static web server for 2D to 3D. The app is plain HTML/JS, so nginx just serves the files.
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html styles.css tests.html /usr/share/nginx/html/
COPY src/ /usr/share/nginx/html/src/
COPY tests/ /usr/share/nginx/html/tests/
COPY vendor/ /usr/share/nginx/html/vendor/
COPY samples/ /usr/share/nginx/html/samples/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
