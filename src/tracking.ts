import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  cardSubject,
  errorLogCardKey,
  manualErrorCard,
  predictErrorCard,
  quizErrorCard,
  recallErrorCard,
  selfCheckCards,
  vegaReviewLine,
} from "./cards.js";
import { resolveReviewEngine, type ReviewEngineInfo } from "./engine.js";
import { writeInboxBatch, type InboxLine, type InboxWriteResult } from "./inbox.js";
import {
  ErrorLogEntryInputSchema,
  emptyProgressState,
  validateProgressState,
  validateReviewsData,
  type CourseMap,
  type PredictProgressEvent,
  type QuizProgressEvent,
  type RecallProgressEvent,
  type ReviewEngine,
  type ReviewItem,
  type ReviewStep,
  type ReviewsData,
  type RoadmapModule,
} from "./schema.js";
import { getProfile, readRoadmap } from "./store.js";
import { notifySmartDrive } from "./smartdrive.js";
import {
  addDays,
  atomicWriteFile,
  daysBetween,
  hash,
  readJson,
  subjectPaths,
  todayIso,
  writeJson,
  type SubjectPaths,
} from "./util.js";

/*
 * Review engines (see engine.ts):
 *   fixed: every entry schedules Polaris's own D+ steps in polaris/reviews.json (the original behaviour, unchanged).
 *   vega:  every entry is still written to polaris/errorlog.md, but the spaced-review line points at a Vega card and
 *          nothing is added to reviews.json; one card per entry goes to <hub>/.vega/inbox/ (one file per tool call).
 */

const NEXT_STEP_VEGA = "Bước tiếp theo: vega_sync, rồi vega_session (giải lại từng thẻ, không đọc lại).";

/* ───────── 0. Vega hand-off batch ───────── */

export interface BatchCommitResult {
  /** Cards written to the inbox. */
  cards: number;
  file?: string;
  fileName?: string;
  duplicatesInBatch: number;
  /** Error-log entries appended to errorlog.md. */
  entries: number;
}

/**
 * Everything one tool call hands to Vega: the cards (one inbox file) and the error-log Markdown chunks that go with
 * them. {@link ReviewBatch.commit} validates and writes the inbox file first, then appends the Markdown, so a rejected
 * card leaves errorlog.md untouched and a retry is clean (Vega skips cards whose key it already has).
 */
export class ReviewBatch {
  readonly cards: InboxLine[] = [];
  private readonly chunks: Array<{ path: string; text: string }> = [];

  constructor(readonly engine: ReviewEngineInfo) {}

  addEntry(errorlogPath: string, mdChunk: string, card: InboxLine): void {
    this.chunks.push({ path: errorlogPath, text: mdChunk });
    this.cards.push(card);
  }

  addCards(cards: InboxLine[]): void {
    this.cards.push(...cards);
  }

  get size(): number {
    return this.cards.length;
  }

  async commit(): Promise<BatchCommitResult> {
    let write: InboxWriteResult | undefined;
    if (this.cards.length > 0) {
      write = await writeInboxBatch(this.engine.hub, "polaris", this.cards);
    }
    for (const chunk of this.chunks) {
      await appendErrorLogChunk(chunk.path, chunk.text);
    }
    const result: BatchCommitResult = {
      cards: write?.written ?? 0,
      file: write?.file,
      fileName: write?.fileName,
      duplicatesInBatch: write?.duplicatesInBatch ?? 0,
      entries: this.chunks.length,
    };
    this.cards.length = 0;
    this.chunks.length = 0;
    return result;
  }
}

/** Stage one entry in the caller's batch, or commit it at once when the caller has no batch. */
async function stageEntry(
  batch: ReviewBatch | undefined,
  engine: ReviewEngineInfo,
  errorlogPath: string,
  mdChunk: string,
  card: InboxLine,
): Promise<BatchCommitResult | undefined> {
  if (batch) {
    batch.addEntry(errorlogPath, mdChunk, card);
    return undefined;
  }
  const own = new ReviewBatch(engine);
  own.addEntry(errorlogPath, mdChunk, card);
  return own.commit();
}

