; FILE: installer-canary.nsh
; Purpose: Keep the Canary NSIS installer from closing or overwriting official Synara.
; Layer: Desktop Windows installer
; Depends on: electron-builder CHECK_APP_RUNNING / preInit / customInit hooks.
;
; Default FIND_PROCESS uses Path.StartsWith($INSTDIR). That matches official
; Synara.exe whenever INSTDIR is empty, a parent of synara-desktop, or the
; official folder itself. Only synara-canary.exe is Canary.

!macro abortIfOfficialInstallDir
  StrCmp $INSTDIR "$LocalAppData\Programs\synara-desktop" canaryHitOfficialDir 0
  Goto canaryInstallDirOk
  canaryHitOfficialDir:
    MessageBox MB_OK|MB_ICONSTOP "This installer is Synara Canary only. It refused to use the official Synara folder."
    Quit
  canaryInstallDirOk:
!macroend

; Runs before initMultiUser so a colliding AppId/GUID cannot pick synara-desktop first.
!macro preInit
  SetRegView 64
  StrCpy $INSTDIR "$LocalAppData\Programs\synara-canary"
!macroend

!macro customInit
  StrCpy $INSTDIR "$LocalAppData\Programs\synara-canary"
  !insertmacro abortIfOfficialInstallDir
!macroend

!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq synara-canary.exe" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"synara-canary.exe\""`
  Pop $R0
  StrCmp $R0 0 canaryRunning canaryNotRunning

  canaryRunning:
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "Synara Canary (synara-canary.exe) is running. Official Synara will not be closed. Click OK to close Canary only." /SD IDOK IDOK canaryStop
    Quit

  canaryStop:
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /IM synara-canary.exe /F`
    Pop $R0
    Sleep 1500
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq synara-canary.exe" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"synara-canary.exe\""`
    Pop $R0
    StrCmp $R0 0 canaryStillRunning canaryNotRunning

  canaryStillRunning:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Could not close synara-canary.exe. Close Canary from the tray, then retry. Official Synara was not touched." /SD IDCANCEL IDRETRY canaryStop
    Quit

  canaryNotRunning:
!macroend
