# SkillForge Windows installer (release-dist). Run by skillforge-setup-<version>.exe (NSIS) from the folder it
# unpacks to: payload.zip (release + node\node.exe), version.txt, this script and uninstall.ps1.
#
#   Program  — <InstallDir>\<version>, <InstallDir>\current (junction to the active version), <InstallDir>\skillforge.cmd
#   Data     — <DataDir>\skillforge.env, <DataDir>\data (database, blobs, backups); an update never touches them
#   Autostart— scheduled task "SkillForge" at system startup as SYSTEM (skipped with -NoTask)
#
# Silent install: -Quiet [-Port 8080] [-ListenHost 127.0.0.1] [-InstallDir ...] [-DataDir ...]
# Check without admin rights and without the task: -NoTask (used by the release acceptance test).
param(
  [string]$InstallDir = (Join-Path $env:ProgramFiles "SkillForge"),
  [string]$DataDir = (Join-Path $env:ProgramData "SkillForge"),
  [int]$Port = 0,
  [string]$ListenHost = "",
  [switch]$Quiet,
  [switch]$NoTask
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $here "version.txt") -Raw).Trim()
$taskName = "SkillForge"

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not $NoTask -and -not (Test-Admin)) {
  # The task and Program Files need administrator rights: start again elevated with the same parameters.
  $forward = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"",
    "-InstallDir", "`"$InstallDir`"", "-DataDir", "`"$DataDir`"")
  if ($Port) { $forward += @("-Port", $Port) }
  if ($ListenHost) { $forward += @("-ListenHost", $ListenHost) }
  if ($Quiet) { $forward += "-Quiet" }
  $p = Start-Process powershell.exe -Verb RunAs -ArgumentList $forward -Wait -PassThru
  exit $p.ExitCode
}

if (-not $Quiet) {
  Write-Host "SkillForge $version"
  if (-not $Port) { $answer = Read-Host "Port [8080]"; if ($answer) { $Port = [int]$answer } }
  if (-not $ListenHost) {
    $answer = Read-Host "Listen on 127.0.0.1 (this machine) or 0.0.0.0 (network) [127.0.0.1]"
    if ($answer) { $ListenHost = $answer }
  }
}
if (-not $Port) { $Port = 8080 }
if (-not $ListenHost) { $ListenHost = "127.0.0.1" }

# A running SkillForge holds its files: stop the task before replacing the program.
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }

$target = Join-Path $InstallDir $version
# .NET reads the zip names as UTF-8 (System32\tar.exe converts them through the console code page and loses or
# rejects non-ASCII names). A reinstall of the same version replaces its folder.
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
  [System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $here "payload.zip"), $target)
} catch {
  throw "could not unpack payload.zip into ${target}: $($_.Exception.Message)"
}

$current = Join-Path $InstallDir "current"
if (Test-Path -LiteralPath $current) { cmd /c rmdir "`"$current`"" | Out-Null }
New-Item -ItemType Junction -Path $current -Target $target | Out-Null
Copy-Item -LiteralPath (Join-Path $here "uninstall.ps1") -Destination (Join-Path $InstallDir "uninstall.ps1") -Force

New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "data") | Out-Null
$envFile = Join-Path $DataDir "skillforge.env"
if (-not (Test-Path -LiteralPath $envFile)) {
  $dataPath = (Join-Path $DataDir "data") -replace "\\", "/"
  @(
    "# SkillForge settings (see INSTALL.md). Kept on update.",
    "SKILLFORGE_PORT=$Port",
    "SKILLFORGE_HOST=$ListenHost",
    "SKILLFORGE_DATA_DIR=$dataPath"
  ) | Set-Content -LiteralPath $envFile -Encoding ascii
} elseif (-not $Quiet) {
  Write-Host "Keeping the existing settings: $envFile"
}

$node = Join-Path $current "node\node.exe"
$server = Join-Path $current "packages\server\dist\index.js"
$launcher = Join-Path $InstallDir "skillforge.cmd"
@(
  "@echo off",
  "rem Starts SkillForge with the bundled Node.js and the settings from the data folder.",
  "`"$node`" --env-file=`"$envFile`" `"$server`""
) | Set-Content -LiteralPath $launcher -Encoding ascii

if (-not $NoTask) {
  $action = New-ScheduledTaskAction -Execute $node -Argument "--env-file=`"$envFile`" `"$server`"" -WorkingDirectory $current
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
}

$url = "http://$(if ($ListenHost -eq '0.0.0.0') { 'localhost' } else { $ListenHost }):$Port"
Write-Host "SkillForge $version is installed in $target"
Write-Host "Settings: $envFile"
if ($NoTask) { Write-Host "Start it with: $launcher" } else { Write-Host "Started as the scheduled task '$taskName': $url" }
Write-Host "First admin password (first start only): $(Join-Path $DataDir 'data\initial-admin-password.txt')"
Write-Host "Uninstall: powershell -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'uninstall.ps1')`""
if (-not $Quiet -and -not $NoTask) { Read-Host "Press Enter to close" | Out-Null }
exit 0