/** The D+ line of the original behaviour (labels D+1..D+35 with the first five configured offsets). */
function fixedSchedule(date: string, reviewOffsets: number[]) {
  const d1 = addDays(date, reviewOffsets[0] ?? 1);
  const d3 = addDays(date, reviewOffsets[1] ?? 3);
  const d7 = addDays(date, reviewOffsets[2] ?? 7);
  const d16 = addDays(date, reviewOffsets[3] ?? 16);
  const d35 = addDays(date, reviewOffsets[4] ?? 35);
  return {
    d1,
    d3,
    d7,
    d16,
    d35,
    line: `- **Lịch ôn lại giãn cách:** D+1 (${d1}), D+3 (${d3}), D+7 (${d7}), D+16 (${d16}), D+35 (${d35})`,
  };
}

function fixedSteps(date: string, reviewOffsets: number[]): ReviewStep[] {
  return reviewOffsets.map((offset) => ({
    dayOffset: offset,
    dueDate: addDays(date, offset),
    done: false,
  }));
}

/* ───────── 1. Error Log ("Sổ lỗi") ───────── */

export interface ErrorLogAddResult {
  errorlogPath: string;
  entryId: string;
  engine: ReviewEngine;
  /** Fixed engine only. */
  dueDateD1?: string;
  dueDateD3?: string;
  dueDateD7?: string;
  dueDateD16?: string;
  dueDateD35?: string;
  /** Vega engine only: the card key and the inbox file that carries it. */
  vegaKey?: string;
  inboxFile?: string;
  summary: string;
}

export interface EntryAddResult {
  entryId: string;
  summary: string;
  /** Vega engine only. */
  vegaKey?: string;
  commit?: BatchCommitResult;
}

export async function appendErrorLogChunk(errorlogPath: string, chunk: string): Promise<void> {
  let existingErrorLog = "";
  if (existsSync(errorlogPath)) {
    existingErrorLog = await readFile(errorlogPath, "utf8");
  } else {
    existingErrorLog =
      "# Sổ lỗi (Error Log & Predict Gaps)\n\n> Ghi nhận các điểm lệch giữa dự đoán (predict) và thực tế (run). Mỗi lỗi là một cơ hội củng cố mental model.\n\n";
  }
  const updatedErrorLog = existingErrorLog.trimEnd() + "\n\n" + chunk;
  await atomicWriteFile(errorlogPath, updatedErrorLog);
  notifySmartDrive(dirname(errorlogPath));
}

