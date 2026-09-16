#!/usr/bin/env bash
#
# Build the fn-sillytavern .fpk package.
#
# Usage:
#   ./build.sh                     # bundle SillyTavern 1.19.0 and pack (Linux)
#   ./build.sh 1.19.0              # pin a specific SillyTavern version
#   ST_VERSION=1.19.0 ./build.sh
#   GH_PROXY=https://gh-proxy.com ./build.sh   # GitHub accelerator (default)
#
# On macOS the script only stages the SillyTavern source under app/sillytavern;
# the final `fnpack build` step must run on Linux (see .github/workflows).
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ST_VERSION="${1:-${ST_VERSION:-1.19.0}}"
GH_PROXY="${GH_PROXY:-https://gh-proxy.com}"
ST_DIR="${APP_DIR}/app/sillytavern"
FNPACK_URL="${FNPACK_URL:-https://static2.fnnas.com/fnpack/fnpack-1.2.1-linux-amd64}"

echo "==> SillyTavern version: ${ST_VERSION}"

# ---------------------------------------------------------------------------
# 1. Stage SillyTavern source into app/sillytavern
# ---------------------------------------------------------------------------
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

ZIP_FILE="${WORK_DIR}/st.zip"
echo "==> Downloading source via ${GH_PROXY} ..."
curl -fL --retry 3 --max-time 600 \
    "${GH_PROXY}/https://github.com/SillyTavern/SillyTavern/archive/refs/tags/${ST_VERSION}.zip" \
    -o "${ZIP_FILE}"

echo "==> Extracting ..."
unzip -q "${ZIP_FILE}" -d "${WORK_DIR}"
SRC_ROOT="${WORK_DIR}/SillyTavern-${ST_VERSION}"
[ -d "${SRC_ROOT}" ] || { echo "ERROR: extracted source dir ${SRC_ROOT} not found"; exit 1; }

rm -rf "${ST_DIR}"
mkdir -p "${ST_DIR}"
cp -R "${SRC_ROOT}/." "${ST_DIR}/"

# ---------------------------------------------------------------------------
# 2. Sanity checks
# ---------------------------------------------------------------------------
[ -f "${ST_DIR}/server.js" ] || { echo "ERROR: server.js missing after extract"; exit 1; }
[ -f "${ST_DIR}/default/config.yaml" ] || { echo "ERROR: default/config.yaml missing after extract"; exit 1; }

BUNDLED_VERSION="$(node -p "require('${ST_DIR}/package.json').version" 2>/dev/null || echo unknown)"
[ "${BUNDLED_VERSION}" = "${ST_VERSION}" ] ||
    { echo "ERROR: bundled version ${BUNDLED_VERSION} != requested ${ST_VERSION}"; exit 1; }

echo "==> Source staged at ${ST_DIR} (SillyTavern ${BUNDLED_VERSION})"

# ---------------------------------------------------------------------------
# 3. Pack with fnpack (Linux only)
# ---------------------------------------------------------------------------
if [[ "$(uname -s)" == "Linux" ]]; then
    if ! command -v fnpack >/dev/null 2>&1; then
        echo "==> fnpack not found, downloading from ${FNPACK_URL} ..."
        curl -fL --retry 3 "${FNPACK_URL}" -o "${WORK_DIR}/fnpack"
        chmod +x "${WORK_DIR}/fnpack"
        export PATH="${WORK_DIR}:${PATH}"
    fi
    cd "${APP_DIR}"
    echo "==> Running fnpack build ..."
    fnpack build
    echo "==> Done. FPK generated in ${APP_DIR}"
else
    echo "==> Skipping fnpack (this machine is not Linux)."
    echo "==> Source is staged; run this script on Linux or push a tag to trigger"
    echo "    the GitHub Actions workflow (.github/workflows/build-fpk.yml)."
fi
