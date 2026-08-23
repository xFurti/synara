; FILE: installer-canary.nsh
; Purpose: Keep the Canary NSIS installer from closing or overwriting official Synara.
; Layer: Desktop Windows installer
; Depends on: electron-builder CHECK_APP_RUNNING / customInit hooks.
;
; Default FIND_PROCESS uses Path.StartsWith($INSTDIR). That matches official
; Synara.exe whenever INSTDIR is empty, a parent of synara-desktop, or the
; official folder itself. Only synara-canary.exe is Canary.

!macro customInit
  StrCpy $INSTDIR "$LocalAppData\Programs\synara-canary"
!macroend

!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq synara-canary.exe" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"synara-canary.exe\""`
  Pop $R0
  StrCmp $R0 0 canaryRunning canaryNotRunning

  canaryRunning:
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK canaryStop
    Quit

  canaryStop:
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /IM synara-canary.exe /F`
    Pop $R0
    Sleep 1500
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq synara-canary.exe" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"synara-canary.exe\""`
    Pop $R0
    StrCmp $R0 0 canaryStillRunning canaryNotRunning

  canaryStillRunning:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY canaryStop
    Quit

  canaryNotRunning:
!macroend
