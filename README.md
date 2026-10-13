[Tiếng Việt](README.vi.md)

<p align="center"><img src="docs/banner.jpg" alt="Polaris MCP — star trails around the North Star" width="100%"></p>

# Polaris MCP

*Named after Polaris, the North Star: the whole sky turns around it, the way a roadmap keeps every lesson on course.*

Polaris is a Model Context Protocol (MCP) server and command-line interface (CLI) that gives coding agents (Claude Code, Google Antigravity, Cursor) the deterministic structure, persistence, research discovery, source capture, schedule planning, slide deck export, and quality gates to build personalized, evidence-based study courses.

Sister project to [Aurora Slides MCP](https://github.com/DuongNAD/aurora-slides-mcp), which renders the presentations.

## Principles

1. **The agent reasons, Polaris structures:** Every artifact is strictly validated with Zod schemas and rendered into Markdown or Aurora course inputs. Typos produce actionable, corrective error messages with "did you mean...".
2. **Evidence first:** Every factual bullet in a roadmap cites verified facts; every fact points to a source plus a precise locator (timestamp `[mm:ss]`, page `[p. N]`, section, line numbers). Labels distinguish primary truth (`course`), extensions (`extension`), and unverified claims (`unverified`).
3. **Learner fit:** The learner profile drives language (Vietnamese by default with correct diacritics), weekly study slots, blackout periods, session recipes (30m, 60m, 90m lab), study techniques (theory -> memory anchors -> paper notebook -> practice easy-to-hard -> recall walk; predict-then-run for code), and the review engine (one adaptive scheduler, Vega FSRS, or the older fixed D+ steps).
4. **Quality gates:** Automated gates verify brief completeness, source labels and quality scores, fact locators, outcome coverage, dependency DAG cycles, and flag overclaims.
5. **Files, not databases:** Plain JSON and Markdown inside the subject folder (`polaris/brief.json`, `sources.json`, `facts.json`, `roadmap.json`, `schedule.json`, `course-map.json`, `tasks-map.json`, `reviews.json`, `errorlog.md`, `captures/`, `research/`, `lessons/`). Captured third-party text is kept local and git-ignored.

## Architecture & Directory Layout

### Hub Level (`POLARIS_HUB`, default: `D:/02_Learning_Knowledge`)
```
<hub>/
├── AGENTS.md                # Global hub rules & agent guidance
├── ACTIVE_LEARNING.md       # Priority learning goals, P0 deadlines & checkpoints
├── TASKS.md                 # Workspace tasks
├── .polaris/
│   └── learner.json         # Learner profile (slots, blackouts, recipes, taste, commitments, method.reviewEngine)
└── .vega/                   # Vega's personal data (git-ignored); Polaris only drops files into inbox/
    └── inbox/               # Card candidates from Polaris (contract vega-card-inbox.v1), ingested on vega_sync
```

### Subject Level (`<subject>/`)
```
<subject>/
├── 04_Roadmaps/
│   └── ROADMAP.md           # Rendered gold-standard roadmap in Vietnamese (with calendar & reviews)
├── 05_Slides/
│   └── <slug>/
│       └── course.json      # Aurora Slides course specification
├── TASKS.md                 # Subject tasks (synced under '## Polaris')
└── polaris/
    ├── .gitignore           # Ignores captures/ and legacy .cache/
    ├── brief.json           # Subject, goal, measurable outcomes with check criteria, hoursPerWeek
    ├── sources.json         # Registry of primary course materials, papers, web pages, local files
    ├── facts.json           # Discrete factual claims with locators and source IDs
    ├── roadmap.json         # Module structure, practice tiers, self-check questions, checkpoints
    ├── schedule.json        # Deterministic slot schedule, session dates, and when labels
    ├── course-map.json      # Stable module/lesson ID to Aurora lesson mapping
    ├── tasks-map.json       # Synced task ID to hub task mapping (duplicate prevention)
    ├── reviews.json         # Fixed engine only: Polaris's own D+1, D+3, D+7, D+16, D+35 steps (older steps are kept, never migrated)
    ├── progress-state.json  # Idempotent sync state (processed events, completed lessons)
    ├── errorlog.md          # Learner error log ("Sổ lỗi"); under Vega each entry names its Vega card instead of D+ dates
    ├── research/            # Generated research shortlist files (e.g. 2026-10-10-ai-agents.md)
    ├── captures/            # Full-text extractions of web pages, arXiv PDFs, and YouTube transcripts (git-ignored)
    │   ├── S1.md
    │   └── S2.md
    └── lessons/             # Lesson outline skeletons for review before deck generation
        ├── 01-tong-quan.outline.md
        └── 02-kien-truc.outline.md
```

> **Note on API Cache:** Regenerable search API responses (24h TTL) are stored in the global cache directory (`%LOCALAPPDATA%/polaris/cache` or `POLARIS_CACHE_DIR`), saving space on exFAT drives.

## Tools (v0.4.0)

Polaris exposes 20 specialized MCP tools across 5 major functional domains:

### 1. Profile & Setup
| Tool | Description |
|---|---|
| `polaris_guide` | Documentation on workflow, pipeline, quality gates, source policy, research engine, schedule, export, tracking, progress sync, today session planning, aurora workflow, and learner method. |
| `polaris_profile` | Read (`get`) or update (`update`) learner preferences, weekly slots (`slots`), blackout dates (`blackouts`), session recipes, and the review engine `method.reviewEngine` (`vega` or `fixed`; `null` removes the override). `get` ends with the engine in force. |
| `polaris_start` | Initialize `<subject>/polaris/` and save validated `brief.json` with measurable outcomes and optional `roadmapPath` ("render the roadmap elsewhere so a learner's own ROADMAP.md is never overwritten"). |

### 2. Research & Sources (with SSRF Guard & Open-Access Fallback)
All outbound network fetches (web pages, arXiv papers, open-access PDFs, Wikipedia, provider APIs, and robots.txt lookups) are guarded against Server-Side Request Forgery (SSRF): only `http:` and `https:` schemes are allowed; hosts are resolved and private/local addresses (loopback, private LAN, link-local cloud metadata 169.254.169.254, CGNAT, multicast, reserved ranges, IPv4-mapped IPv6, and localhost) are refused; redirects are followed manually (max 5 hops) and re-verified on every hop. Set `POLARIS_ALLOW_PRIVATE_URLS=1` to permit local addresses during deliberate testing. When sources have a known `oaUrl`, Polaris captures the open-access copy first while preserving the original publisher link. When a publisher URL or DOI returns 401/403/429, a network failure with a known DOI, or a bot wall interstitial (< 1500 chars of text with strong challenge markers), Polaris queries OpenAlex and Unpaywall for legitimate open-access alternatives, respecting robots.txt on all URLs. Polaris never bypasses paywalls.

| Tool | Description |
|---|---|
| `polaris_find` | Discover research material across keyless providers with transparent scoring, reasons, and open-access links. |
| `polaris_research` | Multi-query research investigation across providers with 24h caching, de-duplication, ranking, shortlist generation, and optional auto-add. |
| `polaris_source_add` | Register sources (web URLs, arXiv IDs, local files) with automatic text capture and de-duplication. |
| `polaris_capture` | Capture source full-text content (PDF via `pdftotext` with page markers, YouTube transcripts via `yt-dlp` with timestamps, web/Wikipedia text). |
| `polaris_sources` | List, search, filter, or update sources in `sources.json`. |

### 3. Facts, Roadmap & Quality Gates
| Tool | Description |
|---|---|
| `polaris_fact_add` | Record discrete claims with source IDs and precise locators (timestamp, page, section, lines). |
| `polaris_facts` | Search and filter verified facts by query, module ID, or source ID. |
| `polaris_roadmap_save` | Validate roadmap through quality gates, save `roadmap.json`, and render `ROADMAP.md`. |
| `polaris_check` | Run the complete quality gate audit across brief, sources, facts, roadmap, schedule, and course export. |

### 4. Scheduling & Slide Export
| Tool | Description |
|---|---|
| `polaris_schedule` | Deterministically fit module hours into weekly slots, skip blackouts and P0 deadlines from `ACTIVE_LEARNING.md`/`TASKS.md`, insert review sessions every N weeks, write `schedule.json`, update `ROADMAP.md` 3.2, and return Vietnamese `when` labels. |
| `polaris_export_course` | Export Aurora Slides `course.json` (splitting > 2.5h modules, alternating themes, Phosphor icons) with idempotent merging and generate lesson outline skeletons in `polaris/lessons/<dir>.outline.md`. |

### 5. Tracking & Learning Hub Sync
| Tool | Description |
|---|---|
| `polaris_tasks_sync` | Sync scheduled lessons and module checkpoints into `<subject>/TASKS.md` under `## Polaris` in hub format (`- [ ] [Deadline: ...] [Priority: P2] ...`) with duplicate prevention. |
| `polaris_progress_sync` | Read Aurora Slides interactive learning events from `progress.jsonl` (or exported files), map lessons to modules, add error log entries for wrong quizzes, predict gaps, and missed palace stations, and hand the reviews to the review engine: under `vega` one inbox file per sync carries a Vega card per new entry plus the self-check cards of newly completed lessons (nothing is added to `reviews.json`); under `fixed` it schedules D+1, D+3, D+7, D+16, D+35 reviews. Skips Vega "card" flashcard events cleanly. Idempotent. |
| `polaris_errorlog_add` | Record prediction errors and gaps into `polaris/errorlog.md` ("Sổ lỗi"). Under `vega` the entry's review line names its Vega card (`- **Ôn tập:** thẻ Vega ... (FSRS lập lịch)`) and one card goes to the Vega inbox; under `fixed` it schedules the D+ steps. |
| `polaris_lesson_done` | Record lesson completion. Under `vega` the lesson's module self-check questions become Vega cards (nothing if the module has none); under `fixed` it records the lesson in `polaris/reviews.json` and schedules reviews after 1, 3, 7, 16, and 35 days. |
| `polaris_review_due` | Query the legacy fixed review steps in `polaris/reviews.json` due on or before a given date, ordered oldest first. Under `vega` it adds one line with the Vega due count (read-only from `<hub>/.vega/cards.json`) and the next step `vega_sync, rồi vega_session`. |
| `polaris_today` | Generate a 60- or 30-minute session plan following learner session recipe (due reviews, Vega FSRS card review load from `<hub>/.vega/cards.json` with next step "vega_sync, then vega_session to review" and, under `vega`, the engine line `vega_sync, rồi vega_session`, next scheduled lesson with slide & outline paths, practice tier with DoD). Optionally write or replace `## Today's Dynamic Goal` in `<hub>/ACTIVE_LEARNING.md`. |

## One Review Engine: Vega (v0.4.0)

Spaced reviews are scheduled by **one adaptive engine, Vega (FSRS)**, not by Polaris's own fixed D+1/D+3/D+7/D+16/D+35 steps. Polaris keeps the human-readable error log ("Sổ lỗi") and hands review items to Vega through a shared inbox; the learner then runs `vega_sync` and `vega_session` (Vega MCP).

**Which engine is in force:** `method.reviewEngine` of the learner profile (`"vega"` or `"fixed"`) when set; otherwise `vega` when `<hub>/.vega/` exists; otherwise `fixed`. `polaris_profile get` and `polaris_guide { topic: "learner" }` print the engine in force. Change it with `polaris_profile { action: "update", patch: { method: { reviewEngine: "fixed" } } }` (`null` returns to automatic choice).

| | `vega` | `fixed` |
|---|---|---|
| Error log entry (`polaris_errorlog_add`, quiz / predict / recall misses in `polaris_progress_sync`) | Same Markdown entry in `errorlog.md`; the review line reads ``- **Ôn tập:** thẻ Vega `<key>` (FSRS lập lịch)``; one card per entry in the inbox; nothing in `reviews.json` | Exactly as before: D+ line and D+ steps in `reviews.json` |
| `polaris_lesson_done` | The module's roadmap self-check questions become cards (key `polaris:<subject>:selfcheck:<module id>:<index>`); if there are none, nothing is written and the reply says so | Lesson item with D+ steps in `reviews.json` |
| `polaris_review_due`, `polaris_today` | Legacy steps already in `reviews.json` are still listed (never deleted or migrated), plus the Vega due count and the next step `vega_sync, rồi vega_session` | As before: the legacy list (and, in `polaris_today`, the 0.3.3 card-load line when `cards.json` exists) |

**Inbox contract `vega-card-inbox.v1`** (shared by Vega, Polaris, Orion, Mira, Constellation): `<hub>/.vega/inbox/`, one new file per tool call named `polaris-<YYYYMMDDTHHmmss>-<6 hex>.jsonl` (UTC), UTF-8, one JSON object per line, written atomically as `.jsonl.tmp` then renamed. Polaris never appends to or rewrites an inbox file and never touches Vega's `cards.json` or `reviews.jsonl`. Every line is validated against the contract before writing (unknown fields rejected); if one line would be invalid nothing is written and the errors are reported. Vega alone validates again, de-duplicates by `key` and schedules with FSRS. Storage note: inbox files are tiny and there is one per tool call, so on a 512 KB-cluster exFAT drive each occupies a whole cluster until Vega ingests it (the contract moves processed files to `inbox/done/`; prune or bundle those from time to time).

| Source | `key` | `front` | `back` | `origin` |
|---|---|---|---|---|
| Quiz miss | `polaris:<subject folder>:<entry id>` | the question | correct answer (+ explanation) | `polaris-errorlog`, `errorlog.md`, entry id |
| Predict miss | same | what to predict (title) | the real output | same |
| Recall miss | same | `<palace> · <place>: mục nào?` | the item | same |
| Manual entry | same | the situation to re-solve, from `prediction` / `result` | `why` + `fix` | same |
| Lesson self-check | `polaris:<subject folder>:selfcheck:<module id>:<index>` (index from 1) | the question | the answer | `polaris-selfcheck`, `roadmap.json`, `<module id> #<index>` |

**Why one adaptive engine:** two schedulers on the same item double the reviews and create review debt, so one adaptive scheduler beats several fixed ones. Expanding versus uniform intervals make no reliable difference (Latimier, Peyre and Ramus 2021, [doi:10.1007/s10648-020-09572-8](https://doi.org/10.1007/s10648-020-09572-8)), so the shape of a fixed ladder is not what buys retention. Personalised review beat one-size-fits-all spacing (Lindsey et al. 2014, [doi:10.1177/0956797613504302](https://doi.org/10.1177/0956797613504302)). Error log reviews should re-solve, never reread (successive relearning, Rawson and Dunlosky 2011, [doi:10.1037/a0023956](https://doi.org/10.1037/a0023956)), which is why every card asks for the situation to be solved again.

## Polaris + Aurora

Polaris and [Aurora Slides MCP](https://github.com/DuongNAD/aurora-slides-mcp) operate together as a closed-loop personalized learning ecosystem:

```mermaid
flowchart TD
  subgraph Polaris_Planning ["1. Polaris: Planning & Scheduling"]
    P1["Profile & Brief"] --> P2["Research Discovery & Fact Extraction"]
    P2 --> P3["Roadmap & Quality Gates"]
    P3 --> P4["Deterministic Slot Scheduling"]
    P4 --> P5["Export: course.json & Lesson Outlines"]
  end

  subgraph Aurora_Learning ["2. Aurora Slides: Active Learning"]
    A1["Author Decks with Fact Citations & Code"] --> A2["Interactive Preview Server"]
    A2 --> A3["Learner: Quizzes, Predictions & Recall Walk"]
    A3 --> A4["progress.jsonl Event Stream"]
  end

  subgraph Polaris_Loop ["3. Polaris: Closed-Loop Tracking"]
    L1["polaris_progress_sync"] --> L2["Error Log ('Sổ lỗi')"]
    L1 --> L3["Vega inbox cards (FSRS schedules the reviews)"]
    L2 --> L4["polaris_today (Daily Session Plan & Goal)"]
    L3 --> L4
  end

  P5 --> A1
  A4 --> L1
  L4 -.-> A2
```

### Ecosystem

All projects by DuongNAD:

| Project | Role | Repository |
| :--- | :--- | :--- |
| **Polaris** | Course architect: sources, facts with locators, roadmap, schedule, error log | [polaris-mcp](https://github.com/DuongNAD/polaris-mcp) |
| **Aurora Slides** | Keynote-style lessons: quizzes, predict and trace slides, progress events | [aurora-slides-mcp](https://github.com/DuongNAD/aurora-slides-mcp) |
| **Vega** | FSRS memory engine and the single review queue (card inbox) | [vega-mcp](https://github.com/DuongNAD/vega-mcp) |
| **Orion** | Practice labs with real tests, tutoring ladder and PRIMM warm-up | [orion-mcp](https://github.com/DuongNAD/orion-mcp) |
| **Mira** | Code-tracing lab: real Python traces, line-by-line players with prediction gates | [mira-mcp](https://github.com/DuongNAD/mira-mcp) |
| **Rigel** | Grounded tutor: answers from the learner's lesson materials with [ref] citations | [rigel-mcp](https://github.com/DuongNAD/rigel-mcp) |
| **Sirius** | Execution loop: deadlines, triage, today router, session timer, weekly review | [sirius-mcp](https://github.com/DuongNAD/sirius-mcp) |
| **Constellation** | MCP registration, health checks and shared contracts | [constellation-mcp](https://github.com/DuongNAD/constellation-mcp) |
| **SmartDrive-OS** | SSD governance, index and learning search | [smart-drive-os](https://github.com/DuongNAD/smart-drive-os) |

### Connections

- Aurora: exports `course.json` and lesson outlines; reads Aurora `progress.jsonl` (`aurora-progress-event.v1`) into the error log.
- Vega: error-log entries and lesson self-checks become cards in the Vega inbox (`vega-card-inbox.v1`).
- Rigel: `[ref]` + locator from Rigel's `search_material` are valid fact locators for course materials.
- SmartDrive-OS: the post-write hook keeps the learning index fresh; learning search over facts and outlines.
- Sirius: reads the error log and review steps as study evidence (read-only).

### Side-by-Side Installation

With Constellation installed, `constellation register --dry-run` then `constellation register` keeps every agent config in sync.

#### Claude Code CLI (`claude mcp add`)
```bash
claude mcp add polaris -- node D:/03_Development_Projects/ai_agents/polaris_mcp/dist/polaris.mjs
claude mcp add aurora-slides -- node D:/03_Development_Projects/Slide_Projects/my_projects/aurora_slides_mcp/dist/aurora.mjs
```

#### Antigravity Configuration (`mcp_config.json`)
```json
{
  "mcpServers": {
    "polaris": {
      "command": "node",
      "args": ["D:/03_Development_Projects/ai_agents/polaris_mcp/dist/polaris.mjs"],
      "env": {
        "POLARIS_HUB": "D:/02_Learning_Knowledge",
        "POLARIS_TOOLCHAIN": "C:/Users/Admin/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Local/aurora-slides/toolchain"
      }
    },
    "aurora-slides": {
      "command": "node",
      "args": ["D:/03_Development_Projects/Slide_Projects/my_projects/aurora_slides_mcp/dist/aurora.mjs"],
      "env": {
        "AURORA_TOOLCHAIN": "C:/Users/Admin/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Local/aurora-slides/toolchain"
      }
    }
  }
}
```

## Research Engine

Polaris includes an autonomous discovery and research engine designed for academic and developer learning:

### Keyless Providers
- **`openalex`**: Works, publication years, citations, inverted-index reconstructed abstracts, and open-access PDF URLs.
- **`arxiv`**: Atom XML API with 1 call / 3s rate limit; metadata and full-text PDF download.
- **`semanticscholar`**: Paper metadata, TL;DR summaries, citation counts, and OA links with exponential backoff on HTTP 429/503. Conservative rate-limiting of at least 1100 ms between requests (configurable via `POLARIS_S2_MIN_INTERVAL_MS`, minimum 1000 ms). Supports optional `SEMANTIC_SCHOLAR_API_KEY` (alias `S2_API_KEY`) placed in the polaris server's `"env"` block of your MCP configuration (request a key at https://www.semanticscholar.org/product/api; never commit keys into git repositories). Keyless access remains the default. Base URL can be overridden via `POLARIS_S2_URL`.
- **`crossref`**: DOIs, journals, books, and citation references.
- **`wikipedia`**: Vietnamese (`vi`) and English (`en`) summaries and plain-text extracts.
- **`github`**: Official repositories and code implementations (10 req/min unauthenticated rate limit).
- **`youtube`**: Public lecture search and transcript extraction via `yt-dlp`.
- **`brave`**: Optional general web search if `BRAVE_API_KEY` is provided.

### Ranking Factors & Reasons
Every result receives a transparent score (0-100) and evaluation reasons:
- **Type Priority**: Primary course > Specs & papers > Books & tutorials > Videos, repos, web.
- **Relevance**: Exact query and module keyword matches in titles and abstracts.
- **Authority**: Log-scaled citations (`Math.log10(citations + 1)`), GitHub stars, and peer-reviewed venues (ICLR, NeurIPS, Nature, etc.).
- **Recency**: Boosts recent publications (>= 2022) and respects `year_from` filters.
- **Open Access**: +10 score for open-access PDFs and freely accessible content.
- **Language**: Matches learner language preferences (Vietnamese / English).

## Scheduling & Aurora Integration

1. **Deterministic Calendar Fit (`polaris_schedule`):**
   - Topological sorting of module dependencies (DAG).
   - Module hours mapped into the learner's weekly study slots (e.g. Tue 30m, Sat 60m).
   - Skips configured blackout intervals.
   - Automatically detects unchecked P0 deadlines in the learning hub (`ACTIVE_LEARNING.md` and `TASKS.md`) and clears both the deadline day and the day before.
   - Inserts interleaved review sessions every `interleave_every` weeks (default 4).
   - Re-renders Section 3.2 in `ROADMAP.md` as an exact weekly calendar table with Vietnamese dates.

2. **Aurora Slides Course Export (`polaris_export_course`):**
   - Generates strict `course.json` compatible with Aurora Slides CLI/MCP.
   - Splits long modules (> 2.5 hours or `lessons: 2`) into manageable sub-lessons (a/b).
   - Alternates visual themes (`aurora`, `midnight`, `daylight`, `titanium`, `ocean`, `sunset`, `forest`, `paper`, `liquid`) between neighbouring lessons.
   - Selects contextual Phosphor duotone icons.
   - Idempotently merges with existing courses via `course-map.json`.
   - Generates detailed lesson outline skeletons in Vietnamese (`polaris/lessons/<dir>.outline.md`) featuring facts, quiz distractors from misconceptions, DoD practice exercises, memory palace anchors, 4-8 line notebook summaries, and slide plans.

3. **Learning Hub Synchronization (`polaris_tasks_sync`):**
   - Appends lesson and checkpoint tasks to `<subject>/TASKS.md` under `## Polaris`.
   - Formats tasks strictly: `- [ ] [Deadline: YYYY-MM-DD 23:59] [Priority: P2] Học bài <n>: <title>`.
   - Preserves line endings and prevents duplicates using `polaris/tasks-map.json`.

4. **Closed-Loop Progress & Spaced Repetition (`polaris_progress_sync`, `polaris_today`):**
   - `polaris_progress_sync` reads `<course_dir>/progress.jsonl` from Aurora preview server or exported files (supporting Aurora 0.6.1+ optional quiz fields `chosenText`, `answerText`, and `explanation`), while recognizing and cleanly skipping Vega `"card"` flashcard events. The canonical, versioned definition with JSON Schema and fixtures lives in [Constellation's contracts](https://github.com/DuongNAD/constellation-mcp/tree/main/contracts), together with the learning-unit markers, the post-write hook and the source labels; this README summarizes them.
   - Ingests incorrect quiz answers (displaying option texts or indices, explanations, and prompt for root cause), predict-run gaps (displaying predictions, actual output, and reflection prompt), and missed memory palace stations (displaying place, item, and hook prompt) into `polaris/errorlog.md` ("Sổ lỗi").
   - Hands the reviews to the review engine in force (see [One Review Engine](#one-review-engine-vega-v040)): under `vega` one atomic inbox file per sync (`<hub>/.vega/inbox/polaris-<stamp>-<hex>.jsonl`) carries a card per new error log entry and the self-check cards of newly completed lessons, and nothing is added to `polaris/reviews.json`; under `fixed` it schedules spaced repetition reviews at D+1, D+3, D+7, D+16, and D+35 in `polaris/reviews.json`.
   - `polaris_today` calculates 30m/60m session plans, reads `<hub>/.vega/cards.json` to show Vega cards due by the end of today with the next step `"vega_sync, then vega_session to review"` (under `vega` also `vega_sync, rồi vega_session`), budgets 10 minutes in the session recipe when cards are due, and writes `## Today's Dynamic Goal` to the hub's `ACTIVE_LEARNING.md`.

## Agent Prompts & Workflow

Polaris provides 4 prompt workflows:
- **`new_course`**: The full 8-step gated pipeline: Profile -> Brief & Diagnostic -> Research Shortlist -> Facts Extraction -> Roadmap Generation -> Schedule Planning -> Course & Outline Export -> Task Sync -> First Lesson Generation with Aurora.
- **`next_lesson`**: Daily learning loop: Sync progress -> Plan today's session -> Pick the next scheduled lesson -> Refresh outline -> Build presentation deck with Aurora tools adhering to accuracy and fact citations -> Audit slide deck -> Sync tasks -> Record review.
- **`review`**: Active recall session: Ingest latest progress events -> Query due reviews (legacy steps and the Vega due count) -> under the `vega` engine run `vega_sync` then `vega_session`, otherwise guide a 5-10 minute active recall session for error log items and lesson summaries.
- **`research`**: Targeted deep-dive research hunt for a specific module across all keyless providers.

## MCP Server Connection

With Constellation installed, `constellation register --dry-run` then `constellation register` keeps every agent config in sync.

### For Claude Code
Add to your project's `.mcp.json` or `~/.claude.json`:
```json
{
  "mcpServers": {
    "polaris": {
      "command": "node",
      "args": ["D:/03_Development_Projects/ai_agents/polaris_mcp/dist/polaris.mjs"],
      "env": {
        "POLARIS_HUB": "D:/02_Learning_Knowledge",
        "POLARIS_TOOLCHAIN": "C:/Users/Admin/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Local/aurora-slides/toolchain"
      }
    }
  }
}
```

### For Google Antigravity
Add to your Antigravity MCP server configuration:
```json
{
  "polaris": {
    "command": "node",
    "args": ["D:/03_Development_Projects/ai_agents/polaris_mcp/dist/polaris.mjs"],
    "env": {
      "POLARIS_HUB": "D:/02_Learning_Knowledge",
      "POLARIS_TOOLCHAIN": "C:/Users/Admin/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Local/aurora-slides/toolchain"
    }
  }
}
```

## CLI Usage

Run directly via Node.js or `bin/polaris`:

```bash
# Start MCP server on stdio
node dist/polaris.mjs

# Run quality gate check on a subject folder
node dist/polaris.mjs check <subject_dir>

# Re-render ROADMAP.md from polaris/roadmap.json
node dist/polaris.mjs render <subject_dir>

# Compute schedule and update ROADMAP.md section 3.2
node dist/polaris.mjs schedule <subject_dir>

# Export Aurora Slides course.json and lesson outline skeletons
node dist/polaris.mjs export <subject_dir>

# Sync scheduled lessons into <subject>/TASKS.md
node dist/polaris.mjs tasks <subject_dir>

# Sync Aurora progress events into the error log and hand reviews to the review engine (Vega inbox or fixed D+ steps)
node dist/polaris.mjs progress <subject_dir> [course_dir]

# Generate daily session plan and print Today's Dynamic Goal
node dist/polaris.mjs today <subject_dir> [date]

# View guide topics (e.g. overview, pipeline, gates, sources, roadmap, research, schedule, export, tracking, progress, today, aurora, learner, rules)
node dist/polaris.mjs guide [topic]

# Version & help
node dist/polaris.mjs version
node dist/polaris.mjs help
```

## Quality Gates

- **Brief:** `hoursPerWeek` and `start` date set; every outcome has a testable `check` verification string.
- **Sources:** At least one source labeled `course`; all sources have labels and quality scores (1-5) with reasons.
- **Facts:** Every fact references a valid source ID with a non-empty locator; numerical and date claims must have `crossCheck` sources or carry the `unverified` label.
- **Roadmap:** Every brief outcome is covered; modules have `why`, ≥ 2 outputs, core points citing facts, ≥ 1 misconception with fix, materials fitting module hours, 3 practice tiers (`warmup`, `core`, `challenge`) with DoD, ≥ 4 self-check questions with predict questions when code is present, checkpoints, and no circular dependency cycles.
- **Language:** Flags absolute overclaims ("100%", "luôn luôn", "tuyệt đối", "always", "every model").

## Works with SmartDrive-OS

Polaris integrates seamlessly with [SmartDrive-OS](https://github.com/DuongNAD/smart-drive-os) (sister project indexing drives and knowledge hubs):

1. **exFAT SSD Optimization & Global API Cache:**
   - On exFAT drives with large clusters (e.g. 512 KB), thousands of small temporary JSON response files waste hundreds of megabytes in cluster slack space.
   - Polaris stores regenerable 24-hour API research caches outside the subject workspace in a dedicated global cache directory:
     - `POLARIS_CACHE_DIR` (if set)
     - Windows: `%LOCALAPPDATA%/polaris/cache/<subject_hash>`
     - macOS/Linux: `$XDG_CACHE_HOME/polaris/<subject_hash>` or `~/.cache/polaris/<subject_hash>`
   - Captures (`captures/`) remain inside the subject folder because they are permanent study materials.
   - Any legacy `polaris/.cache` folder inside a subject workspace is left untouched, no longer written to, and flagged with a notice during research suggesting it can be safely deleted.

2. **Automatic Index Hook:**
   - Polaris fires a non-blocking, detached background update hook (`smart-drive update <dir> --quiet`) after writes to `<subject>/polaris` (brief, sources, facts, roadmap, research shortlists, captures, error log, lesson outlines, reviews, progress sync) and to exported Aurora course folders.
   - Command resolution:
     - `POLARIS_SMARTDRIVE_CMD` (custom command array, e.g. `smart-drive` or `py -3.11 -m smart_drive`)
     - `smart-drive` on `PATH`
     - Windows fallback: `py -3 -m smart_drive` or `python -m smart_drive`
     - Unix fallback: `python3 -m smart_drive` or `python -m smart_drive`
   - Spawns detached with a 60-second execution timeout, ignores errors silently (logs at most once), and coalesces notifications per folder within a 2-second window.
   - To disable notifications completely, set `POLARIS_SMARTDRIVE=off`.

## Version History

| Version | Description |
|---|---|
| **0.4.0** | One review engine: spaced reviews are scheduled by Vega (FSRS) instead of Polaris's fixed D+1/D+3/D+7/D+16/D+35 steps. New profile field `method.reviewEngine` (`vega` or `fixed`; unset = `vega` when `<hub>/.vega/` exists, else `fixed`), shown by `polaris_profile get` and guide topic `learner`. Under `vega`, `polaris_errorlog_add` and the quiz/predict/recall entries of `polaris_progress_sync` still append the same Markdown entry to `errorlog.md` but its review line becomes `- **Ôn tập:** thẻ Vega ... (FSRS lập lịch)`, nothing is added to `reviews.json`, and one card per entry goes to the Vega inbox `<hub>/.vega/inbox/` (contract `vega-card-inbox.v1`, one atomic file per tool call, producer `polaris`, validated before writing); `polaris_lesson_done` sends the lesson's module self-check questions as cards instead of fixed lesson reviews; `polaris_review_due` and `polaris_today` still list legacy steps and add the Vega due count with the next step `vega_sync, rồi vega_session`. Under `fixed` the behaviour is unchanged. New modules `inbox.ts`, `engine.ts`, `cards.ts`; guide topics `tracking`, `progress`, `today`, `learner`, `overview` updated. |
| **0.3.6** | Optional Semantic Scholar API key support (`SEMANTIC_SCHOLAR_API_KEY`, alias `S2_API_KEY`) configured in the polaris server's `"env"` block of MCP configs (request key at https://www.semanticscholar.org/product/api; never committed in repos; keyless remains default); conservative >= 1100 ms rate-limiting with `POLARIS_S2_MIN_INTERVAL_MS` override (min 1000 ms); credential header stripping (`authorization`, `proxy-authorization`, `x-api-key`, `cookie`) case-insensitively across Headers objects, arrays, and plain objects on cross-origin redirects in `fetchSafeHop`; zero credential leakage in errors, logs, cache keys, captures, or tool output; `POLARIS_S2_URL` test base URL override. |
| **0.3.5** | Polaris dogfood fixes: Intelligent facts gate false-positive exemptions for mathematical notation (exponents/indices `R^2`, `x^2`, `O(d^3)`, `O(n log n)`, `w_1`, `L1/L2`, `l1/l2`), dimensions (`1D/2D/3D`, `n×d`), structural markers (`bước 1`, `slide 3`, `M1/M2.1`, `F12/S3` IDs, locators), LaTeX inside `$...$`, and inline code, while strictly flagging empirical quantities (percentages, measurements, dates, statistics); prefers known open-access copies (`oaUrl`) first while keeping original publisher link; interstitial bot-wall detection (< 1500 chars with strong challenge markers) preventing false positives on normal articles; unified HTML/PDF open-access capture engine; robots.txt validation on open-access URLs; automatic Open-Access fallback via OpenAlex and Unpaywall when publisher URLs return 401/403/429/bot-wall (recording both original and `oaUrl` with notes and keeping SSRF guard on every hop); documented brief `roadmapPath` ("render the roadmap elsewhere so a learner's own ROADMAP.md is never overwritten"). |
| **0.3.4** | SSRF Security Guard: Block Server-Side Request Forgery in source capture and research fetches. Outbound requests strictly allow http/https only, resolve hosts via DNS (`node:dns`), refuse loopback (127/8, ::1), unspecified (0.0.0.0, ::), private LANs (10/8, 172.16/12, 192.168/16, fc00::/7), link-local/cloud metadata (169.254/16, fe80::/10), CGNAT (100.64/10), multicast, reserved ranges, IPv4-mapped IPv6, and localhost/*.localhost. Follow redirects manually (max 5 hops) with re-validation on every hop. Opt-in `POLARIS_ALLOW_PRIVATE_URLS=1` for deliberate local testing. |
| **0.3.3** | Vega MCP integration: Read-only load of due Vega FSRS cards (`<hub>/.vega/cards.json`) in `polaris_today` with 10-minute session recipe budget; silent handling of "card" progress events in `polaris_progress_sync`. |
| **0.3.2** | Fit learner's exFAT SSD and SmartDrive-OS: Moved 24h regenerable API cache off subject folders to global cache (%LOCALAPPDATA%/polaris/cache or POLARIS_CACHE_DIR) with legacy cache cleanup notice; added non-blocking detached SmartDrive update hooks with per-folder 2s coalescing, POLARIS_SMARTDRIVE=off, and POLARIS_SMARTDRIVE_CMD. |
| **0.3.1** | Meaningful error-log entries in Sổ lỗi for Aurora 0.6.1 progress sync: Quiz option texts (chosenText/answerText), explanations, learner reflection prompts in "Nguyên nhân gốc rễ", "Bài học rút ra", and "Neo" hooks. |
| **0.3.0** | Closed-loop integration with Aurora Slides: `polaris_progress_sync` (ingesting quiz, predict, recall, complete events into Sổ lỗi & spaced reviews), `polaris_today` (daily session planner & Active Learning Hub updater), `review` prompt, `progress` and `aurora` guide topics. |
| **0.2.0** | Autonomous research discovery engine across 8 keyless providers (OpenAlex, arXiv, Semantic Scholar, CrossRef, Wikipedia, GitHub, YouTube, Brave), ranking with transparent evaluation reasons, 24h caching, Review Gate, and full-text capture tools. |
| **0.1.0** | Initial release: Evidence-based study course creation, profile management, brief validation, fact extraction, 10-section ROADMAP rendering, deterministic scheduling, and Aurora course export. |

## Toolchain & Build

Polaris adheres to clean drive separation for large-cluster drives (e.g. exFAT): `node_modules` lives in `POLARIS_TOOLCHAIN` (falling back to `%LOCALAPPDATA%/aurora-slides/toolchain`).

```powershell
# In PowerShell:
$env:POLARIS_TOOLCHAIN = "C:\Users\Admin\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\aurora-slides\toolchain"

# Type check & build single bundled file:
node scripts/build.mjs --check

# Run end-to-end tests:
node scripts/e2e.mjs
```

## License

MIT License - Copyright (c) 2026 DuongNAD.

