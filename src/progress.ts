import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ProgressEventSchema,
  validateProgressState,
  type CourseMap,
  type ProgressEvent,
  type ProgressState,
  type Roadmap,
} from "./schema.js";
import { readBrief, readRoadmap } from "./store.js";
import {
  addErrorLogEntry,
  addPredictErrorLogEntry,
  addQuizErrorLogEntry,
  addRecallErrorLogEntry,
  getDueReviews,
  markLessonDone,
} from "./tracking.js";
import { notifySmartDrive } from "./smartdrive.js";
import {
  hash,
  readJson,
  slugify,
  subjectPaths,
  todayIso,
  writeJson,
} from "./util.js";

export interface ProgressSyncOptions {
  subject_dir: string;
  course_dir?: string;
  file?: string;
  hub?: string;
}

export interface ProgressSyncResult {
  eventsProcessed: number;
  newEventsCount: number;
  newErrorLogCount: number;
  completedLessonsCount: number;
  skippedLinesCount: number;
  malformedCount: number;
  unknownTypeCount: number;
  vegaCardEventsCount?: number;
  newErrorLogEntries: Array<{ id: string; why: string; fix: string }>;
  lessonsCompleted: string[];
  reviewsDueToday: number;
  summary: string;
}

function canonicalEventHash(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) {
    sorted[k] = obj[k];
  }
  return hash(JSON.stringify(sorted), 16);
}

