import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { captureSource } from "./capture.js";
import {
  Brief,
  Source,
  SourceKind,
  SourceLabel,
  validateSource,
} from "./schema.js";
import { readBrief, readSources } from "./store.js";
import {
  atomicWriteFile,
  fetchWithRetry,
  findExecutable,
  hash,
  rateLimitedDelay,
  readJson,
  runExecutable,
  slugify,
  subjectPaths,
  todayIso,
  writeJson,
} from "./util.js";

export const RESEARCH_PROVIDERS = [
  "openalex",
  "arxiv",
  "semanticscholar",
  "crossref",
  "wikipedia",
  "github",
  "youtube",
  "brave",
] as const;

export type ResearchProvider = (typeof RESEARCH_PROVIDERS)[number];

export interface ResearchItem {
  provider: ResearchProvider;
  kind: SourceKind;
  title: string;
  authors?: string;
  year?: number;
  venue?: string;
  url: string;
  doi?: string;
  arxiv?: string;
  citations?: number;
  oaUrl?: string;
  abstract?: string;
  lang?: string;
  score?: number;
  reasons?: string[];
  rank?: number;
}

export interface ResearchOptions {
  limit?: number;
  per_provider?: number;
  year_from?: number;
  lang?: string;
  providers?: ResearchProvider[];
  module?: string;
  subject_dir?: string;
  auto_add?: number;
}

/* ───────── Cache Handling (24 hours TTL) ───────── */

export interface CacheEntry<T> {
  savedAt: number;
  ttlMs: number;
  data: T;
}

export async function getResearchCache<T>(cacheDir: string, key: string): Promise<T | undefined> {
  const p = join(cacheDir, `${key}.json`);
  if (!existsSync(p)) return undefined;
  const entry = await readJson<CacheEntry<T>>(p);
  if (!entry) return undefined;
  if (Date.now() - entry.savedAt > entry.ttlMs) {
    return undefined;
  }
  return entry.data;
}

export async function setResearchCache<T>(cacheDir: string, key: string, data: T, ttlMs = 86400000): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const p = join(cacheDir, `${key}.json`);
  await writeJson(p, {
    savedAt: Date.now(),
    ttlMs,
    data,
  });
}

/* ───────── Inverted Index Reconstructor (OpenAlex) ───────── */

export function reconstructInvertedIndex(inv?: Record<string, number[]>): string | undefined {
  if (!inv || typeof inv !== "object") return undefined;
  const words: [number, string][] = [];
  for (const [w, positions] of Object.entries(inv)) {
    if (Array.isArray(positions)) {
      for (const pos of positions) {
        if (typeof pos === "number") {
          words.push([pos, w]);
        }
      }
    }
  }
  if (words.length === 0) return undefined;
  words.sort((a, b) => a[0] - b[0]);
  return words.map((w) => w[1]).join(" ");
}

/* ───────── Parsers for Providers ───────── */

