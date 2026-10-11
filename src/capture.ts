import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { notifySmartDrive } from "./smartdrive.js";
import {
  assertSafeUrl,
  atomicWriteFile,
  fetchWithRetry,
  fetchWithTimeout,
  findExecutable,
  isUrlAllowedByRobots,
  readJson,
  runExecutable,
  subjectPaths,
  todayIso,
  writeJson,
} from "./util.js";

export const MAX_CAPTURE_BYTES = 400 * 1024; // 400 KB

export interface CapturedContent {
  id: string;
  kind: "local" | "web" | "paper" | "video" | "book" | "course" | "notebooklm" | "deeptutor";
  title: string;
  author?: string;
  date?: string;
  url?: string;
  oaUrl?: string;
  path?: string;
  text: string;
  preview: string;
  captureRelPath?: string;
  note?: string;
}

/** Extract DOI from a string, URL, or metadata text */
export function extractDoi(str?: string): string | undefined {
  if (!str) return undefined;
  const urlMatch = /(?:doi(?:\.org)?\/|doi:\s*)(10\.\d{4,9}\/[^\s"'<>#?]+)/i.exec(str) ||
    /\b(10\.\d{4,9}\/[^\s"'<>#?]+)/i.exec(str);
  if (urlMatch) {
    return urlMatch[1]!.replace(/[.,;)]+$/, "");
  }
  return undefined;
}

/** Check if HTTP response indicates a paywall, bot challenge wall, or rate-limit captcha */
export function isBotWallOrCaptcha(status: number, html?: string): boolean {
  if (status === 401 || status === 403 || status === 429) return true;
  if (!html) return false;

  const { title, text } = extractHtmlText(html);
  if (text.length >= 1500) {
    return false;
  }

  const titleLower = title.toLowerCase();
  const hasStrongTitle =
    titleLower.includes("just a moment") ||
    (titleLower.includes("attention required") && titleLower.includes("cloudflare")) ||
    titleLower.includes("access denied") ||
    titleLower.includes("are you a robot") ||
    titleLower.includes("verify you are human");

  if (hasStrongTitle) {
    return true;
  }

  const lower = html.toLowerCase();
  const hasStrongMarker =
    lower.includes("/cdn-cgi/challenge-platform/") ||
    lower.includes("cf-chl") ||
    lower.includes("cf_chl_opt") ||
    lower.includes("captcha-delivery.com") ||
    lower.includes("px-captcha") ||
    lower.includes("_incapsula_resource") ||
    lower.includes("request unsuccessful. incapsula");

  return hasStrongMarker;
}

/**
 * Look up an open-access copy via OpenAlex and (optionally) Unpaywall.
 * Never bypasses paywalls; queries legitimate open-access registries.
 */
export async function lookupOpenAccessCopy(params: {
  doi?: string;
  url?: string;
  title?: string;
}): Promise<{ oaUrl: string; provider: "openalex" | "unpaywall"; title?: string } | undefined> {
  const doi = params.doi || extractDoi(params.url);

  // 1. OpenAlex lookup (best_oa_location / open_access.oa_url)
  const openAlexBase = process.env.POLARIS_OPENALEX_URL || "https://api.openalex.org";
  if (doi) {
    try {
      const openAlexUrl = `${openAlexBase.replace(/\/+$/, "")}/works/https://doi.org/${doi}`;
      await assertSafeUrl(openAlexUrl);
      const res = await fetchWithRetry(openAlexUrl, {}, 15000);
      if (res.ok) {
        const json = (await res.json()) as {
          title?: string;
          best_oa_location?: { pdf_url?: string; landing_page_url?: string };
          open_access?: { is_oa?: boolean; oa_url?: string };
        };
        const oaUrl =
          json.best_oa_location?.pdf_url ||
          json.best_oa_location?.landing_page_url ||
          json.open_access?.oa_url;
        if (oaUrl) {
          return { oaUrl, provider: "openalex", title: json.title };
        }
      }
    } catch {
      // ignore OpenAlex error and fallback to Unpaywall
    }
  }

  // 2. Unpaywall lookup (if UNPAYWALL_EMAIL is set and DOI exists)
  const unpaywallEmail = process.env.UNPAYWALL_EMAIL;
  if (doi && unpaywallEmail) {
    try {
      const unpaywallBase = process.env.POLARIS_UNPAYWALL_URL || "https://api.unpaywall.org";
      const unpaywallUrl = `${unpaywallBase.replace(/\/+$/, "")}/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(unpaywallEmail)}`;
      await assertSafeUrl(unpaywallUrl);
      const res = await fetchWithRetry(unpaywallUrl, {}, 15000);
      if (res.ok) {
        const json = (await res.json()) as {
          title?: string;
          best_oa_location?: { url_for_pdf?: string; url?: string };
          oa_locations?: Array<{ url_for_pdf?: string; url?: string }>;
        };
        const oaUrl =
          json.best_oa_location?.url_for_pdf ||
          json.best_oa_location?.url ||
          json.oa_locations?.[0]?.url_for_pdf ||
          json.oa_locations?.[0]?.url;
        if (oaUrl) {
          return { oaUrl, provider: "unpaywall", title: json.title };
        }
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

export function applyCaptureCap(text: string): string {
  if (text.length <= MAX_CAPTURE_BYTES) return text;
  return text.slice(0, MAX_CAPTURE_BYTES) + "\n\n[... Truncated at 400 KB ...]\n";
}

/** Decode common HTML entities */
function decodeEntities(html: string): string {
  return html
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

/** Built-in zero-dependency HTML to readable Markdown text extractor */
export function extractHtmlText(html: string): { title: string; text: string } {
  // Extract <title>
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const rawTitle = titleMatch ? decodeEntities(titleMatch[1]!.trim()) : "Web Page";
  const title = rawTitle.replace(/\s+/g, " ");

  // Drop scripts, styles, svg, noscript, comments
  let clean = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "");

  // Drop navigation, headers, footers, asides
  clean = clean
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");

  // Prefer <article> or <main> if available
  const articleMatch = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(clean);
  const mainMatch = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(clean);
  const contentHtml = articleMatch ? articleMatch[1]! : mainMatch ? mainMatch[1]! : clean;

  // Convert headings
  let text = contentHtml
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n")
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, "\n\n#### $1\n\n");

  // Code blocks
  text = text.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => `\n\`\`\`\n${decodeEntities(code).trim()}\n\`\`\`\n`);
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${decodeEntities(code).trim()}\``);

  // Lists
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1");

  // Links
  text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const cleanInner = inner.replace(/<[^>]+>/g, "").trim();
    return cleanInner ? `[${cleanInner}](${href})` : "";
  });

  // Paragraphs & breaks
  text = text
    .replace(/<p[^>]*>/gi, "\n\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    .replace(/<div[^>]*>/gi, "\n")
    .replace(/<\/div>/gi, "\n");

  // Strong & em
  text = text
    .replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**")
    .replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode entities and collapse excess whitespace
  text = decodeEntities(text);
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, text };
}

/** Check if string is an arXiv identifier or URL */
export function parseArxivId(input: string): string | undefined {
  const clean = input.trim();
  const urlMatch = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i.exec(clean);
  if (urlMatch) return urlMatch[1];
  const directMatch = /^(\d{4}\.\d{4,5}(?:v\d+)?)$/.exec(clean);
  if (directMatch) return directMatch[1];
  return undefined;
}

/** Check if string is a YouTube URL */
export function parseYoutubeId(url: string): string | undefined {
  const m = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i.exec(url);
  return m ? m[1] : undefined;
}

/** Check if string is a Wikipedia URL */
export function parseWikipediaUrl(url: string): { lang: string; title: string } | undefined {
  const m = /https?:\/\/([a-z]{2,3})\.wikipedia\.org\/wiki\/([^#?]+)/i.exec(url);
  if (m && m[1] && m[2]) {
    return {
      lang: m[1].toLowerCase(),
      title: decodeURIComponent(m[2].replace(/_/g, " ")),
    };
  }
  return undefined;
}

/** Query export.arxiv.org Atom API and parse metadata */
export async function captureArxivMetadata(arxivId: string): Promise<{
  title: string;
  authors: string;
  date: string;
  summary: string;
  url: string;
  pdfUrl: string;
}> {
  const url = `http://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
  const res = await fetchWithRetry(url, {}, 20000);
  if (!res.ok) {
    throw new Error(`arXiv API responded with status ${res.status}: ${res.statusText}`);
  }
  const xml = await res.text();

  const entryMatch = /<entry>([\s\S]*?)<\/entry>/i.exec(xml);
  if (!entryMatch) {
    throw new Error(`arXiv ID "${arxivId}" not found or returned empty result`);
  }
  const entry = entryMatch[1]!;

  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(entry);
  const title = titleMatch ? decodeEntities(titleMatch[1]!.replace(/\s+/g, " ").trim()) : `arXiv ${arxivId}`;

  const authors: string[] = [];
  const authorRegex = /<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/gi;
  let am;
  while ((am = authorRegex.exec(entry))) {
    authors.push(decodeEntities(am[1]!.trim()));
  }

  const pubMatch = /<published>([\s\S]*?)<\/published>/i.exec(entry);
  const date = pubMatch ? pubMatch[1]!.slice(0, 10) : todayIso();

  const sumMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(entry);
  const summary = sumMatch ? decodeEntities(sumMatch[1]!.replace(/\s+/g, " ").trim()) : "";

  return {
    title,
    authors: authors.join(", "),
    date,
    summary,
    url: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
  };
}

/* ───────── PDF Full-Text Extraction via pdftotext / Python ───────── */

export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  const tempPdf = join(tmpdir(), `polaris_pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`);
  const tempTxt = join(tmpdir(), `polaris_txt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`);

  await writeFile(tempPdf, pdfBuffer);

  try {
    const pdftotextExe = findExecutable([
      "pdftotext",
      "pdftotext.exe",
      "C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe",
      "C:\\Program Files (x86)\\Git\\mingw64\\bin\\pdftotext.exe",
    ]);

    if (pdftotextExe) {
      const execRes = await runExecutable(pdftotextExe, ["-layout", tempPdf, tempTxt], { timeoutMs: 30000 });
      if (existsSync(tempTxt)) {
        const rawText = await readFile(tempTxt, "utf8");
        // pdftotext uses \x0c (formfeed) as page separator
        const pages = rawText.split("\x0c").map((p) => p.trim()).filter(Boolean);
        if (pages.length > 0) {
          return pages.map((p, idx) => `[p. ${idx + 1}]\n${p}`).join("\n\n");
        }
        return rawText.trim();
      }
    }

    // Python fallback with pypdf
    const pyExe = findExecutable(["py", "python", "python3"]);
    if (pyExe) {
      const pyScript = [
        "import sys",
        "try:",
        "    from pypdf import PdfReader",
        "    reader = PdfReader(sys.argv[1])",
        "    for idx, page in enumerate(reader.pages):",
        "        print(f'[p. {idx + 1}]\\n' + page.extract_text() + '\\n')",
        "except Exception as e:",
        "    sys.exit(1)",
      ].join("\n");
      const pyRes = await runExecutable(pyExe, ["-3.11", "-c", pyScript, tempPdf], { timeoutMs: 30000 }).catch(() =>
        runExecutable(pyExe, ["-c", pyScript, tempPdf], { timeoutMs: 30000 }),
      );
      if (pyRes.exitCode === 0 && pyRes.stdout.trim()) {
        return pyRes.stdout.trim();
      }
    }

    throw new Error("No working PDF extractor (pdftotext or python pypdf) available");
  } finally {
    try {
      if (existsSync(tempPdf)) await unlink(tempPdf);
      if (existsSync(tempTxt)) await unlink(tempTxt);
    } catch {
      // ignore temp cleanup error
    }
  }
}

/**
 * Shared helper to fetch and capture an open-access copy (PDF or HTML).
 * Enforces robots.txt, safe URL / SSRF guard, formats standard markdown,
 * and records both publisher URL and open-access URL.
 */
export async function captureOpenAccessCopy(params: {
  sourceId: string;
  originalUrl?: string;
  oaUrl: string;
  provider?: string;
  fallbackReason?: string;
  preferredTitle?: string;
  capturesDir: string;
  accessed: string;
  kind?: string;
}): Promise<CapturedContent> {
  // 1. Robots.txt check on OA URL
  const allowed = await isUrlAllowedByRobots(params.oaUrl);
  if (!allowed) {
    throw new Error(`Open-access fetch blocked by robots.txt rules for ${params.oaUrl}`);
  }

  // 2. SSRF guard on OA URL
  await assertSafeUrl(params.oaUrl);

  // 3. Fetch OA URL
  const oaRes = await fetchWithRetry(params.oaUrl, {}, 25000);
  if (!oaRes.ok) {
    throw new Error(`Open-access copy at ${params.oaUrl} failed with HTTP ${oaRes.status} ${oaRes.statusText}`);
  }

  // 4. Content negotiation: PDF vs HTML
  const contentType = (oaRes.headers.get("content-type") || "").toLowerCase();
  const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
  const isPdf = !isHtml && (params.oaUrl.toLowerCase().endsWith(".pdf") || contentType.includes("application/pdf"));

  let extractedTitle = params.preferredTitle;
  let extractedText = "";

  if (isPdf) {
    const arrBuf = await oaRes.arrayBuffer();
    extractedText = await extractPdfText(Buffer.from(arrBuf));
    if (!extractedTitle) {
      extractedTitle = params.oaUrl.split("/").pop()?.replace(/\.pdf$/i, "") || "Open Access Paper";
    }
  } else {
    const oaHtml = await oaRes.text();
    const parsed = extractHtmlText(oaHtml);
    extractedText = parsed.text;
    if (!extractedTitle) {
      extractedTitle = parsed.title;
    }
  }

  const finalTitle = params.preferredTitle || extractedTitle || params.originalUrl || params.oaUrl;
  const capped = applyCaptureCap(extractedText);
  const capRel = `captures/${params.sourceId}.md`;
  const capAbs = resolve(params.capturesDir, `${params.sourceId}.md`);

  const viaPart = params.provider && params.provider !== "source" ? ` via ${params.provider}` : "";
  const reasonPart = params.fallbackReason ? ` after publisher returned ${params.fallbackReason}` : "";
  const note = `Captured from open-access copy (${params.oaUrl})${viaPart}${reasonPart}. Never bypasses paywalls.`;

  const md = [
    `# ${finalTitle}`,
    `- Source ID: ${params.sourceId}`,
    `- Kind: ${params.kind || "paper"}`,
    `- URL: ${params.originalUrl || params.oaUrl}`,
    `- Open Access URL: ${params.oaUrl}`,
    `- Accessed: ${params.accessed}`,
    `- Note: ${note}`,
    `- Extracted by: Polaris MCP (${isPdf ? "pdftotext" : "html"})`,
    `---`,
    ``,
    capped,
  ].join("\n");

  await atomicWriteFile(capAbs, md);

  return {
    id: params.sourceId,
    kind: (params.kind as any) || "paper",
    title: finalTitle,
    url: params.originalUrl || params.oaUrl,
    oaUrl: params.oaUrl,
    note,
    text: capped,
    preview: capped.slice(0, 240) + (capped.length > 240 ? "..." : ""),
    captureRelPath: capRel,
  };
}

/* ───────── YouTube Subtitles / Transcript Extraction ───────── */

export function parseVttToTranscript(vttContent: string): string {
  const lines = vttContent.replace(/\r\n/g, "\n").split("\n");
  const timeRegex = /^(?:(\d{2}):)?(\d{2}):(\d{2})\.\d{3}\s+-->\s+(?:(\d{2}):)?(\d{2}):(\d{2})\.\d{3}/;

  const entries: { time: string; text: string }[] = [];
  let currentTime = "";
  let currentTextLines: string[] = [];

  const flush = () => {
    if (currentTime && currentTextLines.length > 0) {
      const raw = currentTextLines
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (raw) {
        const prev = entries[entries.length - 1];
        if (!prev || prev.text !== raw) {
          entries.push({ time: currentTime, text: raw });
        }
      }
    }
    currentTextLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("WEBVTT") ||
      trimmed.startsWith("NOTE") ||
      trimmed.startsWith("Kind:") ||
      trimmed.startsWith("Language:") ||
      trimmed.startsWith("STYLE")
    ) {
      continue;
    }
    const match = timeRegex.exec(trimmed);
    if (match) {
      flush();
      const h = match[1];
      const m = match[2];
      const s = match[3];
      if (h && parseInt(h, 10) > 0) {
        currentTime = `[${h}:${m}:${s}]`;
      } else {
        currentTime = `[${m}:${s}]`;
      }
    } else if (trimmed && !/^\d+$/.test(trimmed)) {
      currentTextLines.push(trimmed);
    }
  }
  flush();

  return entries.map((e) => `${e.time} ${e.text}`).join("\n");
}

export async function extractYoutubeTranscript(videoUrl: string): Promise<{ title?: string; transcript: string }> {
  await assertSafeUrl(videoUrl);

  const ytdlp = findExecutable([
    "yt-dlp",
    "yt-dlp.exe",
    "C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python311\\Scripts\\yt-dlp.exe",
  ]);

  if (!ytdlp) {
    // Try Python fallback youtube_transcript_api
    const pyExe = findExecutable(["py", "python", "python3"]);
    if (pyExe) {
      const vid = parseYoutubeId(videoUrl);
      if (vid) {
        const pyScript = [
          "import sys, json",
          "try:",
          "    from youtube_transcript_api import YouTubeTranscriptApi",
          "    vid = sys.argv[1]",
          "    tx = YouTubeTranscriptApi.get_transcript(vid, languages=['vi', 'en'])",
          "    for item in tx:",
          "        start = int(item['start'])",
          "        m, s = divmod(start, 60)",
          "        h, m = divmod(m, 60)",
          "        tag = f'[{h:02d}:{m:02d}:{s:02d}]' if h else f'[{m:02d}:{s:02d}]'",
          "        print(f\"{tag} {item['text']}\")",
          "except Exception as e:",
          "    sys.exit(1)",
        ].join("\n");
        const pyRes = await runExecutable(pyExe, ["-3.11", "-c", pyScript, vid], { timeoutMs: 25000 }).catch(() =>
          runExecutable(pyExe, ["-c", pyScript, vid], { timeoutMs: 25000 }),
        );
        if (pyRes.exitCode === 0 && pyRes.stdout.trim()) {
          return { transcript: pyRes.stdout.trim() };
        }
      }
    }
    throw new Error("yt-dlp executable not found in PATH or standard location");
  }

  const tempSubDir = join(tmpdir(), `polaris_yt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(tempSubDir, { recursive: true });

  try {
    const outTemplate = `${tempSubDir.replace(/\\/g, "/")}/%(id)s.%(ext)s`;
    const args = [
      "--write-auto-sub",
      "--write-sub",
      "--sub-lang",
      "en.*,en,vi.*,vi",
      "--skip-download",
      "--sub-format",
      "vtt",
      "-o",
      outTemplate,
      videoUrl,
    ];

    try {
      await runExecutable(ytdlp, args, { timeoutMs: 30000 });
    } catch {
      // Ignore non-zero exit code if subtitles were partially written
    }

    const files = existsSync(tempSubDir) ? readdirSync(tempSubDir) : [];
    const vttFiles = files.filter((f) => f.endsWith(".vtt"));

    // Prefer vi.vtt, then en.vtt, then first vtt
    const chosenFile =
      vttFiles.find((f) => f.includes(".vi.")) ||
      vttFiles.find((f) => f.includes(".en.")) ||
      vttFiles.find((f) => f.includes(".en-orig.")) ||
      vttFiles[0];

    if (!chosenFile) {
      throw new Error(`No subtitles found for YouTube video ${videoUrl}`);
    }

    const vttContent = await readFile(join(tempSubDir, chosenFile), "utf8");
    const transcript = parseVttToTranscript(vttContent);
    if (!transcript) {
      throw new Error(`Subtitle content was empty for ${videoUrl}`);
    }

    return { transcript };
  } finally {
    try {
      await rm(tempSubDir, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup error
    }
  }
}

/* ───────── Wikipedia Plain-Text Extraction ───────── */

export async function fetchWikipediaContent(lang: string, title: string): Promise<{ title: string; text: string }> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(title)}&format=json&utf8=1`;
  const res = await fetchWithRetry(url, {}, 20000);
  if (!res.ok) {
    throw new Error(`Wikipedia API HTTP ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as {
    query?: {
      pages?: Record<string, { title?: string; extract?: string }>;
    };
  };

  const pages = json.query?.pages ?? {};
  const firstPage = Object.values(pages)[0];
  if (!firstPage || !firstPage.extract) {
    throw new Error(`No extract found for Wikipedia article "${title}" (${lang})`);
  }

  return {
    title: firstPage.title || title,
    text: firstPage.extract.trim(),
  };
}

/* ───────── Main Capture Engine ───────── */

export async function captureSource(
  sourceId: string,
  input: {
    kind?: string;
    url?: string;
    oaUrl?: string;
    doi?: string;
    path?: string;
    title?: string;
  },
  capturesDir: string,
  full = true,
): Promise<CapturedContent> {
  const accessed = todayIso();
  const rawUrl = input.url?.trim();
  const rawOaUrl = input.oaUrl?.trim();
  const rawPath = input.path?.trim();

  if (rawUrl) {
    await assertSafeUrl(rawUrl);
  }
  if (rawOaUrl) {
    await assertSafeUrl(rawOaUrl);
  }
  if (rawPath && (rawPath.startsWith("file:") || rawPath.startsWith("http:") || rawPath.startsWith("https:"))) {
    await assertSafeUrl(rawPath);
  }

  // 1. YouTube Video
  const ytId = rawUrl ? parseYoutubeId(rawUrl) : undefined;
  if (ytId || input.kind === "video") {
    if (rawUrl) {
      const capRel = `captures/${sourceId}.md`;
      const capAbs = resolve(capturesDir, `${sourceId}.md`);
      let transcriptText = "";
      try {
        const { transcript } = await extractYoutubeTranscript(rawUrl);
        transcriptText = transcript;
      } catch (err) {
        transcriptText = `[Transcript extraction note: ${(err as Error).message}]`;
      }

      const capped = applyCaptureCap(transcriptText);
      const title = input.title || `YouTube Video (${ytId || "video"})`;
      const md = [
        `# ${title}`,
        `- Source ID: ${sourceId}`,
        `- Kind: video`,
        `- URL: ${rawUrl}`,
        `- Accessed: ${accessed}`,
        `- Extracted by: Polaris MCP (yt-dlp)`,
        `---`,
        ``,
        `## Transcript`,
        ``,
        capped,
      ].join("\n");

      await atomicWriteFile(capAbs, md);
      return {
        id: sourceId,
        kind: "video",
        title,
        url: rawUrl,
        text: capped,
        preview: capped.slice(0, 240) + (capped.length > 240 ? "..." : ""),
        captureRelPath: capRel,
      };
    }
  }

  // 2. arXiv Paper (Metadata + Full PDF Text via pdftotext)
  const arxivId = rawUrl ? parseArxivId(rawUrl) : rawPath ? parseArxivId(rawPath) : undefined;
  if (arxivId || (input.kind === "paper" && rawUrl?.includes("arxiv.org"))) {
    const aid = arxivId ?? (rawUrl ? parseArxivId(rawUrl) : undefined);
    if (aid) {
      const meta = await captureArxivMetadata(aid);
      let fullText = "";

      if (full) {
        try {
          const pdfRes = await fetchWithRetry(meta.pdfUrl, {}, 25000);
          if (pdfRes.ok) {
            const arrBuf = await pdfRes.arrayBuffer();
            const extracted = await extractPdfText(Buffer.from(arrBuf));
            if (extracted) {
              fullText = extracted;
            }
          }
        } catch {
          // PDF full text extraction failed, fall back to abstract
        }
      }

      const contentBody = fullText
        ? `## Full Text (pdftotext)\n\n${applyCaptureCap(fullText)}`
        : `## Abstract\n\n${meta.summary}`;

      const capRel = `captures/${sourceId}.md`;
      const capAbs = resolve(capturesDir, `${sourceId}.md`);
      const md = [
        `# ${meta.title}`,
        `- Source ID: ${sourceId}`,
        `- Kind: paper`,
        `- arXiv ID: ${aid}`,
        `- URL: ${meta.url}`,
        `- Authors: ${meta.authors}`,
        `- Published: ${meta.date}`,
        `- Accessed: ${accessed}`,
        `- Extracted by: Polaris MCP`,
        `---`,
        ``,
        contentBody,
      ].join("\n");

      await atomicWriteFile(capAbs, md);
      return {
        id: sourceId,
        kind: "paper",
        title: meta.title,
        author: meta.authors,
        date: meta.date,
        url: meta.url,
        text: fullText || meta.summary,
        preview: (meta.summary || fullText).slice(0, 240) + "...",
        captureRelPath: capRel,
      };
    }
  }

  // 3. Open-Access PDF direct URL
  if (rawUrl && rawUrl.toLowerCase().endsWith(".pdf")) {
    if (rawOaUrl) {
      return await captureOpenAccessCopy({
        sourceId,
        originalUrl: rawUrl,
        oaUrl: rawOaUrl,
        preferredTitle: input.title,
        capturesDir,
        accessed,
        kind: input.kind || "paper",
      });
    }

    const allowed = await isUrlAllowedByRobots(rawUrl);
    if (!allowed) {
      throw new Error(`PDF fetch blocked by robots.txt rules for ${rawUrl}`);
    }

    const capRel = `captures/${sourceId}.md`;
    const capAbs = resolve(capturesDir, `${sourceId}.md`);
    let extractedText = "";

    try {
      const doi = extractDoi(rawUrl) || input.doi;
      let res: Response;
      try {
        res = await fetchWithRetry(rawUrl, {}, 25000);
      } catch (err) {
        if (doi) {
          res = new Response(null, { status: 403, statusText: (err as Error).message });
        } else {
          throw err;
        }
      }

      if (res.ok) {
        const contentType = (res.headers.get("content-type") || "").toLowerCase();
        if (contentType.includes("text/html")) {
          const html = await res.text();
          if (isBotWallOrCaptcha(res.status, html)) {
            const oaMatch = await lookupOpenAccessCopy({ doi, url: rawUrl, title: input.title });
            if (oaMatch) {
              return await captureOpenAccessCopy({
                sourceId,
                originalUrl: rawUrl,
                oaUrl: oaMatch.oaUrl,
                provider: oaMatch.provider,
                fallbackReason: "HTML bot wall / captcha challenge",
                preferredTitle: input.title || oaMatch.title,
                capturesDir,
                accessed,
                kind: input.kind || "paper",
              });
            }
            extractedText = "[PDF capture failed: the URL answered a bot wall / captcha page and no open-access copy was found]";
          } else {
            // The ".pdf" URL answered an HTML page (e.g. a landing page): keep its text instead of running pdftotext.
            extractedText = extractHtmlText(html).text;
          }
        } else {
          const arrBuf = await res.arrayBuffer();
          extractedText = await extractPdfText(Buffer.from(arrBuf));
        }
      } else if (res.status === 401 || res.status === 403 || res.status === 429) {
        const oaMatch = await lookupOpenAccessCopy({ doi, url: rawUrl, title: input.title });
        if (oaMatch) {
          return await captureOpenAccessCopy({
            sourceId,
            originalUrl: rawUrl,
            oaUrl: oaMatch.oaUrl,
            provider: oaMatch.provider,
            fallbackReason: `HTTP ${res.status} ${res.statusText}`,
            preferredTitle: input.title || oaMatch.title,
            capturesDir,
            accessed,
            kind: input.kind || "paper",
          });
        }
        extractedText = `[PDF capture failed: HTTP ${res.status} ${res.statusText}]`;
      } else {
        extractedText = `[PDF capture failed: HTTP ${res.status} ${res.statusText}]`;
      }
    } catch (err) {
      extractedText = `[PDF capture failed: ${(err as Error).message}]`;
    }

    const title = input.title || rawUrl.split("/").pop()?.replace(/\.pdf$/i, "") || "Open Access PDF Document";
    const capped = applyCaptureCap(extractedText);
    const md = [
      `# ${title}`,
      `- Source ID: ${sourceId}`,
      `- Kind: paper`,
      `- URL: ${rawUrl}`,
      `- Accessed: ${accessed}`,
      `- Extracted by: Polaris MCP (pdftotext)`,
      `---`,
      ``,
      capped,
    ].join("\n");

    await atomicWriteFile(capAbs, md);
    return {
      id: sourceId,
      kind: "paper",
      title,
      url: rawUrl,
      text: capped,
      preview: capped.slice(0, 240) + (capped.length > 240 ? "..." : ""),
      captureRelPath: capRel,
    };
  }

  // 4. Wikipedia Article
  const wikiInfo = rawUrl ? parseWikipediaUrl(rawUrl) : undefined;
  if (wikiInfo) {
    const capRel = `captures/${sourceId}.md`;
    const capAbs = resolve(capturesDir, `${sourceId}.md`);
    const { title, text } = await fetchWikipediaContent(wikiInfo.lang, wikiInfo.title);
    const capped = applyCaptureCap(text);
    const md = [
      `# ${title}`,
      `- Source ID: ${sourceId}`,
      `- Kind: web`,
      `- Venue: Wikipedia (${wikiInfo.lang})`,
      `- URL: ${rawUrl}`,
      `- Accessed: ${accessed}`,
      `- Extracted by: Polaris MCP`,
      `---`,
      ``,
      capped,
    ].join("\n");

    await atomicWriteFile(capAbs, md);
    return {
      id: sourceId,
      kind: "web",
      title,
      url: rawUrl,
      text: capped,
      preview: capped.slice(0, 240) + (capped.length > 240 ? "..." : ""),
      captureRelPath: capRel,
    };
  }

  // 5. General Web Page (HTML) / Publisher Article
  if (rawUrl && (rawUrl.startsWith("http://") || rawUrl.startsWith("https://"))) {
    if (rawOaUrl) {
      return await captureOpenAccessCopy({
        sourceId,
        originalUrl: rawUrl,
        oaUrl: rawOaUrl,
        preferredTitle: input.title,
        capturesDir,
        accessed,
        kind: input.kind || "paper",
      });
    }

    const allowed = await isUrlAllowedByRobots(rawUrl);
    if (!allowed) {
      // Disallowed by robots.txt
      throw new Error(`Web page fetch blocked by robots.txt rules for ${rawUrl}`);
    }

    let res: Response;
    try {
      res = await fetchWithRetry(rawUrl, {}, 20000);
    } catch (err) {
      const doi = extractDoi(rawUrl) || input.doi;
      if (doi) {
        res = new Response(null, { status: 403, statusText: (err as Error).message });
      } else {
        throw err;
      }
    }

    let html = "";
    let needOaFallback = false;
    let fallbackReason = "";

    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        needOaFallback = true;
        fallbackReason = `HTTP ${res.status} ${res.statusText}`;
      } else {
        throw new Error(`Failed to fetch web page ${rawUrl}: HTTP ${res.status} ${res.statusText}`);
      }
    } else {
      html = await res.text();
      if (isBotWallOrCaptcha(res.status, html)) {
        needOaFallback = true;
        fallbackReason = "HTML bot wall / captcha challenge";
      }
    }

    if (needOaFallback) {
      const doi = extractDoi(rawUrl) || extractDoi(html) || input.doi;
      const oaResult = (doi || rawUrl)
        ? await lookupOpenAccessCopy({ doi, url: rawUrl, title: input.title })
        : undefined;

      if (!oaResult) {
        throw new Error(
          `Failed to fetch web page ${rawUrl}: publisher returned ${fallbackReason} and no open-access alternative was found via OpenAlex/Unpaywall`,
        );
      }

      return await captureOpenAccessCopy({
        sourceId,
        originalUrl: rawUrl,
        oaUrl: oaResult.oaUrl,
        provider: oaResult.provider,
        fallbackReason,
        preferredTitle: input.title || oaResult.title,
        capturesDir,
        accessed,
        kind: input.kind || "paper",
      });
    }

    const { title: extractedTitle, text: extractedText } = extractHtmlText(html);
    const finalTitle = input.title || extractedTitle || rawUrl;
    const capped = applyCaptureCap(extractedText);
    const capRel = `captures/${sourceId}.md`;
    const capAbs = resolve(capturesDir, `${sourceId}.md`);
    const md = [
      `# ${finalTitle}`,
      `- Source ID: ${sourceId}`,
      `- Kind: web`,
      `- URL: ${rawUrl}`,
      `- Accessed: ${accessed}`,
      `- Extracted by: Polaris MCP`,
      `---`,
      ``,
      capped,
    ].join("\n");

    await atomicWriteFile(capAbs, md);
    return {
      id: sourceId,
      kind: "web",
      title: finalTitle,
      url: rawUrl,
      text: capped,
      preview: capped.slice(0, 240) + (capped.length > 240 ? "..." : ""),
      captureRelPath: capRel,
    };
  }

  // Standalone open-access URL when rawUrl is omitted
  if (!rawUrl && rawOaUrl && (rawOaUrl.startsWith("http://") || rawOaUrl.startsWith("https://"))) {
    return await captureOpenAccessCopy({
      sourceId,
      originalUrl: rawOaUrl,
      oaUrl: rawOaUrl,
      preferredTitle: input.title,
      capturesDir,
      accessed,
      kind: input.kind || "paper",
    });
  }

  // 6. Local file
  if (rawPath) {
    const absPath = resolve(rawPath);
    if (!existsSync(absPath)) {
      throw new Error(`Local file does not exist: ${rawPath}`);
    }
    const content = await readFile(absPath, "utf8").catch(() => "");
    const lines = content.split("\n");
    const preview = lines.slice(0, 6).join("\n").slice(0, 240);
    return {
      id: sourceId,
      kind: "local",
      title: input.title || rawPath.split(/[\\/]/).pop() || "Local File",
      path: rawPath,
      text: content,
      preview: preview || `Local file (${lines.length} lines)`,
    };
  }

  return {
    id: sourceId,
    kind: "local",
    title: input.title || "Manual Source",
    text: "",
    preview: input.title || "Manual Source",
  };
}

