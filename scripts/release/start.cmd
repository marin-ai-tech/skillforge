@echo off
rem SkillForge release: start the server from this folder (Windows). Settings: skillforge.env (see INSTALL.md).
setlocal
cd /d "%~dp0"
if not exist skillforge.env copy /y skillforge.env.example skillforge.env >nul
node -e "const m=+process.versions.node.split('.')[0];if(m<24){console.error('SkillForge needs Node.js 24 or newer, found '+process.versions.node);process.exit(1)}require('node:sqlite')"
if errorlevel 1 exit /b 1
node --env-file=skillforge.env packages\server\dist\index.js
