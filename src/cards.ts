/**
 * Card candidates that Polaris hands to Vega (contract vega-card-inbox.v1).
 *
 * Polaris keeps the human-readable error log ("Sổ lỗi") and sends one card per entry; Vega validates, de-duplicates by
 * key and schedules it with FSRS. Card content follows the contract guidance: a card is something to re-solve, never
 * "reread X".
 *
 *   quiz miss       front: the question                       back: the correct answer (+ explanation)
 *   predict miss    front: what to predict (title)             back: the real output
 *   recall miss     front: "<palace> · <place>: mục nào?"      back: the item
 *   manual entry    front: the situation to re-solve           back: root cause (why) + fix
 *   self-check      front: the question                       back: the answer
 *
 * Keys: `polaris:<subject folder name>:<entry id>` and `polaris:<subject>:selfcheck:<module id>:<index>` (1-based).
 */
import { basename } from "node:path";
import { INBOX_LIMITS, clampText, stripEmoji, type InboxLine, type InboxOrigin } from "./inbox.js";
import type {
  PredictProgressEvent,
  QuizProgressEvent,
  RecallProgressEvent,
  RoadmapModule,
} from "./schema.js";
import { subjectPaths } from "./util.js";

const toPosix = (p: string): string => p.replace(/\\/g, "/");

/** Subject name used in keys and in the card `subject` field: the subject folder name. */
export function cardSubject(subjectDir: string): string {
  const name = basename(subjectPaths(subjectDir).dir);
  return clampText(stripEmoji(name).normalize("NFC"), INBOX_LIMITS.subject) || "subject";
}

export const errorLogCardKey = (subject: string, entryId: string): string => `polaris:${subject}:${entryId}`;

export const selfCheckCardKey = (subject: string, moduleId: string, index: number): string =>
  `polaris:${subject}:selfcheck:${moduleId}:${index}`;

/** The review line of an error-log entry when Vega owns the schedule. */
export const vegaReviewLine = (key: string): string => `- **Ôn tập:** thẻ Vega \`${key}\` (FSRS lập lịch)`;

interface LineParts {
  now: Date;
  subject: string;
  key: string;
  deck?: string;
  front: string;
  back: string;
  hint?: string;
  hook?: string;
  origin: InboxOrigin;
  tags?: string[];
  reason?: string;
}

function cleanText(s: string | undefined, max: number): string | undefined {
  if (s === undefined) return undefined;
  const t = clampText(stripEmoji(s).normalize("NFC"), max);
  return t.length > 0 ? t : undefined;
}

/** Normalize and clamp the text of one card; the field order is stable (v, t, producer, key, subject, deck, ...). */
function buildLine(p: LineParts): InboxLine {
  const deck = cleanText(p.deck, INBOX_LIMITS.deck);
  const hint = cleanText(p.hint, INBOX_LIMITS.hint);
  const hook = cleanText(p.hook, INBOX_LIMITS.hook);
  const reason = cleanText(p.reason, INBOX_LIMITS.reason);
  const tags = [
    ...new Set((p.tags ?? []).map((t) => cleanText(t, INBOX_LIMITS.tag)).filter((t): t is string => Boolean(t))),
  ].slice(0, INBOX_LIMITS.tags);

  return {
    v: 1,
    // Whole seconds, UTC "Z": the form every ISO 8601 date-time validator accepts.
    t: p.now.toISOString().replace(/\.\d+Z$/, "Z"),
    producer: "polaris",
    key: p.key,
    subject: p.subject,
    ...(deck ? { deck } : {}),
    kind: "basic",
    front: cleanText(p.front, INBOX_LIMITS.front) ?? "",
    back: cleanText(p.back, INBOX_LIMITS.back) ?? "",
    ...(hint ? { hint } : {}),
    ...(hook ? { hook } : {}),
    origin: {
      kind: p.origin.kind,
      path: toPosix(p.origin.path),
      ...(p.origin.locator ? { locator: clampText(p.origin.locator, INBOX_LIMITS.originLocator) } : {}),
      ...(p.origin.href ? { href: p.origin.href } : {}),
    },
    ...(tags.length > 0 ? { tags } : {}),
    ...(reason ? { reason } : {}),
  };
}

/* ───────── Error-log cards ───────── */

interface ErrorCardBase {
  /** Subject name from {@link cardSubject}. */
  subject: string;
  entryId: string;
  /** Absolute path of polaris/errorlog.md. */
  errorlogPath: string;
  now?: Date;
}

function errorOrigin(a: ErrorCardBase): InboxOrigin {
  return { kind: "polaris-errorlog", path: a.errorlogPath, locator: a.entryId };
}

