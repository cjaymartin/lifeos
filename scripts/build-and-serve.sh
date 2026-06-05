#!/bin/sh
# Build-and-serve step run by nodemon inside the lifeos container.
# Re-installs deps only when package-lock.json actually changed, rebuilds the
# Astro output, then supervises the server: if the server process dies for any
# reason other than a nodemon-initiated restart (SIGTERM to this script), it
# is relaunched after 2s. Build failures still exit nonzero so nodemon waits
# for the next file change.
set -e

STAMP=node_modules/.lock-hash
HASH=$(md5sum package-lock.json | cut -d' ' -f1)
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$HASH" ]; then
  echo "[build-and-serve] lockfile changed — npm ci"
  npm ci --omit=dev
  echo "$HASH" > "$STAMP"
fi

echo "[build-and-serve] building…"
npm run build

# nodemon restarts us with SIGTERM — forward it to the server and exit cleanly
trap 'echo "[build-and-serve] restart requested"; kill "$child" 2>/dev/null; exit 0' TERM INT

# set -e protected the install/build steps; from here on a nonzero status is
# expected (a killed server) and must not abort the supervisor loop
set +e

while :; do
  echo "[build-and-serve] serving"
  node ./dist/server/entry.mjs &
  child=$!
  wait "$child"
  code=$?
  echo "[build-and-serve] server exited (code $code) — restarting in 2s"
  sleep 2
done
