#!/bin/sh -eu
# takes one arg - directory of a clone of gemmimol.github.io
outdir="$1"

[ -e src/elmap.ts ] || { echo "Run me from top-level gemmimol dir"; exit 1; }

strip_dev() {
    grep -v -- -DEV- "$1" > "$2"
}

mkdir -p "$outdir/src" "$outdir/vendor/wasm" "$outdir/perf" "$outdir/data" \
    "$outdir/test" "$outdir/view"

# use README.md without badges
cat >"$outdir/index.md" <<EOF
---
layout: default
---

$(sed '/^\[!\[/d; s,https://gemmimol.github.io/,,' README.md)
EOF

cp src/*.ts "$outdir/src/"
for path in benchmark/benchmark.js lodash/lodash.min.js platform/platform.js; do
    npath=node_modules/$path
    diff -q "$npath" "$outdir/$npath" || cp "$npath" "$outdir/$npath"
done

cp gemmimol.js LICENSE perf.html 3kw8.htm 3kw8_mc_restraints.mmcif "$outdir/"
cp "$outdir/3kw8.htm" "$outdir/3kw8.html"
#cp gemmimol.js.map gemmimol.min.js $outdir/
cp vendor/wasm/gemmi.wasm vendor/wasm/gemmi.js "$outdir/vendor/wasm/"
cp data/* "$outdir/data/"
cp perf/* "$outdir/perf/"
cp test/*.html "$outdir/test/"

strip_dev dev.html "$outdir/1mru.html"
strip_dev dual.html "$outdir/dual.html"
strip_dev reciprocal.html "$outdir/reciprocal.html"
strip_dev view.html "$outdir/view/index.html"
sed -e 's/1mru/4un4_final/g' -e 's/\.map/_m0.map/g' \
    <"$outdir/1mru.html" >"$outdir/4un4.html"
sed -e 's/1mru/dimple_thaum/g' \
    <"$outdir/1mru.html" >"$outdir/dimple_thaum.html"

cd "$outdir"
echo "=== $(pwd) ==="
git status -s
echo
git diff --stat
echo
#jekyll build
#du -sh _site/
