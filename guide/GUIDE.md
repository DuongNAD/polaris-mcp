# Polaris MCP Guide

Polaris gives coding agents (Claude Code, Google Antigravity) the deterministic structure, persistence, capture tools, and quality gates to build evidence-based personal study courses.

## overview

Polaris operates on five core principles:
1. **The agent reasons, Polaris structures:** Every artifact is strictly validated with JSON Schema (Zod) and rendered into clean Markdown or Aurora lesson outlines. Errors are actionable and corrective ("did you mean...").
2. **Evidence first:** Every factual bullet of a roadmap points to facts; every fact points to a source plus a precise locator (timestamp, page, section, lines). Labels distinguish primary truth (`course`), extensions (`extension`), and unverified claims (`unverified`).
3. **Learner fit:** The learner profile drives language (Vietnamese by default with correct diacritics), session recipes, study techniques (theory -> memory anchors -> paper notebook -> practice easy-to-hard -> recall walk; predict-then-run for code), and constraints.
4. **Quality gates:** The pipeline checks brief completeness, source labels and quality scores, fact locators, outcome coverage, dependency DAG cycles, and flags overclaims before finalizing the roadmap.
5. **Files, not databases:** Plain JSON and Markdown inside the subject folder (`polaris/brief.json`, `sources.json`, `facts.json`, `roadmap.json`, `captures/`). Captured third-party text is kept local and git-ignored.

**One review engine (v0.4.0):** spaced reviews are scheduled by a single adaptive engine, Vega (FSRS), not by Polaris's own fixed D+1/D+3/D+7/D+16/D+35 steps. Polaris keeps the human-readable error log ("Sổ lỗi") and hands review items to Vega through a shared inbox (`<hub>/.vega/inbox/`, contract `vega-card-inbox.v1`); the learner then runs `vega_sync` and `vega_session`. The profile field `method.reviewEngine` (`"vega"` or `"fixed"`) overrides the automatic choice (vega when `<hub>/.vega/` exists, else fixed). See the `tracking` and `learner` topics.

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

## pipeline

The Polaris workflow follows 4 distinct stages:

1. **Profile & Initiation (`polaris_profile`, `polaris_start`):**
   - Check the learner's study methods, session lengths, taste, and hard calendar commitments.
   - Initialize the course brief with measurable outcome criteria (`check`), start date, hours per week, and sources of truth.
   - Polaris creates the `<subject>/polaris/` directory and sets up `.gitignore` for captures.

2. **Source Registry & Capture (`polaris_source_add`, `polaris_sources`):**
   - Register primary course materials, papers (arXiv IDs or URLs), web pages, and local files.
   - Polaris automatically captures clean text/metadata into `captures/<id>.md` with 20 s timeout and zero external API dependencies.
   - Sources are de-duplicated automatically by URL, path, or arXiv ID.

3. **Fact Extraction (`polaris_fact_add`, `polaris_facts`):**
   - Extract discrete claims from sources, written in learner language.
   - Every fact must have a valid locator (e.g. `02:13`, `p. 4`, `Sec. 2.1`, `lines 12-25`).
   - Numerical and date claims must have cross-checking sources or carry the `unverified` label.

4. **Roadmap & Quality Gates (`polaris_roadmap_save`, `polaris_check`):**
   - Structure modules with clear why, 2+ outputs, core points citing facts, misconceptions with fixes, materials with minutes, 3 practice tiers with DoD, 4+ self-check questions with `<details>` answers, and checkpoints.
   - Validate through automated quality gates.
   - Render the complete, gold-standard `ROADMAP.md` in Vietnamese with Mermaid dependency diagrams and generated references.

## brief

The course brief (`polaris/brief.json`) defines high-level learning goals, scope, and operational boundaries:
- `subject`: Name of the course / topic.
- `slug`: URL-friendly identifier for directory naming.
- `goal`: Clear, outcome-focused statement of what the learner will be able to do.
- `outcomes`: Array of measurable objectives with concrete verification conditions (`check`).
- `start`: ISO start date (`YYYY-MM-DD`).
- `deadline`: Optional completion target date.
- `hoursPerWeek`: Realistic weekly study budget (e.g. 2, 3, or 5 hours).
- `sourcesOfTruth`: Primary references (local files, course textbooks, or official URLs).
- `roadmapPath`: Optional relative path to render `ROADMAP.md` (e.g. `"polaris/ROADMAP.polaris.md"`). **Use this to render the roadmap elsewhere so a learner's own ROADMAP.md is never overwritten.**

## gates