export async function syncProgress(options: ProgressSyncOptions): Promise<ProgressSyncResult> {
  const { subject_dir } = options;
  const p = subjectPaths(subject_dir);

  const brief = await readBrief(subject_dir);
  const roadmap = await readRoadmap(subject_dir);
  const courseMap = await readJson<CourseMap>(p.courseMapJson);

  // Map lesson folders to module IDs
  const lessonToModule = new Map<string, string>();
  if (courseMap?.lessons) {
    courseMap.lessons.forEach((l) => {
      lessonToModule.set(l.dir, l.module);
    });
  }
  if (roadmap?.modules) {
    roadmap.modules.forEach((m) => {
      if (!lessonToModule.has(m.id)) {
        lessonToModule.set(m.id, m.id);
      }
    });
  }

  // Determine course directory
  const slug = brief?.slug || slugify(roadmap?.title || "course");
  let targetCourseDir: string;
  if (options.course_dir) {
    targetCourseDir = resolve(p.dir, options.course_dir);
  } else if (courseMap?.courseDir) {
    targetCourseDir = courseMap.courseDir;
  } else {
    targetCourseDir = join(p.dir, "05_Slides", slug);
  }

  // Find candidate progress files
  const filesToRead: string[] = [];
  const defaultProgressPath = join(targetCourseDir, "progress.jsonl");
  if (existsSync(defaultProgressPath)) {
    filesToRead.push(defaultProgressPath);
  }

  if (options.file) {
    const explicitPath = resolve(p.dir, options.file);
    if (existsSync(explicitPath)) {
      if (!filesToRead.includes(explicitPath)) {
        filesToRead.push(explicitPath);
      }
    } else if (existsSync(options.file)) {
      if (!filesToRead.includes(options.file)) {
        filesToRead.push(options.file);
      }
    }
  }

  if (filesToRead.length === 0) {
    throw new Error(
      `Không tìm thấy file tiến độ nào. Đã kiểm tra:\n  - ${defaultProgressPath}${options.file ? `\n  - ${options.file}` : ""}`,
    );
  }

  // Load progress state for idempotency
  let state = await readJson<ProgressState>(p.progressStateJson);
  if (!state || !validateProgressState(state).ok) {
    state = {
      updated: todayIso(),
      processedHashes: [],
      dedupKeys: [],
      lastSyncedFiles: [],
      stats: {
        totalEvents: 0,
        quizTotal: 0,
        quizCorrect: 0,
        predictRight: 0,
        predictDifferent: 0,
        recallGot: 0,
        recallMissed: 0,
        lessonsCompleted: [],
      },
    };
  }

  const processedHashes = new Set<string>(state.processedHashes ?? []);
  const dedupKeys = new Set<string>(state.dedupKeys ?? []);
  const completedLessonsSet = new Set<string>(state.stats?.lessonsCompleted ?? []);

  let malformedCount = 0;
  let unknownTypeCount = 0;
  let vegaCardEventsCount = 0;
  let newEventsCount = 0;
  const newErrorLogEntries: Array<{ id: string; why: string; fix: string }> = [];
  const newlyCompletedLessons: string[] = [];

  // Per-lesson tracking
  const lessonActivity = new Map<
    string,
    {
      lastTime: string;
      eventsCount: number;
      quizTotal: number;
      quizCorrect: number;
      predictRight: number;
      predictDifferent: number;
      recallGot: number;
      recallMissed: number;
      completed?: boolean;
    }
  >();

  const missedStationsList: Array<{ place: string; item: string; station: number; lesson: string }> = [];

  // Read lines across all candidate files
  for (const filePath of filesToRead) {
    const content = await readFile(filePath, "utf8");
    const rawLines = content.replace(/\r\n/g, "\n").split("\n");

    for (const rawLine of rawLines) {
      const line = rawLine.trim();
      if (!line) continue;

      let rawObj: unknown;
      try {
        rawObj = JSON.parse(line);
      } catch {
        malformedCount++;
        continue;
      }

      if (!rawObj || typeof rawObj !== "object" || Array.isArray(rawObj)) {
        malformedCount++;
        continue;
      }

      const objRecord = rawObj as Record<string, unknown>;
      const eventType = objRecord.type;
      if (!eventType || typeof eventType !== "string") {
        malformedCount++;
        continue;
      }

      if (eventType === "card") {
        vegaCardEventsCount++;
        continue;
      }

      if (!["quiz", "predict", "recall", "complete"].includes(eventType)) {
        unknownTypeCount++;
        continue;
      }

      const parsed = ProgressEventSchema.safeParse(rawObj);
      if (!parsed.success) {
        malformedCount++;
        continue;
      }

      const event: ProgressEvent = parsed.data;
      const eventHash = canonicalEventHash(objRecord);

      // Track lesson activity
      let act = lessonActivity.get(event.lesson);
      if (!act) {
        act = {
          lastTime: event.t,
          eventsCount: 0,
          quizTotal: 0,
          quizCorrect: 0,
          predictRight: 0,
          predictDifferent: 0,
          recallGot: 0,
          recallMissed: 0,
        };
        lessonActivity.set(event.lesson, act);
      }
      act.eventsCount++;
      if (event.t > act.lastTime) {
        act.lastTime = event.t;
      }

      // Check if already processed
      if (processedHashes.has(eventHash)) {
        continue;
      }
      processedHashes.add(eventHash);
      newEventsCount++;

      const eventDate = event.t.slice(0, 10);
      const modId = lessonToModule.get(event.lesson);

      if (event.type === "quiz") {
        act.quizTotal++;
        if (event.correct) {
          act.quizCorrect++;
        } else {
          // Wrong quiz -> Error log
          const dedupKey = `${event.lesson}::${event.slide}::quiz::${event.question}`;
          if (!dedupKeys.has(dedupKey)) {
            dedupKeys.add(dedupKey);
            const errRes = await addQuizErrorLogEntry(
              subject_dir,
              event,
              modId,
              options.hub,
            );
            const answerDisplay =
              event.answerText && event.answerText.length > 0
                ? event.answerText.join(", ")
                : `[${event.answer.join(", ")}]`;
            newErrorLogEntries.push({
              id: errRes.entryId,
              why: `Câu hỏi: ${event.question}`,
              fix: `Đáp án đúng: ${answerDisplay}`,
            });
          }
        }
      } else if (event.type === "predict") {
        if (event.rating === "right") {
          act.predictRight++;
        } else {
          act.predictDifferent++;
          // Predict gap -> Error log
          const dedupKey = `${event.lesson}::${event.slide}::predict::${event.title}`;
          if (!dedupKeys.has(dedupKey)) {
            dedupKeys.add(dedupKey);
            const errRes = await addPredictErrorLogEntry(
              subject_dir,
              event,
              modId,
              options.hub,
            );
            newErrorLogEntries.push({
              id: errRes.entryId,
              why: `Lệch dự đoán slide ${event.slide}: ${event.title}`,
              fix: `Kết quả thật: ${event.output ? event.output.slice(0, 100) : event.title}`,
            });
          }
        }
      } else if (event.type === "recall") {
        if (event.rating === "got") {
          act.recallGot++;
        } else {
          act.recallMissed++;
          missedStationsList.push({
            place: event.place,
            item: event.item,
            station: event.station,
            lesson: event.lesson,
          });

          // Missed station -> Error log
          const dedupKey = `${event.lesson}::${event.slide}::recall::${event.palace}_${event.station}_${event.place}_${event.item}`;
          if (!dedupKeys.has(dedupKey)) {
            dedupKeys.add(dedupKey);
            const errRes = await addRecallErrorLogEntry(
              subject_dir,
              event,
              modId,
              options.hub,
            );
            newErrorLogEntries.push({
              id: errRes.entryId,
              why: `Quên trạm ${event.station} (${event.place}) -> ${event.item}`,
              fix: `Neo: ${event.place} -> ${event.item}`,
            });
          }
        }
      } else if (event.type === "complete") {
        act.completed = true;
        if (!completedLessonsSet.has(event.lesson)) {
          completedLessonsSet.add(event.lesson);
          newlyCompletedLessons.push(event.lesson);
          const score = event.quiz ? `Quiz: ${event.quiz}` : event.predictions ? `Predict: ${event.predictions}` : undefined;
          await markLessonDone(subject_dir, event.lesson, eventDate, score, options.hub);
        }
      }
    }
  }

  // Update aggregated stats
  let totalQuiz = 0;
  let correctQuiz = 0;
  let totalPredictRight = 0;
  let totalPredictDiff = 0;
  let totalRecallGot = 0;
  let totalRecallMissed = 0;

  for (const act of lessonActivity.values()) {
    totalQuiz += act.quizTotal;
    correctQuiz += act.quizCorrect;
    totalPredictRight += act.predictRight;
    totalPredictDiff += act.predictDifferent;
    totalRecallGot += act.recallGot;
    totalRecallMissed += act.recallMissed;
  }

  const updatedState: ProgressState = {
    updated: todayIso(),
    processedHashes: Array.from(processedHashes),
    dedupKeys: Array.from(dedupKeys),
    lastSyncedFiles: filesToRead,
    stats: {
      totalEvents: processedHashes.size,
      quizTotal: totalQuiz,
      quizCorrect: correctQuiz,
      predictRight: totalPredictRight,
      predictDifferent: totalPredictDiff,
      recallGot: totalRecallGot,
      recallMissed: totalRecallMissed,
      lessonsCompleted: Array.from(completedLessonsSet),
    },
  };
  await writeJson(p.progressStateJson, updatedState);
  notifySmartDrive(p.polarisDir);
  if (existsSync(targetCourseDir)) {
    notifySmartDrive(targetCourseDir);
  }

  // Query reviews due today
  const due = await getDueReviews(subject_dir, todayIso());

  // Formulate 1-3 concrete suggestions
  const suggestions: string[] = [];
  if (missedStationsList.length > 0) {
    const firstMiss = missedStationsList[0]!;
    suggestions.push(
      `1. Đi bộ hồi tưởng (recall walk) 5 phút củng cố trạm Cung điện trí nhớ: "${firstMiss.place} -> ${firstMiss.item}" (Trạm ${firstMiss.station}).`,
    );
  }
  if (newErrorLogEntries.length > 0) {
    suggestions.push(
      `${suggestions.length + 1}. Ôn tập ${newErrorLogEntries.length} mục mới ghi vào Sổ lỗi (che phần nguyên nhân và tự giải thích lại).`,
    );
  }
  if (newlyCompletedLessons.length > 0) {
    suggestions.push(
      `${suggestions.length + 1}. Bài học "${newlyCompletedLessons.join(", ")}" đã hoàn thành và lên lịch ôn D+1..D+35; chuẩn bị bài tiếp theo theo lộ trình.`,
    );
  }
  if (suggestions.length === 0 && due.dueCount > 0) {
    suggestions.push(
      `1. Hoàn thành ${due.dueCount} mục ôn tập đến hạn trước khi bắt đầu bài học mới.`,
    );
  }
  if (suggestions.length === 0) {
    suggestions.push(
      "1. Tất cả bài học và trắc nghiệm đều nắm vững; sẵn sàng cho phiên học tiếp theo.",
    );
  }

  // Build compact summary lines
  const lines: string[] = [
    `Đồng bộ tiến độ Aurora hoàn tất (${filesToRead.length} file nguồn, ${newEventsCount} sự kiện mới).`,
    "",
    "Hoạt động theo bài học:",
  ];

  if (lessonActivity.size === 0) {
    lines.push("  (Chưa có hoạt động bài học nào được ghi nhận)");
  } else {
    for (const [lesName, act] of lessonActivity.entries()) {
      const parts: string[] = [`Lần cuối: ${act.lastTime}`];
      if (act.quizTotal > 0) {
        const pct = Math.round((act.quizCorrect / act.quizTotal) * 100);
        parts.push(`Quiz: ${act.quizCorrect}/${act.quizTotal} (${pct}%)`);
      }
      if (act.predictRight + act.predictDifferent > 0) {
        parts.push(`Dự đoán: ${act.predictRight} đúng, ${act.predictDifferent} lệch`);
      }
      if (act.recallGot + act.recallMissed > 0) {
        parts.push(`Trạm nhớ: ${act.recallGot} nhớ, ${act.recallMissed} quên`);
      }
      if (act.completed || completedLessonsSet.has(lesName)) {
        parts.push("Đã hoàn thành");
      }
      lines.push(`  - ${lesName}: ${parts.join(" · ")}`);
    }
  }

  lines.push(
    "",
    `Mục mới thêm vào Sổ lỗi: ${newErrorLogEntries.length}`,
    `Bài học hoàn thành mới: ${newlyCompletedLessons.length}`,
    `Ôn tập đến hạn hôm nay: ${due.dueCount} mục`,
  );

  if (newErrorLogEntries.length > 0) {
    lines.push("", "Chi tiết mục Sổ lỗi mới:");
    newErrorLogEntries.forEach((e) => {
      lines.push(`  - [${e.id}] ${e.why} -> ${e.fix}`);
    });
  }

  lines.push("", "Gợi ý cho phiên học tiếp theo:", ...suggestions.map((s) => `  ${s}`));

  if (vegaCardEventsCount > 0) {
    lines.push(
      "",
      `${vegaCardEventsCount} sự kiện thẻ ("card") dành riêng cho Vega FSRS (${vegaCardEventsCount} card events left for Vega).`,
    );
  }

  const skippedTotal = malformedCount + unknownTypeCount;
  if (skippedTotal > 0) {
    lines.push(
      "",
      `Bỏ qua ${skippedTotal} dòng (${malformedCount} lỗi định dạng, ${unknownTypeCount} sự kiện không xác định).`,
    );
  }

  return {
    eventsProcessed: processedHashes.size,
    newEventsCount,
    newErrorLogCount: newErrorLogEntries.length,
    completedLessonsCount: newlyCompletedLessons.length,
    skippedLinesCount: skippedTotal,
    malformedCount,
    unknownTypeCount,
    vegaCardEventsCount,
    newErrorLogEntries,
    lessonsCompleted: Array.from(completedLessonsSet),
    reviewsDueToday: due.dueCount,
    summary: lines.join("\n"),
  };
}
