[Tiếng Việt](README.vi.md)

# Polaris MCP

Polaris is a Model Context Protocol (MCP) server and command-line interface (CLI) that gives coding agents (Claude Code, Google Antigravity, Cursor) the deterministic structure, persistence, research discovery, source capture, and quality gates to build personalized, evidence-based study courses.

Sister project to [Aurora Slides MCP](https://github.com/DuongNAD/aurora-slides-mcp), which renders the presentations.

## Principles

1. **The agent reasons, Polaris structures:** Every artifact is strictly validated with Zod schemas and rendered into Markdown or Aurora course inputs. Typos produce actionable, corrective error messages with "did you mean...".
2. **Evidence first:** Every factual bullet in a roadmap cites verified facts; every fact points to a source plus a precise locator (timestamp `[mm:ss]`, page `[p. N]`, section, line numbers). Labels distinguish primary truth (`course`), extensions (`extension`), and unverified claims (`unverified`).
3. **Learner fit:** The learner profile drives language (Vietnamese by default with correct diacritics), session recipes, study techniques (theory -> memory anchors -> paper notebook -> practice easy-to-hard -> recall walk; predict-then-run for code), and constraints.
4. **Quality gates:** Automated gates verify brief completeness, source labels and quality scores, fact locators, outcome coverage, dependency DAG cycles, and flag overclaims.
5. **Files, not databases:** Plain JSON and Markdown inside the subject folder (`polaris/brief.json`, `sources.json`, `facts.json`, `roadmap.json`, `captures/`, `research/`). Captured third-party text is kept local and git-ignored.

## Architecture & Directory Layout

### Hub Level (`POLARIS_HUB`, default: `D:/02_Learning_Knowledge`)
```
<hub>/
└── .polaris/
    └── learner.json         # Learner profile (study methods, session types, visual taste, commitments)
```

### Subject Level (`<subject>/polaris/`)
```
<subject>/
├── 04_Roadmaps/
│   └── ROADMAP.md           # Rendered gold-standard roadmap in Vietnamese
└── polaris/
    ├── .gitignore           # Ignores captures/ and .cache/
    ├── brief.json           # Subject, goal, measurable outcomes with check criteria, hoursPerWeek
    ├── sources.json         # Registry of primary course materials, papers, web pages, local files
    ├── facts.json           # Discrete factual claims with locators and source IDs
    ├── roadmap.json         # Module structure, practice tiers, self-check questions, checkpoints
    ├── .cache/              # 24-hour search query cache (git-ignored)
    ├── research/            # Generated research shortlist files (e.g. 2026-10-10-ai-agents.md)
    └── captures/            # Full-text extractions of web pages, arXiv PDFs, and YouTube transcripts (git-ignored)
        ├── S1.md
        └── S2.md
```

## Tools (v0.1 & v0.2a)

| Tool | Description |
|---|---|
| `polaris_guide` | In-depth documentation on workflow, pipeline, quality gates, source policy, research engine, and learner method. |
| `polaris_profile` | Read (`get`) or update (`update`) learner preferences, study methods, session recipes, and constraints. |
| `polaris_start` | Initialize `<subject>/polaris/` and save validated `brief.json` with measurable outcomes. |
| `polaris_find` | Discover research material across keyless providers with transparent scoring, reasons, and open-access links. |
| `polaris_research` | Multi-query research investigation across providers with 24h caching, de-duplication, ranking, shortlist generation, and optional auto-add. |
| `polaris_source_add` | Register sources (web URLs, arXiv IDs, local files) with automatic text capture and de-duplication. |
| `polaris_capture` | Capture source full-text content (PDF via `pdftotext` with page markers, YouTube transcripts via `yt-dlp` with timestamps, web/Wikipedia text). |
| `polaris_sources` | List, search, filter, or update sources in `sources.json`. |
| `polaris_fact_add` | Record discrete claims with source IDs and precise locators (timestamp, page, section, lines). |
| `polaris_facts` | Search and filter verified facts by query, module ID, or source ID. |
| `polaris_roadmap_save` | Validate roadmap through quality gates, save `roadmap.json`, and render `ROADMAP.md`. |
| `polaris_check` | Run the complete quality gate audit across brief, sources, facts, and roadmap. |

## Research Engine (v0.2a)

Polaris includes an autonomous discovery and research engine designed for academic and developer learning:

### Keyless Providers
- **`openalex`**: Works, publication years, citations, inverted-index reconstructed abstracts, and open-access PDF URLs.
- **`arxiv`**: Atom XML API with 1 call / 3s rate limit; metadata and full-text PDF download.
- **`semanticscholar`**: Paper metadata, TL;DR summaries, citation counts, and OA links with exponential backoff on HTTP 429/503.
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

### Review Gate Workflow
1. The agent executes `polaris_research` with queries and target module.
2. Polaris generates a shortlist file `polaris/research/<yyyy-mm-dd>-<slug>.md` with a summary table and detailed evaluation reasons.
3. The agent presents the top 10 candidates to the learner and pauses for approval before adding items to `sources.json` (unless `auto_add > 0` was specified).
4. Approved sources are captured locally with full text (PDF page markers `[p. N]`, YouTube timestamps `[mm:ss]`) into `captures/<id>.md`.

## CLI Usage

Run directly via Node.js or `bin/polaris`:

```bash
# Start MCP server on stdio
node dist/polaris.mjs

# Run quality gate check on a subject folder
node dist/polaris.mjs check <subject_dir>

# Re-render ROADMAP.md from polaris/roadmap.json
node dist/polaris.mjs render <subject_dir>

# View guide topics (e.g. overview, pipeline, gates, sources, roadmap, research, learner, rules)
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
