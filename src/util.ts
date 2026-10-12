import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.4.0";
export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const UA = `Polaris/${VERSION} (personal study course builder; https://github.com/DuongNAD) Node.js/${process.versions.node}`;

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

/* ───────── SSRF Guard & IP Range Checks ───────── */

export function parseIpv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (let i = 0; i < 4; i++) {
    const part = parts[i]!;
    if (!/^\d+$/.test(part)) return null;
    const n = parseInt(part, 10);
    if (n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

export function isPrivateIpv4(num: number): boolean {
  if ((num >>> 24) === 0) return true;       // 0.0.0.0/8 (unspecified)
  if ((num >>> 24) === 10) return true;      // 10.0.0.0/8 (private)
  if ((num >>> 22) === 0x191) return true;   // 100.64.0.0/10 (CGNAT)
  if ((num >>> 24) === 127) return true;     // 127.0.0.0/8 (loopback)
  if ((num >>> 16) === 0xa9fe) return true;  // 169.254.0.0/16 (link-local)
  if ((num >>> 20) === 0xac1) return true;   // 172.16.0.0/12 (private)
  if ((num >>> 8) === 0xc00000) return true; // 192.0.0.0/24 (IETF protocol assignments)
  if ((num >>> 8) === 0xc00002) return true; // 192.0.2.0/24 (TEST-NET-1)
  if ((num >>> 16) === 0xc0a8) return true;  // 192.168.0.0/16 (private)
  if ((num >>> 17) === 25353) return true;   // 198.18.0.0/15 (benchmarking)
  if ((num >>> 8) === 0xc63364) return true; // 198.51.100.0/24 (TEST-NET-2)
  if ((num >>> 8) === 0xcb0071) return true; // 203.0.113.0/24 (TEST-NET-3)
  if ((num >>> 28) === 14) return true;      // 224.0.0.0/4 (multicast)
  if ((num >>> 28) === 15) return true;      // 240.0.0.0/4 (reserved & broadcast)
  return false;
}

export function parseIpv6(ip: string): number[] | null {
  const clean = ip.split("%")[0]!.trim().toLowerCase();
  let hexStr = clean;
  const lastColon = clean.lastIndexOf(":");
  if (lastColon >= 0) {
    const afterLastColon = clean.slice(lastColon + 1);
    if (afterLastColon.includes(".")) {
      const ipv4Num = parseIpv4(afterLastColon);
      if (ipv4Num === null) return null;
      const hi = (ipv4Num >>> 16).toString(16);
      const lo = (ipv4Num & 0xffff).toString(16);
      hexStr = `${clean.slice(0, lastColon)}:${hi}:${lo}`;
    }
  }
  if (hexStr.includes(":::")) return null;
  const dc = (hexStr.match(/::/g) || []).length;
  if (dc > 1) return null;
  const words: number[] = [];
  if (dc === 1) {
    const [left, right] = hexStr.split("::");
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];
    if (leftParts.length + rightParts.length > 7) return null;
    const missing = 8 - (leftParts.length + rightParts.length);
    const middle = Array(missing).fill("0");
    const all = [...leftParts, ...middle, ...rightParts];
    for (const part of all) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      words.push(parseInt(part, 16));
    }
  } else {
    const parts = hexStr.split(":");
    if (parts.length !== 8) return null;
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      words.push(parseInt(part, 16));
    }
  }
  return words.length === 8 ? words : null;
}

export function isPrivateIpv6(w: number[]): boolean {
  // 1. Unspecified: ::
  if (w.every((x) => x === 0)) return true;

  // 2. Loopback: ::1
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true;

  // 3. IPv4-mapped IPv6: ::ffff:0:0/96
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) {
    const v4 = ((w[6]! << 16) | w[7]!) >>> 0;
    return isPrivateIpv4(v4);
  }

  // 4. IPv4-compatible IPv6 (deprecated): ::/96
  if (w.slice(0, 6).every((x) => x === 0)) {
    const v4 = ((w[6]! << 16) | w[7]!) >>> 0;
    return isPrivateIpv4(v4);
  }

  // 5. 6to4: 2002::/16
  if (w[0] === 0x2002) {
    const v4 = ((w[1]! << 16) | w[2]!) >>> 0;
    return isPrivateIpv4(v4);
  }

  // 6. Well-Known Prefix for IPv4/IPv6 translation (NAT64): 64:ff9b::/96
  if (w[0] === 0x0064 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) {
    const v4 = ((w[6]! << 16) | w[7]!) >>> 0;
    return isPrivateIpv4(v4);
  }

  // 7. Unique Local Address (ULA / private): fc00::/7
  if ((w[0]! & 0xfe00) === 0xfc00) return true;

  // 8. Link-local unicast: fe80::/10
  if ((w[0]! & 0xffc0) === 0xfe80) return true;

  // 9. Site-local (deprecated RFC 3879): fec0::/10
  if ((w[0]! & 0xffc0) === 0xfec0) return true;

  // 10. Multicast: ff00::/8
  if ((w[0]! & 0xff00) === 0xff00) return true;

  // 11. Documentation: 2001:db8::/32
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true;

  // 12. Discard-only: 100::/64
  if (w[0] === 0x0100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return true;

  return false;
}

