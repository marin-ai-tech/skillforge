# SkillForge release: start the server from this folder (PowerShell). Settings: skillforge.env (see INSTALL.md).
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path skillforge.env)) { Copy-Item skillforge.env.example skillforge.env }
node -e "const m=+process.versions.node.split('.')[0];if(m<24){console.error('SkillForge needs Node.js 24 or newer, found '+process.versions.node);process.exit(1)}require('node:sqlite')"
if ($LASTEXITCODE -ne 0) { exit 1 }
node --env-file=skillforge.env packages/server/dist/index.js
exit $LASTEXITCODE
