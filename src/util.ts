import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.3.2";
export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const UA = `Polaris/0.3.2 (personal study course builder; https://github.com/DuongNAD) Node.js/${process.versions.node}`;

export function hubDir(): string {
  return resolve(process.env.POLARIS_HUB ?? "D:/02_Learning_Knowledge");
}

export function defaultCacheRoot(): string {
  if (process.env.POLARIS_CACHE_DIR && process.env.POLARIS_CACHE_DIR.trim()) {
    return resolve(process.env.POLARIS_CACHE_DIR.trim());
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, "polaris", "cache");
  }
  const xdg = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(xdg, "polaris");
}

export function profilePath(hub?: string): string {
  const base = hub ? resolve(hub) : hubDir();
  return join(base, ".polaris", "learner.json");
}

export interface SubjectPaths {
  dir: string;
  polarisDir: string;
  briefJson: string;
  sourcesJson: string;
  factsJson: string;
  roadmapJson: string;
  scheduleJson: string;
  courseMapJson: string;
  tasksMapJson: string;
  reviewsJson: string;
  errorlogMd: string;
  progressStateJson: string;
  capturesDir: string;
  researchDir: string;
  lessonsDir: string;
  cacheDir: string;
  legacyCacheDir: string;
  gitignore: string;
  defaultRoadmapMd: string;
  tasksMd: string;
}

export function subjectPaths(target: string): SubjectPaths {
  const abs = resolve(target);
  let dir = abs;
  if (basename(abs).toLowerCase() === "brief.json" || basename(abs).toLowerCase() === "roadmap.json") {
    dir = dirname(dirname(abs));
  } else if (basename(abs).toLowerCase() === "polaris") {
    dir = dirname(abs);
  }
  const polarisDir = join(dir, "polaris");
  const subjectHash = hash(dir, 16);
  const cacheDir = join(defaultCacheRoot(), subjectHash);
  const legacyCacheDir = join(polarisDir, ".cache");
  return {
    dir,
    polarisDir,
    briefJson: join(polarisDir, "brief.json"),
    sourcesJson: join(polarisDir, "sources.json"),
    factsJson: join(polarisDir, "facts.json"),
    roadmapJson: join(polarisDir, "roadmap.json"),
    scheduleJson: join(polarisDir, "schedule.json"),
    courseMapJson: join(polarisDir, "course-map.json"),
    tasksMapJson: join(polarisDir, "tasks-map.json"),
    reviewsJson: join(polarisDir, "reviews.json"),
    errorlogMd: join(polarisDir, "errorlog.md"),
    progressStateJson: join(polarisDir, "progress-state.json"),
    capturesDir: join(polarisDir, "captures"),
    researchDir: join(polarisDir, "research"),
    lessonsDir: join(polarisDir, "lessons"),
    cacheDir,
    legacyCacheDir,
    gitignore: join(polarisDir, ".gitignore"),
    defaultRoadmapMd: join(dir, "04_Roadmaps", "ROADMAP.md"),
    tasksMd: join(dir, "TASKS.md"),
  };
}

export const hash = (s: string, n = 8): string => createHash("sha1").update(s).digest("hex").slice(0, n);

/* ───────── Date and Schedule Helpers ───────── */

export function parseIsoDate(dateIso: string): Date {
  const parts = dateIso.split("-").map((x) => parseInt(x, 10));
  const y = parts[0] ?? 2026;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function formatIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dateIso: string, days: number): string {
  const dt = parseIsoDate(dateIso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatIsoDate(dt);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const d1 = parseIsoDate(fromIso);
  const d2 = parseIsoDate(toIso);
  return Math.round((d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000));
}

const EN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export type EnDayOfWeek = (typeof EN_DAYS)[number];

const VI_DAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"] as const;
const VI_SHORT_DAYS = ["CN", "Hai", "Ba", "Tư", "Năm", "Sáu", "Bảy"] as const;

export function dayOfWeekEn(dateIso: string): EnDayOfWeek {
  const d = parseIsoDate(dateIso);
  return EN_DAYS[d.getUTCDay()]!;
}

export function dayOfWeekVi(dateIso: string): string {
  const d = parseIsoDate(dateIso);
  return VI_DAYS[d.getUTCDay()]!;
}

export function shortDayVi(dateIso: string): string {
  const d = parseIsoDate(dateIso);
  return VI_SHORT_DAYS[d.getUTCDay()]!;
}

export function formatWhenLabel(dateIso: string, startIso: string, weekNum: number): string {
  const dayVi = dayOfWeekVi(dateIso);
  const targetYear = dateIso.slice(0, 4);
  const startYear = startIso.slice(0, 4);
  const dd = dateIso.slice(8, 10);
  const mm = dateIso.slice(5, 7);

  let datePart = `${dd}/${mm}`;
  if (targetYear !== startYear) {
    datePart = `${dd}/${mm}/${targetYear}`;
  }
  return `Tuần ${weekNum} · ${dayVi} ${datePart}`;
}

export function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "subject"
  );
}