/* ───────── polaris_capture Tool Handler ───────── */

export async function captureSources(
  subjectDir: string,
  ids?: string[],
  full = true,
): Promise<{
  captured: Array<{ id: string; title: string; preview: string }>;
  errors: string[];
}> {
  const p = subjectPaths(subjectDir);
  await mkdir(p.capturesDir, { recursive: true });

  const allSources = (await readJson<Array<Record<string, unknown>>>(p.sourcesJson)) ?? [];
  const targetSources = ids && ids.length > 0
    ? allSources.filter((s) => ids.includes(String(s.id)))
    : allSources;

  const captured: Array<{ id: string; title: string; preview: string }> = [];
  const errors: string[] = [];

  for (const s of targetSources) {
    const sid = String(s.id);
    try {
      const res = await captureSource(
        sid,
        {
          kind: typeof s.kind === "string" ? s.kind : undefined,
          url: typeof s.url === "string" ? s.url : undefined,
          oaUrl: typeof s.oaUrl === "string" ? s.oaUrl : undefined,
          doi: typeof s.doi === "string" ? s.doi : undefined,
          path: typeof s.path === "string" ? s.path : undefined,
          title: typeof s.title === "string" ? s.title : undefined,
        },
        p.capturesDir,
        full,
      );

      if (res.captureRelPath) {
        s.capture = res.captureRelPath;
      }
      if (res.oaUrl) {
        s.oaUrl = res.oaUrl;
      }
      if (res.note) {
        s.notes = s.notes ? `${s.notes} | ${res.note}` : res.note;
      }
      if (res.title && (!s.title || s.title === "Web Page" || s.title === "Local File")) {
        s.title = res.title;
      }
      captured.push({ id: sid, title: String(s.title || res.title), preview: res.preview });
    } catch (e) {
      errors.push(`Failed to capture source ${sid} ("${s.title ?? s.url}"): ${(e as Error).message}`);
    }
  }

  if (captured.length > 0) {
    await writeJson(p.sourcesJson, allSources);
    notifySmartDrive(p.polarisDir);
  }

  return { captured, errors };
}
