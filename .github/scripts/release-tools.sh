#!/usr/bin/env bash
# Tools the release tests and scripts/release.mjs need for the Windows installer: makensis (NSIS) and the official
# Windows node.exe of the running Node version (SKILLFORGE_NODE_WIN_EXE). Linux: NSIS from apt and node.exe from
# nodejs.org, checked against SHASUMS256.txt. Windows: the runner's own node.exe and NSIS.
# NSIS is checked right after it is installed: a failed install stops this step with a message, not the release tests
# fifteen minutes later.
set -euo pipefail
version="$(node -p "process.versions.node")"

if [ "${RUNNER_OS:-}" = "Windows" ]; then
  nsis="/c/Program Files (x86)/NSIS"
  if ! command -v makensis > /dev/null 2>&1 && [ ! -x "$nsis/makensis.exe" ]; then
    for attempt in 1 2 3; do
      if choco install nsis -y --no-progress && [ -x "$nsis/makensis.exe" ]; then break; fi
      echo "NSIS install attempt $attempt did not give $nsis/makensis.exe" >&2
      if [ "$attempt" -lt 3 ]; then sleep 10; fi
    done
  fi
  if command -v makensis > /dev/null 2>&1; then
    echo "makensis $(makensis -VERSION)"
  elif [ -x "$nsis/makensis.exe" ]; then
    echo "makensis $("$nsis/makensis.exe" -VERSION)"
    echo "C:\\Program Files (x86)\\NSIS" >> "$GITHUB_PATH"
  else
    echo "makensis not found after installing NSIS: the Windows installer cannot be built" >&2
    exit 1
  fi
  echo "SKILLFORGE_NODE_WIN_EXE=$(node -p "process.execPath")" >> "$GITHUB_ENV"
  exit 0
fi

sudo apt-get update -qq
sudo apt-get install -y -qq nsis > /dev/null
command -v makensis > /dev/null 2>&1 || { echo "makensis not found after apt-get install nsis" >&2; exit 1; }
echo "makensis $(makensis -VERSION)"
dir="${RUNNER_TEMP:-/tmp}/node-win"
mkdir -p "$dir"
curl -fsSLo "$dir/node.exe" "https://nodejs.org/dist/v${version}/win-x64/node.exe"
curl -fsSLo "$dir/SHASUMS256.txt" "https://nodejs.org/dist/v${version}/SHASUMS256.txt"
want="$(awk '$2 == "win-x64/node.exe" { print $1 }' "$dir/SHASUMS256.txt")"
have="$(sha256sum "$dir/node.exe" | cut -d' ' -f1)"
if [ -z "$want" ] || [ "$want" != "$have" ]; then
  echo "node.exe checksum mismatch: want $want, have $have" >&2
  exit 1
fi
echo "SKILLFORGE_NODE_WIN_EXE=$dir/node.exe" >> "$GITHUB_ENV"
