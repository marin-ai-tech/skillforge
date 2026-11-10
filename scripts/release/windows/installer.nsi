; SkillForge Windows installer. Built by scripts/release.mjs with makensis (Linux or Windows):
;   makensis -V2 -DVERSION=<v> -DSRC=<folder><separator> -DOUTFILE=<exe> installer.nsi
; SRC ends with the separator of the host: makensis on Windows splits a File path at the last backslash only.
; It carries payload.zip (release + node\node.exe), version.txt, install.ps1 and uninstall.ps1 and runs install.ps1, which
; asks for the port and address and raises its own rights when it needs them.
;   /S              silent install with defaults (install.ps1 -Quiet)
;   /EXTRACT=<dir>  only unpack the files into <dir>, for a check or a custom install.ps1 run
Unicode true
!include "FileFunc.nsh"
!include "LogicLib.nsh"

Name "SkillForge ${VERSION}"
OutFile "${OUTFILE}"
RequestExecutionLevel user
ShowInstDetails nevershow
AutoCloseWindow true
; payload.zip is already compressed
SetCompress off

!macro UNPACK
  File "${SRC}payload.zip"
  File "${SRC}version.txt"
  File "${SRC}install.ps1"
  File "${SRC}uninstall.ps1"
!macroend

Section
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/EXTRACT=" $R1
  ${IfNot} ${Errors}
    CreateDirectory "$R1"
    SetOutPath "$R1"
    !insertmacro UNPACK
    SetErrorLevel 0
    Quit
  ${EndIf}

  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  !insertmacro UNPACK
  StrCpy $R2 ""
  ${If} ${Silent}
    StrCpy $R2 " -Quiet"
  ${EndIf}
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\install.ps1"$R2' $R3
  ; Leave the temporary folder so it can be removed.
  SetOutPath "$TEMP"
  SetErrorLevel $R3
SectionEnd
