import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { captureSource } from "./capture.js";
import { checkQualityGates, type CheckReport } from "./check.js";
import { renderRoadmapMarkdown } from "./render.js";
import {
  LearnerProfileSchema,
  validateBrief,
  validateFact,
  validateProfile,
  validateRoadmap,
  validateSource,
  type Brief,
  type Fact,
  type LearnerProfile,
  type Roadmap,
  type Source,
} from "./schema.js";
import { atomicWriteFile, profilePath, readJson, slugify, subjectPaths, todayIso, writeJson } from "./util.js";

/* ───────── Default Learner Profile ───────── */

export function defaultLearnerProfile(): LearnerProfile {
  return {
    lang: "vi",
    method: {
      summary: "Theory -> memory anchors -> paper notebook notes -> practice easy-to-hard -> recall walk; predict-then-run for code.",
      theoryFirst: true,
      memoryAnchors: ["palace", "anchors", "analogy", "mnemonic"],
      notebookPages: true,
      predictThenRun: true,
      errorLog: "Sổ lỗi",
      sessionTypes: [
        { name: "30min", minutes: 30, structure: "5 review + 25 one small task / warmup tier" },
        { name: "60min", minutes: 60, structure: "5 review + 10 video/docs + 35 practice + 7 self-check/error log + 3 next step" },
        { name: "90min", minutes: 90, structure: "Lab / deep practice session" },
      ],
      spacedReviewDays: [1, 3, 7, 16, 35],
    },
    taste: {
      slideStyle: "Apple-keynote",
      noEmoji: true,
      noNeon: true,
    },
    commitments: [],
  };
}

export async function getProfile(hub?: string): Promise<LearnerProfile> {
  const p = profilePath(hub);
  const loaded = await readJson<unknown>(p);
  if (!loaded) {
    const def = defaultLearnerProfile();
    await writeJson(p, def);
    return def;
  }
  const v = validateProfile(loaded);
  return v.ok ? v.value! : defaultLearnerProfile();
}

export async function updateProfile(patch: Record<string, unknown>, hub?: string): Promise<LearnerProfile> {
  const current = await getProfile(hub);
  const merged = {
    ...current,
    ...patch,
    method: patch.method && typeof patch.method === "object"
      ? { ...current.method, ...(patch.method as Record<string, unknown>) }
      : current.method,
    taste: patch.taste && typeof patch.taste === "object"
      ? { ...current.taste, ...(patch.taste as Record<string, unknown>) }
      : current.taste,
  };
  const v = validateProfile(merged);
  if (!v.ok) {
    throw new Error(`Invalid profile update:\n${v.errors.map((e) => `  - ${e}`).join("\n")}`);
  }
  const p = profilePath(hub);
  await writeJson(p, v.value);
  return v.value!;
}

/* ───────── Subject & Brief ───────── */

export async function initSubject(
  subjectDir: string,
  rawBrief: unknown,
): Promise<{ brief: Brief; paths: ReturnType<typeof subjectPaths>; issues: string[] }> {
  const p = subjectPaths(subjectDir);
  await mkdir(p.polarisDir, { recursive: true });
  await mkdir(p.capturesDir, { recursive: true });
  await mkdir(p.researchDir, { recursive: true });
  await mkdir(p.cacheDir, { recursive: true });

  // Create or update .gitignore inside polaris/
  if (!existsSync(p.gitignore)) {
    await atomicWriteFile(p.gitignore, "captures/\n.cache/\n");
  } else {
    const gitignoreContent = await readFile(p.gitignore, "utf8").catch(() => "");
    if (!gitignoreContent.includes(".cache/")) {
      await atomicWriteFile(p.gitignore, gitignoreContent.trim() + "\n.cache/\n");
    }
  }

  // Parse brief
  let briefObj = rawBrief;
  if (typeof rawBrief === "string") {
    try {
      briefObj = JSON.parse(rawBrief.replace(/^\uFEFF/, ""));
    } catch (e) {
      throw new Error(`brief is a string but not valid JSON: ${(e as Error).message}`);
    }
  }

  // Normalize outcomes with IDs if missing
  if (typeof briefObj === "object" && briefObj !== null && Array.isArray((briefObj as { outcomes?: unknown[] }).outcomes)) {
    const bo = briefObj as { slug?: string; subject?: string; outcomes: Array<Record<string, unknown>> };
    bo.slug = bo.slug || slugify(bo.subject || "subject");
    bo.outcomes.forEach((out, i) => {
      out.id = out.id || `O${i + 1}`;
    });
  }

  const v = validateBrief(briefObj);
  if (!v.ok || !v.value) {
    throw new Error(`Invalid brief:\n${v.errors.map((e) => `  - ${e}`).join("\n")}`);
  }

  const brief = v.value;
  await writeJson(p.briefJson, brief);

  // Initialize sources.json and facts.json if they don't exist
  if (!existsSync(p.sourcesJson)) {
    await writeJson(p.sourcesJson, []);
  }
  if (!existsSync(p.factsJson)) {
    await writeJson(p.factsJson, []);
  }

  const check = checkQualityGates({ brief });
  const issues = [...check.errors.map((e) => `ERROR (${e.location}): ${e.message}`), ...check.warnings.map((w) => `WARN (${w.location}): ${w.message}`)];

  return { brief, paths: p, issues };
}

