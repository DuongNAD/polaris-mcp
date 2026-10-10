import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ErrorLogEntryInputSchema,
  validateReviewsData,
  type ErrorLogEntryInput,
  type ReviewItem,
  type ReviewStep,
  type ReviewsData,
} from "./schema.js";
import { getProfile } from "./store.js";
import {
  addDays,
  atomicWriteFile,
  daysBetween,
  hash,
  readJson,
  subjectPaths,
  todayIso,
  writeJson,
} from "./util.js";

/* ───────── 1. Error Log ("Sổ lỗi") ───────── */

export interface ErrorLogAddResult {
  errorlogPath: string;
  entryId: string;
  dueDateD1: string;
  dueDateD3: string;
  dueDateD7: string;
  dueDateD16: string;
  dueDateD35: string;
  summary: string;
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
  const profile = await getProfile(hub);
  const reviewOffsets = profile.method?.spacedReviewDays ?? [1, 3, 7, 16, 35];

  const d1 = addDays(date, reviewOffsets[0] ?? 1);
  const d3 = addDays(date, reviewOffsets[1] ?? 3);
  const d7 = addDays(date, reviewOffsets[2] ?? 7);
  const d16 = addDays(date, reviewOffsets[3] ?? 16);
  const d35 = addDays(date, reviewOffsets[4] ?? 35);

  const modStr = entry.module ? ` - Module ${entry.module}` : "";
  const lesStr = entry.lesson ? ` (${entry.lesson})` : "";
  const entryId = `ERR_${date}_${hash(entry.why + entry.fix, 6)}`;

  const mdChunk = [
    `### [${date}] Lỗi gap${modStr}${lesStr}`,
    `- **Mã mục:** \`${entryId}\``,
    `- **Ngày ghi nhận:** ${date}`,
    `- **Dự đoán ban đầu:** ${entry.prediction || "Chưa ghi dự đoán"}`,
    `- **Kết quả thực tế (Triệu chứng):** ${entry.result || "Gặp lỗi ngoài mong đợi"}`,
    `- **Nguyên nhân gốc rễ:** ${entry.why}`,
    `- **Cách sửa & Quy tắc rút ra:** ${entry.fix}`,
    `- **Nguồn / Tham chiếu:** ${entry.source || "Thực hành bài học"}`,
    `- **Lịch ôn lại giãn cách:** D+1 (${d1}), D+3 (${d3}), D+7 (${d7}), D+16 (${d16}), D+35 (${d35})`,
    "",
  ].join("\n");

  // Append to polaris/errorlog.md
  let existingErrorLog = "";
  if (existsSync(p.errorlogMd)) {
    existingErrorLog = await readFile(p.errorlogMd, "utf8");
  } else {
    existingErrorLog = "# Sổ lỗi (Error Log & Predict Gaps)\n\n> Ghi nhận các điểm lệch giữa dự đoán (predict) và thực tế (run). Mỗi lỗi là một cơ hội củng cố mental model.\n\n";
  }

  const updatedErrorLog = existingErrorLog.trimEnd() + "\n\n" + mdChunk;
  await atomicWriteFile(p.errorlogMd, updatedErrorLog);

  // Schedule reviews in polaris/reviews.json
  const reviewsData = await loadOrCreateReviewsData(p.reviewsJson);

  const steps: ReviewStep[] = reviewOffsets.map((offset) => ({
    dayOffset: offset,
    dueDate: addDays(date, offset),
    done: false,
  }));

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
  scheduledReviews: Array<{ dayOffset: number; dueDate: string }>;
  summary: string;
}

export async function markLessonDone(
  subjectDir: string,
  lessonDir: string,
  date?: string,
  score?: number | string,
  hub?: string,
): Promise<LessonDoneResult> {
  const p = subjectPaths(subjectDir);
  const completedDate = date || todayIso();
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
