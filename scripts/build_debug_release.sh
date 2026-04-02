#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PY_WHOLE_OUTPUT_NAME="py_whole_debug.html" \
PY_WHOLE_BUNDLED_PACKAGES="numpy" \
node "$ROOT_DIR/scripts/build_single_html.mjs"