Quality gates run during `polaris_check` and `polaris_roadmap_save`:

- **Brief:**
  - `hoursPerWeek` > 0 and `start` date (YYYY-MM-DD) must be defined.
  - Every outcome must have a testable, measurable `check` condition.
- **Sources:**
  - At least one source must carry the `course` label (primary source of truth).
  - Every source must have a label (`course`, `extension`, `unverified`) and a quality score (1-5) with `why`.
- **Facts:**
  - Every fact must point to an existing source in `sources.json`.
  - Every fact must have a non-empty locator (`lines`, `[p. N]`, `Sec. X`, `[mm:ss]`).
  - **Empirical quantities rule:** Claims containing real quantities (percentages like `92%`, measurements, counts with units, dates/years like `2023`, and statistics like `"22.22x"` or `"50 TOPS"`) must either have `crossCheck` sources or carry the `unverified` label.
  - **Exemptions (no crossCheck required):** The gate ignores mathematical notation and conventional names:
    - Exponents and indices: `R^2`, `x^2`, `O(d^3)`, `O(n log n)`, `w_1`, `L1/L2`, `l1/l2`.
    - Dimensions: `1D`, `2D`, `3D`, `n×d`, `(n, 1)`.
    - Ordinal and structural words: `bước 1`, `slide 3`, `M1/M2.1`, `F12/S3` IDs, page numbers inside locators (`[p. 4]`, `lines 12-25`).
    - LaTeX math expressions inside `$...$` or `$$...$$` (e.g. `$x^2$`, `$\|Xw - y\|^2$`).
    - Numbers inside inline code (e.g. `` `n_iter=100` ``, `` `lr=0.001` ``).
    - Mathematical relations with 0 or 1 (`= 0`, `= 1`, `> 0`).
- **Roadmap:**
  - Every brief outcome must be covered by at least one module output.
  - Every module must have:
    - Non-empty `why`.
    - At least 2 `outputs`.
    - `core` bullets that cite valid fact IDs from `facts.json`.
    - At least 1 `misconception` with `wrong` and `fix`.
    - `materials` whose total minutes fit the module's estimated hours.
    - 3 `practice` tiers (`warmup`, `core`, `challenge`), each with `task` and `dod`.
    - At least 4 `selfCheck` questions with answers; if code/scripts are involved, at least one question must have `level: "predict"`.
    - Non-empty `checkpoint`.
  - Module dependencies must form a Directed Acyclic Graph (DAG) with no circular dependency cycles.
  - Total module hours should fit the available time budget.
- **Language / Claims:**
  - Flags absolute overclaims such as "100%", "luôn luôn", "tuyệt đối", "always", "every model", "không bao giờ sai".

## sources

**Source Priority Policy:**
1. **The learner's own course materials:** (Priority 1, label: `course`, source of truth) — official video transcripts, official notebooks, instructor slides.
2. **Official documentation and specifications:** (Priority 2, label: `course` or `extension`) — Python docs, framework docs, ROCm docs, MCP spec.
3. **Primary research papers:** (Priority 3, label: `extension`) — arXiv papers, peer-reviewed publications.
4. **Reputable books and curated tutorials:** (Priority 4, label: `extension`).
5. **Community videos and blog posts:** (Priority 5, label: `extension` or `unverified`).

**Best Practices:**
- Summarize in your own words; quote only short, crucial passages.
- Capture third-party text locally in `captures/<id>.md` (git-ignored, personal study copy).
- For local files, search with the `smart-drive` MCP; never run recursive scans across D:.
- NotebookLM and DeepTutor answers should be registered with the notebook topic and prompt as locator.

