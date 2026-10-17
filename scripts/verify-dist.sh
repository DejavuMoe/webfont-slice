#!/bin/sh
# Fail the pipeline if dist/ is not a complete, deployable build.
#
#   scripts/verify-dist.sh <dist-dir>
#
# Catches the failure mode where the build silently produces a directory
# that serves a blank page: the HTML entry is missing, the base path is
# absolute instead of relative, the WASM assets never made it, or the
# character set data the app fetches at runtime is absent.
set -eu

dist="${1:-}"

if [ -z "$dist" ] || [ ! -d "$dist" ]; then
  echo "usage: $0 <dist-dir>" >&2
  exit 1
fi

fail() {
  echo "verify-dist: $*" >&2
  exit 1
}

[ -f "$dist/index.html" ] || fail "index.html is missing"
[ -f "$dist/manifest.webmanifest" ] || fail "manifest.webmanifest is missing"
[ -f "$dist/sw.js" ] || fail "sw.js is missing"

# The build is meant to run from a domain root or any subpath, which only
# works while Vite keeps base at './'. An absolute asset URL would break
# every deployment under a subpath.
if grep -qE '(src|href)="/assets/' "$dist/index.html"; then
  fail "index.html references assets from an absolute path; base must stay './'"
fi
grep -q './assets/' "$dist/index.html" || fail "index.html does not reference ./assets/"

# HarfBuzz and wawoff2 must stay separate static assets. If they were
# inlined the browser could not stream them, and the WASM requests the app
# makes at runtime would 404.
[ -n "$(find "$dist/assets" -name '*.wasm' -print -quit)" ] || fail "no .wasm asset found"
grep -rq 'hb-subset' "$dist/assets" || fail "HarfBuzz WASM is missing"

# The app fetches these at runtime; without them the workbench cannot
# resolve any character target.
[ -f "$dist/charsets/index.json" ] || fail "charsets/index.json is missing"
[ -f "$dist/freq/han-freq.json" ] || fail "freq/han-freq.json is missing"

presets=$(find "$dist/charsets" -name '*.json' ! -name 'index.json' | wc -l)
[ "$presets" -ge 31 ] || fail "expected at least 31 charset presets, found $presets"

# A CJK font is tens of megabytes, so the shell itself has to stay small.
# The budget is 300 KiB gzipped for the entry bundle.
entry=$(find "$dist/assets" -maxdepth 1 -name 'index-*.js' -print -quit)
[ -n "$entry" ] || fail "entry bundle index-*.js is missing"
gzip_size=$(gzip -c "$entry" | wc -c)
if [ "$gzip_size" -gt $((300 * 1024)) ]; then
  fail "entry bundle is $((gzip_size / 1024)) KiB gzipped, over the 300 KiB budget"
fi

echo "verify-dist: ok ($((gzip_size / 1024)) KiB entry bundle gzipped, $presets presets)"
