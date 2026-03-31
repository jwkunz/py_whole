#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
APP_FILE="${DIST_DIR}/py_whole.html"
PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"
BUILD_FIRST="${BUILD_FIRST:-1}"

if [[ "${BUILD_FIRST}" != "0" ]]; then
  echo "Building single-file app..."
  bash "${ROOT_DIR}/scripts/build_single_html.sh"
fi

if [[ ! -f "${APP_FILE}" ]]; then
  echo "Built app not found at ${APP_FILE}" >&2
  echo "Run: bash scripts/build_single_html.sh" >&2
  exit 1
fi

echo "Serving ${APP_FILE}"
echo "Bind address: http://${HOST}:${PORT}/py_whole.html"

if command -v hostname >/dev/null 2>&1; then
  LAN_IPS="$(hostname -I 2>/dev/null || true)"
  for ip in ${LAN_IPS}; do
    echo "Try from another device: http://${ip}:${PORT}/py_whole.html"
  done
fi

cd "${DIST_DIR}"
exec python3 -m http.server "${PORT}" --bind "${HOST}"
