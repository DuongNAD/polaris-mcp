import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { atomicWriteFile, fetchWithTimeout, todayIso } from "./util.js";

export interface CapturedContent {
  id: string;
  kind: "local" | "web" | "paper";
  title: string;
  author?: string;
  date?: string;
  url?: string;
  path?: string;
  text: string;
  preview: string;
  captureRelPath?: string;
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

/** Query export.arxiv.org Atom API and parse metadata */
export async function captureArxiv(arxivId: string): Promise<{
  title: string;
  authors: string;
  date: string;
  summary: string;
  url: string;
}> {
  const url = `http://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
  const res = await fetchWithTimeout(url, {}, 20000);
  if (!res.ok) {
    throw new Error(`arXiv API responded with status ${res.status}: ${res.statusText}`);
  }
  const xml = await res.text();

  // Extract <entry>
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
  };
}

/** Capture source content and save capture file if applicable */
export async function captureSource(
  sourceId: string,
  input: {
    kind?: string;
    url?: string;
    path?: string;
    title?: string;
  },
  capturesDir: string,
): Promise<CapturedContent> {
  const accessed = todayIso();
  const arxivId = input.url ? parseArxivId(input.url) : input.path ? parseArxivId(input.path) : undefined;

  // 1. arXiv paper
  if (arxivId || input.kind === "paper") {
    const aid = arxivId ?? (input.url ? parseArxivId(input.url) : undefined);
    if (aid) {
      const data = await captureArxiv(aid);
      const capRel = `captures/${sourceId}.md`;
      const capAbs = resolve(capturesDir, `${sourceId}.md`);
      const md = [
        `# ${data.title}`,
        `- Source ID: ${sourceId}`,
        `- arXiv ID: ${aid}`,
        `- URL: ${data.url}`,
        `- Authors: ${data.authors}`,
        `- Published: ${data.date}`,
        `- Accessed: ${accessed}`,
        `- Extracted by: Polaris MCP`,
        `---`,
        ``,
        `## Abstract`,
        ``,
        data.summary,
      ].join("\n");
      await atomicWriteFile(capAbs, md);
      return {
        id: sourceId,
        kind: "paper",
        title: data.title,
        author: data.authors,
        date: data.date,
        url: data.url,
        text: data.summary,
        preview: data.summary.slice(0, 240) + (data.summary.length > 240 ? "..." : ""),
        captureRelPath: capRel,
      };
    }
  }

  // 2. Web page
  if (input.url && (input.url.startsWith("http://") || input.url.startsWith("https://"))) {
    const res = await fetchWithTimeout(input.url, {}, 20000);
    if (!res.ok) {
      throw new Error(`Failed to fetch web page ${input.url}: HTTP ${res.status} ${res.statusText}`);
    }
    const html = await res.text();
    const { title: extractedTitle, text: extractedText } = extractHtmlText(html);
    const finalTitle = input.title || extractedTitle || input.url;
    const capRel = `captures/${sourceId}.md`;
    const capAbs = resolve(capturesDir, `${sourceId}.md`);
    const md = [
      `# ${finalTitle}`,
      `- Source ID: ${sourceId}`,
      `- URL: ${input.url}`,
      `- Accessed: ${accessed}`,
      `- Extracted by: Polaris MCP`,
      `---`,
      ``,
      extractedText,
    ].join("\n");
    await atomicWriteFile(capAbs, md);
    return {
      id: sourceId,
      kind: "web",
      title: finalTitle,
      url: input.url,
      text: extractedText,
      preview: extractedText.slice(0, 240) + (extractedText.length > 240 ? "..." : ""),
      captureRelPath: capRel,
    };
  }

  // 3. Local file
  if (input.path) {
    const absPath = resolve(input.path);
    if (!existsSync(absPath)) {
      throw new Error(`Local file does not exist: ${input.path}`);
    }
    const content = await readFile(absPath, "utf8").catch(() => "");
    const lines = content.split("\n");
    const preview = lines.slice(0, 6).join("\n").slice(0, 240);
    return {
      id: sourceId,
      kind: "local",
      title: input.title || input.path.split(/[\\/]/).pop() || "Local File",
      path: input.path,
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