export function isPrivateIp(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4 !== null) return isPrivateIpv4(v4);
  const v6 = parseIpv6(ip);
  if (v6 !== null) return isPrivateIpv6(v6);
  return false;
}

export async function assertSafeUrl(urlStr: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error(`Refused: invalid URL "${urlStr}"`);
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Refused: scheme "${u.protocol}" is not allowed (only http and https)`);
  }

  if (process.env.POLARIS_ALLOW_PRIVATE_URLS === "1") {
    return u;
  }

  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) {
    throw new Error(`Refused: empty host in URL`);
  }

  const cleanHost = host.toLowerCase().replace(/\.+$/, "");
  if (cleanHost === "localhost" || cleanHost.endsWith(".localhost")) {
    throw new Error(`Refused: ${host} resolves to a private or local address`);
  }

  if (isPrivateIp(cleanHost)) {
    throw new Error(`Refused: ${host} resolves to a private or local address`);
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(cleanHost, { all: true });
  } catch (err) {
    throw new Error(`Refused: failed to resolve host "${host}": ${(err as Error).message}`);
  }

  if (!addresses || addresses.length === 0) {
    throw new Error(`Refused: ${host} resolves to no addresses`);
  }

  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) {
      throw new Error(`Refused: ${host} resolves to a private or local address`);
    }
  }

  return u;
}

export type SafeFetchInit = RequestInit & {
  allowFirstHop?: boolean;
};

export type FetchHeaders = NonNullable<RequestInit["headers"]>;

const CREDENTIAL_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "cookie",
]);

export function stripCredentialHeaders(headers: FetchHeaders): FetchHeaders {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const nextHeaders = new Headers(headers);
    for (const h of CREDENTIAL_HEADERS) {
      nextHeaders.delete(h);
    }
    return nextHeaders;
  }
  if (Array.isArray(headers)) {
    return headers.filter(([k]) => typeof k === "string" && !CREDENTIAL_HEADERS.has(k.toLowerCase().trim()));
  }
  if (typeof headers === "object" && headers !== null) {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (typeof k === "string" && !CREDENTIAL_HEADERS.has(k.toLowerCase().trim())) {
        clean[k] = v as string;
      }
    }
    return clean;
  }
  return headers;
}

export function mergeHeadersWithUserAgent(headers?: RequestInit["headers"]): RequestInit["headers"] {
  if (!headers) {
    return { "User-Agent": UA };
  }
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const h = new Headers(headers);
    if (!h.has("user-agent")) {
      h.set("User-Agent", UA);
    }
    return h;
  }
  if (Array.isArray(headers)) {
    const hasUa = headers.some(([k]) => typeof k === "string" && k.toLowerCase() === "user-agent");
    if (!hasUa) {
      return [["User-Agent", UA], ...headers];
    }
    return headers;
  }
  if (typeof headers === "object" && headers !== null) {
    const hasUa = Object.keys(headers).some((k) => k.toLowerCase() === "user-agent");
    return {
      ...(hasUa ? {} : { "User-Agent": UA }),
      ...headers,
    };
  }
  return headers;
}

export async function fetchSafeHop(
  currentUrl: string,
  init: SafeFetchInit,
  signal: AbortSignal,
  hopCount = 0,
): Promise<Response> {
  if (hopCount > 5) {
    throw new Error("Refused: too many redirects (max 5)");
  }

  if (hopCount === 0 && init.allowFirstHop) {
    const u = new URL(currentUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error(`Refused: scheme "${u.protocol}" is not allowed (only http and https)`);
    }
  } else {
    await assertSafeUrl(currentUrl);
  }

  const requestHeaders = mergeHeadersWithUserAgent(init.headers);

  const res = await fetch(currentUrl, {
    ...init,
    redirect: "manual",
    signal,
    headers: requestHeaders,
  });

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = res.headers.get("location");
    if (location) {
      const currentUrlObj = new URL(currentUrl);
      const nextUrlObj = new URL(location, currentUrl);
      const nextUrl = nextUrlObj.href;

      const nextInit: SafeFetchInit = { ...init };
      delete nextInit.allowFirstHop;

      if ([301, 302, 303].includes(res.status)) {
        nextInit.method = "GET";
        delete (nextInit as Record<string, unknown>).body;
      }

      if (nextUrlObj.origin !== currentUrlObj.origin && nextInit.headers) {
        nextInit.headers = stripCredentialHeaders(nextInit.headers as FetchHeaders);
      }

      return fetchSafeHop(nextUrl, nextInit, signal, hopCount + 1);
    }
  }

  return res;
}

export async function fetchWithTimeout(
  url: string,
  init: SafeFetchInit = {},
  ms = 20000,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetchSafeHop(url, init, ctl.signal, 0);
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
  init: SafeFetchInit = {},
  ms = 20000,
  maxRetries = 2,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    attempt++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetchSafeHop(url, init, ctl.signal, 0);

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
      if ((err as Error).message?.startsWith("Refused:")) {
        throw err;
      }
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
  await assertSafeUrl(urlStr);

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
      } catch (err) {
        if ((err as Error).message?.startsWith("Refused:")) {
          throw err;
        }
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
  } catch (err) {
    if ((err as Error).message?.startsWith("Refused:")) {
      throw err;
    }
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
