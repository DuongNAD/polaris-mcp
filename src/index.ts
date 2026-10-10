/**
 * Polaris MCP: MCP server (stdio) and CLI for evidence-based study course creation.
 *
 *   node dist/polaris.mjs                 -> MCP server on stdio
 *   node dist/polaris.mjs check <dir>     -> CLI quality gate check
 *   node dist/polaris.mjs render <dir>    -> CLI render ROADMAP.md
 *   node dist/polaris.mjs guide [topic]   -> CLI guide viewer
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { captureSources } from "./capture.js";
import { checkQualityGates } from "./check.js";
import { exportCourse } from "./export.js";
import { guideText, TOPICS } from "./guide.js";
import { renderRoadmapMarkdown } from "./render.js";
import {
  findResearch,
  RESEARCH_PROVIDERS,
  ResearchProvider,
  runResearch,
} from "./research.js";
import { buildSchedule } from "./schedule.js";
import {
  addFacts,
  addSources,
  getProfile,
  initSubject,
  listFacts,
  listSources,
  readBrief,
  readFacts,
  readRoadmap,
  readSources,
  saveRoadmap,
  updateProfile,
  updateSources,
} from "./store.js";
import { syncTasks } from "./tasks.js";
import {
  addErrorLogEntry,
  getDueReviews,
  markLessonDone,
} from "./tracking.js";
import { syncProgress } from "./progress.js";
import { getTodayPlan } from "./today.js";
import { errMsg, subjectPaths, VERSION } from "./util.js";

export * from "./schema.js";
export * from "./store.js";
export * from "./capture.js";
export * from "./check.js";
export * from "./render.js";
export * from "./guide.js";
export * from "./research.js";
export * from "./schedule.js";
export * from "./export.js";
export * from "./tasks.js";
export * from "./tracking.js";
export * from "./progress.js";
export * from "./today.js";
export * from "./smartdrive.js";
export * from "./util.js";

type Content = { type: "text"; text: string };
type ToolResult = { content: Content[]; isError?: boolean };

const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

async function safe(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    return text(errMsg(e), true);
  }
}

const INSTRUCTIONS = `Polaris MCP builds evidence-based personal study courses for self-learners from brief to Aurora Slides course.

Workflow:
1. polaris_guide (topics: "overview", "pipeline", "gates", "sources", "roadmap", "research", "schedule", "export", "tracking", "progress", "aurora", "learner", "rules").
2. polaris_profile { action: "get" } to read learner methods, slots, and blackouts.
3. polaris_start { subject_dir, brief } to initialize subject brief and polaris folder.
4. Research & Discovery:
   - polaris_find { query, providers?, limit?, year_from?, lang? } to discover materials across keyless providers.
   - polaris_research { subject_dir, queries, providers?, auto_add? } to run multi-query search, generate tracked shortlist in polaris/research/, and optionally auto-add top items.
   - polaris_source_add { subject_dir, sources } to register sources with automatic capture.
   - polaris_capture { subject_dir, ids?, full? } to capture full-text (PDF via pdftotext with page markers, YouTube transcripts via yt-dlp with timestamps, web/Wikipedia text).
5. polaris_fact_add { subject_dir, facts } to record discrete factual claims with locators.
6. polaris_roadmap_save { subject_dir, roadmap } to validate quality gates and render ROADMAP.md in Vietnamese.
7. polaris_check { subject_dir } to verify that all quality gates pass.
8. polaris_schedule { subject_dir, start?, interleave_every? } to deterministically fit module hours into learner slots minus blackouts and P0 deadlines, writing schedule.json and ROADMAP.md section 3.2.
9. polaris_export_course { subject_dir, course_dir? } to write Aurora course.json and lesson outline skeletons in polaris/lessons/<dir>.outline.md.
10. polaris_tasks_sync { subject_dir } to append scheduled lesson and checkpoint tasks to TASKS.md under ## Polaris.
11. Tracking & Spaced Repetition:
    - polaris_progress_sync { subject_dir, course_dir?, file? } to ingest Aurora progress events into Sổ lỗi and schedule spaced reviews.
    - polaris_errorlog_add { subject_dir, entry } to log runtime prediction gaps in polaris/errorlog.md and schedule D+1, D+3, D+7, D+16, D+35 reviews.
    - polaris_lesson_done { subject_dir, lesson_dir, score? } to record completion and schedule spaced reviews.
    - polaris_review_due { subject_dir, date? } to query due reviews.
    - polaris_today { subject_dir, date?, minutes?, write? } to generate 60m/30m session plan & dynamic goal for the learning hub.

Rules:
- Evidence first: every factual bullet points to facts; every fact points to a source + locator (page [p. N], timestamp [mm:ss], section, lines).
- Labels: [Khóa học] (learner source of truth), [Mở rộng] (extensions), (chưa xác minh) (unverified). Numbers and dates must be cross-checked or marked unverified.
- Learner fit: learner-facing text in the learner's language (Vietnamese by default with correct diacritics); no emoji; no overclaims.
- Review gate: show top research candidates with evaluation reasons and wait for approval unless auto_add is explicitly specified.
- Do not write solution code for assignments; adhere to AGENTS.md rules.
- Never scan D: recursively; open files directly or use smart-drive MCP.

Done when:
polaris_check reports 0 errors, ROADMAP.md is rendered with all 10 standard sections, schedule and course.json are generated, and tasks are synced.`;

async function startMcp(): Promise<void> {
  const server = new McpServer({ name: "polaris", version: VERSION }, { instructions: INSTRUCTIONS });

  /* 1. polaris_guide */
  server.registerTool(
    "polaris_guide",
    {
      title: "Polaris course creation guide",
      description:
        "READ FIRST. How to build evidence-based courses: pipeline, quality gates, source policy, roadmap format, research engine, learner preferences, and rules. No arguments = overview.",
      inputSchema: {
        topic: z.enum(TOPICS).optional().describe(`One of: ${TOPICS.join(" | ")}`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ topic }) => safe(async () => text(await guideText(topic))),
  );

  /* 2. polaris_profile */
  server.registerTool(
    "polaris_profile",
    {
      title: "Learner profile",
      description:
        "Read or update the learner profile (language, study methods, memory anchors, session lengths, visual taste, hard commitments).",
      inputSchema: {
        action: z.enum(["get", "update"]).default("get"),
        patch: z.record(z.string(), z.unknown()).optional().describe("Fields to update when action is 'update'"),
        hub: z.string().optional().describe("Learning hub root directory (default: POLARIS_HUB or D:/02_Learning_Knowledge)"),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ action, patch, hub }) =>
      safe(async () => {
        if (action === "update") {
          if (!patch || Object.keys(patch).length === 0) {
            return text("Missing patch data for profile update.", true);
          }
          const updated = await updateProfile(patch, hub);
          return text(`Profile updated:\n${JSON.stringify(updated, null, 2)}`);
        }
        const profile = await getProfile(hub);
        return text(`Learner Profile:\n${JSON.stringify(profile, null, 2)}`);
      }),
  );

  /* 3. polaris_start */
  server.registerTool(
    "polaris_start",
    {
      title: "Start a course workspace",
      description:
        "Initialize or update the course brief in `<subject_dir>/polaris/brief.json` and set up git-ignored captures and cache. Returns validated brief and next steps.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        brief: z.union([z.record(z.string(), z.unknown()), z.string()]).describe(
          'Brief JSON: {"subject", "slug"?, "goal", "outcomes": [{"id", "text", "check"}], "start", "hoursPerWeek", "sourcesOfTruth": [...], "deadline"?}',
        ),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ subject_dir, brief }) =>
      safe(async () => {
        const { brief: saved, paths, issues } = await initSubject(subject_dir, brief);
        const lines = [
          `Initialized subject workspace for "${saved.subject}" in ${paths.dir}`,
          `Brief saved: ${paths.briefJson}`,
          `Captures directory: ${paths.capturesDir}`,
          "",
          `Outcomes defined (${saved.outcomes.length}):`,
          ...saved.outcomes.map((o) => `  - [${o.id}] ${o.text} (Check: ${o.check})`),
        ];
        if (issues.length) {
          lines.push("", "Quality gate notes:", ...issues.map((i) => `  - ${i}`));
        }
        lines.push(
          "",
          "Next step: Discover materials with polaris_find or polaris_research, register sources with polaris_source_add, then extract facts with polaris_fact_add.",
        );
        return text(lines.join("\n"));
      }),
  );

  /* 4. polaris_find */
  server.registerTool(
    "polaris_find",
    {
      title: "Find research and learning material",
      description:
        "Discover learning material across keyless providers (openalex, arxiv, semanticscholar, crossref, wikipedia, github, youtube, brave). Returns ranked results with scores, reasons, and open-access links without modifying subject registry.",
      inputSchema: {
        query: z.string().min(1).describe("Search query string"),
        providers: z.array(z.enum(RESEARCH_PROVIDERS)).optional().describe("Specific providers to query"),
        limit: z.number().int().min(1).max(50).default(10).optional().describe("Max number of results to return"),
        year_from: z.number().int().min(1900).max(2030).optional().describe("Filter publications from this year onwards"),
        lang: z.string().optional().describe("Language preference (e.g. 'vi' or 'en')"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, providers, limit, year_from, lang }) =>
      safe(async () => {
        const results = await findResearch(query, { providers, limit, year_from, lang });
        if (results.length === 0) {
          return text(`No research results found for query: "${query}"`);
        }
        const lines = [
          `Found ${results.length} research result(s) for "${query}":`,
          "",
          ...results.map((r) => {
            const oa = r.oaUrl || r.provider === "arxiv" ? "[OA Full-Text]" : "";
            const yr = r.year ? `(${r.year})` : "";
            const cit = typeof r.citations === "number" ? `[${r.citations.toLocaleString()} cites/views]` : "";
            const reasons = r.reasons && r.reasons.length > 0 ? ` -> Reasons: ${r.reasons.slice(0, 2).join("; ")}` : "";
            return `[#${r.rank}] (${r.provider}/${r.kind}) "${r.title}" ${yr} ${cit} ${oa} - Score: ${r.score}/100\n  Link: ${r.url}${reasons}`;
          }),
        ];
        return text(lines.join("\n"));
      }),
  );

  /* 5. polaris_research */
  server.registerTool(
    "polaris_research",
    {
      title: "Run multi-query research investigation",
      description:
        "Execute a multi-query research hunt across providers with rate limits, 24h caching in polaris cache directory, de-duplication, and ranking. Generates shortlist file polaris/research/<yyyy-mm-dd>-<slug>.md. Optionally auto-adds and captures top N sources.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        module: z.string().optional().describe("Target module ID e.g. 'M1'"),
        queries: z.array(z.string().min(1)).min(1).describe("List of search queries to execute"),
        providers: z.array(z.enum(RESEARCH_PROVIDERS)).optional().describe("Providers to query"),
        per_provider: z.number().int().min(1).max(30).default(5).optional().describe("Max items to fetch per provider per query"),
        year_from: z.number().int().min(1900).max(2030).optional().describe("Filter publications from this year onwards"),
        auto_add: z.number().int().min(0).max(20).default(0).optional().describe("Auto-add top N items to sources.json and capture them"),
        lang: z.string().optional().describe("Language preference (e.g. 'vi' or 'en')"),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ subject_dir, module: mod, queries, providers, per_provider, year_from, auto_add, lang }) =>
      safe(async () => {
        const res = await runResearch(subject_dir, {
          module: mod,
          queries,
          providers,
          per_provider,
          year_from,
          auto_add,
          lang,
        });

        const lines = [
          `Research investigation complete for ${queries.length} query(s).`,
          `Shortlist saved: ${res.shortlistPath}`,
          `Total discovered & ranked items: ${res.items.length}`,
          "",
          "Top Candidates (Review Gate):",
          ...res.items.slice(0, 10).map((it) => {
            const yr = it.year ? `(${it.year})` : "";
            const cit = typeof it.citations === "number" ? `[${it.citations.toLocaleString()} cites]` : "";
            const oa = it.oaUrl || it.provider === "arxiv" ? "[OA]" : "";
            const reasons = it.reasons ? ` - ${it.reasons.slice(0, 2).join("; ")}` : "";
            return `  ${it.rank}. [Score ${it.score}] (${it.kind}) "${it.title}" ${yr} ${cit} ${oa}\n     Link: ${it.url}${reasons}`;
          }),
        ];

        if (res.autoAdded.length > 0) {
          lines.push(
            "",
            `Auto-added and captured ${res.autoAdded.length} source(s):`,
            ...res.autoAdded.map((s) => `  - [${s.id}] "${s.title}" [${s.label}] (Quality: ${s.quality.score}/5)`),
          );
        }

        if (res.autoErrors.length > 0) {
          lines.push("", "Auto-add warnings/errors:", ...res.autoErrors.map((e) => `  - ${e}`));
        }

        if (res.legacyCacheDetected) {
          lines.push(
            "",
            `Storage notice: Legacy cache folder detected at "${res.legacyCachePath}". Polaris now stores regenerable API cache in "${subjectPaths(subject_dir).cacheDir}". The legacy folder is no longer used and can safely be deleted.`,
          );
        }

        if (!auto_add || auto_add === 0) {
          lines.push(
            "",
            "Review Gate: Review the top candidates above. Use polaris_source_add to register approved items, or call polaris_research with auto_add > 0.",
          );
        }

        return text(lines.join("\n"));
      }),
  );

  /* 6. polaris_source_add */
  server.registerTool(
    "polaris_source_add",
    {
      title: "Add and capture sources",
      description:
        "Register sources (web URLs, arXiv IDs, local files) in `sources.json` and capture clean text into `captures/<id>.md`. De-duplicates automatically.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        sources: z
          .array(
            z.object({
              id: z.string().optional().describe("Source ID (e.g. S1; auto-assigned if omitted)"),
              kind: z.enum(["local", "web", "paper", "video", "book", "course", "notebooklm", "deeptutor"]).optional(),
              title: z.string().optional(),
              author: z.string().optional(),
              date: z.string().optional(),
              url: z.string().optional(),
              path: z.string().optional(),
              label: z.enum(["course", "extension", "unverified"]).default("course"),
              quality: z.object({ score: z.number().int().min(1).max(5), why: z.string() }).optional(),
              notes: z.string().optional(),
            }),
          )
          .min(1)
          .describe("Array of sources to add and capture"),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ subject_dir, sources }) =>
      safe(async () => {
        const res = await addSources(subject_dir, sources);
        const lines = [
          `Processed ${sources.length} source(s): ${res.added.length} added, ${res.existing.length} already existed.`,
        ];
        if (res.previews.length) {
          lines.push("", "Captures & Previews:", ...res.previews.map((p) => `  - ${p}`));
        }
        if (res.errors.length) {
          lines.push("", "Errors:", ...res.errors.map((e) => `  - ${e}`));
        }
        lines.push("", "Next: Extract verified claims using polaris_fact_add.");
        return text(lines.join("\n"), res.errors.length > 0 && res.added.length === 0);
      }),
  );

  /* 7. polaris_capture */
  server.registerTool(
    "polaris_capture",
    {
      title: "Capture source full-text content",
      description:
        "Capture full text for registered sources (open-access PDF via pdftotext with page markers, YouTube transcripts via yt-dlp with timestamps, web articles via built-in extractor, Wikipedia extracts) into `captures/<id>.md`. Capped at 400 KB.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        ids: z.array(z.string().min(1)).optional().describe("Specific source IDs to capture (e.g. ['S1', 'S2']). If omitted, captures all uncaptured sources."),
        full: z.boolean().default(true).optional().describe("Attempt full-text extraction for PDFs and videos"),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ subject_dir, ids, full }) =>
      safe(async () => {
        const res = await captureSources(subject_dir, ids, full ?? true);
        const lines = [`Processed capture for ${res.captured.length} source(s).`];
        if (res.captured.length > 0) {
          lines.push("", "Captures:", ...res.captured.map((c) => `  - [${c.id}] ${c.title} (${c.preview.slice(0, 100)}...)`));
        }
        if (res.errors.length > 0) {
          lines.push("", "Errors:", ...res.errors.map((e) => `  - ${e}`));
        }
        return text(lines.join("\n"), res.errors.length > 0 && res.captured.length === 0);
      }),
  );

  /* 8. polaris_sources */
  server.registerTool(
    "polaris_sources",
    {
      title: "List or update sources",
      description: "Query, filter, or update sources in the source registry.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        filter: z
          .object({
            kind: z.enum(["local", "web", "paper", "video", "book", "course", "notebooklm", "deeptutor"]).optional(),
            label: z.enum(["course", "extension", "unverified"]).optional(),
            q: z.string().optional().describe("Search query in title, author, or notes"),
          })
          .optional(),
        update: z
          .array(
            z.object({
              id: z.string().min(1),
              set: z.record(z.string(), z.unknown()),
            }),
          )
          .optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ subject_dir, filter, update }) =>
      safe(async () => {
        if (update?.length) {
          const res = await updateSources(subject_dir, update);
          return text(
            `Updated ${res.updated.length} source(s).${res.errors.length ? `\nErrors:\n${res.errors.map((e) => `  - ${e}`).join("\n")}` : ""}`,
            res.errors.length > 0,
          );
        }
        const list = await listSources(subject_dir, filter);
        return text(`Sources (${list.length}):\n${JSON.stringify(list, null, 2)}`);
      }),
  );

  /* 9. polaris_fact_add */
  server.registerTool(
    "polaris_fact_add",
    {
      title: "Add verified facts",
      description:
        "Record discrete factual claims in `facts.json` pointing to a source ID and locator (e.g. timestamp [mm:ss], page [p. N], section, line numbers).",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        facts: z
          .array(
            z.object({
              id: z.string().optional().describe("Fact ID (e.g. F1; auto-assigned if omitted)"),
              claim: z.string().min(1).describe("Claim statement in learner language"),
              source: z.string().min(1).describe("Source ID (e.g. S1)"),
              locator: z.string().min(1).describe("Locator in source e.g. '02:13', '[p. 4]', 'Sec. 2.1', 'lines 12-25'"),
              label: z.enum(["course", "extension", "unverified"]).optional(),
              modules: z.array(z.string().min(1)).min(1).describe("Target module IDs e.g. ['M1']"),
              crossCheck: z.array(z.string().min(1)).optional().describe("Cross checking source IDs for numbers/dates"),
            }),
          )
          .min(1)
          .describe("Array of facts to add"),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ subject_dir, facts }) =>
      safe(async () => {
        const res = await addFacts(subject_dir, facts);
        const lines = [`Added ${res.added.length} fact(s).`];
        res.added.forEach((f) => {
          lines.push(`  - [${f.id}] (${f.source} @ ${f.locator}) ${f.claim.slice(0, 80)}...`);
        });
        if (res.errors.length) {
          lines.push("", "Errors:", ...res.errors.map((e) => `  - ${e}`));
        }
        return text(lines.join("\n"), res.errors.length > 0 && res.added.length === 0);
      }),
  );

  /* 10. polaris_facts */
  server.registerTool(
    "polaris_facts",
    {
      title: "Query facts",
      description: "Query and filter facts by search term, target module ID, or source ID.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        query: z.string().optional().describe("Search term in claim or locator"),
        module: z.string().optional().describe("Filter by module ID e.g. 'M1'"),
        source: z.string().optional().describe("Filter by source ID e.g. 'S1'"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ subject_dir, query, module: mod, source }) =>
      safe(async () => {
        const facts = await listFacts(subject_dir, { query, module: mod, source });
        return text(`Facts (${facts.length}):\n${JSON.stringify(facts, null, 2)}`);
      }),
  );

  /* 11. polaris_roadmap_save */
  server.registerTool(
    "polaris_roadmap_save",
    {
      title: "Save and render roadmap",
      description:
        "Validate roadmap against quality gates, save `roadmap.json`, and render gold-standard `ROADMAP.md` in Vietnamese. Returns report.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        roadmap: z.union([z.record(z.string(), z.unknown()), z.string()]).describe("Roadmap JSON or string"),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ subject_dir, roadmap }) =>
      safe(async () => {
        const res = await saveRoadmap(subject_dir, roadmap);
        const rep = res.checkReport;
        const lines = [
          rep.ok ? `Roadmap saved and rendered to ${res.renderedPath}` : `Roadmap saved with quality issues to ${res.renderedPath}`,
          rep.summary,
          "",
          `Stats: ${rep.stats.modulesCount} modules, ${rep.stats.totalHours} total hours, ${rep.stats.factsCount} facts, ${rep.stats.sourcesCount} sources.`,
        ];
        if (rep.errors.length) {
          lines.push("", "Quality Gate Errors:", ...rep.errors.map((e) => `  - [${e.location}] ${e.message} -> Fix: ${e.fix}`));
        }
        if (rep.warnings.length) {
          lines.push("", "Quality Gate Warnings:", ...rep.warnings.map((w) => `  - [${w.location}] ${w.message} -> Fix: ${w.fix}`));
        }
        return text(lines.join("\n"), !rep.ok);
      }),
  );

  /* 12. polaris_check */
  server.registerTool(
    "polaris_check",
    {
      title: "Check quality gates",
      description:
        "Run the complete quality gate audit across brief, sources, facts, and roadmap. Returns all errors, warnings, and fixes.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ subject_dir }) =>
      safe(async () => {
        const brief = await readBrief(subject_dir);
        const sources = await readSources(subject_dir);
        const facts = await readFacts(subject_dir);
        const roadmap = await readRoadmap(subject_dir);

        const rep = checkQualityGates({ brief, sources, facts, roadmap });
        const lines = [
          `Quality Gate Audit for ${resolve(subject_dir)}:`,
          rep.summary,
          "",
          `Stats: ${rep.stats.briefOutcomes} brief outcomes, ${rep.stats.sourcesCount} sources, ${rep.stats.factsCount} facts, ${rep.stats.modulesCount} modules (${rep.stats.totalHours} hours).`,
        ];
        if (rep.errors.length) {
          lines.push("", "ERRORS (must fix):", ...rep.errors.map((e) => `  - [${e.location}] ${e.message}\n    Fix: ${e.fix}`));
        }
        if (rep.warnings.length) {
          lines.push("", "WARNINGS:", ...rep.warnings.map((w) => `  - [${w.location}] ${w.message}\n    Fix: ${w.fix}`));
        }
        return text(lines.join("\n"), !rep.ok);
      }),
  );

  /* 13. polaris_schedule */
  server.registerTool(
    "polaris_schedule",
    {
      title: "Schedule course sessions",
      description:
        "Deterministically fit module study hours into learner weekly slots from start date, skipping blackouts and hub P0 deadlines (day of & day before), inserting interleaved reviews every N weeks. Writes polaris/schedule.json and updates ROADMAP.md weekly table.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start must be YYYY-MM-DD").optional().describe("Start date (defaults to brief.start)"),
        until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "until must be YYYY-MM-DD").optional().describe("Latest end date"),
        interleave_every: z.number().int().min(1).default(4).optional().describe("Interleaved review interval in weeks (default: 4)"),
        hub: z.string().optional().describe("Hub path for reading P0 deadlines (defaults to POLARIS_HUB)"),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ subject_dir, start, until, interleave_every, hub }) =>
      safe(async () => {
        const res = await buildSchedule({
          subject_dir,
          start,
          until,
          interleave_every,
          hub,
        });
        return text(res.summary);
      }),
  );

  /* 14. polaris_export_course */
  server.registerTool(
    "polaris_export_course",
    {
      title: "Export course to Aurora Slides",
      description:
        "Generate Aurora Slides course.json and lesson outline skeletons in polaris/lessons/<dir>.outline.md. Automatically splits long modules (> 2.5h) into a/b lessons, rotates visual themes, assigns Phosphor icons, and preserves existing customizations idempotently.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        course_dir: z.string().optional().describe("Target Aurora course directory (defaults to <subject>/05_Slides/<slug>)"),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ subject_dir, course_dir }) =>
      safe(async () => {
        const res = await exportCourse({ subject_dir, course_dir });
        return text(res.summary);
      }),
  );

  /* 15. polaris_tasks_sync */
  server.registerTool(
    "polaris_tasks_sync",
    {
      title: "Sync tasks to learning hub",
      description:
        "Append scheduled lesson tasks and module checkpoints under ## Polaris in <subject>/TASKS.md in exact hub format (- [ ] [Deadline: YYYY-MM-DD 23:59] [Priority: P2] ...). Preserves line endings and prevents duplicates.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ subject_dir }) =>
      safe(async () => {
        const res = await syncTasks(subject_dir);
        return text(res.summary);
      }),
  );

  /* 16. polaris_errorlog_add */
  server.registerTool(
    "polaris_errorlog_add",
    {
      title: "Add error log entry ('Sổ lỗi')",
      description:
        "Record a runtime predict-vs-run gap in polaris/errorlog.md ('Sổ lỗi') and automatically schedule spaced repetition reviews (D+1, D+3, D+7, D+16, D+35) in polaris/reviews.json.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        entry: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD").optional(),
          module: z.string().optional().describe("Module ID e.g. M1"),
          lesson: z.string().optional().describe("Lesson dir e.g. 01-vong-lap-agent"),
          prediction: z.string().optional().describe("Initial prediction before running"),
          result: z.string().optional().describe("Actual runtime result / symptom"),
          why: z.string().min(1).describe("Root cause of the error"),
          fix: z.string().min(1).describe("Fix and general rule learned"),
          source: z.string().optional().describe("Reference or source ID"),
        }),
        hub: z.string().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ subject_dir, entry, hub }) =>
      safe(async () => {
        const res = await addErrorLogEntry(subject_dir, entry, hub);
        return text(res.summary);
      }),
  );

  /* 17. polaris_lesson_done */
  server.registerTool(
    "polaris_lesson_done",
    {
      title: "Mark lesson completed",
      description:
        "Record lesson completion in polaris/reviews.json and schedule spaced repetition reviews (D+1, D+3, D+7, D+16, D+35) for retention.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        lesson_dir: z.string().min(1).describe("Lesson folder name e.g. '01-vong-lap-agent'"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD").optional().describe("Completion date (default today)"),
        score: z.union([z.number(), z.string()]).optional().describe("Quiz score or assessment result"),
        hub: z.string().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ subject_dir, lesson_dir, date, score, hub }) =>
      safe(async () => {
        const res = await markLessonDone(subject_dir, lesson_dir, date, score, hub);
        return text(res.summary);
      }),
  );

  /* 18. polaris_review_due */
  server.registerTool(
    "polaris_review_due",
    {
      title: "Query due reviews",
      description:
        "List all lesson reviews and error log entries due on or before target date, sorted oldest first, with concise review advice.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD").optional().describe("Target query date (default today)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ subject_dir, date }) =>
      safe(async () => {
        const res = await getDueReviews(subject_dir, date);
        return text(res.summary);
      }),
  );

  /* 19. polaris_progress_sync */
  server.registerTool(
    "polaris_progress_sync",
    {
      title: "Sync Aurora Slides learning progress",
      description:
        "Read Aurora Slides interactive learning events from `<course_dir>/progress.jsonl` or exported file, map lessons to modules, add error log entries for wrong quizzes, predict gaps, and missed palace stations, and schedule spaced reviews (D+1, D+3, D+7, D+16, D+35) for completed lessons. Idempotent.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        course_dir: z.string().optional().describe("Target Aurora course directory (defaults to course-map.json or <subject>/05_Slides/<slug>)"),
        file: z.string().optional().describe("Explicit progress JSONL file path (e.g. aurora-progress-<slug>.jsonl)"),
        hub: z.string().optional().describe("Learning hub root directory"),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ subject_dir, course_dir, file, hub }) =>
      safe(async () => {
        const res = await syncProgress({ subject_dir, course_dir, file, hub });
        return text(res.summary);
      }),
  );

  /* 20. polaris_today */
  server.registerTool(
    "polaris_today",
    {
      title: "Generate daily session plan and dynamic goal",
      description:
        "Generate a 60- or 30-minute session plan following learner session recipe: due spaced reviews, next uncompleted lesson from schedule with Aurora slide & outline paths, and practice tier with Definition of Done (DoD). When write: true, updates or inserts ## Today's Dynamic Goal block in <hub>/ACTIVE_LEARNING.md.",
      inputSchema: {
        subject_dir: z.string().min(1).describe("Subject directory path"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD").optional().describe("Session date (defaults to today)"),
        minutes: z.number().int().min(15).max(180).optional().describe("Session minutes (30 or 60; defaults to schedule or profile slot)"),
        write: z.boolean().default(false).optional().describe("Write or replace ## Today's Dynamic Goal in ACTIVE_LEARNING.md (default false)"),
        hub: z.string().optional().describe("Learning hub root directory"),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ subject_dir, date, minutes, write, hub }) =>
      safe(async () => {
        const res = await getTodayPlan({ subject_dir, date, minutes, write, hub });
        return text(res.summary);
      }),
  );

  /* ───────── Prompts ───────── */

  server.registerPrompt(
    "new_course",
    {
      title: "Build a personalized course",
      description: "Guided end-to-end workflow to build an evidence-based course from brief to Aurora Slides course with scheduling and task sync",
      argsSchema: {
        subject: z.string().describe("Course subject name"),
        goal: z.string().optional().describe("Core goal of the learner"),
        hours_per_week: z.string().optional().describe("Target hours per week"),
        sources: z.string().optional().describe("Known primary sources of truth"),
      },
    },
    ({ subject, goal, hours_per_week, sources }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Build a personal study course for subject: "${subject}"`,
              `Goal: ${goal ?? "Master the subject thoroughly with evidence-based practice and mental models"}`,
              `Study time: ${hours_per_week ?? "2-3"} hours per week`,
              `Sources of truth: ${sources ?? "official video transcripts and notebooks"}`,
              "",
              "Follow the complete Polaris workflow and quality gates:",
              "1. polaris_guide to review pipeline, quality gates, source policy, schedule, export, and tracking.",
              "2. polaris_profile { action: 'get' } to inspect learner slots, blackouts, and study methods (theory -> memory anchors -> paper notebook -> practice easy-to-hard; predict-then-run).",
              "3. polaris_start to initialize polaris/brief.json with measurable outcome checks.",
              "4. polaris_research / polaris_find to discover literature, specs, and tutorials across keyless providers (openalex, arxiv, semanticscholar, crossref, wikipedia, youtube, github).",
              "5. polaris_source_add / polaris_capture to register and capture primary materials and open-access PDFs.",
              "6. polaris_fact_add to extract discrete claims with precise locators (pages [p. N], timestamps [mm:ss]).",
              "7. polaris_roadmap_save to structure modules (why, outputs, core citing facts, misconceptions, materials with minutes, 3 practice tiers with DoD, 4+ self-check questions with predict, checkpoint) and render ROADMAP.md in Vietnamese.",
              "8. polaris_check to verify 0 errors.",
              "9. polaris_schedule to deterministically fit module hours into slots minus blackouts and P0 deadlines, writing schedule.json and updating Section 3.2.",
              "10. polaris_export_course to generate Aurora course.json and lesson outline skeletons in polaris/lessons/<dir>.outline.md.",
              "11. polaris_tasks_sync to append scheduled lesson and checkpoint tasks to TASKS.md under ## Polaris.",
              "12. Build the first lesson deck with Aurora Slides tools according to its outline skeleton.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "research",
    {
      title: "Research sources and facts for a module",
      description: "Discover and verify primary sources and facts for one module",
      argsSchema: {
        subject_dir: z.string().describe("Subject directory path"),
        module_id: z.string().describe("Module ID e.g. M1"),
        topic: z.string().describe("Topic to research"),
      },
    },
    ({ subject_dir, module_id, topic }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Research verified sources and facts for Module ${module_id} (${topic}) in course at ${subject_dir}.`,
              "",
              "1. Discover candidates using polaris_research with targeted queries across keyless providers (openalex, arxiv, semanticscholar, crossref, wikipedia, youtube, github).",
              "2. Review the generated shortlist in polaris/research/ with top candidates, scores, and evaluation reasons (Review Gate).",
              "3. Register approved primary sources with polaris_source_add (or auto_add) and verify full-text captures in captures/<id>.md with polaris_capture.",
              "4. Extract discrete factual claims with polaris_fact_add with precise locators (timestamp [mm:ss], page [p. N], section, lines).",
              "5. Cross-check numerical/date claims or mark them unverified.",
              "6. Check that facts are tagged for module " + module_id + ".",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "next_lesson",
    {
      title: "Build and study the next scheduled lesson deck",
      description: "Sync progress, plan today's session, pick the next scheduled lesson, refresh outline, build slide deck with Aurora, audit, and sync tasks",
      argsSchema: {
        subject_dir: z.string().describe("Subject directory path"),
        lesson_dir: z.string().optional().describe("Specific lesson folder e.g. '01-vong-lap-agent' (defaults to next due)"),
      },
    },
    ({ subject_dir, lesson_dir }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Build and verify the next lesson deck for course at ${subject_dir}${lesson_dir ? ` (target: ${lesson_dir})` : ""}.`,
              "",
              "1. Run polaris_progress_sync to ingest recent Aurora progress events, update Sổ lỗi, and schedule spaced reviews.",
              "2. Run polaris_today to get today's session plan (due reviews, next lesson, practice tier, and Definition of Done).",
              "3. Inspect polaris/course-map.json and polaris/lessons/ to find the target lesson outline skeleton.",
              "4. Follow the lesson outline skeleton: Title, Theory, Anchors (Memory palace & visual anchors), Notebook page (4-8 lines), Predict-then-run practice (easy -> hard), Quiz (with distractors from misconceptions), Recall walk, and Summary.",
              "5. Build the deck in <course_dir>/<lesson_dir>/deck.json using Aurora Slides tools, strictly adhering to Aurora accuracy rules and citing facts in `source`.",
              "6. Run aurora_audit to verify slide length, typography, and contrast.",
              "7. Run polaris_tasks_sync to keep tasks synchronized.",
              "8. When the learner finishes studying the deck, call polaris_progress_sync or polaris_lesson_done to schedule retention reviews.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "review",
    {
      title: "Spaced review and active recall session",
      description: "Run progress sync, list due reviews, and guide an active recall session for error log items and completed lessons",
      argsSchema: {
        subject_dir: z.string().describe("Subject directory path"),
        date: z.string().optional().describe("Target review date (default today)"),
      },
    },
    ({ subject_dir, date }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Conduct an active spaced repetition review session for course at ${subject_dir}${date ? ` on date ${date}` : ""}.`,
              "",
              "1. Run polaris_progress_sync to ensure all latest Aurora interactive learning events are synchronized.",
              "2. Run polaris_review_due to list all lessons and error log entries due today.",
              "3. Guide a 5-10 minute active recall session with the learner:",
              "   - For Sổ lỗi (error log) entries: Present the symptom and initial prediction without showing the fix; ask the learner to explain the root cause and the rule learned.",
              "   - For Lesson reviews: Walk through the memory palace stations, review the 4-8 line notebook summary, and ask 2-3 retrieval questions.",
              "4. If any errors or prediction gaps occur during review, record them using polaris_errorlog_add.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/* ───────── CLI ───────── */

const HELP = `Polaris MCP ${VERSION}
Evidence-based personal study course builder.

Usage: node polaris.mjs [command] [options]

  (no command) | mcp            run the MCP server on stdio
  check <subject_dir>           run quality gates audit
  render <subject_dir>          re-render ROADMAP.md from polaris/roadmap.json
  schedule <subject_dir>        generate schedule and update ROADMAP.md weekly table
  export <subject_dir>          export Aurora course.json and lesson outlines
  tasks <subject_dir>           sync tasks to <subject_dir>/TASKS.md
  progress <subject_dir> [dir]  sync Aurora progress.jsonl events to Sổ lỗi & reviews
  today <subject_dir> [date]    print daily session plan & Today's Dynamic Goal
  guide [topic]                 view guide documentation
  version | --version           print version
  help | --help                 print this help`;

async function cli(args: string[]): Promise<number> {
  const cmd = args[0] || "mcp";
  const target = args[1];

  switch (cmd) {
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;

    case "version":
    case "--version":
    case "-v":
      console.log(VERSION);
      return 0;

    case "guide":
      console.log(await guideText(target));
      return 0;

    case "progress": {
      if (!target) {
        console.error("Usage: polaris progress <subject_dir> [course_dir]");
        return 1;
      }
      const dir = resolve(target);
      const res = await syncProgress({ subject_dir: dir, course_dir: args[2] });
      console.log(res.summary);
      return 0;
    }

    case "today": {
      if (!target) {
        console.error("Usage: polaris today <subject_dir> [date]");
        return 1;
      }
      const dir = resolve(target);
      const res = await getTodayPlan({ subject_dir: dir, date: args[2] });
      console.log(res.summary);
      return 0;
    }

    case "check": {
      if (!target) {
        console.error("Usage: polaris check <subject_dir>");
        return 1;
      }
      const dir = resolve(target);
      const brief = await readBrief(dir);
      const sources = await readSources(dir);
      const facts = await readFacts(dir);
      const roadmap = await readRoadmap(dir);

      const rep = checkQualityGates({ brief, sources, facts, roadmap });
      console.log(`Quality Gate Audit for ${dir}:`);
      console.log(rep.summary);
      console.log(
        `Stats: ${rep.stats.briefOutcomes} brief outcomes, ${rep.stats.sourcesCount} sources, ${rep.stats.factsCount} facts, ${rep.stats.modulesCount} modules (${rep.stats.totalHours} hours).`,
      );
      if (rep.errors.length) {
        console.log("\nERRORS:");
        rep.errors.forEach((e) => console.log(`  - [${e.location}] ${e.message}\n    Fix: ${e.fix}`));
      }
      if (rep.warnings.length) {
        console.log("\nWARNINGS:");
        rep.warnings.forEach((w) => console.log(`  - [${w.location}] ${w.message}\n    Fix: ${w.fix}`));
      }
      return rep.ok ? 0 : 1;
    }

    case "render": {
      if (!target) {
        console.error("Usage: polaris render <subject_dir>");
        return 1;
      }
      const dir = resolve(target);
      const p = subjectPaths(dir);
      const roadmap = await readRoadmap(dir);
      if (!roadmap) {
        console.error(`No roadmap.json found in ${p.polarisDir}. Run polaris_roadmap_save first.`);
        return 1;
      }
      const brief = await readBrief(dir);
      const sources = await readSources(dir);
      const facts = await readFacts(dir);
      const targetMd = brief?.roadmapPath ? resolve(p.dir, brief.roadmapPath) : p.defaultRoadmapMd;
      const relPath = targetMd.replace(/\\/g, "/").replace(p.dir.replace(/\\/g, "/") + "/", "");
      const md = renderRoadmapMarkdown({ roadmap, brief, sources, facts, relativePath: relPath });
      const { atomicWriteFile } = await import("./util.js");
      await atomicWriteFile(targetMd, md);
      console.log(`Rendered ROADMAP.md to ${targetMd}`);
      return 0;
    }

    case "schedule": {
      if (!target) {
        console.error("Usage: polaris schedule <subject_dir>");
        return 1;
      }
      const dir = resolve(target);
      const res = await buildSchedule({ subject_dir: dir });
      console.log(res.summary);
      return 0;
    }

    case "export": {
      if (!target) {
        console.error("Usage: polaris export <subject_dir>");
        return 1;
      }
      const dir = resolve(target);
      const res = await exportCourse({ subject_dir: dir });
      console.log(res.summary);
      return 0;
    }

    case "tasks": {
      if (!target) {
        console.error("Usage: polaris tasks <subject_dir>");
        return 1;
      }
      const dir = resolve(target);
      const res = await syncTasks(dir);
      console.log(res.summary);
      return 0;
    }

    case "mcp":
    default:
      await startMcp();
      return 0;
  }
}

// Entrypoint
import { fileURLToPath } from "node:url";
import { basename } from "node:path";

const isMain =
  Boolean(process.argv[1]) &&
  (resolve(process.argv[1]!) === fileURLToPath(import.meta.url) ||
    basename(process.argv[1]!).startsWith("polaris"));

if (isMain) {
  const isCli = process.argv.length > 2 && !["mcp"].includes(process.argv[2]!);
  if (isCli) {
    cli(process.argv.slice(2))
      .then((code) => {
        if (code !== 0) process.exit(code);
      })
      .catch((err) => {
        console.error(errMsg(err));
        process.exit(1);
      });
  } else {
    startMcp().catch((err) => {
      console.error("Failed to start Polaris MCP server:", errMsg(err));
      process.exit(1);
    });
  }
}
