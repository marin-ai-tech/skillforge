# SkillForge Windows uninstaller (release-dist): removes the scheduled task and the program. The data folder
# (database, settings, backups) stays unless -RemoveData is given.
param(
  [string]$InstallDir = $PSScriptRoot,
  [string]$DataDir = (Join-Path $env:ProgramData "SkillForge"),
  [switch]$RemoveData
)
$ErrorActionPreference = "Stop"
$taskName = "SkillForge"

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
# A server started by hand from skillforge.cmd still runs the bundled node.exe: stop only that one.
$bundled = Join-Path $InstallDir "*\node\node.exe"
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like $bundled } | Stop-Process -Force -ErrorAction SilentlyContinue

$current = Join-Path $InstallDir "current"
if (Test-Path -LiteralPath $current) { cmd /c rmdir "`"$current`"" | Out-Null }
Set-Location -LiteralPath $env:TEMP
Remove-Item -LiteralPath $InstallDir -Recurse -Force
if ($RemoveData) {
  Remove-Item -LiteralPath $DataDir -Recurse -Force
  Write-Host "SkillForge and its data are removed."
} else {
  Write-Host "SkillForge is removed. Data and settings are kept in $DataDir (use -RemoveData to delete them)."
}
