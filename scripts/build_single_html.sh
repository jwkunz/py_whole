#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/src"
DIST_DIR="$ROOT_DIR/dist"
OUT_FILE="$DIST_DIR/py_whole.html"

mkdir -p "$DIST_DIR"

html_escape_script() {
  perl -0pe 's#</script#<\\/script#g'
}

HTML_TEMPLATE="$(cat "$SRC_DIR/index.html")"
CSS_CONTENT="$(cat "$SRC_DIR/styles.css")"
JS_CONTENT="$(cat "$SRC_DIR/app.js" | html_escape_script)"

HTML_TEMPLATE="${HTML_TEMPLATE//__INLINE_CSS__/$CSS_CONTENT}"
HTML_TEMPLATE="${HTML_TEMPLATE//__INLINE_JS__/$JS_CONTENT}"

printf '%s\n' "$HTML_TEMPLATE" > "$OUT_FILE"
printf 'Built %s\n' "$OUT_FILE"