export async function addQuizErrorLogEntry(
  subjectDir: string,
  event: QuizProgressEvent,
  modId?: string,
  hub?: string,
  batch?: ReviewBatch,
): Promise<EntryAddResult> {
  const p = subjectPaths(subjectDir);
  const date = event.t.slice(0, 10);
  const engine = batch ? batch.engine : await resolveReviewEngine(hub);

  const modStr = modId ? ` - Module ${modId}` : "";
  const lesStr = event.lesson ? ` (${event.lesson})` : "";
  const entryId = `ERR_${date}_${hash(`quiz_${event.lesson}_${event.slide}_${event.question}`, 6)}`;

  const chosenDisplay =
    event.chosenText && event.chosenText.length > 0
      ? event.chosenText.join(", ")
      : `[${event.chosen.join(", ")}]`;

  const answerDisplay =
    event.answerText && event.answerText.length > 0
      ? event.answerText.join(", ")
      : `[${event.answer.join(", ")}]`;

  const head = [
    `### [${date}] Trắc nghiệm sai${modStr}${lesStr}`,
    `- **Mã mục:** \`${entryId}\``,
    `- **Ngày ghi nhận:** ${date}`,
    `- **Câu hỏi:** ${event.question}`,
    `- **Đã chọn:** ${chosenDisplay}`,
    `- **Đáp án đúng:** ${answerDisplay}`,
  ];

  if (event.explanation && event.explanation.trim()) {
    head.push(`- **Giải thích:** ${event.explanation.trim()}`);
  }

  head.push(
    `- **Nguyên nhân gốc rễ:** (tự điền khi ôn: vì sao chọn sai?)`,
    `- **Nguồn / Tham chiếu:** ${event.deck || event.lesson || "Thực hành bài học"}`,
  );

  const summary = `Câu hỏi: ${event.question} -> Đáp án đúng: ${answerDisplay}`;

  if (engine.engine === "vega") {
    const subject = cardSubject(subjectDir);
    const vegaKey = errorLogCardKey(subject, entryId);
    const mdChunk = [...head, vegaReviewLine(vegaKey), ""].join("\n");
    const card = quizErrorCard({ subject, entryId, errorlogPath: p.errorlogMd, event });
    const commit = await stageEntry(batch, engine, p.errorlogMd, mdChunk, card);
    return { entryId, summary, vegaKey, commit };
  }

  const profile = await getProfile(hub);
  const reviewOffsets = profile.method?.spacedReviewDays ?? [1, 3, 7, 16, 35];
  const sched = fixedSchedule(date, reviewOffsets);

  const mdChunk = [...head, sched.line, ""].join("\n");
  await appendErrorLogChunk(p.errorlogMd, mdChunk);

  // Schedule reviews in polaris/reviews.json
  const reviewsData = await loadOrCreateReviewsData(p.reviewsJson);
  const steps = fixedSteps(date, reviewOffsets);

  const reviewItem: ReviewItem = {
    id: entryId,
    type: "error",
    title: `Trắc nghiệm: ${event.question.slice(0, 60)}`,
    module: modId,
    lessonDir: event.lesson,
    createdDate: date,
    steps,
    details: {
      kind: "quiz",
      question: event.question,
      chosen: event.chosen,
      chosenText: event.chosenText,
      answer: event.answer,
      answerText: event.answerText,
      explanation: event.explanation,
    },
  };

  reviewsData.items.push(reviewItem);
  reviewsData.updated = todayIso();
  await writeJson(p.reviewsJson, reviewsData);
  notifySmartDrive(p.polarisDir);

  return { entryId, summary };
}

export async function addPredictErrorLogEntry(
  subjectDir: string,
  event: PredictProgressEvent,
  modId?: string,
  hub?: string,
  batch?: ReviewBatch,
): Promise<EntryAddResult> {
  const p = subjectPaths(subjectDir);
  const date = event.t.slice(0, 10);
  const engine = batch ? batch.engine : await resolveReviewEngine(hub);

  const modStr = modId ? ` - Module ${modId}` : "";
  const lesStr = event.lesson ? ` (${event.lesson})` : "";
  const entryId = `ERR_${date}_${hash(`predict_${event.lesson}_${event.slide}_${event.title}`, 6)}`;

  const head = [
    `### [${date}] Lệch dự đoán${modStr}${lesStr}`,
    `- **Mã mục:** \`${entryId}\``,
    `- **Ngày ghi nhận:** ${date}`,
    `- **Tình huống:** ${event.title}`,
    `- **Dự đoán:** ${event.prediction || "Chưa ghi dự đoán"}`,
    `- **Kết quả thật:** ${event.output || "Lệch kết quả thực thi"}`,
    `- **Bài học rút ra:** (tự điền: mental model nào cần sửa?)`,
    `- **Nguồn / Tham chiếu:** ${event.deck || event.lesson || "Thực hành bài học"}`,
  ];

  const summary = `Lệch dự đoán: ${event.title}`;

  if (engine.engine === "vega") {
    const subject = cardSubject(subjectDir);
    const vegaKey = errorLogCardKey(subject, entryId);
    const mdChunk = [...head, vegaReviewLine(vegaKey), ""].join("\n");
    const card = predictErrorCard({ subject, entryId, errorlogPath: p.errorlogMd, event });
    const commit = await stageEntry(batch, engine, p.errorlogMd, mdChunk, card);
    return { entryId, summary, vegaKey, commit };
  }

  const profile = await getProfile(hub);
  const reviewOffsets = profile.method?.spacedReviewDays ?? [1, 3, 7, 16, 35];
  const sched = fixedSchedule(date, reviewOffsets);

  const mdChunk = [...head, sched.line, ""].join("\n");
  await appendErrorLogChunk(p.errorlogMd, mdChunk);

  // Schedule reviews in polaris/reviews.json
  const reviewsData = await loadOrCreateReviewsData(p.reviewsJson);
  const steps = fixedSteps(date, reviewOffsets);

  const reviewItem: ReviewItem = {
    id: entryId,
    type: "error",
    title: `Lệch dự đoán: ${event.title.slice(0, 60)}`,
    module: modId,
    lessonDir: event.lesson,
    createdDate: date,
    steps,
    details: {
      kind: "predict",
      title: event.title,
      prediction: event.prediction,
      output: event.output,
    },
  };

  reviewsData.items.push(reviewItem);
  reviewsData.updated = todayIso();
  await writeJson(p.reviewsJson, reviewsData);
  notifySmartDrive(p.polarisDir);

  return { entryId, summary };
}

