#!/usr/bin/env node
// FILE: synara-appsnap-helper.mjs
// Purpose: Windows AppSnap helper that speaks the same NDJSON protocol as the macOS Swift helper.
// Layer: Desktop native helper
// Capture uses Win32 + System.Drawing via PowerShell; Electron owns the global shortcut.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

function fail(code, message) {
  emit({
    type: "error",
    code,
    message,
    capturedAt: timestamp(),
  });
  process.exitCode = 1;
}

function timestamp() {
  return new Date().toISOString();
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function parseArgs(argv) {
  let mode = null;
  let outputDirectory = null;
  let excludedBundleId = null;
  let externalTrigger = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--check-permissions":
      case "--request-permissions":
      case "--watch":
        if (mode) {
          throw new Error("Choose exactly one helper mode.");
        }
        mode = argument;
        break;
      case "--output-dir":
        index += 1;
        outputDirectory = argv[index];
        if (!outputDirectory) {
          throw new Error("--output-dir requires a path.");
        }
        break;
      case "--excluded-bundle-id":
        index += 1;
        excludedBundleId = argv[index];
        if (!excludedBundleId) {
          throw new Error("--excluded-bundle-id requires a bundle identifier.");
        }
        break;
      case "--external-trigger":
        externalTrigger = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!mode) {
    throw new Error("Expected --check-permissions, --request-permissions, or --watch.");
  }
  return { mode, outputDirectory, excludedBundleId, externalTrigger };
}

function emitPermissions() {
  emit({
    type: "permissions",
    inputMonitoring: "granted",
    screenRecording: "granted",
  });
}