/* ───────── Sources ───────── */

export async function readSources(subjectDir: string): Promise<Source[]> {
  const p = subjectPaths(subjectDir);
  return (await readJson<Source[]>(p.sourcesJson)) ?? [];
}

function nextSourceId(existing: Source[]): string {
  let max = 0;
  for (const s of existing) {
    const m = /^S(\d+)$/i.exec(s.id);
    if (m) {
      const n = parseInt(m[1]!, 10);
      if (n > max) max = n;
    }
  }
  return `S${max + 1}`;
}

export async function addSources(
  subjectDir: string,
  rawSources: unknown[],
): Promise<{ added: Source[]; existing: Source[]; previews: string[]; errors: string[] }> {
  const p = subjectPaths(subjectDir);
  await mkdir(p.capturesDir, { recursive: true });
  const current = await readSources(subjectDir);

  const added: Source[] = [];
  const existingMatches: Source[] = [];
  const previews: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rawSources.length; i++) {
    const raw = rawSources[i];
    if (typeof raw !== "object" || raw === null) {
      errors.push(`sources[${i}]: Invalid source input (not an object)`);
      continue;
    }
    const item = { ...(raw as Record<string, unknown>) };

    // De-duplication check: URL or Path match
    const url = typeof item.url === "string" ? item.url.trim() : undefined;
    const path = typeof item.path === "string" ? resolve(item.path) : undefined;
    const found = current.find((s) => (url && s.url && s.url.trim() === url) || (path && s.path && resolve(s.path) === path));

    if (found) {
      existingMatches.push(found);
      previews.push(`Source ${found.id} already exists: "${found.title}"`);
      continue;
    }

    const sId = (typeof item.id === "string" && item.id.trim()) ? item.id.trim() : nextSourceId([...current, ...added]);
    item.id = sId;
    item.accessed = item.accessed || todayIso();
    item.label = item.label || "course";
    if (!item.quality) {
      item.quality = { score: 4, why: "Verified source" };
    }

    try {
      const captured = await captureSource(sId, {
        kind: typeof item.kind === "string" ? item.kind : undefined,
        url,
        path: typeof item.path === "string" ? item.path : undefined,
        title: typeof item.title === "string" ? item.title : undefined,
      }, p.capturesDir);

      item.title = item.title || captured.title;
      item.kind = item.kind || captured.kind;
      if (captured.author) item.author = item.author || captured.author;
      if (captured.date) item.date = item.date || captured.date;
      if (captured.captureRelPath) item.capture = captured.captureRelPath;

      const v = validateSource(item);
      if (!v.ok || !v.value) {
        errors.push(`Source ${sId} invalid:\n${v.errors.map((e) => `  - ${e}`).join("\n")}`);
        continue;
      }

      added.push(v.value);
      previews.push(`Added ${v.value.id}: "${v.value.title}" [${v.value.label}] (${captured.preview})`);
    } catch (e) {
      errors.push(`Failed to capture source "${item.title || url || path || sId}": ${(e as Error).message}`);
    }
  }

  if (added.length > 0) {
    const updated = [...current, ...added];
    await writeJson(p.sourcesJson, updated);
  }

  return { added, existing: existingMatches, previews, errors };
}

