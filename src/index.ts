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
import { guideText, TOPICS } from "./guide.js";
import { renderRoadmapMarkdown } from "./render.js";
import {
  findResearch,
  RESEARCH_PROVIDERS,
  ResearchProvider,
  runResearch,
} from "./research.js";
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
import { errMsg, subjectPaths, VERSION } from "./util.js";

export * from "./schema.js";
export * from "./store.js";
export * from "./capture.js";
export * from "./check.js";
export * from "./render.js";
export * from "./guide.js";
export * from "./research.js";
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

const INSTRUCTIONS = `Polaris MCP builds evidence-based personal study courses for self-learners from brief to roadmap.

Workflow:
1. polaris_guide (topics: "overview", "pipeline", "gates", "sources", "roadmap", "research", "learner", "rules").
2. polaris_profile { action: "get" } to read learner methods, or "update" to adjust preferences.
3. polaris_start { subject_dir, brief } to initialize subject brief and polaris folder.
4. Research & Discovery:
   - polaris_find { query, providers?, limit?, year_from?, lang? } to discover materials across keyless providers.
   - polaris_research { subject_dir, queries, providers?, auto_add? } to run multi-query search, generate tracked shortlist in polaris/research/, and optionally auto-add top items.
   - polaris_source_add { subject_dir, sources } to register sources with automatic capture.
   - polaris_capture { subject_dir, ids?, full? } to capture full-text (PDF via pdftotext with page markers, YouTube transcripts via yt-dlp with timestamps, web/Wikipedia text).
5. polaris_fact_add { subject_dir, facts } to record discrete factual claims with locators.
6. polaris_roadmap_save { subject_dir, roadmap } to validate quality gates and render ROADMAP.md in Vietnamese.
7. polaris_check { subject_dir } to verify that all quality gates pass.

Rules:
- Evidence first: every factual bullet points to facts; every fact points to a source + locator (page [p. N], timestamp [mm:ss], section, lines).
- Labels: [Khóa học] (learner source of truth), [Mở rộng] (extensions), (chưa xác minh) (unverified). Numbers and dates must be cross-checked or marked unverified.
- Learner fit: learner-facing text in the learner's language (Vietnamese by default with correct diacritics); no emoji; no overclaims.
- Review gate: show the top 10 research candidates with evaluation reasons and wait for approval unless auto_add is explicitly specified.
- Do not write solution code for assignments; adhere to AGENTS.md rules.
- Never scan D: recursively; open files directly or use smart-drive MCP.

Done when:
polaris_check reports 0 errors and ROADMAP.md is rendered with all 10 standard sections.`;

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
        "Execute a multi-query research hunt across providers with rate limits, 24h caching in polaris/.cache/, de-duplication, and ranking. Generates shortlist file polaris/research/<yyyy-mm-dd>-<slug>.md. Optionally auto-adds and captures top N sources.",
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

  /* ───────── Prompts ───────── */

  server.registerPrompt(
    "new_course",
    {
      title: "Build a personalized course",
      description: "Guided workflow to build an evidence-based course from brief to roadmap",
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
              "Follow the Polaris workflow and quality gates:",
              "1. polaris_guide to review pipeline, gates, and research methods.",
              "2. polaris_profile { action: 'get' } to inspect learner methods (theory -> memory anchors -> paper notebook -> practice easy-to-hard; predict-then-run).",
              "3. polaris_start to initialize polaris/brief.json with measurable outcome checks.",
              "4. polaris_research / polaris_find to discover literature and tutorials across keyless providers.",
              "5. polaris_source_add / polaris_capture to register and capture primary materials and open-access PDFs.",
              "6. polaris_fact_add to extract key claims with locators (pages, timestamps).",
              "7. polaris_roadmap_save to structure modules (why, outputs, core citing facts, misconceptions, materials with minutes, 3 practice tiers with DoD, 4+ self-check questions with predict, checkpoint) and render ROADMAP.md in Vietnamese.",
              "8. polaris_check to verify 0 errors.",
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
