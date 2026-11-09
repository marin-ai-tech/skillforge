#!/bin/sh
# SkillForge release: start the server from this folder (Linux, macOS). Settings: skillforge.env (see INSTALL.md).
set -e
cd "$(dirname "$0")"
[ -f skillforge.env ] || cp skillforge.env.example skillforge.env
node -e "const m=+process.versions.node.split('.')[0];if(m<24){console.error('SkillForge needs Node.js 24 or newer, found '+process.versions.node);process.exit(1)}require('node:sqlite')"
exec node --env-file=skillforge.env packages/server/dist/index.js
