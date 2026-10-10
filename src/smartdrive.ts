import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { findExecutable } from "./util.js";

/** Split a command line string into tokens, preserving quoted arguments */
export function splitCommand(cmdStr: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inQuote: "'" | '"' | null = null;
  for (let i = 0; i < cmdStr.length; i++) {
    const ch = cmdStr[i]!;
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (/\s/.test(ch)) {
      if (cur.length > 0) {
        tokens.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) {
    tokens.push(cur);
  }
  return tokens;
}

export function isSmartDriveDisabled(): boolean {
  const val = process.env.POLARIS_SMARTDRIVE?.trim().toLowerCase();
  return val === "off" || val === "false" || val === "0" || val === "no";
}

/** Resolve the SmartDrive command from environment or PATH fallback */
export function resolveSmartDriveCommand(): { executable: string; baseArgs: string[] } | undefined {
  if (process.env.POLARIS_SMARTDRIVE_CMD && process.env.POLARIS_SMARTDRIVE_CMD.trim()) {
    const parts = splitCommand(process.env.POLARIS_SMARTDRIVE_CMD.trim());
    if (parts.length > 0) {
      return {
        executable: parts[0]!,
        baseArgs: parts.slice(1),
      };
    }
  }

  // 1. `smart-drive` on PATH
  const sdExe = findExecutable(["smart-drive"]);
  if (sdExe) {
    return {
      executable: sdExe,
      baseArgs: [],
    };
  }

  // 2. `python -m smart_drive` or on Windows `py -3 -m smart_drive`
  if (process.platform === "win32") {
    const pyExe = findExecutable(["py"]);
    if (pyExe) {
      return {
        executable: pyExe,
        baseArgs: ["-3", "-m", "smart_drive"],
      };
    }
    const pythonExe = findExecutable(["python", "python3"]);
    if (pythonExe) {
      return {
        executable: pythonExe,
        baseArgs: ["-m", "smart_drive"],
      };
    }
  } else {
    const pythonExe = findExecutable(["python3", "python"]);
    if (pythonExe) {
      return {
        executable: pythonExe,
        baseArgs: ["-m", "smart_drive"],
      };
    }
  }

  return undefined;
}

interface FolderState {
  lastSpawnTime: number;
  timer: NodeJS.Timeout | null;
  trailingRequested: boolean;
}

const folderStates = new Map<string, FolderState>();
let hasLoggedFailure = false;

export function _resetSmartDriveState(): void {
  for (const s of folderStates.values()) {
    if (s.timer) clearTimeout(s.timer);
  }
  folderStates.clear();
  hasLoggedFailure = false;
}

function executeNotify(normDir: string): void {
  const cmd = resolveSmartDriveCommand();
  if (!cmd) return;

  const args = [...cmd.baseArgs, "update", normDir, "--quiet"];
  try {
    const child = spawn(cmd.executable, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      try {
        if (child.pid && !child.killed) {
          child.kill();
        }
      } catch {
        // ignore
      }
    }, 60000);
    timer.unref();

    child.on("exit", () => {
      clearTimeout(timer);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (!hasLoggedFailure) {
        hasLoggedFailure = true;
        console.error(`[polaris] SmartDrive notification error: ${err.message}`);
      }
    });

    child.unref();
  } catch (err) {
    if (!hasLoggedFailure) {
      hasLoggedFailure = true;
      console.error(`[polaris] SmartDrive spawn error: ${(err as Error).message}`);
    }
  }
}

/**
 * Best-effort, non-blocking notification to SmartDrive to update index for directory.
 * Coalesced per directory within 2 seconds.
 */
export function notifySmartDrive(dir: string): void {
  if (isSmartDriveDisabled()) return;

  const normDir = resolve(dir);
  const now = Date.now();
  const state = folderStates.get(normDir);

  if (!state || now - state.lastSpawnTime >= 2000) {
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    folderStates.set(normDir, {
      lastSpawnTime: now,
      timer: null,
      trailingRequested: false,
    });
    executeNotify(normDir);
  } else {
    state.trailingRequested = true;
    if (!state.timer) {
      const delay = Math.max(50, 2000 - (now - state.lastSpawnTime));
      state.timer = setTimeout(() => {
        const cur = folderStates.get(normDir);
        if (cur && cur.trailingRequested) {
          cur.lastSpawnTime = Date.now();
          cur.trailingRequested = false;
          cur.timer = null;
          executeNotify(normDir);
        } else if (cur) {
          cur.timer = null;
        }
      }, delay);
      state.timer.unref();
    }
  }
}
