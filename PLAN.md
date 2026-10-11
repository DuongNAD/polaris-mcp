# Polaris MCP - plan and design

Polaris is an MCP server plus a workflow that lets coding agents (Claude Code, Google Antigravity) build a personal
course for one learner from start to finish: learner profile -> subject brief -> research with a source registry ->
evidence-based roadmap in the learner's own format -> an Aurora Slides course -> tracking and adaptation.
The agent is the brain. Polaris gives structure, persistence, deterministic helpers (source capture, scheduling,
rendering) and quality gates. It never calls a paid API. Sister project: Aurora Slides MCP
(`D:/03_Development_Projects/Slide_Projects/my_projects/aurora_slides_mcp`), which renders the lessons.

## Principles
1. The agent reasons, the server structures. Every artifact is JSON validated with zod and rendered to Markdown or to
   Aurora input. Errors are precise and corrective ("did you mean ..."), like Aurora's.
2. Evidence first. Every factual bullet of a roadmap points to facts; every fact points to a source plus a locator
   (timestamp, page, section, line range). Labels: `course` (the learner's source of truth), `extension`, `unverified`.
3. Learner fit. The profile drives language, study method, session lengths, schedule and level. The learning hub's
   rules (`D:/02_Learning_Knowledge/AGENTS.md`, "DeepTutor") are respected: never write the learner's assignment or
   solution code; learner-facing text in Vietnamese; no emoji; no unverified claims.
4. Gates. The pipeline stops at reviewable checkpoints (brief, source shortlist, roadmap, lesson outline). The agent
   shows a compact summary and waits for approval unless the learner said to run straight through.
5. Files, not databases. Plain JSON and Markdown inside the subject folder, readable and diffable. Captured third-party
   text is git-ignored (personal study copies, never published).
6. Same toolchain discipline as Aurora: TypeScript, one bundled `dist/polaris.mjs`, toolchain outside the project
   (no `node_modules` on D:, an exFAT drive with 512 KB clusters), few files.

## The learner (current defaults, stored in the profile)
Vietnamese developer and self-learner. Method: theory -> memory anchors (memory palace through their home, picture
anchors, analogy, mnemonic) -> copy 4-8 key lines into a paper notebook -> practice from easy to hard -> recall walk;
predict-then-run for code (write the prediction, run, compare; the gap goes into an error log, "Sổ lỗi"). Big subjects
become courses of small lessons (15-25 minutes, each with its own look). Sessions: 30 min (5 review + one small task),
60 min (5 review, 10 video/docs, 35 practice, 7 self-check, 3 next step), labs 90 min. Spaced review after 1, 3, 7, 16,
35 days. Taste: Apple-keynote slides, no emoji, no neon. Hard commitments (e.g. a P0 course) take priority in the
calendar. Gold standard of the roadmap format: `D:/02_Learning_Knowledge/AMD_AI_Academy_AI_Agents_101/04_Roadmaps/ROADMAP.md`.

## Learning hub layout (existing)
`D:/02_Learning_Knowledge`: `AGENTS.md` (rules), `INDEX.md` (knowledge map), `ACTIVE_LEARNING.md` (top projects,
checkpoints, deadlines), `TASKS.md` (workspace tasks), `pick_today.py`, one folder per subject, e.g.
`AMD_AI_Academy_AI_Agents_101/` with `01_Recordings`, `02_Notes_Summaries`, `03_Materials_Code`,
`04_Roadmaps/ROADMAP.md`, `05_Slides/` (Aurora course) and its own `TASKS.md`. Task format:
`- [ ] [Deadline: YYYY-MM-DD HH:mm] [Priority: P0|P1|P2] Description`; never delete a task, only toggle after its check.
Never scan D: recursively (find, grep -r, dir /s, Get-ChildItem -Recurse); local search goes through the smart-drive MCP.

## Data
Hub level: `<hub>/.polaris/learner.json` (hub = `POLARIS_HUB`, default `D:/02_Learning_Knowledge`).
Subject level, in `<subject>/polaris/`:

| File | Content |
|---|---|
| `brief.json` | subject, slug, goal, outcomes `[{id: "O1", text, check}]` (measurable), start, deadline?, hoursPerWeek, sourcesOfTruth `[path or url]`, level `{summary, diagnostic: [{q, answer, correct}]}`, scope `{in: [], out: []}`, constraints `[]` |
| `sources.json` | `[{id: "S1", kind: local, web, paper, video, book, course, notebooklm or deeptutor, title, author?, date?, url?, path?, label: course, extension or unverified, quality: {score 1-5, why}, accessed, capture?: "captures/S1.md", license?, notes?}]` |
| `facts.json` | `[{id: "F1", claim (learner language), source: "S1", locator, label, modules: ["M1"], crossCheck?: ["S3"]}]` |
| `roadmap.json` | title, version, updated, outcomes, modules `[{id, title, hours, depends, why, outputs, core: [{text, facts}], diagram?, misconceptions: [{wrong, why, fix}], materials: [{title, source, minutes, note}], practice: {warmup, core, challenge} each {task, minutes, dod}, selfCheck: [{q, level: remember, explain, predict or apply, answer}], checkpoint}]`, capstone?, review |
| `schedule.json` | weeks `[{week, from, to, sessions: [{date, minutes, module, activity}]}]`, lesson `when` labels |
| `lessons/<dir>.outline.md` | lesson outline for review before the deck is built |
| `captures/<id>.md` | captured text of a source with URL and date (git-ignored) |
| `errorlog.md`, `reviews.json` | "Sổ lỗi" entries and spaced-review dates |

The rendered roadmap goes to `<subject>/04_Roadmaps/ROADMAP.md` by default (configurable in the brief).

## Tools
v0.1:
- `polaris_guide {topic?}`: pipeline, gates, source policy, roadmap format, quality rules, the learner method.
- `polaris_profile {action: get or update, patch?}`: learner profile; created with sensible defaults from this plan.
- `polaris_start {subject_dir, brief}`: create or update the brief (validated), create `polaris/`, add `captures/` to a
  `.gitignore` inside `polaris/`, return the next steps.
- `polaris_source_add {subject_dir, sources: [...]}`: validate, de-duplicate (same url/path/arXiv id), and capture:
  web page -> readable text (built-in extractor: drop script/style/nav/footer, prefer article/main); arXiv id or URL ->
  title, authors, date, abstract via the keyless export.arxiv.org API; local text, Markdown or code file -> referenced
  by path (no copy). Returns ids and a short preview of each capture.
- `polaris_sources {subject_dir, filter?, update?}`: list, filter and update entries.
- `polaris_fact_add {subject_dir, facts: [...]}` and `polaris_facts {subject_dir, query?, module?}`.
- `polaris_roadmap_save {subject_dir, roadmap}`: validate, run the quality gates, render ROADMAP.md, return issues.
- `polaris_check {subject_dir}`: the whole quality gate report (below).
- Prompts: `new_course` (whole pipeline with gates) and `research` (source hunt for one module).

v0.2: `polaris_schedule` (deterministic fit of module hours into the learner's weekly slots minus blackouts and
other deadlines read from ACTIVE_LEARNING.md; writes schedule.json, section 3.2 of the roadmap and `when` labels),
`polaris_export_course` (Aurora `course.json` with lessons per module, alternating themes, `when`, icons, plus lesson
outline skeletons built from outcomes, facts, misconceptions -> quiz distractors, practice -> exercise and predict
slides), `polaris_tasks_sync` (append tasks to the subject TASKS.md in the hub format, never delete),
`polaris_errorlog_add`, `polaris_review_due`, `polaris_find {query, providers: arxiv, wikipedia, semanticscholar}`
(keyless discovery; results are suggestions, not auto-added), YouTube transcripts through `yt-dlp` when installed.
v0.3: progress loop with Aurora (the Aurora preview server stores quiz, predict and recall results in the course folder;
Polaris reads them to schedule reviews and adapt the next lesson). Dogfood on a real subject end to end.

## Quality gates (`polaris_check`, also run by `polaris_roadmap_save`)
- Brief: every outcome has a checkable `check`; hoursPerWeek and start are set.
- Sources: at least one `course` source; every source has a label and a quality score with a reason.
- Facts: every fact has a source and a locator; numbers and dates either appear in two sources (`crossCheck`) or carry
  the `unverified` label.
- Roadmap: every outcome is covered by at least one module output; every module has why, at least two outputs, core
  bullets that each cite at least one fact, at least one misconception, materials whose minutes fit the module hours,
  three practice tiers with a DoD, at least four self-check questions with answers (including a predict question when
  the module has code) and a checkpoint; module dependencies exist and have no cycles; total hours fit the budget.
- Language: overclaims ("100%", "luôn luôn", "tuyệt đối", "always", "every model") are flagged.
- Each issue says where it is and how to fix it.

## Roadmap Markdown format (mirror of the gold standard)
Header quote (goal, source of truth) -> table of contents -> 1 How to use (labels **[Khóa học]**, **[Mở rộng]**,
**(chưa xác minh)**; the module loop; the 60 and 30 minute session recipes) -> 2 Big picture (2.1 outcomes, 2.2 module
map as Mermaid, 2.3 prerequisites with a quick self-test, 2.4 time budget) -> 3 Status and calendar (3.1 you are here,
3.2 weekly table) -> 4 Modules (Vì sao học, Đầu ra, Kiến thức cốt lõi with labels, Hiểu lầm và lỗi hay gặp, Tài liệu with
minutes, Thực hành in three tiers with DoD, Tự kiểm tra with answers in `<details>`, Checkpoint) -> 5 Spaced and
interleaved review -> 6 Capstone -> 7 Error log and how to ask DeepTutor -> 8 Older material -> 9 Progress tracking ->
10 References (generated from sources.json). Learner-facing text in Vietnamese.

## Source policy (in the guide)
Priority: 1 the learner's own course materials (source of truth), 2 official docs and specifications, 3 papers,
4 reputable books and tutorials, 5 videos and blogs (extension). Prefer primary sources; record a locator for every
fact; cross-check numbers; mark what cannot be verified; summarize in your own words, quote only short passages;
captures stay git-ignored; respect site terms; no paywalled or pirated material. Local files are found with the
smart-drive MCP; NotebookLM and DeepTutor answers are registered as sources with the notebook and question as locator.

## Layout and build
`src/` (schema, store, capture, render, check, guide, index = MCP + CLI), `guide/GUIDE.md`, `scripts/build.mjs`
(bundles `dist/polaris.mjs` with esbuild; type-checks with tsc on a copy beside the toolchain), `scripts/e2e.mjs`
(real MCP stdio client exercising every tool on a temporary subject folder outside D:), `README.md` (English) and
`README.vi.md` (Vietnamese). Toolchain: `POLARIS_TOOLCHAIN`, falling back to the Aurora toolchain
(`%LOCALAPPDATA%/aurora-slides/toolchain`, which already has @modelcontextprotocol/sdk, zod, esbuild and typescript).
No other runtime dependencies in v0.1.

## Research engine (v0.2a)
The learner asked that Polaris find research and learning material on the internet by itself. The agent still plans
the queries, reads the captures, extracts facts with locators and decides; Polaris searches, ranks, de-duplicates and
captures. Everything is keyless by default.

Providers (each normalized to `{provider, kind, title, authors, year, venue, url, doi?, arxiv?, citations?, oaUrl?,
abstract?, lang?}`):
- `openalex`: api.openalex.org/works?search=...&per-page=N (abstract rebuilt from abstract_inverted_index,
  cited_by_count, best_oa_location / open_access.oa_url, publication_year, host venue).
- `arxiv`: export.arxiv.org/api/query?search_query=all:...&max_results=N (Atom XML; at most one call every 3 s).
- `semanticscholar`: api.semanticscholar.org/graph/v1/paper/search?query=...&fields=title,authors,year,venue,
  citationCount,openAccessPdf,tldr,externalIds,abstract (back off and retry on HTTP 429).
- `crossref`: api.crossref.org/works?query=...&rows=N (DOIs, books, journal metadata).
- `wikipedia`: vi and en, action=query&list=search, then the REST page summary (overviews; label `extension`).
- `github`: api.github.com/search/repositories?q=... (official repositories and code; 10 requests per minute
  unauthenticated, use GITHUB_TOKEN only if the user set it).
- `youtube`: `yt-dlp "ytsearchN:<query>" --flat-playlist -J` (title, channel, duration, url); yt-dlp is installed.
- `brave` (optional, off unless BRAVE_API_KEY is set): general web search through the Brave Search API free tier.
  Without it, general web pages come from the agent's own web search tool and are added with `polaris_source_add`.

Tools:
- `polaris_find {query, providers?, limit?, year_from?, lang?}`: one query, normalized and scored results; nothing is
  added to the registry.
- `polaris_research {subject_dir, module?, queries: [...], providers?, per_provider?, year_from?, auto_add?}`: runs
  every query on every provider (rate limited, responses cached for 24 h in `polaris/.cache/`, git-ignored),
  de-duplicates (DOI, arXiv id, URL, normalized title), ranks, writes a shortlist file
  `polaris/research/<yyyy-mm-dd>-<slug>.md` (tracked: rank, title, link, kind, year, citations, open access, score and
  the reasons), and when `auto_add` > 0 adds the top N as sources (label `extension` unless the item matches a
  source of truth) and captures them. Returns the shortlist in compact form for the review gate.
- `polaris_capture {subject_dir, ids, full?}`: (re)capture sources. Web pages: the built-in extractor. Open-access PDFs
  (arXiv or OpenAlex/Semantic Scholar OA links only): download to a temp file, extract with `pdftotext -layout`
  (Git for Windows ships it; fall back to `py -3.11` with pypdf), write "[p. N]" page markers, delete the PDF and keep
  only the text capture. YouTube: auto or manual subtitles via yt-dlp (vi, then en) converted to "[mm:ss] text" lines;
  fall back to youtube_transcript_api through `py -3.11`. Wikipedia: the plain-text extract. Captures are capped at
  about 400 KB with a truncation note.

Ranking (documented in the guide, every score comes with its reasons): type priority from the source policy
(course > official docs > paper > book/tutorial > video/blog), relevance (query and module keywords in title and
abstract), authority (log-scaled citations for papers, official domains and organisations, channel for videos),
recency (configurable half-life, not for classics), open access available, language match.

Courtesy and law: a clear User-Agent ("Polaris/0.2 (personal study course builder; https://github.com/DuongNAD)"),
per-provider rate limits, robots.txt honoured for HTML page fetches, open-access full text only (never paywalled or
pirated copies), captures stay git-ignored and are only for personal study.

## Status
- 2026-10-10: v0.1 built and verified (MCP stdio server, CLI, Zod schemas with corrective error suggestions, source capture for web/arXiv/local, quality gates, Vietnamese ROADMAP.md rendering, e2e test suite passing).
- 2026-10-10: v0.2a research engine built and verified (`polaris_find`, `polaris_research`, `polaris_capture`, keyless providers OpenAlex/arXiv/SemanticScholar/CrossRef/Wikipedia/GitHub/YouTube, transparent ranking with reasons, de-duplication, 24h cache, Vietnamese shortlist files in `polaris/research/`, full-text open-access PDF extraction via pdftotext with page markers, YouTube transcript extraction via yt-dlp, robots.txt check, rate limits & retry backoff, review gate, extended e2e test suite passing).
- 2026-10-10: v0.2b built and v0.2.0 released (`polaris_schedule` deterministic slot scheduling with DAG ordering, blackout & hub P0 deadline skipping, interleaved review sessions every N weeks; `polaris_export_course` Aurora Slides course.json generator with module splitting, theme rotation, Phosphor icons, idempotent merge, and Vietnamese lesson outline skeletons; `polaris_tasks_sync` task syncing to hub TASKS.md with duplicate prevention; `polaris_errorlog_add` error log with spaced review; `polaris_lesson_done` completion tracking; `polaris_review_due` spaced review queries; updated prompts `new_course`, `next_lesson`, and `research`; full e2e test suite passing).
- 2026-10-10: v0.3.0 built and released (v0.3 done: closed-loop learning integration with Aurora Slides; `polaris_progress_sync` for ingesting interactive learning events from `progress.jsonl` into Sổ lỗi with deduplication and spaced review scheduling; `polaris_today` for generating 30m/60m session plans and updating `## Today's Dynamic Goal` in `ACTIVE_LEARNING.md`; `review` prompt; guide topics `progress` and `aurora`; Polaris + Aurora unified workflow docs with Mermaid flow and side-by-side MCP configs; complete e2e test suite passing with 20 tools).
- 2026-10-11: v0.3.2 built and released: Optimized for exFAT SSD and SmartDrive-OS. Regenerable API cache moved to global cache directory (`POLARIS_CACHE_DIR` or `%LOCALAPPDATA%/polaris/cache/<hash>`) to avoid cluster slack waste on 512 KB cluster drives; captures stay in subject; non-blocking detached SmartDrive update hooks (`smart-drive update <dir> --quiet`) after writes to `<subject>/polaris` and exported slide course folders with 2s coalescing per directory; configurable via `POLARIS_SMARTDRIVE_CMD` and `POLARIS_SMARTDRIVE=off`.
- 2026-10-11: v0.3.3 built and released: Integrated Vega MCP (FSRS flashcard memory engine). `polaris_today` reads `<hub>/.vega/cards.json` (read-only) to report Vega cards due by end of today (and count for the active subject) with next step "vega_sync, then vega_session to review", budgeting 10 minutes in the 30m/60m session recipe when cards are due (graceful fallback if absent/unreadable); `polaris_progress_sync` recognizes and cleanly skips "card" events emitted by Aurora, preserving them for Vega.
- 2026-10-11: v0.3.4 built and released: Block server-side request forgery (SSRF) in source capture and research fetches. Outbound requests strictly allow http/https only, resolve hosts via DNS (node:dns with all addresses), refuse loopback (127/8, ::1), unspecified (0.0.0.0, ::), private LANs (10/8, 172.16/12, 192.168/16, fc00::/7), link-local/cloud metadata (169.254/16, fe80::/10), CGNAT (100.64/10), multicast, reserved ranges, IPv4-mapped IPv6, and localhost/*.localhost. Follow redirects manually (max 5 hops) with re-validation on every hop. Added POLARIS_ALLOW_PRIVATE_URLS=1 opt-in for deliberate local use and e2e fixture server.
- 2026-10-11: v0.3.5 built and released: Resolved findings from Machine Learning dogfood report. (1) Facts gate false-positive exemptions for mathematical notation (exponents/indices R^2, x^2, O(d^3), O(n log n), w_1, L1/L2), dimensions (1D/2D/3D, n×d), structural markers (bước 1, slide 3, M1/M2.1, F12/S3 IDs, locators), LaTeX $...$, and inline code, while strictly enforcing crossCheck for empirical quantities (50 TOPS, 92%, 2023, 22.22x). (2) Open-Access fallback in capture for 401/403/429 or bot walls via OpenAlex (best_oa_location / open_access.oa_url) and Unpaywall with SSRF guards and dual URL recording. (3) Documented brief `roadmapPath` ("render the roadmap elsewhere so a learner's own ROADMAP.md is never overwritten") in guide, README, and README.vi. (4) Comprehensive e2e unit & integration tests passing.