function captureForegroundWindow(outputDirectory, excludedBundleId) {
  const id = randomUUID();
  const capturedAt = timestamp();
  const outputPath = join(outputDirectory, `appsnap-${id}.png`).replace(/\\/g, "\\\\");
  const helperPid = process.pid;
  const parentPid = process.ppid;
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SynaraWinCapture {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
  public const int GWL_EXSTYLE = -20;
  public const int WS_EX_TOOLWINDOW = 0x00000080;
  public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  public const uint PW_RENDERFULLCONTENT = 2;
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$ownPids = @(${helperPid}, ${parentPid})
$ownPath = $null
try { $ownPath = (Get-Process -Id ${helperPid} -ErrorAction Stop).Path } catch {}
function Get-WindowProcessId([IntPtr]$hwnd) {
  $processId = 0
  [void][SynaraWinCapture]::GetWindowThreadProcessId($hwnd, [ref]$processId)
  return [int]$processId
}
function Test-OwnWindow([IntPtr]$hwnd) {
  $processId = Get-WindowProcessId $hwnd
  if ($ownPids -contains $processId) { return $true }
  if (-not $ownPath) { return $false }
  $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
  return [bool]($proc -and $proc.Path -and ($proc.Path.ToLowerInvariant() -eq $ownPath.ToLowerInvariant()))
}
function Test-CapturableWindow([IntPtr]$hwnd) {
  if ($hwnd -eq [IntPtr]::Zero) { return $false }
  if (-not [SynaraWinCapture]::IsWindowVisible($hwnd)) { return $false }
  if ([SynaraWinCapture]::IsIconic($hwnd)) { return $false }
  $exStyle = [SynaraWinCapture]::GetWindowLongPtr($hwnd, [SynaraWinCapture]::GWL_EXSTYLE).ToInt64()
  if (($exStyle -band [SynaraWinCapture]::WS_EX_TOOLWINDOW) -ne 0) { return $false }
  if (Test-OwnWindow $hwnd) { return $false }
  $rect = New-Object SynaraWinCapture+RECT
  $boundsOk = [SynaraWinCapture]::DwmGetWindowAttribute(
    $hwnd,
    [SynaraWinCapture]::DWMWA_EXTENDED_FRAME_BOUNDS,
    [ref]$rect,
    [System.Runtime.InteropServices.Marshal]::SizeOf($rect)
  ) -eq 0
  if (-not $boundsOk) {
    if (-not [SynaraWinCapture]::GetWindowRect($hwnd, [ref]$rect)) { return $false }
  }
  return (($rect.Right - $rect.Left) -ge 8 -and ($rect.Bottom - $rect.Top) -ge 8)
}
$candidates = New-Object 'System.Collections.Generic.List[IntPtr]'
$enum = [SynaraWinCapture+EnumWindowsProc] {
  param([IntPtr]$windowHandle, [IntPtr]$lParam)
  $candidates.Add($windowHandle)
  return $true
}
[void][SynaraWinCapture]::EnumWindows($enum, [IntPtr]::Zero)
$hwnd = [IntPtr]::Zero
foreach ($candidate in $candidates) {
  if (Test-CapturableWindow $candidate) {
    $hwnd = $candidate
    break
  }
}
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Output (@{ skipped = $true } | ConvertTo-Json -Compress)
  exit 0
}
$rect = New-Object SynaraWinCapture+RECT
$boundsOk = [SynaraWinCapture]::DwmGetWindowAttribute(
  $hwnd,
  [SynaraWinCapture]::DWMWA_EXTENDED_FRAME_BOUNDS,
  [ref]$rect,
  [System.Runtime.InteropServices.Marshal]::SizeOf($rect)
) -eq 0
if (-not $boundsOk) {
  if (-not [SynaraWinCapture]::GetWindowRect($hwnd, [ref]$rect)) { throw 'Could not read window bounds.' }
}
$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$printed = [SynaraWinCapture]::PrintWindow($hwnd, $hdc, [SynaraWinCapture]::PW_RENDERFULLCONTENT)
$graphics.ReleaseHdc($hdc)
if (-not $printed) {
  $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $width, $height))
}
$bitmap.Save('${outputPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$processId = Get-WindowProcessId $hwnd
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
$processName = if ($process) { $process.ProcessName } else { '' }
$titleBuilder = New-Object System.Text.StringBuilder 512
[void][SynaraWinCapture]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
Write-Output (@{
  skipped = $false
  path = '${outputPath}'
  processName = $processName
  windowTitle = $titleBuilder.ToString()
} | ConvertTo-Json -Compress)
`;

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Capture failed with exit ${code}.`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim() || "{}");
        resolve({ id, capturedAt, parsed });
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function watch(options) {
  if (!options.outputDirectory) {
    throw new Error("--watch requires --output-dir.");
  }
  mkdirSync(options.outputDirectory, { recursive: true });
  emit({ type: "ready" });

  const trigger = async () => {
    const id = randomUUID();
    const capturedAt = timestamp();
    emit({ type: "triggered", id, capturedAt });
    try {
      const result = await captureForegroundWindow(
        options.outputDirectory,
        options.excludedBundleId,
      );
      if (result.parsed?.skipped) {
        emit({
          type: "error",
          id: result.id,
          code: "excluded_app",
          message:
            "Focus another app, then press Alt+S. AppSnap captures that window, not Synara.",
          capturedAt: result.capturedAt,
        });
        return;
      }
      const path = result.parsed?.path;
      if (!path) {
        throw new Error("Capture did not return a file path.");
      }
      emit({
        type: "captured",
        id: result.id,
        capturedAt: result.capturedAt,
        path,
        name: `AppSnap ${result.capturedAt.replace(/[:.]/g, "-")}.png`,
        sourceAppName: result.parsed.processName || null,
        sourceBundleIdentifier: result.parsed.processName || null,
        sourceWindowTitle: result.parsed.windowTitle || null,
      });
    } catch (error) {
      emit({
        type: "error",
        id,
        code: "capture_failed",
        message: error instanceof Error ? error.message : String(error),
        capturedAt,
      });
    }
  };

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (line.trim() === "trigger") {
      void trigger();
    }
  });

  if (!options.externalTrigger) {
    // Windows never monitors both-Option. Electron registers the chord and
    // writes "trigger" lines; stay alive for those.
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "--check-permissions" || options.mode === "--request-permissions") {
    emitPermissions();
    process.exit(0);
  }
  await watch(options);
} catch (error) {
  fail("invalid_arguments", error instanceof Error ? error.message : String(error));
}