export function parseOpenAlexResponse(json: Record<string, unknown>): ResearchItem[] {
  const results = (json.results as Array<Record<string, unknown>>) ?? [];
  const items: ResearchItem[] = [];

  for (const w of results) {
    const title = typeof w.title === "string" ? w.title.trim() : (typeof w.display_name === "string" ? w.display_name.trim() : "");
    if (!title) continue;

    const authorships = (w.authorships as Array<{ author?: { display_name?: string } }>) ?? [];
    const authors = authorships
      .map((a) => a.author?.display_name)
      .filter(Boolean)
      .join(", ");

    const year = typeof w.publication_year === "number" ? w.publication_year : undefined;
    const primaryLoc = w.primary_location as Record<string, unknown> | undefined;
    const hostVenue = w.host_venue as Record<string, unknown> | undefined;
    const sourceObj = primaryLoc?.source as Record<string, unknown> | undefined;
    const venue = (typeof sourceObj?.display_name === "string" ? sourceObj.display_name : undefined) ||
      (typeof hostVenue?.display_name === "string" ? hostVenue.display_name : undefined);

    const doiRaw = typeof w.doi === "string" ? w.doi : undefined;
    const doi = doiRaw ? doiRaw.replace(/^https?:\/\/doi\.org\//i, "") : undefined;
    const url = doiRaw || (typeof w.id === "string" ? w.id : "") || (typeof primaryLoc?.landing_page_url === "string" ? primaryLoc.landing_page_url : "");

    const citations = typeof w.cited_by_count === "number" ? w.cited_by_count : undefined;
    const openAccess = w.open_access as Record<string, unknown> | undefined;
    const oaUrl = (typeof primaryLoc?.pdf_url === "string" ? primaryLoc.pdf_url : undefined) ||
      (typeof openAccess?.oa_url === "string" ? openAccess.oa_url : undefined) ||
      (openAccess?.is_oa && typeof primaryLoc?.landing_page_url === "string" ? primaryLoc.landing_page_url : undefined);

    const abstract = reconstructInvertedIndex(w.abstract_inverted_index as Record<string, number[]> | undefined);
    const typeStr = String(w.type ?? "").toLowerCase();
    const kind: SourceKind = typeStr.includes("book") ? "book" : "paper";

    items.push({
      provider: "openalex",
      kind,
      title,
      authors: authors || undefined,
      year,
      venue,
      url,
      doi,
      citations,
      oaUrl: oaUrl || undefined,
      abstract,
    });
  }

  return items;
}

export function parseArxivXml(xml: string): ResearchItem[] {
  const items: ResearchItem[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let em;

  while ((em = entryRegex.exec(xml))) {
    const entry = em[1]!;
    const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(entry);
    const rawTitle = titleMatch ? titleMatch[1]!.replace(/\s+/g, " ").trim() : "";
    if (!rawTitle) continue;

    const idMatch = /<id>([\s\S]*?)<\/id>/i.exec(entry);
    const rawId = idMatch ? idMatch[1]!.trim() : "";
    const aidMatch = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/i.exec(rawId);
    const rawEnd = rawId.split("/").pop()?.replace(/v\d+$/i, "");
    const arxivId = aidMatch ? aidMatch[1] : rawEnd || undefined;

    const authors: string[] = [];
    const authRegex = /<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/gi;
    let am;
    while ((am = authRegex.exec(entry))) {
      authors.push(am[1]!.trim());
    }

    const pubMatch = /<published>([\s\S]*?)<\/published>/i.exec(entry);
    const year = pubMatch ? parseInt(pubMatch[1]!.slice(0, 4), 10) : undefined;

    const sumMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(entry);
    const abstract = sumMatch ? sumMatch[1]!.replace(/\s+/g, " ").trim() : undefined;

    const pdfMatch = /<link[^>]*title=["']pdf["'][^>]*href=["']([^"']+)["']/i.exec(entry) ||
      /<link[^>]*href=["']([^"']+)["'][^>]*title=["']pdf["']/i.exec(entry);
    const oaUrl = pdfMatch ? pdfMatch[1] : arxivId ? `https://arxiv.org/pdf/${arxivId}` : undefined;

    items.push({
      provider: "arxiv",
      kind: "paper",
      title: rawTitle,
      authors: authors.length > 0 ? authors.join(", ") : undefined,
      year,
      venue: "arXiv",
      url: arxivId ? `https://arxiv.org/abs/${arxivId}` : rawId,
      arxiv: arxivId,
      oaUrl,
      abstract,
    });
  }

  return items;
}

export function parseSemanticScholarResponse(json: Record<string, unknown>): ResearchItem[] {
  const data = (json.data as Array<Record<string, unknown>>) ?? [];
  const items: ResearchItem[] = [];

  for (const paper of data) {
    const title = typeof paper.title === "string" ? paper.title.trim() : "";
    if (!title) continue;

    const authList = (paper.authors as Array<{ name?: string }>) ?? [];
    const authors = authList.map((a) => a.name).filter(Boolean).join(", ");
    const year = typeof paper.year === "number" ? paper.year : undefined;
    const venue = typeof paper.venue === "string" ? paper.venue : undefined;

    const extIds = (paper.externalIds as Record<string, string>) ?? {};
    const doi = extIds.DOI;
    const arxiv = extIds.ArXiv;

    const oaPdf = paper.openAccessPdf as { url?: string } | undefined;
    const oaUrl = oaPdf?.url;

    let url = typeof paper.url === "string" ? paper.url : "";
    if (!url) {
      if (doi) url = `https://doi.org/${doi}`;
      else if (arxiv) url = `https://arxiv.org/abs/${arxiv}`;
      else if (paper.paperId) url = `https://www.semanticscholar.org/paper/${paper.paperId}`;
    }

    const tldr = paper.tldr as { text?: string } | undefined;
    const abstractText = typeof paper.abstract === "string" ? paper.abstract : "";
    const abstract = tldr?.text
      ? `${tldr.text}${abstractText ? `\n\n${abstractText}` : ""}`
      : abstractText || undefined;

    items.push({
      provider: "semanticscholar",
      kind: "paper",
      title,
      authors: authors || undefined,
      year,
      venue,
      url,
      doi,
      arxiv,
      citations: typeof paper.citationCount === "number" ? paper.citationCount : undefined,
      oaUrl,
      abstract,
    });
  }

  return items;
}

export function parseCrossRefResponse(json: Record<string, unknown>): ResearchItem[] {
  const msg = json.message as Record<string, unknown> | undefined;
  const rawItems = (msg?.items as Array<Record<string, unknown>>) ?? [];
  const items: ResearchItem[] = [];

  for (const it of rawItems) {
    const titleArr = it.title as string[] | undefined;
    const title = titleArr && titleArr.length > 0 ? titleArr[0]!.trim() : "";
    if (!title) continue;

    const authList = (it.author as Array<{ given?: string; family?: string }>) ?? [];
    const authors = authList.map((a) => `${a.given ?? ""} ${a.family ?? ""}`.trim()).filter(Boolean).join(", ");

    const pub = (it.published ?? it["published-print"] ?? it["published-online"]) as { "date-parts"?: number[][] } | undefined;
    const year = pub?.["date-parts"]?.[0]?.[0];

    const containerArr = it["container-title"] as string[] | undefined;
    const venue = (containerArr && containerArr.length > 0 ? containerArr[0] : undefined) || (typeof it.publisher === "string" ? it.publisher : undefined);

    const doi = typeof it.DOI === "string" ? it.DOI : undefined;
    const url = typeof it.URL === "string" ? it.URL : doi ? `https://doi.org/${doi}` : "";

    const citations = typeof it["is-referenced-by-count"] === "number" ? it["is-referenced-by-count"] : undefined;
    const typeStr = String(it.type ?? "").toLowerCase();
    const kind: SourceKind = typeStr.includes("book") || typeStr.includes("monograph") ? "book" : "paper";

    items.push({
      provider: "crossref",
      kind,
      title,
      authors: authors || undefined,
      year,
      venue,
      url,
      doi,
      citations,
      abstract: typeof it.abstract === "string" ? it.abstract.replace(/<[^>]+>/g, " ").trim() : undefined,
    });
  }

  return items;
}

export function parseGitHubResponse(json: Record<string, unknown>): ResearchItem[] {
  const rawItems = (json.items as Array<Record<string, unknown>>) ?? [];
  const items: ResearchItem[] = [];

  for (const it of rawItems) {
    const title = typeof it.full_name === "string" ? it.full_name.trim() : (typeof it.name === "string" ? it.name.trim() : "");
    if (!title) continue;

    const owner = it.owner as { login?: string } | undefined;
    const authors = owner?.login;
    const url = typeof it.html_url === "string" ? it.html_url : "";
    const abstract = typeof it.description === "string" ? it.description : undefined;
    const citations = typeof it.stargazers_count === "number" ? it.stargazers_count : undefined;

    const pushedAt = typeof it.pushed_at === "string" ? it.pushed_at : (typeof it.updated_at === "string" ? it.updated_at : undefined);
    const year = pushedAt ? parseInt(pushedAt.slice(0, 4), 10) : undefined;

    const lang = typeof it.language === "string" ? it.language : undefined;
    const venue = lang ? `GitHub (${lang})` : "GitHub";

    items.push({
      provider: "github",
      kind: "web",
      title,
      authors,
      year,
      venue,
      url,
      citations,
      abstract,
      oaUrl: url,
    });
  }

  return items;
}

/* ───────── Provider Fetchers ───────── */

export async function fetchOpenAlex(query: string, limit = 5): Promise<ResearchItem[]> {
  await rateLimitedDelay("openalex", 1000);
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}`;
  const res = await fetchWithRetry(url, {}, 20000);
  if (!res.ok) {
    throw new Error(`OpenAlex returned HTTP ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return parseOpenAlexResponse(json);
}

export async function fetchArxiv(query: string, limit = 5): Promise<ResearchItem[]> {
  await rateLimitedDelay("arxiv", 3000);
  const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}`;
  const res = await fetchWithRetry(url, {}, 20000);
  if (!res.ok) {
    throw new Error(`arXiv API returned HTTP ${res.status}: ${res.statusText}`);
  }
  const xml = await res.text();
  return parseArxivXml(xml);
}

export async function fetchSemanticScholar(query: string, limit = 5): Promise<ResearchItem[]> {
  await rateLimitedDelay("semanticscholar", 1000);
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,authors,year,venue,citationCount,openAccessPdf,tldr,externalIds,abstract`;
  const res = await fetchWithRetry(url, {}, 20000);
  if (!res.ok) {
    throw new Error(`Semantic Scholar returned HTTP ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return parseSemanticScholarResponse(json);
}

export async function fetchCrossRef(query: string, limit = 5): Promise<ResearchItem[]> {
  await rateLimitedDelay("crossref", 1000);
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}`;
  const res = await fetchWithRetry(url, {}, 20000);
  if (!res.ok) {
    throw new Error(`CrossRef returned HTTP ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return parseCrossRefResponse(json);
}

export async function fetchWikipedia(query: string, lang = "vi", limit = 3): Promise<ResearchItem[]> {
  await rateLimitedDelay(`wikipedia_${lang}`, 1000);
  const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=${limit}`;
  const res = await fetchWithRetry(searchUrl, {}, 20000);
  if (!res.ok) {
    throw new Error(`Wikipedia (${lang}) returned HTTP ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as { query?: { search?: Array<{ title?: string; snippet?: string }> } };
  const searchList = json.query?.search ?? [];
  const items: ResearchItem[] = [];

  for (const s of searchList) {
    if (!s.title) continue;
    try {
      await rateLimitedDelay(`wikipedia_${lang}`, 500);
      const sumUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(s.title)}`;
      const sRes = await fetchWithRetry(sumUrl, {}, 10000);
      if (sRes.ok) {
        const sum = (await sRes.json()) as {
          title?: string;
          extract?: string;
          description?: string;
          content_urls?: { desktop?: { page?: string } };
        };
        items.push({
          provider: "wikipedia",
          kind: "web",
          title: sum.title || s.title,
          url: sum.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(s.title)}`,
          venue: sum.description || `Wikipedia (${lang})`,
          abstract: sum.extract || (s.snippet ? s.snippet.replace(/<[^>]+>/g, "") : undefined),
          lang,
          oaUrl: sum.content_urls?.desktop?.page,
        });
      }
    } catch {
      // fallback to search snippet
      items.push({
        provider: "wikipedia",
        kind: "web",
        title: s.title,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(s.title)}`,
        venue: `Wikipedia (${lang})`,
        abstract: s.snippet ? s.snippet.replace(/<[^>]+>/g, "") : undefined,
        lang,
      });
    }
  }

  return items;
}

export async function fetchGitHub(query: string, limit = 5): Promise<ResearchItem[]> {
  await rateLimitedDelay("github", 6000);
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetchWithRetry(url, { headers }, 20000);
  if (!res.ok) {
    throw new Error(`GitHub API returned HTTP ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return parseGitHubResponse(json);
}

export async function fetchYouTube(query: string, limit = 5): Promise<ResearchItem[]> {
  const ytdlp = findExecutable([
    "yt-dlp",
    "yt-dlp.exe",
    "C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python311\\Scripts\\yt-dlp.exe",
  ]);

  if (!ytdlp) {
    throw new Error("yt-dlp executable not found in PATH or standard location");
  }

  const args = [`ytsearch${limit}:${query}`, "--flat-playlist", "-J"];
  const res = await runExecutable(ytdlp, args, { timeoutMs: 25000 });
  if (res.exitCode !== 0 || !res.stdout.trim()) {
    throw new Error(`yt-dlp search failed with exit code ${res.exitCode}: ${res.stderr.slice(0, 200)}`);
  }

  const json = JSON.parse(res.stdout) as { entries?: Array<Record<string, unknown>> };
  const entries = json.entries ?? [];
  const items: ResearchItem[] = [];

  for (const e of entries) {
    const title = typeof e.title === "string" ? e.title.trim() : "";
    if (!title) continue;

    const uploader = typeof e.uploader === "string" ? e.uploader : (typeof e.channel === "string" ? e.channel : undefined);
    const url = typeof e.url === "string" ? e.url : (typeof e.id === "string" ? `https://www.youtube.com/watch?v=${e.id}` : "");
    const desc = typeof e.description === "string" ? e.description : undefined;
    const views = typeof e.view_count === "number" ? e.view_count : undefined;

    let year: number | undefined;
    if (typeof e.upload_date === "string" && e.upload_date.length >= 4) {
      year = parseInt(e.upload_date.slice(0, 4), 10);
    }

    items.push({
      provider: "youtube",
      kind: "video",
      title,
      authors: uploader,
      venue: uploader || "YouTube",
      year,
      url,
      citations: views,
      abstract: desc,
      oaUrl: url,
    });
  }

  return items;
}

export async function fetchBrave(query: string, limit = 5): Promise<ResearchItem[]> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];

  await rateLimitedDelay("brave", 1000);
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const res = await fetchWithRetry(url, { headers: { "X-Subscription-Token": key } }, 20000);
  if (!res.ok) {
    throw new Error(`Brave Search returned HTTP ${res.status}: ${res.statusText}`);
  }

  const json = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  const results = json.web?.results ?? [];
  return results.map((r) => ({
    provider: "brave",
    kind: "web",
    title: r.title || "Web Page",
    url: r.url || "",
    abstract: r.description,
  }));
}

/* ───────── De-duplication ───────── */

export function normalizeDoi(doi?: string): string | undefined {
  if (!doi) return undefined;
  return doi.toLowerCase().replace(/^https?:\/\/doi\.org\//i, "").trim() || undefined;
}

export function normalizeArxiv(arxiv?: string, url?: string): string | undefined {
  if (arxiv) {
    const m = /(\d{4}\.\d{4,5}(?:v\d+)?)/i.exec(arxiv);
    if (m) return m[1];
  }
  if (url) {
    const m = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i.exec(url);
    if (m) return m[1];
  }
  return undefined;
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
  }
}

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateTitleSimilarity(t1: string, t2: string): number {
  const n1 = normalizeTitle(t1);
  const n2 = normalizeTitle(t2);
  if (!n1 || !n2) return 0;
  if (n1 === n2) return 1.0;

  const words1 = new Set(n1.split(" ").filter((w) => w.length > 2));
  const words2 = new Set(n2.split(" ").filter((w) => w.length > 2));
  if (words1.size === 0 || words2.size === 0) return 0;

  let intersection = 0;
  words1.forEach((w) => {
    if (words2.has(w)) intersection++;
  });
  const union = new Set([...words1, ...words2]).size;
  return union > 0 ? intersection / union : 0;
}

export function areItemsDuplicate(a: ResearchItem, b: ResearchItem): boolean {
  const doiA = normalizeDoi(a.doi);
  const doiB = normalizeDoi(b.doi);
  if (doiA && doiB && doiA === doiB) return true;

  const axA = normalizeArxiv(a.arxiv, a.url);
  const axB = normalizeArxiv(b.arxiv, b.url);
  if (axA && axB && axA === axB) return true;

  if (a.url && b.url && normalizeUrl(a.url) === normalizeUrl(b.url)) return true;

  const sim = calculateTitleSimilarity(a.title, b.title);
  if (sim >= 0.85) {
    if (a.year && b.year && a.year === b.year) return true;
    if (a.authors && b.authors) {
      const aFirst = a.authors.split(",")[0]?.trim().toLowerCase();
      const bFirst = b.authors.split(",")[0]?.trim().toLowerCase();
      if (aFirst && bFirst && (aFirst.includes(bFirst) || bFirst.includes(aFirst))) return true;
    }
  }

  return false;
}

export function mergeItems(target: ResearchItem, source: ResearchItem): ResearchItem {
  return {
    ...target,
    authors: target.authors || source.authors,
    year: target.year || source.year,
    venue: target.venue || source.venue,
    doi: target.doi || source.doi,
    arxiv: target.arxiv || source.arxiv,
    citations: Math.max(target.citations || 0, source.citations || 0) || undefined,
    oaUrl: target.oaUrl || source.oaUrl,
    abstract: (target.abstract?.length ?? 0) >= (source.abstract?.length ?? 0) ? target.abstract : source.abstract,
    kind: target.kind === "web" && source.kind !== "web" ? source.kind : target.kind,
  };
}

export function deduplicateResearchItems(items: ResearchItem[]): ResearchItem[] {
  const deduped: ResearchItem[] = [];

  for (const item of items) {
    let matched = false;
    for (let i = 0; i < deduped.length; i++) {
      if (areItemsDuplicate(deduped[i]!, item)) {
        deduped[i] = mergeItems(deduped[i]!, item);
        matched = true;
        break;
      }
    }
    if (!matched) {
      deduped.push({ ...item });
    }
  }

  return deduped;
}

/* ───────── Ranking with Reasons ───────── */

const STOP_WORDS = new Set([
  "the", "and", "or", "in", "of", "a", "an", "for", "to", "with", "on", "at", "by", "from",
  "ve", "cua", "va", "la", "trong", "cho", "voi", "tren", "tai", "tu", "nhung", "cac", "mot",
]);

export function rankResearchItems(
  items: ResearchItem[],
  context: {
    queries: string[];
    moduleKeywords?: string[];
    year_from?: number;
    lang?: string;
  },
): ResearchItem[] {
  const queryWords = new Set<string>();
  context.queries.forEach((q) => {
    normalizeTitle(q)
      .split(" ")
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
      .forEach((w) => queryWords.add(w));
  });

  if (context.moduleKeywords) {
    context.moduleKeywords.forEach((k) => {
      normalizeTitle(k)
        .split(" ")
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
        .forEach((w) => queryWords.add(w));
    });
  }

  const scored = items.map((item) => {
    const reasons: string[] = [];
    let score = 0;

    // 1. Type priority (source policy)
    switch (item.kind) {
      case "course":
        score += 35;
        reasons.push("Primary course material (Priority 1)");
        break;
      case "paper":
        score += 30;
        reasons.push("Primary research paper / preprint (Priority 3)");
        break;
      case "book":
        score += 28;
        reasons.push("Curated book / comprehensive material (Priority 4)");
        break;
      case "video":
        score += 22;
        reasons.push("Video presentation / lecture (Priority 5)");
        break;
      case "web":
      default:
        if (item.provider === "wikipedia") {
          score += 22;
          reasons.push("Overview encyclopedia article");
        } else if (item.provider === "github") {
          score += 20;
          reasons.push("Official code repository / implementation");
        } else {
          score += 15;
          reasons.push("Web resource");
        }
        break;
    }

    // 2. Keyword relevance
    const titleNorm = normalizeTitle(item.title);
    const abstractNorm = normalizeTitle(item.abstract ?? "");

    // Check full query match
    for (const q of context.queries) {
      const qNorm = normalizeTitle(q);
      if (qNorm && titleNorm.includes(qNorm)) {
        score += 18;
        reasons.push(`Exact title match for query "${q}"`);
        break;
      }
    }

    const matchedInTitle: string[] = [];
    const matchedInAbstract: string[] = [];

    queryWords.forEach((word) => {
      if (titleNorm.split(" ").includes(word)) {
        matchedInTitle.push(word);
      } else if (abstractNorm.split(" ").includes(word)) {
        matchedInAbstract.push(word);
      }
    });

    if (matchedInTitle.length > 0) {
      const boost = Math.min(24, matchedInTitle.length * 8);
      score += boost;
      reasons.push(`Keywords matched in title: ${matchedInTitle.slice(0, 3).join(", ")}`);
    }

    if (matchedInAbstract.length > 0) {
      const boost = Math.min(12, matchedInAbstract.length * 3);
      score += boost;
      reasons.push(`Keywords matched in abstract: ${matchedInAbstract.slice(0, 3).join(", ")}`);
    }

    // 3. Authority / Citations
    if (item.citations && item.citations > 0) {
      const citationScore = Math.min(25, Math.round(Math.log10(item.citations + 1) * 8));
      score += citationScore;
      if (item.citations >= 10) {
        reasons.push(`High impact/citation count (${item.citations.toLocaleString()})`);
      }
    }

    if (item.venue) {
      const vLower = item.venue.toLowerCase();
      if (
        vLower.includes("iclr") ||
        vLower.includes("neurips") ||
        vLower.includes("icml") ||
        vLower.includes("nature") ||
        vLower.includes("ieee") ||
        vLower.includes("acm") ||
        vLower.includes("arxiv")
      ) {
        score += 6;
        reasons.push(`Published in reputable venue (${item.venue})`);
      }
    }

    // 4. Recency
    if (context.year_from && item.year) {
      if (item.year >= context.year_from) {
        score += 6;
        reasons.push(`Published since ${context.year_from} (${item.year})`);
      } else {
        score -= 10;
        reasons.push(`Pre-dates target year range (${item.year} < ${context.year_from})`);
      }
    } else if (item.year) {
      if (item.year >= 2022) {
        score += 6;
        reasons.push(`Recent publication (${item.year})`);
      }
    }

    // 5. Open Access availability
    if (item.oaUrl || item.provider === "arxiv" || item.provider === "wikipedia" || item.kind === "video") {
      score += 10;
      reasons.push("Open-access full text available");
    }

    // 6. Language match
    if (context.lang && item.lang && item.lang === context.lang) {
      score += 5;
      reasons.push(`Language match (${context.lang})`);
    }

    const finalScore = Math.max(1, Math.min(100, Math.round(score)));

    return {
      ...item,
      score: finalScore,
      reasons,
    };
  });

  scored.sort((a, b) => {
    if ((b.score ?? 0) !== (a.score ?? 0)) {
      return (b.score ?? 0) - (a.score ?? 0);
    }
    if ((b.citations ?? 0) !== (a.citations ?? 0)) {
      return (b.citations ?? 0) - (a.citations ?? 0);
    }
    return (b.year ?? 0) - (a.year ?? 0);
  });

  return scored.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}

/* ───────── Shortlist Markdown Generator ───────── */

export function renderShortlistMarkdown(params: {
  subject: string;
  slug: string;
  date: string;
  module?: string;
  queries: string[];
  items: ResearchItem[];
}): string {
  const { subject, date, module: mod, queries, items } = params;
  const lines: string[] = [];

  lines.push(`# Danh sách tài liệu nghiên cứu: ${subject}`);
  lines.push("");
  lines.push(`- **Ngày thực hiện:** ${date}`);
  lines.push(`- **Module:** ${mod || "Toàn khóa học"}`);
  lines.push(`- **Truy vấn:** ${queries.map((q) => `\`${q}\``).join(", ")}`);
  lines.push(`- **Tổng số kết quả đã xếp hạng:** ${items.length}`);
  lines.push("");
  lines.push("## 1. Bảng tổng hợp (Shortlist)");
  lines.push("");
  lines.push("| Rank | Title | Kind | Year | Citations | Open Access | Score | Reasons | Link |");
  lines.push("|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---|:---|");

  items.forEach((it) => {
    const cleanTitle = it.title.replace(/\|/g, "-").replace(/\n+/g, " ");
    const yr = it.year ? String(it.year) : "-";
    const cit = typeof it.citations === "number" ? it.citations.toLocaleString() : "-";
    const oa = it.oaUrl || it.provider === "arxiv" ? "Yes" : "No";
    const sc = it.score ?? "-";
    const why = it.reasons ? it.reasons.slice(0, 2).join("; ") : "-";
    const link = it.url ? `[Link](${it.url})` : "-";
    lines.push(`| ${it.rank} | ${cleanTitle} | ${it.kind} | ${yr} | ${cit} | ${oa} | **${sc}** | ${why} | ${link} |`);
  });

  lines.push("");
  lines.push("## 2. Chi tiết và Lý do đánh giá");
  lines.push("");

  items.slice(0, 15).forEach((it) => {
    lines.push(`### ${it.rank}. ${it.title}`);
    lines.push(`- **Nguồn / Provider:** ${it.provider} (${it.kind})`);
    if (it.authors) lines.push(`- **Tác giả:** ${it.authors}`);
    lines.push(`- **Năm / Nơi công bố:** ${it.year || "N/A"} | ${it.venue || "N/A"}`);
    lines.push(
      `- **Trích dẫn:** ${typeof it.citations === "number" ? it.citations.toLocaleString() : "0"} | **Open Access:** ${it.oaUrl || it.provider === "arxiv" ? `[PDF/Link](${it.oaUrl || it.url})` : "Không"}`,
    );
    lines.push(`- **Điểm chất lượng:** ${it.score}/100`);
    if (it.reasons && it.reasons.length > 0) {
      lines.push(`- **Lý do đánh giá:**`);
      it.reasons.forEach((r) => lines.push(`  - ${r}`));
    }
    if (it.abstract) {
      const cleanAbs = it.abstract.slice(0, 450).replace(/\s+/g, " ").trim();
      lines.push(`- **Tóm tắt:** ${cleanAbs}${it.abstract.length > 450 ? "..." : ""}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

/* ───────── polaris_find Single Query Engine ───────── */

export async function findResearch(query: string, options: ResearchOptions = {}): Promise<ResearchItem[]> {
  const providers = options.providers ?? ["openalex", "arxiv", "semanticscholar", "crossref", "wikipedia", "youtube", "github"];
  const perProvider = options.limit ? Math.max(2, Math.ceil(options.limit / 2)) : 5;
  const rawResults: ResearchItem[] = [];

  const promises = providers.map(async (provider) => {
    try {
      switch (provider) {
        case "openalex":
          return await fetchOpenAlex(query, perProvider);
        case "arxiv":
          return await fetchArxiv(query, perProvider);
        case "semanticscholar":
          return await fetchSemanticScholar(query, perProvider);
        case "crossref":
          return await fetchCrossRef(query, perProvider);
        case "wikipedia": {
          const lang = options.lang || "vi";
          const res = await fetchWikipedia(query, lang, perProvider);
          if (res.length === 0 && lang !== "en") {
            const enRes = await fetchWikipedia(query, "en", perProvider);
            return enRes;
          }
          return res;
        }
        case "github":
          return await fetchGitHub(query, perProvider);
        case "youtube":
          return await fetchYouTube(query, perProvider);
        case "brave":
          return await fetchBrave(query, perProvider);
        default:
          return [];
      }
    } catch {
      return [];
    }
  });

  const gathered = await Promise.all(promises);
  gathered.forEach((list) => rawResults.push(...list));

  const deduped = deduplicateResearchItems(rawResults);
  const ranked = rankResearchItems(deduped, {
    queries: [query],
    year_from: options.year_from,
    lang: options.lang,
  });

  return ranked.slice(0, options.limit ?? 10);
}

/* ───────── polaris_research Multi-Query Orchestration ───────── */

export async function runResearch(
  subjectDir: string,
  params: {
    module?: string;
    queries: string[];
    providers?: ResearchProvider[];
    per_provider?: number;
    year_from?: number;
    auto_add?: number;
    lang?: string;
  },
): Promise<{
  shortlistPath: string;
  shortlistMarkdown: string;
  items: ResearchItem[];
  autoAdded: Source[];
  autoErrors: string[];
}> {
  const p = subjectPaths(subjectDir);
  await mkdir(p.researchDir, { recursive: true });
  await mkdir(p.cacheDir, { recursive: true });

  const providers = params.providers ?? ["openalex", "arxiv", "semanticscholar", "crossref", "wikipedia", "youtube", "github"];
  const perProvider = params.per_provider ?? 5;
  const allResults: ResearchItem[] = [];

  for (const query of params.queries) {
    const promises = providers.map(async (provider) => {
      const cacheKey = `${provider}_${hash(`${query}_${params.lang ?? ""}_${perProvider}`)}`;
      let items = await getResearchCache<ResearchItem[]>(p.cacheDir, cacheKey);

      if (!items) {
        try {
          switch (provider) {
            case "openalex":
              items = await fetchOpenAlex(query, perProvider);
              break;
            case "arxiv":
              items = await fetchArxiv(query, perProvider);
              break;
            case "semanticscholar":
              items = await fetchSemanticScholar(query, perProvider);
              break;
            case "crossref":
              items = await fetchCrossRef(query, perProvider);
              break;
            case "wikipedia": {
              const lang = params.lang || "vi";
              items = await fetchWikipedia(query, lang, perProvider);
              if (items.length === 0 && lang !== "en") {
                const enList = await fetchWikipedia(query, "en", perProvider);
                items = enList;
              }
              break;
            }
            case "github":
              items = await fetchGitHub(query, perProvider);
              break;
            case "youtube":
              items = await fetchYouTube(query, perProvider);
              break;
            case "brave":
              items = await fetchBrave(query, perProvider);
              break;
            default:
              items = [];
          }
          if (items && items.length > 0) {
            await setResearchCache(p.cacheDir, cacheKey, items, 86400000);
          }
        } catch {
          items = [];
        }
      }
      return items ?? [];
    });

    const results = await Promise.all(promises);
    results.forEach((r) => allResults.push(...r));
  }

  const deduped = deduplicateResearchItems(allResults);
  const brief = await readBrief(subjectDir);

  const ranked = rankResearchItems(deduped, {
    queries: params.queries,
    year_from: params.year_from,
    lang: params.lang,
  });

  const dateStr = todayIso();
  const slug = brief?.slug || slugify(params.module || params.queries[0] || "research");
  const shortlistFilename = `${dateStr}-${slug}.md`;
  const shortlistPath = join(p.researchDir, shortlistFilename);

  const md = renderShortlistMarkdown({
    subject: brief?.subject || slug,
    slug,
    date: dateStr,
    module: params.module,
    queries: params.queries,
    items: ranked,
  });

  await atomicWriteFile(shortlistPath, md);

  const autoAdded: Source[] = [];
  const autoErrors: string[] = [];

  if (params.auto_add && params.auto_add > 0) {
    const topItems = ranked.slice(0, params.auto_add);
    const existingSources = await readSources(subjectDir);

    const isMatchSourceOfTruth = (it: ResearchItem): boolean => {
      const sotList = brief?.sourcesOfTruth ?? [];
      const normUrl = normalizeUrl(it.url);
      const doi = normalizeDoi(it.doi);
      const ax = normalizeArxiv(it.arxiv, it.url);

      for (const sot of sotList) {
        if (sot.includes(normUrl) || normUrl.includes(normalizeUrl(sot))) return true;
        if (doi && sot.toLowerCase().includes(doi)) return true;
        if (ax && sot.includes(ax)) return true;
      }
      return false;
    };

    const nextId = (current: Source[], added: Source[]): string => {
      let max = 0;
      for (const s of [...current, ...added]) {
        const m = /^S(\d+)$/i.exec(s.id);
        if (m) {
          const n = parseInt(m[1]!, 10);
          if (n > max) max = n;
        }
      }
      return `S${max + 1}`;
    };

    for (const item of topItems) {
      // Check if already in sources
      const alreadyIn = existingSources.find(
        (s) =>
          (s.url && normalizeUrl(s.url) === normalizeUrl(item.url)) ||
          (item.doi && s.notes?.includes(item.doi)) ||
          (item.arxiv && s.url?.includes(item.arxiv)),
      );

      if (alreadyIn) continue;

      const sid = nextId(existingSources, autoAdded);
      const isTruth = isMatchSourceOfTruth(item);
      const label: SourceLabel = isTruth ? "course" : "extension";
      const qScore = Math.max(1, Math.min(5, Math.round((item.score ?? 50) / 20)));
      const qWhy = item.reasons?.slice(0, 3).join("; ") || "Ranked by Polaris research engine";

      const newSourceInput = {
        id: sid,
        kind: item.kind,
        title: item.title,
        author: item.authors,
        date: item.year ? `${item.year}-01-01` : undefined,
        url: item.url,
        label,
        quality: { score: qScore, why: qWhy },
        accessed: dateStr,
        notes: [
          item.venue ? `Venue: ${item.venue}` : undefined,
          item.doi ? `DOI: ${item.doi}` : undefined,
          item.arxiv ? `arXiv: ${item.arxiv}` : undefined,
          item.citations ? `Citations: ${item.citations}` : undefined,
        ]
          .filter(Boolean)
          .join(" | "),
      };

      try {
        const cap = await captureSource(
          sid,
          {
            kind: item.kind,
            url: item.oaUrl || item.url,
            title: item.title,
          },
          p.capturesDir,
          true,
        );

        const v = validateSource({
          ...newSourceInput,
          capture: cap.captureRelPath,
        });

        if (v.ok && v.value) {
          autoAdded.push(v.value);
        } else {
          autoErrors.push(`Failed validating auto-added source ${sid}: ${v.errors.join(", ")}`);
        }
      } catch (e) {
        autoErrors.push(`Failed to capture auto-added source ${item.title}: ${(e as Error).message}`);
      }
    }

    if (autoAdded.length > 0) {
      await writeJson(p.sourcesJson, [...existingSources, ...autoAdded]);
    }
  }

  return {
    shortlistPath,
    shortlistMarkdown: md,
    items: ranked,
    autoAdded,
    autoErrors,
  };
}
