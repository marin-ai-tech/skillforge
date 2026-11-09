# SkillForge local start/stop/reset (Windows PowerShell)
# Usage: scripts/local-start.ps1 <start|stop|reset>
param(
  [Parameter(Position = 0)]
  [ValidateSet("start", "stop", "reset")]
  [string]$Verb = "start"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Get-ConfiguredPort {
  if ($env:SKILLFORGE_PORT -and $env:SKILLFORGE_PORT.Trim() -ne "") {
    return [int]$env:SKILLFORGE_PORT
  }
  return 8787
}

function Get-DataDir {
  if ($env:SKILLFORGE_DATA_DIR -and $env:SKILLFORGE_DATA_DIR.Trim() -ne "") {
    return $env:SKILLFORGE_DATA_DIR
  }
  return (Join-Path $RepoRoot "data")
}

function Get-RequiredNodeRange {
  $pkg = Get-Content (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
  return [string]$pkg.engines.node
}

function Test-NodeEngine {
  $range = Get-RequiredNodeRange
  $actual = (& node -v 2>$null)
  if (-not $actual) {
    Write-Error "Node.js is not installed or not on PATH. Required: $range"
    exit 1
  }
  # engines.node is like ">=26" — require major >= N
  if ($range -match '>=?\s*(\d+)') {
    $needMajor = [int]$Matches[1]
    if ($actual -match 'v?(\d+)') {
      $haveMajor = [int]$Matches[1]
      if ($haveMajor -lt $needMajor) {
        Write-Host "ERROR: Node version $actual does not satisfy engines.node '$range' (required major >= $needMajor)." -ForegroundColor Red
        exit 1
      }
      return
    }
  }
  Write-Host "WARNING: could not parse engines.node '$range'; continuing." -ForegroundColor Yellow
}

function Get-ListenersOnPort([int]$Port) {
  try {
    return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  } catch {
    return @()
  }
}

function Test-PortBusy([int]$Port) {
  return @(Get-ListenersOnPort $Port).Count -gt 0
}

function Test-SkillforgeServerProcess([int]$ProcId) {
  # Only a node process running the SkillForge server entry counts as "ours".
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcId" -ErrorAction SilentlyContinue
  if (-not $p -or -not $p.CommandLine) { return $false }
  return ($p.Name -match '^node(\.exe)?$') -and ($p.CommandLine -match 'packages[\\/]server[\\/]dist[\\/]index\.js')
}

function Stop-PortListeners([int]$Port) {
  $conns = Get-ListenersOnPort $Port
  if ($conns.Count -eq 0) {
    Write-Host "No process listening on port $Port."
    return
  }
  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    if (-not $procId -or $procId -eq 0) { continue }
    if (-not (Test-SkillforgeServerProcess $procId)) {
      $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
      Write-Host "ERROR: port $Port is busy by $name($procId), which is not the SkillForge server. Not stopping it." -ForegroundColor Red
      exit 1
    }
    Write-Host "Stopping SkillForge server PID $procId on port $Port..."
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 500
  if (Test-PortBusy $Port) {
    Write-Host "ERROR: port $Port is still in use after stop. Free it manually, then retry." -ForegroundColor Red
    exit 1
  }
  Write-Host "Stopped listener(s) on port $Port."
}

$port = Get-ConfiguredPort
$dataDir = Get-DataDir

switch ($Verb) {
  "start" {
    Test-NodeEngine
    if (Test-PortBusy $port) {
      Write-Host "ERROR: port $port is already in use. Run 'npm run local:stop' or set SKILLFORGE_PORT to another free port." -ForegroundColor Red
      exit 1
    }
    Write-Host "Building SkillForge..."
    npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Starting SkillForge on port $port (foreground). Data dir: $dataDir"
    Write-Host "Initial admin password (if generated) is saved to $dataDir\initial-admin-password.txt"
    npm start
    exit $LASTEXITCODE
  }
  "stop" {
    Stop-PortListeners $port
  }
  "reset" {
    if (Test-PortBusy $port) {
      Write-Host "ERROR: server still listening on port $port. Run 'npm run local:stop' before reset." -ForegroundColor Red
      exit 1
    }
    if ($env:LOCAL_RESET_CONFIRM -ne "1") {
      Write-Host "ERROR: reset deletes the data directory ($dataDir)." -ForegroundColor Red
      Write-Host "Set LOCAL_RESET_CONFIRM=1 to confirm, then re-run: `$env:LOCAL_RESET_CONFIRM='1'; npm run local:reset"
      exit 1
    }
    if (Test-Path $dataDir) {
      # Delete only a SkillForge data directory: it must contain skillforge.db or blobs\,
      # and must not be a drive root, the home directory or the repository itself.
      $full = (Resolve-Path $dataDir).Path.TrimEnd('\', '/')
      $forbidden = @([IO.Path]::GetPathRoot($full).TrimEnd('\', '/'), $HOME.TrimEnd('\', '/'), $RepoRoot.TrimEnd('\', '/'))
      if ($forbidden -contains $full) {
        Write-Host "ERROR: refusing to delete $full (drive root, home or repository directory)." -ForegroundColor Red
        exit 1
      }
      if (-not ((Test-Path (Join-Path $full "skillforge.db")) -or (Test-Path (Join-Path $full "blobs")))) {
        Write-Host "ERROR: $full does not look like a SkillForge data directory (no skillforge.db or blobs\). Nothing deleted." -ForegroundColor Red
        exit 1
      }
      Remove-Item -Recurse -Force $full
      Write-Host "Removed data directory: $dataDir"
      Write-Host "Next 'npm run local:start' will re-seed the admin user."
    } else {
      Write-Host "Data directory already absent: $dataDir"
    }
  }
}
