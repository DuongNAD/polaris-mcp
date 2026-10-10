# Polaris MCP Guide

Polaris gives coding agents (Claude Code, Google Antigravity) the deterministic structure, persistence, capture tools, and quality gates to build evidence-based personal study courses.

## overview

Polaris operates on five core principles:
1. **The agent reasons, Polaris structures:** Every artifact is strictly validated with JSON Schema (Zod) and rendered into clean Markdown or Aurora lesson outlines. Errors are actionable and corrective ("did you mean...").
2. **Evidence first:** Every factual bullet of a roadmap points to facts; every fact points to a source plus a precise locator (timestamp, page, section, lines). Labels distinguish primary truth (`course`), extensions (`extension`), and unverified claims (`unverified`).
3. **Learner fit:** The learner profile drives language (Vietnamese by default with correct diacritics), session recipes, study techniques (theory -> memory anchors -> paper notebook -> practice easy-to-hard -> recall walk; predict-then-run for code), and constraints.
4. **Quality gates:** The pipeline checks brief completeness, source labels and quality scores, fact locators, outcome coverage, dependency DAG cycles, and flags overclaims before finalizing the roadmap.
5. **Files, not databases:** Plain JSON and Markdown inside the subject folder (`polaris/brief.json`, `sources.json`, `facts.json`, `roadmap.json`, `captures/`). Captured third-party text is kept local and git-ignored.

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
  - Every fact must have a non-empty locator.
  - Numbers and dates must either have `crossCheck` sources or carry the `unverified` label.
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
- **`semanticscholar`:** Query `api.semanticscholar.org/graph/v1/paper/search`. Retrieves titles, authors, venues, TL;DR summaries, citations, and open-access PDF links with exponential backoff on HTTP 429/503.
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
- **Sổ lỗi (Error Log):** `polaris_errorlog_add` records runtime prediction gaps in `polaris/errorlog.md` with date, prediction, actual result, root cause (`why`), rule/fix, and sources.
- **Spaced Review:** Automatically schedules spaced repetition reviews (D+1, D+3, D+7, D+16, D+35) in `polaris/reviews.json` for completed lessons (`polaris_lesson_done`) and error log entries.
- **Task Synchronization:** `polaris_tasks_sync` appends lesson tasks and module checkpoints under `## Polaris` in `<subject>/TASKS.md` in standard hub format (`- [ ] [Deadline: YYYY-MM-DD 23:59] [Priority: P2] ...`), preserving file line endings and preventing duplicates via `polaris/tasks-map.json`.
- **Daily Review Due:** `polaris_review_due` retrieves all lessons and error log items due on or before today, sorted oldest first, with concise review advice.

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
  - All error log entries automatically schedule spaced repetition reviews (D+1, D+3, D+7, D+16, D+35) in `polaris/reviews.json` and are de-duplicated per `(lesson, slide, type, key)`.
- **Lesson Completion:** `complete` events automatically mark the lesson done (`polaris_lesson_done`) with the event date and schedule spaced reviews.
- **Summary & Actionable Guidance:** Returns per-lesson activity, quiz accuracy, prediction accuracy, missed palace stations, new error log entries, reviews due today, count of card events left for Vega, and 1-3 concrete suggestions for the next session.

## today

`polaris_today` calculates the daily session plan and keeps the learner's dynamic goals in sync across the ecosystem:

**Daily Session Planning:**
- **Session Recipe Budget:** Produces a structured 60- or 30-minute plan following learner profile slots:
  - 30 min: 5m spaced reviews + 25m lesson practice (or 10m Vega + 5m spaced reviews + 15m lesson practice when Vega cards are due).
  - 60 min: 5m spaced reviews + 10m theory & memory anchors + 35m practice + 7m self-check & error log + 3m wrap-up (or 10m Vega + 5m spaced reviews + 10m theory + 25m practice + 7m self-check + 3m wrap-up when Vega cards are due).
- **Spaced Reviews:** Queries all due error log and lesson review items from `polaris/reviews.json` on or before the target date.
- **Next Scheduled Lesson:** Identifies the next uncompleted lesson from `polaris/schedule.json` and `course-map.json`, providing direct paths to Aurora slide decks and lesson outline skeletons with practice tasks and DoD.
- **Vega FSRS Card Load:**
  - Reads `<hub>/.vega/cards.json` (read-only) if present.
  - Counts non-suspended, non-deleted Vega cards due by the end of today, as well as the count for the current subject when cards carry a matching `subject`.
  - Adds a plan line with the next step `"vega_sync, then vega_session to review"` and budgets 10 minutes in the session recipe.
  - If `.vega/cards.json` is absent or unreadable, the line is omitted with zero errors.
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
  -> polaris_progress_sync: Ingests progress.jsonl into Sổ lỗi & spaced reviews
  -> polaris_today: Generates 60m/30m session plan & Today's Dynamic Goal for learning hub
```

**End-to-End Steps:**
1. **Export:** `polaris_export_course` outputs Aurora `course.json` and lesson outline skeletons (`polaris/lessons/<dir>.outline.md`).
2. **Author:** Aurora decks are created according to outline skeletons, citing facts in `source` and pinning verbatim code.
3. **Study & Practice:** The learner studies decks via Aurora preview server, answering quizzes, predicting code outputs, and recalling memory palace stations.
4. **Capture:** Aurora logs events to `<course_dir>/progress.jsonl`.
5. **Sync:** `polaris_progress_sync` ingests events into `polaris/errorlog.md` and `polaris/reviews.json`.
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

## rules

**Core Rules for Coding Agents:**
1. **Never write assignment solutions:** Respect the learning hub's rules (`AGENTS.md`). Provide hints, leading questions, and mental models; never write the learner's solution code.
2. **Evidence first:** Never invent facts, numbers, or dates. Quote with locators.
3. **No recursive disk scans:** Never run recursive scans on D: (`find`, `grep -r`, `dir /s`, `Get-ChildItem -Recurse`). Open files directly or query `smart-drive`.
4. **Toolchain discipline:** Never run `npm install` on D: (exFAT drive with 512 KB clusters). All dependencies live in `POLARIS_TOOLCHAIN`.
5. **No paid API dependencies:** Polaris uses built-in fetchers, local parsers, and keyless public endpoints (e.g. export.arxiv.org).
