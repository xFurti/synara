#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDirectory = dirname(scriptPath);
const desktopDirectory = resolve(scriptsDirectory, "..");
const sourceDirectory = join(desktopDirectory, "native", "appsnap-win");

export const defaultWindowsAppSnapHelperPath = join(
  desktopDirectory,
  ".electron-runtime",
  "appsnap",
  "synara-appsnap-helper.exe",
);

function cscCompilerCandidates() {
  const root = process.env.WINDIR?.trim() || "C:\\Windows";
  return [
    join(root, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(root, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
}

function resolveCscCompiler() {
  for (const candidate of cscCompilerCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: desktopDirectory,
    encoding: "utf8",
    windowsHide: true,
    env: options.env ?? process.env,
  });
  if (result.status === 0) {
    return;
  }

  const details = [result.stdout, result.stderr]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .trim();
  const suffix = details ? `\n${details}` : "";
  throw new Error(
    `AppSnap helper command failed (${command} ${arguments_.join(" ")}): ${result.status ?? "unknown"}${suffix}`,
  );
}

function buildFingerprint({ sources, manifestPath }) {
  const hash = createHash("sha256");
  hash.update("synara-appsnap-helper-windows-build-v1\0");
  hash.update(readFileSync(scriptPath));
  hash.update("\0");
  hash.update(readFileSync(manifestPath));
  for (const source of sources) {
    hash.update("\0");
    hash.update(source);
    hash.update("\0");
    hash.update(readFileSync(source));
  }
  return hash.digest("hex");
}

function isUsableCachedBuild(outputPath, metadataPath, fingerprint) {
  if (!existsSync(outputPath) || !existsSync(metadataPath)) {
    return false;
  }
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    return metadata.fingerprint === fingerprint;
  } catch {
    return false;
  }
}

export function buildWindowsAppSnapHelper({
  outputPath = defaultWindowsAppSnapHelperPath,
  quiet = false,
} = {}) {
  if (process.platform !== "win32") {
    throw new Error("The Windows AppSnap helper can only be built on Windows.");
  }

  const csc = resolveCscCompiler();
  if (!csc) {
    throw new Error("csc.exe was not found. Install the .NET Framework 4.8 developer pack.");
  }

  const sources = readdirSync(sourceDirectory)
    .filter((name) => name.endsWith(".cs"))
    .sort()
    .map((name) => join(sourceDirectory, name));
  if (sources.length === 0) {
    throw new Error(`No C# sources found in ${sourceDirectory}.`);
  }
  const manifestPath = join(sourceDirectory, "app.manifest");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing AppSnap helper manifest at ${manifestPath}.`);
  }

  const resolvedOutputPath = resolve(outputPath);
  const metadataPath = `${resolvedOutputPath}.build.json`;
  const fingerprint = buildFingerprint({ sources, manifestPath });
  if (isUsableCachedBuild(resolvedOutputPath, metadataPath, fingerprint)) {
    if (!quiet) {
      console.error(`[appsnap] Reusing Windows helper at ${resolvedOutputPath}`);
    }
    return resolvedOutputPath;
  }

  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  const pendingOutputPath = `${resolvedOutputPath}.tmp-${process.pid}.exe`;
  rmSync(pendingOutputPath, { force: true });

  run(csc, [
    "/nologo",
    "/optimize+",
    "/target:winexe",
    "/platform:x64",
    "/langversion:5",
    "/main:Synara.AppSnap.Program",
    `/win32manifest:${manifestPath}`,
    "/r:System.Drawing.dll",
    "/r:System.Windows.Forms.dll",
    `/out:${pendingOutputPath}`,
    ...sources,
  ]);

  try {
    chmodSync(pendingOutputPath, 0o755);
  } catch {
    // Windows file modes are advisory.
  }
  rmSync(resolvedOutputPath, { force: true });
  try {
    renameSync(pendingOutputPath, resolvedOutputPath);
  } catch {
    copyFileSync(pendingOutputPath, resolvedOutputPath);
    rmSync(pendingOutputPath, { force: true });
  }

  const pendingMetadataPath = `${metadataPath}.tmp-${process.pid}`;
  rmSync(pendingMetadataPath, { force: true });
  writeFileSync(pendingMetadataPath, `${JSON.stringify({ fingerprint })}\n`, { mode: 0o600 });
  rmSync(metadataPath, { force: true });
  renameSync(pendingMetadataPath, metadataPath);

  if (!quiet) {
    console.error(`[appsnap] Built Windows AppSnap helper at ${resolvedOutputPath}`);
  }
  return resolvedOutputPath;
}

function parseCommandLine(arguments_) {
  let outputPath = defaultWindowsAppSnapHelperPath;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    switch (argument) {
      case "--output":
        index += 1;
        if (index >= arguments_.length) {
          throw new Error("--output requires a path.");
        }
        outputPath = arguments_[index];
        break;
      case "--release":
      case "--arch":
        if (argument === "--arch") index += 1;
        break;
      default:
        throw new Error(`Unknown AppSnap helper build argument: ${argument}`);
    }
  }

  return { outputPath };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    buildWindowsAppSnapHelper(parseCommandLine(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