export async function listSources(
  subjectDir: string,
  filter?: { kind?: string; label?: string; q?: string },
): Promise<Source[]> {
  const all = await readSources(subjectDir);
  return all.filter((s) => {
    if (filter?.kind && s.kind !== filter.kind) return false;
    if (filter?.label && s.label !== filter.label) return false;
    if (filter?.q) {
      const q = filter.q.toLowerCase();
      const match = s.title.toLowerCase().includes(q) || (s.author ?? "").toLowerCase().includes(q) || (s.notes ?? "").toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });
}

export async function updateSources(
  subjectDir: string,
  updates: Array<{ id: string; set: Partial<Source> }>,
): Promise<{ updated: Source[]; errors: string[] }> {
  const p = subjectPaths(subjectDir);
  const all = await readSources(subjectDir);
  const updatedList: Source[] = [];
  const errors: string[] = [];

  for (const u of updates) {
    const idx = all.findIndex((s) => s.id === u.id);
    if (idx < 0) {
      errors.push(`Source "${u.id}" not found`);
      continue;
    }
    const merged = { ...all[idx], ...u.set };
    const v = validateSource(merged);
    if (!v.ok || !v.value) {
      errors.push(`Update to ${u.id} failed:\n${v.errors.join("\n")}`);
      continue;
    }
    all[idx] = v.value;
    updatedList.push(v.value);
  }

  if (updatedList.length > 0) {
    await writeJson(p.sourcesJson, all);
  }

  return { updated: updatedList, errors };
}

/* ───────── Facts ───────── */

export async function readFacts(subjectDir: string): Promise<Fact[]> {
  const p = subjectPaths(subjectDir);
  return (await readJson<Fact[]>(p.factsJson)) ?? [];
}

function nextFactId(existing: Fact[]): string {
  let max = 0;
  for (const f of existing) {
    const m = /^F(\d+)$/i.exec(f.id);
    if (m) {
      const n = parseInt(m[1]!, 10);
      if (n > max) max = n;
    }
  }
  return `F${max + 1}`;
}

export async function addFacts(
  subjectDir: string,
  rawFacts: unknown[],
): Promise<{ added: Fact[]; errors: string[] }> {
  const p = subjectPaths(subjectDir);
  const current = await readFacts(subjectDir);
  const sources = await readSources(subjectDir);
  const sourceMap = new Map<string, Source>();
  sources.forEach((s) => sourceMap.set(s.id, s));

  const added: Fact[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rawFacts.length; i++) {
    const raw = rawFacts[i];
    if (typeof raw !== "object" || raw === null) {
      errors.push(`facts[${i}]: Invalid fact input (not an object)`);
      continue;
    }
    const item = { ...(raw as Record<string, unknown>) };
    const fId = (typeof item.id === "string" && item.id.trim()) ? item.id.trim() : nextFactId([...current, ...added]);
    item.id = fId;

    if (!item.label && typeof item.source === "string") {
      const src = sourceMap.get(item.source);
      if (src) item.label = src.label;
    }

    const v = validateFact(item);
    if (!v.ok || !v.value) {
      errors.push(`Fact ${fId} invalid:\n${v.errors.map((e) => `  - ${e}`).join("\n")}`);
      continue;
    }

    added.push(v.value);
  }

  if (added.length > 0) {
    const updated = [...current, ...added];
    await writeJson(p.factsJson, updated);
  }

  return { added, errors };
}

export async function listFacts(
  subjectDir: string,
  filter?: { query?: string; module?: string; source?: string },
): Promise<Fact[]> {
  const all = await readFacts(subjectDir);
  return all.filter((f) => {
    if (filter?.source && f.source !== filter.source) return false;
    if (filter?.module && !f.modules.includes(filter.module)) return false;
    if (filter?.query) {
      const q = filter.query.toLowerCase();
      if (!f.claim.toLowerCase().includes(q) && !f.locator.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

/* ───────── Roadmap ───────── */

export async function readBrief(subjectDir: string): Promise<Brief | undefined> {
  const p = subjectPaths(subjectDir);
  const raw = await readJson<unknown>(p.briefJson);
  if (!raw) return undefined;
  const v = validateBrief(raw);
  return v.ok ? v.value : undefined;
}

export async function readRoadmap(subjectDir: string): Promise<Roadmap | undefined> {
  const p = subjectPaths(subjectDir);
  const raw = await readJson<unknown>(p.roadmapJson);
  if (!raw) return undefined;
  const v = validateRoadmap(raw);
  return v.ok ? v.value : undefined;
}

export async function saveRoadmap(
  subjectDir: string,
  rawRoadmap: unknown,
): Promise<{ roadmap?: Roadmap; checkReport: CheckReport; renderedPath: string; errors: string[] }> {
  const p = subjectPaths(subjectDir);
  let roadmapObj = rawRoadmap;
  if (typeof rawRoadmap === "string") {
    try {
      roadmapObj = JSON.parse(rawRoadmap.replace(/^\uFEFF/, ""));
    } catch (e) {
      throw new Error(`roadmap is a string but not valid JSON: ${(e as Error).message}`);
    }
  }

  const v = validateRoadmap(roadmapObj);
  if (!v.ok || !v.value) {
    return {
      checkReport: {
        ok: false,
        errors: v.errors.map((e) => ({ category: "roadmap", location: "roadmap.json", message: e, fix: "Fix schema errors", level: "error" })),
        warnings: [],
        summary: `Roadmap JSON schema validation failed with ${v.errors.length} error(s).`,
        stats: { briefOutcomes: 0, sourcesCount: 0, factsCount: 0, modulesCount: 0, totalHours: 0 },
      },
      renderedPath: p.defaultRoadmapMd,
      errors: v.errors,
    };
  }

  const roadmap = v.value;
  const brief = await readBrief(subjectDir);
  const sources = await readSources(subjectDir);
  const facts = await readFacts(subjectDir);

  const checkReport = checkQualityGates({ brief, sources, facts, roadmap });

  // Save roadmap.json
  await writeJson(p.roadmapJson, roadmap);

  // Render ROADMAP.md
  const targetMdPath = brief?.roadmapPath ? resolve(p.dir, brief.roadmapPath) : p.defaultRoadmapMd;
  const relativePath = targetMdPath.replace(/\\/g, "/").replace(p.dir.replace(/\\/g, "/") + "/", "");
  const md = renderRoadmapMarkdown({ roadmap, brief, sources, facts, relativePath });
  await atomicWriteFile(targetMdPath, md);

  return {
    roadmap,
    checkReport,
    renderedPath: targetMdPath,
    errors: checkReport.errors.map((e) => `ERROR (${e.location}): ${e.message} [Fix: ${e.fix}]`),
  };
}