**Security & SSRF Guard (v0.3.4):**
- **Strict Protocol Restriction:** Outbound captures only permit `http:` and `https:` schemes. Non-http schemes (`file:`, etc.) are immediately refused.
- **Private & Local Address Blocking:** Every host is resolved via DNS (`node:dns`) with all addresses checked. Polaris refuses loopback (`127.0.0.0/8`, `::1`), unspecified (`0.0.0.0`, `::`), private LANs (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), link-local / cloud metadata (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`), multicast (`224.0.0.0/4`, `ff00::/8`), reserved ranges, IPv4-mapped IPv6 forms of those, and hostnames `localhost` / `*.localhost`.
- **Manual Redirect Protection:** Redirects are followed manually (max 5 hops) and every hop is strictly re-validated through the guard to prevent SSRF via redirect.
- **Opt-In for Local Testing:** `POLARIS_ALLOW_PRIVATE_URLS=1` disables the private address restriction for deliberate local testing while preserving the `http`/`https` scheme requirement.

**Open-Access Fallback & Known OA Copies (v0.3.5):**
- When a source or research item already has an `oaUrl`, Polaris captures the open-access copy directly, preserving the original publisher link in `url` and recording both with an explanatory note.
- When no `oaUrl` is known and a publisher URL returns HTTP 401 Unauthorized, 403 Forbidden, 429 Too Many Requests, or an interstitial bot wall (< 1500 chars with strong challenge markers), Polaris queries OpenAlex (`best_oa_location` / `open_access.oa_url`) and Unpaywall for legitimate open-access copies.
- Evaluates `robots.txt` for both publisher and open-access URLs, skipping with a clear error if disallowed.
- Uses a unified open-access capture engine for both PDF and HTML content.
- **Ethics & Security:** Never bypasses paywalls; preserves outbound SSRF security guard on every hop.

## capture

Polaris captures full-text local copies (`captures/<id>.md`, git-ignored for personal study) from local files, general web pages, arXiv preprints, YouTube transcripts, and open-access research papers. When a source or research item already has an open-access URL (`oaUrl`), Polaris captures the open-access copy first to ensure complete full text is retained, while keeping the original publisher link in `url` and recording both along with an explanatory note. If no `oaUrl` is known and a publisher blocks with HTTP 401/403/429, a network failure with a known DOI, or a bot wall interstitial (< 1500 chars of readable text with strong challenge markers), Polaris queries OpenAlex and Unpaywall for legitimate open-access alternatives. Both publisher and open-access URLs strictly respect robots.txt (skipping with a clear error if disallowed) and enforce the outbound SSRF guard on every hop. Polaris never bypasses paywalls.

## roadmap

The rendered `ROADMAP.md` mirrors the gold-standard 10-section layout in Vietnamese:
- **Header Quote:** Goal statement, relative file path, and primary source of truth.
- **Mục lục:** Clickable Table of Contents for all 10 sections.
- **1. Cách dùng lộ trình này:** Explains labels (`**[Khóa học]**`, `**[Mở rộng]**`, `**(chưa xác minh)**`), the module study loop, and session recipes (60 min: 5 review + 10 study + 35 practice + 7 self-check + 3 plan; 30 min: 5 review + 25 task; 90 min lab).
- **2. Bức tranh toàn cảnh:** 2.1 Năng lực đầu ra, 2.2 Bản đồ module (Mermaid flowchart TD), 2.3 Kiến thức nền cần có + Quick self-test in `<details>`, 2.4 Ngân sách thời gian.
- **3. Trạng thái hiện tại và lịch:** 3.1 Bạn đang ở đây, 3.2 Lịch theo tuần.
- **4. Các module:**
  - Vì sao học
  - Đầu ra (≥ 2 items)
  - Kiến thức cốt lõi (labeled with citations)
  - Hiểu lầm và lỗi hay gặp
  - Tài liệu (with minute estimates)
  - Thực hành (3 tiers: Khởi động, Cốt lõi, Thử thách with DoD)
  - Tự kiểm tra (≥ 4 questions with hidden answers in `<details>`)
  - Checkpoint
- **5. Ôn tập giãn cách và ôn xen kẽ:** Spaced repetition table (D+1, D+3, D+7, D+21/D+35) and interleaved review topics.
- **6. Dự án tổng hợp:** Capstone project description, scope, and Definition of Done.
- **7. Sổ lỗi và cách hỏi DeepTutor:** Error log entry format and 5-level scaffolding prompt guide.
- **8. Tài liệu cũ trong thư mục này:** Reference table of legacy documents.
- **9. Theo dõi tiến độ:** Checklist of completed modules and milestones.
- **10. Nguồn tham khảo:** Generated bibliography table from `sources.json`.

## research

Polaris v0.2a includes an autonomous research and discovery engine with keyless providers, transparent ranking, de-duplication, and open-access capture.

**Keyless Providers:**
- **`openalex`:** Query `api.openalex.org/works`. Extracts metadata, publication year, citations, reconstructed abstracts from inverted indices, and open-access PDF locations.
- **`arxiv`:** Query `export.arxiv.org/api/query` (Atom XML API; rate limited to 1 call every 3 seconds). Extracts preprints and downloads open-access PDFs.
- **`semanticscholar`:** Query `api.semanticscholar.org/graph/v1/paper/search` (or `POLARIS_S2_URL`). Retrieves titles, authors, venues, TL;DR summaries, citations, and open-access PDF links with exponential backoff on HTTP 429/503. Rate limited to >= 1100 ms per request (customizable via `POLARIS_S2_MIN_INTERVAL_MS`, min 1000 ms). Supports optional `SEMANTIC_SCHOLAR_API_KEY` (alias `S2_API_KEY`) configured in the polaris server's `"env"` block of your MCP config (request a key at https://www.semanticscholar.org/product/api; never store keys in git repositories). Keyless access remains the default and continues to work without configuration.
- **`crossref`:** Query `api.crossref.org/works`. Resolves DOIs, journal publications, and books.
- **`wikipedia`:** Query `vi` and `en` Wikipedia APIs. Extracts summaries and structured plain text overviews.
- **`github`:** Query `api.github.com/search/repositories`. Discovers official code implementations and tools (10 req/min unauthenticated rate limit).
- **`youtube`:** Discover video lectures and tutorials via `yt-dlp` flat-playlist search.
- **`brave`:** Optional general web search if `BRAVE_API_KEY` is provided.

**Ranking Factors & Evaluation Reasons:**
Every discovered item is scored (0-100) and comes with explicit, human-readable reasons:
1. **Type Priority:** Course source of truth > Official specs / papers > Books / tutorials > Videos / repos / web.
2. **Relevance:** Exact query and module keyword matches in titles (high weight) and abstracts/summaries.
3. **Authority:** Log-scaled citation counts (`Math.log10(citations + 1)`), GitHub stars, and peer-reviewed venues (e.g. ICLR, NeurIPS, ICML, Nature).
4. **Recency:** Boosts recent work (>= 2022) and respects `year_from` filters, while preserving classics with high citation authority.
5. **Open Access:** Prioritizes open-access full-text PDFs and freely accessible content (+10 score).
6. **Language:** Aligns with learner language preferences (Vietnamese / English).

**Courtesy & Law Rules:**
- **Polite User-Agent:** `Polaris/0.2 (personal study course builder; https://github.com/DuongNAD) Node.js/...`
- **Rate Limits & Backoff:** Per-provider request rate limits with automatic exponential backoff on HTTP 429/503.
- **robots.txt:** Evaluated and cached per host before fetching arbitrary web pages for capture.
- **Open Access Only:** Captures only open-access PDFs, public YouTube transcripts, Wikipedia text, and open web pages. Never bypasses paywalls.
- **Local Personal Study Copies:** Third-party captures (`polaris/captures/`) and query caches (`polaris/.cache/`, 24h TTL) are strictly git-ignored.
- **SSRF Guard:** All outbound provider queries, robots.txt lookups, redirect hops, and automatic captures pass through Polaris's outbound SSRF guard, blocking requests to internal, private, or local network resources.

**The Review Gate:**
When running research (`polaris_research`), Polaris generates a tracked shortlist file (`polaris/research/<yyyy-mm-dd>-<slug>.md`) containing the ranked table and evaluation reasons.
- **Review Gate Workflow:** By default (`auto_add: 0`), the agent presents the top 10 candidates with their scores and evaluation reasons, then pauses to wait for learner approval before adding items to `sources.json`.
- **Auto Mode:** If the learner explicitly requests automated sourcing (`auto_add > 0`), the top N items are automatically registered in `sources.json` (labeled `extension` unless matching a brief `sourcesOfTruth`), scored, and captured into `captures/<id>.md`.

## schedule

Polaris v0.2b provides deterministic study schedule fitting module hours into learner weekly slots:
- **Topological Sorting:** Modules are ordered strictly by their prerequisites (`depends`), ensuring foundational concepts precede advanced modules.
- **Slot Filling:** The learner's weekly study slots (e.g. `[{ day: "Tue", minutes: 30 }, { day: "Sat", minutes: 60 }]`) are filled sequentially from the start date until each module's estimated hours are completed.
- **Calendar Protection:**
  - Skips dates defined in profile `blackouts` (`[{ from, to, reason }]`).
  - Skips the day of and the day before every unchecked P0 deadline found in the learning hub's `ACTIVE_LEARNING.md` or `TASKS.md` (`- [ ] [Deadline: YYYY-MM-DD HH:mm] [Priority: P0]`).
- **Interleaved Review:** Injects an interleaved review session every `interleave_every` weeks (default: 4) covering all modules completed up to that point.
- **Artifacts:**
  - Writes `polaris/schedule.json`.
  - Re-renders `ROADMAP.md` Section 3.2 (Lịch theo tuần) as a formatted weekly table and Section 5 (Spaced review schedule).
  - Generates Vietnamese `when` labels: `"Tuần 2 · Thứ Ba 20/10"` (`dd/mm/yyyy` if crossing into a future year).

## export

Export personal study courses into Aurora Slides decks with structured lesson skeletons:
- **Aurora `course.json`:** Generated at `<subject>/05_Slides/<slug>/course.json`. Strictly adheres to Aurora `CourseSchema` (no extra keys allowed).
- **Lessons Splitting:** One lesson per module by default; two lessons (a/b) when module hours exceed 2.5 hours or when `lessons: 2` is set.
- **Theme & Icon Rotation:** Cycles through Aurora themes (`aurora`, `midnight`, `daylight`, `titanium`, `ocean`, `sunset`, `forest`, `paper`, `liquid`) so neighbouring decks differ visually, with default Phosphor duotone icons.
- **Idempotency:** Existing `course.json` customizations (`dir`, `title`, `theme`, `icon`) are preserved via `polaris/course-map.json`.
- **Lesson Outline Skeletons (`polaris/lessons/<dir>.outline.md`):**
  - Generated in Vietnamese with module metadata, `when`, minutes, theme, and Phosphor icon.
  - Skeletons include: 1. Mục tiêu (outputs), 2. Dữ kiện có nguồn (facts for `source` citation), 3. Hiểu lầm -> phương án nhiễu cho Quiz, 4. Thực hành (DoD without solution code), 5. Neo trí nhớ gợi ý (palace, anchors, analogy, mnemonic), 6. Trang vở gợi ý (4-8 lines), 7. Tự kiểm tra, 8. Code liên quan, and 9. Slide-plan skeleton.
  - **Protection:** Never overwrites an existing outline (writes `<dir>.outline.new.md` instead).

## tracking

Track mastery, errors, and scheduled reviews:
- **Sổ lỗi (Error Log):** `polaris_errorlog_add` records runtime prediction gaps in `polaris/errorlog.md` with date, prediction, actual result, root cause (`why`), rule/fix, and sources. The log stays human-readable under both review engines.
- **Review engine (who schedules):** the engine in force is `method.reviewEngine` of the learner profile when set; otherwise `vega` when `<hub>/.vega/` exists; otherwise `fixed`. `polaris_profile get` and the `learner` topic show it.
  - **`vega` (single adaptive engine, v0.4.0):** Vega (FSRS) is the only scheduler. Every path that adds an error log entry (`polaris_errorlog_add`; quiz, predict and recall misses in `polaris_progress_sync`) still appends the same Markdown entry, but its review line becomes ``- **Ôn tập:** thẻ Vega `<key>` (FSRS lập lịch)`` and **nothing is added to `reviews.json`**. Instead Polaris writes one card per entry to the Vega inbox, one inbox file per tool call. Then run `vega_sync`, then `vega_session`.
  - **`fixed` (original behaviour):** Polaris schedules its own D+1, D+3, D+7, D+16, D+35 steps (`method.spacedReviewDays`) in `polaris/reviews.json` for error log entries and completed lessons.
- **Why one adaptive engine:** two schedulers on the same item double the reviews and create review debt, so one adaptive scheduler is better than several fixed ones. Meta-analytic evidence finds no reliable difference between expanding and uniform intervals (Latimier, Peyre and Ramus 2021, doi:10.1007/s10648-020-09572-8), so the shape of a fixed ladder is not what buys retention. Personalised review beat one-size-fits-all spacing (Lindsey et al. 2014, doi:10.1177/0956797613504302), which is what an adaptive FSRS scheduler fed by the learner's own ratings provides. Error log reviews must re-solve, never reread (successive relearning, Rawson and Dunlosky 2011, doi:10.1037/a0023956), so each card asks the learner to redo the situation from memory.
- **Inbox contract `vega-card-inbox.v1` (producer `polaris`):**
  - Folder `<hub>/.vega/inbox/` (created on demand). One new file per tool call: `polaris-<YYYYMMDDTHHmmss>-<6 hex>.jsonl` (UTC stamp), UTF-8, one JSON object per line, trailing newline. Written atomically as `<name>.jsonl.tmp`, then renamed. Polaris never appends to or rewrites an existing inbox file and never touches Vega's `cards.json` or `reviews.jsonl`.
  - Every line is validated against the contract before writing (unknown fields are rejected). If any line would be invalid, nothing is written and the errors are reported. Fields used: `v` (1), `t`, `producer` (`polaris`), `key`, `subject` (the subject folder name), `deck`, `kind` (`basic`), `front`, `back`, `origin`, `tags`, `reason`. Text is Vietnamese, without emoji, cut to the contract limits.
  - Keys (Vega skips keys it already has, so repeats never duplicate cards): `polaris:<subject folder name>:<entry id>` for error log entries (`ERR_YYYY-MM-DD_xxxxxx`), and `polaris:<subject folder name>:selfcheck:<module id>:<index>` (index counts from 1) for lesson self-checks.
  - Card content: quiz miss, front the question and back the correct answer plus the explanation; predict miss, front what to predict (the title) and back the real output; recall miss, front `<palace> · <place>: mục nào?` and back the item; manual entry, front the situation to re-solve (built from `prediction` and `result`) and back `why` plus `fix`; self-check, front the question and back the answer.
  - Origins: `polaris-errorlog` (path `polaris/errorlog.md`, locator the entry id) and `polaris-selfcheck` (path `polaris/roadmap.json`, locator `<module id> #<index>`).
- **Lesson completion:** `polaris_lesson_done` under `vega` writes cards from the self-check questions (`selfCheck {q, answer}`) of the lesson's module (found through `polaris/course-map.json`, or a lesson dir that is itself a module id). If no module or no self-check item is found, nothing is written and the reply says so. The completion itself is recorded in `polaris/progress-state.json` (read by `polaris_today`), never in `reviews.json`. Under `fixed` it records the lesson in `reviews.json` with the D+ steps as before.
- **Legacy steps:** steps already in `polaris/reviews.json` are never deleted or migrated. `polaris_review_due` and `polaris_today` still list them and, under `vega`, add one line with the Vega due count (read-only from `<hub>/.vega/cards.json`) and the next step `vega_sync, rồi vega_session`.
- **Task Synchronization:** `polaris_tasks_sync` appends lesson tasks and module checkpoints under `## Polaris` in `<subject>/TASKS.md` in standard hub format (`- [ ] [Deadline: YYYY-MM-DD 23:59] [Priority: P2] ...`), preserving file line endings and preventing duplicates via `polaris/tasks-map.json`.
- **Daily Review Due:** `polaris_review_due` retrieves the legacy fixed steps due on or before today, sorted oldest first, with concise review advice; under `vega` it adds the Vega due count line.

## progress

Aurora Slides records learner interactions as JSON Lines events in `<course_dir>/progress.jsonl` (or exported `aurora-progress-<slug>.jsonl`). `polaris_progress_sync` reads these events to close the learning loop:

**Event Contract:**
Each event is a JSON object on a single line:
`{"v":1, "t":"<ISO 8601 with offset>", "course":"<title|null>", "lesson":"<dir>", "deck":"<title>", "slide":<1-based index>, "slideId":"<id|null>", "type":"quiz"|"predict"|"recall"|"complete", ...payload}`

- **`quiz`:** `{"question": string (<=200 chars), "chosen": number[], "answer": number[], "correct": boolean, "chosenText"?: string[], "answerText"?: string[], "explanation"?: string}`
- **`predict`:** `{"title": string, "prediction": string, "rating": "right" | "different", "output": string (<=300 chars)}`
- **`recall`:** `{"palace": string, "station": number, "place": string, "item": string, "rating": "got" | "missed"}`
- **`complete`:** `{"slides": number, "quiz": string | null, "predictions": string | null}`
- **`card`:** Flashcard events emitted for [Vega MCP](https://github.com/DuongNAD/vega-mcp). `polaris_progress_sync` recognizes these events and skips them silently (never counted as malformed or unknown), preserving them for `vega_sync`.

**Sync & Deduplication Engine:**
- **Idempotency:** Every processed event's canonical hash is stored in `polaris/progress-state.json`. Running sync multiple times or merging exported files produces no duplicates.
- **Error Log Generation ("Sổ lỗi"):**
  - **Quiz entries:** Formatted with a "Câu hỏi" line with the question; "Đã chọn" and "Đáp án đúng" with the option texts when present (fallback to indices `[n]`); "Giải thích" when `explanation` is provided; "Nguyên nhân gốc rễ" left as a reflection prompt for the learner (`(tự điền khi ôn: vì sao chọn sai?)`), never filled with the question.
  - **Predict entries:** Formatted with "Dự đoán" (learner prediction), "Kết quả thật" (actual output snippet), and "Bài học rút ra" (`(tự điền: mental model nào cần sửa?)`).
  - **Recall entries:** Formatted with "Trạm" (palace place), "Ý cần nhớ" (item to recall), and "Neo" (`(tự điền: củng cố hình ảnh liên tưởng giữa trạm và ý cần nhớ)`).
  - All error log entries are de-duplicated per `(lesson, slide, type, key)`. Under the `fixed` review engine each entry also schedules spaced repetition reviews (D+1, D+3, D+7, D+16, D+35) in `polaris/reviews.json`. Under the `vega` engine (see `tracking`) the entry's review line points at a Vega card (``- **Ôn tập:** thẻ Vega `<key>` (FSRS lập lịch)``), nothing is added to `reviews.json`, and one card per entry goes to the Vega inbox (`origin.kind` `polaris-errorlog`): a quiz card is question -> correct answer (+ explanation), a predict card is title -> real output, a recall card is `<palace> · <place>: mục nào?` -> item.
- **Lesson Completion:** `complete` events automatically mark the lesson done (`polaris_lesson_done`) with the event date. Under `fixed` this schedules the D+ reviews. Under `vega` the lesson's module self-check questions become cards (`origin.kind` `polaris-selfcheck`, key `polaris:<subject>:selfcheck:<module id>:<index>`) and join the same inbox file; the completion is kept in `polaris/progress-state.json`.
- **One inbox file per sync (vega):** the whole sync, error log cards and self-check cards together, is written as a single atomic file in `<hub>/.vega/inbox/`, before the sync state is saved, so a rejected card fails the sync and a retry starts clean. Run `vega_sync`, then `vega_session` afterwards.
- **Summary & Actionable Guidance:** Returns per-lesson activity, quiz accuracy, prediction accuracy, missed palace stations, new error log entries, reviews due today (legacy fixed steps), the inbox file and card count under `vega`, count of card events left for Vega, and 1-3 concrete suggestions for the next session.

## today

`polaris_today` calculates the daily session plan and keeps the learner's dynamic goals in sync across the ecosystem:

**Daily Session Planning:**
- **Session Recipe Budget:** Produces a structured 60- or 30-minute plan following learner profile slots:
  - 30 min: 5m spaced reviews + 25m lesson practice (or 10m Vega + 5m spaced reviews + 15m lesson practice when Vega cards are due).
  - 60 min: 5m spaced reviews + 10m theory & memory anchors + 35m practice + 7m self-check & error log + 3m wrap-up (or 10m Vega + 5m spaced reviews + 10m theory + 25m practice + 7m self-check + 3m wrap-up when Vega cards are due).
- **Spaced Reviews:** Queries the legacy fixed review steps (error log and lesson items) from `polaris/reviews.json` on or before the target date. Steps scheduled earlier stay listed under both review engines; nothing is deleted or migrated.
- **Next Scheduled Lesson:** Identifies the next uncompleted lesson from `polaris/schedule.json` and `course-map.json` (completions come from `reviews.json` lesson items and from `polaris/progress-state.json`), providing direct paths to Aurora slide decks and lesson outline skeletons with practice tasks and DoD.
- **Vega FSRS Card Load:**
  - Reads `<hub>/.vega/cards.json` (read-only) if present.
  - Counts non-suspended, non-deleted Vega cards due by the end of today, as well as the count for the current subject when cards carry a matching `subject`.
  - Adds a plan line with the next step `"vega_sync, then vega_session to review"` and budgets 10 minutes in the session recipe.
  - If `.vega/cards.json` is absent or unreadable, that line is omitted with zero errors (under the `fixed` engine, exactly as before).
  - Under the `vega` review engine (see `tracking`) the plan adds one more line, `Bộ máy ôn tập: Vega (FSRS lập lịch)`, with the next step `vega_sync, rồi vega_session` (re-solve each card, never reread), and when `cards.json` is missing it says so with `0 thẻ đến hạn`. `polaris_review_due` carries the same Vega due count line.
- **Dynamic Goal Sync (`write: true`):**
  - Inserts or replaces the `## Today's Dynamic Goal` section in `<hub>/ACTIVE_LEARNING.md`, preserving other hub sections and newline formatting.

## aurora

Polaris and Aurora Slides form a closed-loop personalized learning system:

```
Polaris (Plan & Structure)
  -> polaris_profile & polaris_start: Learner profile and brief
  -> polaris_research & polaris_fact_add: Keyless discovery & locators
  -> polaris_roadmap_save: 10-section ROADMAP.md with quality gates
  -> polaris_schedule: Topological sorting & slot fitting
  -> polaris_export_course: Aurora course.json & lesson outline skeletons
        |
        v
Aurora Slides (Interactive Active Learning)
  -> Deck Authoring: Decks cite facts in `source` and verbatim code (`file` + `lines`)
  -> aurora_audit: Typography, contrast, line limits
  -> aurora preview: Interactive slide deck with quiz, predict, and memory palace walk
  -> Event Stream: Writes learning events to <course_dir>/progress.jsonl
        |
        v
Polaris (Tracking & Daily Guidance)
  -> polaris_progress_sync: Ingests progress.jsonl into Sổ lỗi & hands reviews to the review engine (Vega inbox, or fixed D+ steps)
  -> polaris_today: Generates 60m/30m session plan & Today's Dynamic Goal for learning hub
```

**End-to-End Steps:**
1. **Export:** `polaris_export_course` outputs Aurora `course.json` and lesson outline skeletons (`polaris/lessons/<dir>.outline.md`).
2. **Author:** Aurora decks are created according to outline skeletons, citing facts in `source` and pinning verbatim code.
3. **Study & Practice:** The learner studies decks via Aurora preview server, answering quizzes, predicting code outputs, and recalling memory palace stations.
4. **Capture:** Aurora logs events to `<course_dir>/progress.jsonl`.
5. **Sync:** `polaris_progress_sync` ingests events into `polaris/errorlog.md` and hands the reviews to the review engine: cards in the Vega inbox under `vega` (then `vega_sync` and `vega_session`), or D+ steps in `polaris/reviews.json` under `fixed`.
6. **Plan Today:** `polaris_today` creates the daily session plan and updates `## Today's Dynamic Goal` in `ACTIVE_LEARNING.md`.



## learner

**The Learner Method & Preferences:**
- **Language:** Vietnamese for all learner-facing text (with correct diacritics, clear grammar, and natural teaching tone). English for code, JSON keys, and tool names.
- **Pedagogy:**
  - Theory -> Memory anchors -> Paper notebook summary (4-8 lines) -> Practice easy-to-hard -> Recall walk.
  - Predict-then-run: Write predictions for code/commands before running; gaps go to "Sổ lỗi" (Error Log).
  - 3-tier practice: Khởi động (warmup, 15 min), Cốt lõi (core, 45 min), Thử thách (challenge, 30 min).
- **Memory Anchors:**
  - *Memory Palace:* Walking a familiar home route for ordered lists and sequences.
  - *Picture Anchors:* Vivid, concrete images for abstract terms.
  - *Analogy:* Mapping a new concept to something well-known, stating where the analogy breaks.
  - *Mnemonic:* Rhythmic or memorable phrases.
- **Visual Taste:** Apple-keynote aesthetic, no emoji, no neon colors.
- **Calendar:** Hard commitments (e.g. P0 courses) take absolute priority over P2 self-study tracks.
- **Review engine (`method.reviewEngine`):** who schedules spaced reviews.
  - `"vega"`: one adaptive scheduler, Vega (FSRS). Polaris keeps the Sổ lỗi and hands cards to Vega through the inbox `<hub>/.vega/inbox/`; the learner runs `vega_sync`, then `vega_session`. No fixed D+ steps are created.
  - `"fixed"`: Polaris schedules D+1, D+3, D+7, D+16, D+35 steps (`method.spacedReviewDays`) in `polaris/reviews.json`, exactly as before v0.4.0.
  - Unset (default): `vega` when `<hub>/.vega/` exists, otherwise `fixed`.
  - Change it with `polaris_profile { action: "update", patch: { method: { reviewEngine: "fixed" } } }`; `null` removes the override and returns to automatic choice. `polaris_profile get` prints the engine in force (``Bộ máy ôn tập hiệu lực (reviewEngine): ...``), and so does this topic below.
  - Why one engine: one adaptive scheduler avoids the review debt of several fixed ones (see `tracking` for the evidence).

## rules

**Core Rules for Coding Agents:**
1. **Never write assignment solutions:** Respect the learning hub's rules (`AGENTS.md`). Provide hints, leading questions, and mental models; never write the learner's solution code.
2. **Evidence first:** Never invent facts, numbers, or dates. Quote with locators.
3. **No recursive disk scans:** Never run recursive scans on D: (`find`, `grep -r`, `dir /s`, `Get-ChildItem -Recurse`). Open files directly or query `smart-drive`.
4. **Toolchain discipline:** Never run `npm install` on D: (exFAT drive with 512 KB clusters). All dependencies live in `POLARIS_TOOLCHAIN`.
5. **No paid API dependencies:** Polaris uses built-in fetchers, local parsers, and keyless public endpoints (e.g. export.arxiv.org).
