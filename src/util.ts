import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.1.0";
export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const UA = `Polaris/${VERSION} (personal study course builder; Model Context Protocol server) Node.js/${process.versions.node}`;

export function hubDir(): string {
  return resolve(process.env.POLARIS_HUB ?? "D:/02_Learning_Knowledge");
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
  capturesDir: string;
  gitignore: string;
  defaultRoadmapMd: string;
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
  return {
    dir,
    polarisDir,
    briefJson: join(polarisDir, "brief.json"),
    sourcesJson: join(polarisDir, "sources.json"),
    factsJson: join(polarisDir, "facts.json"),
    roadmapJson: join(polarisDir, "roadmap.json"),
    scheduleJson: join(polarisDir, "schedule.json"),
    capturesDir: join(polarisDir, "captures"),
    gitignore: join(polarisDir, ".gitignore"),
    defaultRoadmapMd: join(dir, "04_Roadmaps", "ROADMAP.md"),
  };
}

export const hash = (s: string, n = 8): string => createHash("sha1").update(s).digest("hex").slice(0, n);

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