/** Atomic file write via temp file + rename to prevent corruption */
export async function atomicWriteFile(targetPath: string, content: string | Buffer): Promise<void> {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tempPath = `${targetPath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, targetPath);
  } catch (err) {
    try {
      if (existsSync(tempPath)) {
        await unlink(tempPath);
      }
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, "")) as T;
  } catch {
    return undefined;
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await atomicWriteFile(path, JSON.stringify(data, null, 2) + "\n");
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 20000): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: {
        "User-Agent": UA,
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/* ───────── Rate Limiting & Retry on 429/503 ───────── */

const lastRequestTime = new Map<string, number>();

export async function rateLimitedDelay(provider: string, minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const last = lastRequestTime.get(provider) ?? 0;
  const elapsed = now - last;
  if (elapsed < minIntervalMs) {
    const waitMs = minIntervalMs - elapsed;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  lastRequestTime.set(provider, Date.now());
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  ms = 20000,
  maxRetries = 2,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    attempt++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctl.signal,
        headers: {
          "User-Agent": UA,
          ...(init.headers ?? {}),
        },
      });

      if ((res.status === 429 || res.status === 503) && attempt <= maxRetries) {
        const retryAfterHeader = res.headers.get("retry-after");
        let delayMs = attempt * 1500;
        if (retryAfterHeader) {
          const parsed = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsed) && parsed > 0 && parsed <= 10) {
            delayMs = parsed * 1000;
          }
        }
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ───────── robots.txt Courtesy ───────── */

const robotsCache = new Map<string, { rules: { userAgent: string; disallow: string[] }[]; fetchedAt: number }>();

function parseRobotsTxt(txt: string): { userAgent: string; disallow: string[] }[] {
  const sections: { userAgent: string; disallow: string[] }[] = [];
  let currentUa: string | undefined;
  let disallows: string[] = [];

  for (const rawLine of txt.split("\n")) {
    const line = rawLine.split("#")[0]!.trim();
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();

    if (field === "user-agent") {
      if (currentUa) {
        sections.push({ userAgent: currentUa, disallow: disallows });
        disallows = [];
      }
      currentUa = val.toLowerCase();
    } else if (field === "disallow" && currentUa) {
      if (val) disallows.push(val);
    }
  }
  if (currentUa) {
    sections.push({ userAgent: currentUa, disallow: disallows });
  }
  return sections;
}

export async function isUrlAllowedByRobots(urlStr: string): Promise<boolean> {
  try {
    const u = new URL(urlStr);
    const hostKey = u.origin;
    const now = Date.now();
    let cached = robotsCache.get(hostKey);

    if (!cached || now - cached.fetchedAt > 3600000) {
      const robotsUrl = `${u.origin}/robots.txt`;
      let rules: { userAgent: string; disallow: string[] }[] = [];
      try {
        const res = await fetchWithTimeout(robotsUrl, {}, 5000);
        if (res.ok) {
          const txt = await res.text();
          rules = parseRobotsTxt(txt);
        }
      } catch {
        // Assume allowed if unreachable
      }
      cached = { rules, fetchedAt: now };
      robotsCache.set(hostKey, cached);
    }

    if (cached.rules.length === 0) return true;

    const path = u.pathname + u.search;
    for (const rule of cached.rules) {
      const ua = rule.userAgent;
      if (ua === "*" || ua.includes("polaris")) {
        for (const dis of rule.disallow) {
          if (dis && (dis === "/" || path.startsWith(dis))) {
            return false;
          }
        }
      }
    }
    return true;
  } catch {
    return true;
  }
}

/* ───────── External Program Detection & Safe Execution ───────── */

const exeCache = new Map<string, string | null>();

export function findExecutable(candidates: string[]): string | undefined {
  const cacheKey = candidates.join("|");
  if (exeCache.has(cacheKey)) {
    return exeCache.get(cacheKey) ?? undefined;
  }

  const pathEnv = process.env.PATH || "";
  const pathDirs = pathEnv.split(process.platform === "win32" ? ";" : ":");
  const isWin = process.platform === "win32";

  for (const cand of candidates) {
    if (existsSync(cand)) {
      exeCache.set(cacheKey, cand);
      return cand;
    }
    for (const dir of pathDirs) {
      const p = join(dir, cand);
      if (existsSync(p)) {
        exeCache.set(cacheKey, p);
        return p;
      }
      if (isWin && !cand.toLowerCase().endsWith(".exe")) {
        if (existsSync(p + ".exe")) {
          exeCache.set(cacheKey, p + ".exe");
          return p + ".exe";
        }
        if (existsSync(p + ".cmd")) {
          exeCache.set(cacheKey, p + ".cmd");
          return p + ".cmd";
        }
        if (existsSync(p + ".bat")) {
          exeCache.set(cacheKey, p + ".bat");
          return p + ".bat";
        }
      }
    }
  }

  exeCache.set(cacheKey, null);
  return undefined;
}

export async function runExecutable(
  exePath: string,
  args: string[],
  options: { timeoutMs?: number; input?: string; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeoutMs = options.timeoutMs ?? 25000;
    const child = spawn(exePath, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        rejectPromise(new Error(`Execution timed out after ${timeoutMs}ms: ${basename(exePath)} ${args.join(" ")}`));
      }
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });

    child.on("error", (err) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        rejectPromise(err);
      }
    });

    child.on("close", (code) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolvePromise({ stdout, stderr, exitCode: code ?? 0 });
      }
    });

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Closest candidate by edit distance (typos like "subtitel", "bulets") */
export function closest(word: string, candidates: string[]): string | undefined {
  const w = word.toLowerCase();
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const a = w;
    const b = c.toLowerCase();
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = row[j]!;
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    const d = row[b.length]!;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best && bestD <= Math.max(2, Math.floor(w.length / 3)) ? best : undefined;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