export async function addRecallErrorLogEntry(
  subjectDir: string,
  event: RecallProgressEvent,
  modId?: string,
  hub?: string,
  batch?: ReviewBatch,
): Promise<EntryAddResult> {
  const p = subjectPaths(subjectDir);
  const date = event.t.slice(0, 10);
  const engine = batch ? batch.engine : await resolveReviewEngine(hub);

  const modStr = modId ? ` - Module ${modId}` : "";
  const lesStr = event.lesson ? ` (${event.lesson})` : "";
  const entryId = `ERR_${date}_${hash(`recall_${event.lesson}_${event.slide}_${event.palace}_${event.station}`, 6)}`;

  const head = [
    `### [${date}] Quên trạm nhớ${modStr}${lesStr}`,
    `- **Mã mục:** \`${entryId}\``,
    `- **Ngày ghi nhận:** ${date}`,
    `- **Cung điện:** ${event.palace} (Trạm ${event.station})`,
    `- **Trạm:** ${event.place}`,
    `- **Ý cần nhớ:** ${event.item}`,
    `- **Neo:** (tự điền: củng cố hình ảnh liên tưởng giữa trạm và ý cần nhớ)`,
    `- **Nguồn / Tham chiếu:** Cung điện trí nhớ: ${event.palace}`,
  ];

  const summary = `Quên trạm ${event.station} (${event.place}) -> ${event.item}`;

  if (engine.engine === "vega") {
    const subject = cardSubject(subjectDir);
    const vegaKey = errorLogCardKey(subject, entryId);
    const mdChunk = [...head, vegaReviewLine(vegaKey), ""].join("\n");
    const card = recallErrorCard({ subject, entryId, errorlogPath: p.errorlogMd, event });
    const commit = await stageEntry(batch, engine, p.errorlogMd, mdChunk, card);
    return { entryId, summary, vegaKey, commit };
  }

  const profile = await getProfile(hub);
  const reviewOffsets = profile.method?.spacedReviewDays ?? [1, 3, 7, 16, 35];
  const sched = fixedSchedule(date, reviewOffsets);

  const mdChunk = [...head, sched.line, ""].join("\n");
  await appendErrorLogChunk(p.errorlogMd, mdChunk);

  // Schedule reviews in polaris/reviews.json
  const reviewsData = await loadOrCreateReviewsData(p.reviewsJson);
  const steps = fixedSteps(date, reviewOffsets);

  const reviewItem: ReviewItem = {
    id: entryId,
    type: "error",
    title: `Quên trạm nhớ: ${event.place} -> ${event.item}`,
    module: modId,
    lessonDir: event.lesson,
    createdDate: date,
    steps,
    details: {
      kind: "recall",
      palace: event.palace,
      station: event.station,
      place: event.place,
      item: event.item,
    },
  };

  reviewsData.items.push(reviewItem);
  reviewsData.updated = todayIso();
  await writeJson(p.reviewsJson, reviewsData);
  notifySmartDrive(p.polarisDir);

  return { entryId, summary };
}