export function quizErrorCard(a: ErrorCardBase & { event: QuizProgressEvent }): InboxLine {
  const e = a.event;
  const answer = e.answerText && e.answerText.length > 0 ? e.answerText.join(", ") : `[${e.answer.join(", ")}]`;
  const explanation = e.explanation?.trim();
  const back = [`Đáp án đúng: ${answer}`, explanation ? `Giải thích: ${explanation}` : ""].filter(Boolean).join("\n");
  return buildLine({
    now: a.now ?? new Date(),
    subject: a.subject,
    key: errorLogCardKey(a.subject, a.entryId),
    deck: e.lesson,
    front: e.question,
    back,
    origin: errorOrigin(a),
    tags: ["so-loi", "trac-nghiem"],
    reason: `Trả lời sai trắc nghiệm ở slide ${e.slide} của bài ${e.lesson}`,
  });
}

export function predictErrorCard(a: ErrorCardBase & { event: PredictProgressEvent }): InboxLine {
  const e = a.event;
  const back = e.output.trim() || "Kết quả thật khác dự đoán của bạn; chạy lại để quan sát kết quả.";
  const guess = e.prediction.trim();
  return buildLine({
    now: a.now ?? new Date(),
    subject: a.subject,
    key: errorLogCardKey(a.subject, a.entryId),
    deck: e.lesson,
    front: e.title,
    back,
    origin: errorOrigin(a),
    tags: ["so-loi", "du-doan"],
    reason: guess ? `Dự đoán sai ở slide ${e.slide}: ${guess}` : `Dự đoán lệch kết quả ở slide ${e.slide}`,
  });
}

export function recallErrorCard(a: ErrorCardBase & { event: RecallProgressEvent }): InboxLine {
  const e = a.event;
  return buildLine({
    now: a.now ?? new Date(),
    subject: a.subject,
    key: errorLogCardKey(a.subject, a.entryId),
    deck: e.lesson,
    front: `${e.palace} · ${e.place}: mục nào?`,
    back: e.item,
    origin: errorOrigin(a),
    tags: ["so-loi", "cung-dien-tri-nho"],
    reason: `Quên trạm ${e.station} của cung điện ${e.palace}`,
  });
}

export interface ManualErrorCardInput {
  date: string;
  module?: string;
  lesson?: string;
  prediction?: string;
  result?: string;
  why: string;
  fix: string;
  source?: string;
}

const endSentence = (s: string): string => (/[.!?…:;]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

export function manualErrorCard(a: ErrorCardBase & { entry: ManualErrorCardInput }): InboxLine {
  const e = a.entry;
  const ask = "Nguyên nhân gốc là gì và cách sửa (quy tắc rút ra) là gì?";
  const parts: string[] = [];
  const symptom = e.result?.trim();
  const guess = e.prediction?.trim();
  if (symptom) parts.push(`Triệu chứng: ${endSentence(clampText(symptom, 280))}`);
  if (guess) parts.push(`Bạn từng dự đoán: ${endSentence(clampText(guess, 180))}`);
  const context = [e.module ? `module ${e.module}` : "", e.lesson ? `bài ${e.lesson}` : ""].filter(Boolean).join(", ");
  const front = parts.length > 0 ? `${parts.join(" ")} ${ask}` : `Một lỗi đã ghi trong Sổ lỗi${context ? ` (${context})` : ""}. ${ask}`;
  const back = `Nguyên nhân gốc: ${clampText(e.why, 560)}\nCách sửa và quy tắc rút ra: ${clampText(e.fix, 560)}`;
  return buildLine({
    now: a.now ?? new Date(),
    subject: a.subject,
    key: errorLogCardKey(a.subject, a.entryId),
    deck: e.lesson || e.module || "Sổ lỗi",
    front,
    back,
    origin: errorOrigin(a),
    tags: ["so-loi", ...(e.module ? [e.module.toLowerCase()] : [])],
    reason: `Sổ lỗi ngày ${e.date}${e.source ? ` (${e.source})` : ""}`,
  });
}

/* ───────── Lesson self-check cards ───────── */

/**
 * One card per self-check question of the lesson's module. The key uses the module id and the 1-based question index,
 * so finishing both halves (a and b) of a split module, or finishing a lesson twice, never creates duplicate cards.
 */
export function selfCheckCards(a: {
  subject: string;
  module: Pick<RoadmapModule, "id" | "selfCheck">;
  lessonDir: string;
  roadmapPath: string;
  now?: Date;
}): InboxLine[] {
  const now = a.now ?? new Date();
  return a.module.selfCheck.map((item, i) => {
    const index = i + 1;
    return buildLine({
      now,
      subject: a.subject,
      key: selfCheckCardKey(a.subject, a.module.id, index),
      deck: a.lessonDir,
      front: item.q,
      back: item.answer,
      origin: { kind: "polaris-selfcheck", path: a.roadmapPath, locator: `${a.module.id} #${index}` },
      tags: ["tu-kiem-tra", ...(item.level ? [item.level] : [])],
      reason: `Hoàn thành bài ${a.lessonDir}`,
    });
  });
}
