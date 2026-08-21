import { spawn } from "node:child_process";

import { buildAppSnapHelper } from "./build-appsnap-helper.mjs";
import { buildWindowsAppSnapHelper } from "./build-appsnap-helper-windows.mjs";
import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";

if (process.platform === "darwin") {
  buildAppSnapHelper({ arch: process.arch });
} else if (process.platform === "win32") {
  buildWindowsAppSnapHelper();
}

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(resolveElectronPath(), ["dist-electron/main.js"], {
  stdio: "inherit",
  cwd: desktopDir,
  env: childEnv,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