export async function addErrorLogEntry(
  subjectDir: string,
  rawEntry: unknown,
  hub?: string,
): Promise<ErrorLogAddResult> {
  const p = subjectPaths(subjectDir);
  const parsed = ErrorLogEntryInputSchema.safeParse(rawEntry);
  if (!parsed.success) {
    throw new Error(`Invalid error log entry:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }

  const entry = parsed.data;
  const date = entry.date || todayIso();
  const engine = await resolveReviewEngine(hub);

  const modStr = entry.module ? ` - Module ${entry.module}` : "";
  const lesStr = entry.lesson ? ` (${entry.lesson})` : "";
  const entryId = `ERR_${date}_${hash(entry.why + entry.fix, 6)}`;

  const head = [
    `### [${date}] Lỗi gap${modStr}${lesStr}`,
    `- **Mã mục:** \`${entryId}\``,
    `- **Ngày ghi nhận:** ${date}`,
    `- **Dự đoán ban đầu:** ${entry.prediction || "Chưa ghi dự đoán"}`,
    `- **Kết quả thực tế (Triệu chứng):** ${entry.result || "Gặp lỗi ngoài mong đợi"}`,
    `- **Nguyên nhân gốc rễ:** ${entry.why}`,
    `- **Cách sửa & Quy tắc rút ra:** ${entry.fix}`,
    `- **Nguồn / Tham chiếu:** ${entry.source || "Thực hành bài học"}`,
  ];

  if (engine.engine === "vega") {
    const subject = cardSubject(subjectDir);
    const vegaKey = errorLogCardKey(subject, entryId);
    const mdChunk = [...head, vegaReviewLine(vegaKey), ""].join("\n");
    const card = manualErrorCard({
      subject,
      entryId,
      errorlogPath: p.errorlogMd,
      entry: {
        date,
        module: entry.module,
        lesson: entry.lesson,
        prediction: entry.prediction,
        result: entry.result,
        why: entry.why,
        fix: entry.fix,
        source: entry.source,
      },
    });
    const commit = await stageEntry(undefined, engine, p.errorlogMd, mdChunk, card);

    const lines = [
      `Ghi nhận thành công vào Sổ lỗi: ${p.errorlogMd}`,
      `Mã mục: ${entryId}`,
      `Nguyên nhân: ${entry.why}`,
      `Quy tắc rút ra: ${entry.fix}`,
      "",
      "Ôn tập do Vega (FSRS) lập lịch, không dùng mốc D+ cố định; không có mục nào được thêm vào polaris/reviews.json.",
      `  - Thẻ Vega: ${vegaKey}`,
      `  - Hộp thư: ${commit?.file ?? "(không ghi được)"}`,
      NEXT_STEP_VEGA,
    ];

    return {
      errorlogPath: p.errorlogMd,
      entryId,
      engine: "vega",
      vegaKey,
      inboxFile: commit?.file,
      summary: lines.join("\n"),
    };
  }

  const profile = await getProfile(hub);
  const reviewOffsets = profile.method?.spacedReviewDays ?? [1, 3, 7, 16, 35];
  const sched = fixedSchedule(date, reviewOffsets);
  const { d1, d3, d7, d16, d35 } = sched;

  const mdChunk = [...head, sched.line, ""].join("\n");

  await appendErrorLogChunk(p.errorlogMd, mdChunk);

  // Schedule reviews in polaris/reviews.json
  const reviewsData = await loadOrCreateReviewsData(p.reviewsJson);

  const steps = fixedSteps(date, reviewOffsets);

  const reviewItem: ReviewItem = {
    id: entryId,
    type: "error",
    title: `Sổ lỗi: ${entry.fix.slice(0, 60)}`,
    module: entry.module,
    lessonDir: entry.lesson,
    createdDate: date,
    steps,
    details: {
      why: entry.why,
      fix: entry.fix,
      prediction: entry.prediction,
      result: entry.result,
    },
  };

  reviewsData.items.push(reviewItem);
  reviewsData.updated = todayIso();
  await writeJson(p.reviewsJson, reviewsData);
  notifySmartDrive(p.polarisDir);

  const lines = [
    `Ghi nhận thành công vào Sổ lỗi: ${p.errorlogMd}`,
    `Mã mục: ${entryId}`,
    `Nguyên nhân: ${entry.why}`,
    `Quy tắc rút ra: ${entry.fix}`,
    "",
    "Lịch ôn tập giãn cách đã tạo:",
    `  - D+1:  ${d1}`,
    `  - D+3:  ${d3}`,
    `  - D+7:  ${d7}`,
    `  - D+16: ${d16}`,
    `  - D+35: ${d35}`,
  ];

  return {
    errorlogPath: p.errorlogMd,
    entryId,
    engine: "fixed",
    dueDateD1: d1,
    dueDateD3: d3,
    dueDateD7: d7,
    dueDateD16: d16,
    dueDateD35: d35,
    summary: lines.join("\n"),
  };
}

/* ───────── 2. Lesson Done ───────── */

export interface LessonDoneResult {
  lessonDir: string;
  completedDate: string;
  engine: ReviewEngine;
  /** Fixed engine only; empty under Vega (Vega schedules). */
  scheduledReviews: Array<{ dayOffset: number; dueDate: string }>;
  /** Vega engine only: self-check cards handed to Vega and the inbox file that carries them. */
  vegaCards?: number;
  inboxFile?: string;
  summary: string;
}

interface LessonModuleLookup {
  module?: RoadmapModule;
  /** Why no self-check cards can be made (Vietnamese). */
  reason?: string;
}

/** The module a lesson belongs to: course-map.json first, then a lesson dir that is itself a module id. */
async function findLessonModule(p: SubjectPaths, lessonDir: string): Promise<LessonModuleLookup> {
  const roadmap = await readRoadmap(p.dir);
  if (!roadmap) return { reason: "chưa đọc được polaris/roadmap.json" };

  const courseMap = await readJson<CourseMap>(p.courseMapJson);
  let moduleId = courseMap?.lessons?.find((l) => l.dir === lessonDir)?.module;
  if (!moduleId) {
    const lower = lessonDir.toLowerCase();
    moduleId = roadmap.modules.find((m) => m.id === lessonDir || m.id.toLowerCase() === lower)?.id;
  }
  if (!moduleId) {
    return {
      reason: `bài học "${lessonDir}" không khớp module nào trong polaris/course-map.json hoặc roadmap.json (chạy polaris_export_course để có course-map.json, hoặc truyền mã module như M1 làm lesson_dir)`,
    };
  }
  const mod = roadmap.modules.find((m) => m.id === moduleId);
  if (!mod) return { reason: `module ${moduleId} không có trong polaris/roadmap.json` };
  if (mod.selfCheck.length === 0) return { module: mod, reason: `module ${mod.id} chưa có câu tự kiểm tra (selfCheck)` };
  return { module: mod };
}

/** Vega engine: remember the completion in progress-state.json (read by polaris_today), never in reviews.json. */
async function recordLessonCompleted(statePath: string, lessonDir: string): Promise<void> {
  const raw = await readJson<unknown>(statePath);
  const checked = raw !== undefined ? validateProgressState(raw) : undefined;
  const state = checked?.ok && checked.value ? checked.value : emptyProgressState(todayIso());
  const stats = state.stats ?? emptyProgressState(todayIso()).stats!;
  const done = new Set(stats.lessonsCompleted ?? []);
  if (done.has(lessonDir)) return;
  done.add(lessonDir);
  await writeJson(statePath, {
    ...state,
    updated: todayIso(),
    stats: { ...stats, lessonsCompleted: Array.from(done) },
  });
  notifySmartDrive(dirname(statePath));
}

export async function markLessonDone(
  subjectDir: string,
  lessonDir: string,
  date?: string,
  score?: number | string,
  hub?: string,
  batch?: ReviewBatch,
): Promise<LessonDoneResult> {
  const p = subjectPaths(subjectDir);
  const completedDate = date || todayIso();
  const engine = batch ? batch.engine : await resolveReviewEngine(hub);

  if (engine.engine === "vega") {
    const subject = cardSubject(subjectDir);
    const found = await findLessonModule(p, lessonDir);
    const cards = found.module
      ? selfCheckCards({ subject, module: found.module, lessonDir, roadmapPath: p.roadmapJson })
      : [];

    let commit: BatchCommitResult | undefined;
    if (batch) {
      // progress_sync owns the commit and records the completion in progress-state.json itself.
      batch.addCards(cards);
    } else {
      const own = new ReviewBatch(engine);
      own.addCards(cards);
      commit = await own.commit();
      await recordLessonCompleted(p.progressStateJson, lessonDir);
    }

    const lines = [
      `Đã ghi nhận hoàn thành bài học "${lessonDir}" vào ngày ${completedDate}.`,
      score !== undefined ? `Điểm đánh giá / tự kiểm tra: ${score}` : "",
      "",
      "Ôn tập do Vega (FSRS) lập lịch, không dùng mốc D+ cố định; không có mục nào được thêm vào polaris/reviews.json.",
    ];
    if (found.module && cards.length > 0) {
      lines.push(
        batch
          ? `Chuẩn bị gửi ${cards.length} thẻ tự kiểm tra của module ${found.module.id} vào hộp thư Vega.`
          : `Đã gửi ${commit?.cards ?? 0} thẻ tự kiểm tra của module ${found.module.id} vào hộp thư Vega: ${commit?.file ?? "(không ghi được)"}`,
        NEXT_STEP_VEGA,
      );
    } else {
      lines.push(`Không có thẻ nào được gửi vào hộp thư Vega: ${found.reason ?? "không có câu tự kiểm tra"}.`);
    }

    return {
      lessonDir,
      completedDate,
      engine: "vega",
      scheduledReviews: [],
      vegaCards: found.module ? cards.length : 0,
      inboxFile: commit?.file,
      summary: lines.filter(Boolean).join("\n"),
    };
  }

  const profile = await getProfile(hub);
  const reviewOffsets = profile.method?.spacedReviewDays ?? [1, 3, 7, 16, 35];

  const reviewsData = await loadOrCreateReviewsData(p.reviewsJson);
  const itemId = `LESSON_${lessonDir}`;

  const steps: ReviewStep[] = reviewOffsets.map((offset) => ({
    dayOffset: offset,
    dueDate: addDays(completedDate, offset),
    done: false,
    score,
  }));

  // Update or insert
  const existingIdx = reviewsData.items.findIndex((it) => it.id === itemId);
  const reviewItem: ReviewItem = {
    id: itemId,
    type: "lesson",
    title: `Ôn bài học: ${lessonDir}`,
    lessonDir,
    createdDate: completedDate,
    steps,
    details: { score },
  };

  if (existingIdx >= 0) {
    reviewsData.items[existingIdx] = reviewItem;
  } else {
    reviewsData.items.push(reviewItem);
  }

  reviewsData.updated = todayIso();
  await writeJson(p.reviewsJson, reviewsData);
  notifySmartDrive(p.polarisDir);

  const lines = [
    `Đã ghi nhận hoàn thành bài học "${lessonDir}" vào ngày ${completedDate}.`,
    score !== undefined ? `Điểm đánh giá / tự kiểm tra: ${score}` : "",
    "",
    "Lịch ôn tập giãn cách đã lên lịch trong polaris/reviews.json:",
    ...steps.map((s) => `  - D+${s.dayOffset}: ${s.dueDate}`),
  ].filter(Boolean);

  return {
    lessonDir,
    completedDate,
    engine: "fixed",
    scheduledReviews: steps.map((s) => ({ dayOffset: s.dayOffset, dueDate: s.dueDate })),
    summary: lines.join("\n"),
  };
}

/* ───────── 3. Due Reviews Query ───────── */

export interface DueReviewEntry {
  itemId: string;
  type: "lesson" | "error";
  title: string;
  dayOffset: number;
  dueDate: string;
  overdueDays: number;
  lessonDir?: string;
  module?: string;
  details?: Record<string, unknown>;
}

export interface DueReviewsResult {
  targetDate: string;
  dueCount: number;
  items: DueReviewEntry[];
  summary: string;
}

/**
 * Legacy fixed steps in polaris/reviews.json that are due on or before the date. Under the Vega engine nothing new is
 * added to reviews.json, but steps scheduled earlier stay listed (never deleted or migrated); the Vega due count is
 * appended by getReviewDueReport (today.ts).
 */
export async function getDueReviews(subjectDir: string, date?: string): Promise<DueReviewsResult> {
  const p = subjectPaths(subjectDir);
  const targetDate = date || todayIso();

  const reviewsData = await loadOrCreateReviewsData(p.reviewsJson);
  const dueList: DueReviewEntry[] = [];

  for (const item of reviewsData.items) {
    for (const step of item.steps) {
      if (step.dueDate <= targetDate && !step.done) {
        const overdue = daysBetween(step.dueDate, targetDate);
        dueList.push({
          itemId: item.id,
          type: item.type,
          title: item.title,
          dayOffset: step.dayOffset,
          dueDate: step.dueDate,
          overdueDays: Math.max(0, overdue),
          lessonDir: item.lessonDir,
          module: item.module,
          details: item.details,
        });
      }
    }
  }

  // Sort oldest due date first
  dueList.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const lines: string[] = [
    `Danh sách ôn tập đến hạn tại ngày ${targetDate}: ${dueList.length} mục.`,
  ];

  if (dueList.length === 0) {
    lines.push("Tuyệt vời! Không có mục ôn tập nào bị quá hạn.");
  } else {
    lines.push("");
    dueList.forEach((it, i) => {
      const typeTag = it.type === "lesson" ? "[Bài học]" : "[Sổ lỗi]";
      const overdueTag = it.overdueDays > 0 ? ` (Quá hạn ${it.overdueDays} ngày)` : " (Hôm nay)";
      lines.push(`${i + 1}. ${typeTag} ${it.title} — Hạn: ${it.dueDate}${overdueTag} [D+${it.dayOffset}]`);
    });

    lines.push(
      "",
      "Phương pháp ôn tập (5-10 phút):",
      "- Đối với Bài học: Xem lại Trang vở (4-8 dòng), đi bộ hồi tưởng (recall walk), tự kiểm tra lại 2-3 câu hỏi.",
      "- Đối với Sổ lỗi: Che phần nguyên nhân và cách sửa, đọc lại triệu chứng và tự giải thích lại quy tắc rút ra.",
    );
  }

  return {
    targetDate,
    dueCount: dueList.length,
    items: dueList,
    summary: lines.join("\n"),
  };
}

/* ───────── Helper ───────── */

async function loadOrCreateReviewsData(filePath: string): Promise<ReviewsData> {
  const raw = await readJson<ReviewsData>(filePath);
  if (raw) {
    const v = validateReviewsData(raw);
    if (v.ok && v.value) return v.value;
  }
  return {
    updated: todayIso(),
    items: [],
  };
}
