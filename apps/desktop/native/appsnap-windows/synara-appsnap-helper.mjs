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
  const excluded = (excludedBundleId ?? "").replace(/'/g, "''");
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SynaraWinCapture {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$hwnd = [SynaraWinCapture]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { throw 'No foreground window.' }
$processId = 0
[void][SynaraWinCapture]::GetWindowThreadProcessId($hwnd, [ref]$processId)
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
$processName = if ($process) { $process.ProcessName } else { '' }
$excluded = '${excluded}'.ToLowerInvariant()
if ($excluded -ne '' -and ($processName.ToLowerInvariant() -eq $excluded -or $processName.ToLowerInvariant() -like 'synara*')) {
  Write-Output (@{ skipped = $true; processName = $processName } | ConvertTo-Json -Compress)
  exit 0
}
$rect = New-Object SynaraWinCapture+RECT
if (-not [SynaraWinCapture]::GetWindowRect($hwnd, [ref]$rect)) { throw 'Could not read window bounds.' }
$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $width, $height))
$bitmap.Save('${outputPath}', [System.Drawing.Imaging.ImageFormat]::Png)
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
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
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
          message: "The foreground window belongs to Synara, so it was not captured.",
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
