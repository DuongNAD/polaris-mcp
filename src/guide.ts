import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PKG_ROOT } from "./util.js";

export const TOPICS = ["overview", "pipeline", "gates", "sources", "roadmap", "research", "schedule", "export", "tracking", "learner", "rules"] as const;
export type Topic = (typeof TOPICS)[number];

let sections: Map<string, string> | undefined;

async function loadSections(): Promise<Map<string, string>> {
  if (sections) return sections;
  sections = new Map();
  let md = "";
  try {
    md = await readFile(join(PKG_ROOT, "guide", "GUIDE.md"), "utf8");
  } catch {
    md = "## overview\nPolaris MCP builds evidence-based personal study courses.";
  }

  let key = "overview";
  let buf: string[] = [];

  const flush = () => {
    if (buf.join("").trim()) {
      sections!.set(key, buf.join("\n").trim());
    }
    buf = [];
  };

  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^##\s+([a-z0-9_-]+)/i.exec(line);
    if (m) {
      flush();
      key = m[1]!.toLowerCase();
      buf.push(line);
    } else if (!/^#\s/.test(line)) {
      buf.push(line);
    }
  }
  flush();

  return sections;
}

export async function guideText(topic?: string): Promise<string> {
  const s = await loadSections();
  if (!topic || topic === "overview") {
    const ov = s.get("overview") ?? "";
    const otherTopics = TOPICS.filter((t) => t !== "overview");
    return [
      ov,
      "",
      `Available guide topics: ${otherTopics.join(", ")}`,
      `Call polaris_guide { "topic": "<name>" } or run "node polaris.mjs guide <name>" to read details.`,
    ].join("\n");
  }

  const found = s.get(topic.toLowerCase());
  if (found) {
    return found;
  }

  return `No guide section for "${topic}". Available topics: ${TOPICS.join(", ")}`;
}
