import { z } from "zod";
import { closest } from "./util.js";

export const SOURCE_KINDS = ["local", "web", "paper", "video", "book", "course", "notebooklm", "deeptutor"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_LABELS = ["course", "extension", "unverified"] as const;
export type SourceLabel = (typeof SOURCE_LABELS)[number];

export const SELF_CHECK_LEVELS = ["remember", "explain", "predict", "apply"] as const;
export type SelfCheckLevel = (typeof SELF_CHECK_LEVELS)[number];

/* ───────── Learner Profile ───────── */

export const StudySlotSchema = z.strictObject({
  day: z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]).describe("Day of week: Mon, Tue, Wed, Thu, Fri, Sat, Sun"),
  minutes: z.number().int().min(15).max(480).describe("Duration of study slot in minutes"),
});

export const BlackoutSchema = z.strictObject({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from date must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to date must be YYYY-MM-DD"),
  reason: z.string().optional(),
});

export const SessionTypeSchema = z.strictObject({
  name: z.string().min(1),
  minutes: z.number().int().min(1),
  structure: z.string().min(1),
});

export const CommitmentSchema = z.strictObject({
  name: z.string().min(1),
  priority: z.string().min(1),
  period: z.string().optional(),
  note: z.string().optional(),
});

export const LearnerProfileSchema = z.strictObject({
  lang: z.string().default("vi"),
  slots: z.array(StudySlotSchema).default([
    { day: "Tue", minutes: 30 },
    { day: "Sat", minutes: 60 },
  ]),
  blackouts: z.array(BlackoutSchema).default([]),
  method: z.strictObject({
    summary: z.string().min(1),
    theoryFirst: z.boolean().default(true),
    memoryAnchors: z.array(z.string()).default(["palace", "anchors", "analogy", "mnemonic"]),
    notebookPages: z.boolean().default(true),
    predictThenRun: z.boolean().default(true),
    errorLog: z.string().default("Sổ lỗi"),
    sessionTypes: z.array(SessionTypeSchema).min(1),
    spacedReviewDays: z.array(z.number().int().min(1)).default([1, 3, 7, 16, 35]),
  }),
  taste: z.strictObject({
    slideStyle: z.string().default("Apple-keynote"),
    noEmoji: z.boolean().default(true),
    noNeon: z.boolean().default(true),
    accent: z.string().optional(),
  }),
  commitments: z.array(CommitmentSchema).default([]),
  custom: z.record(z.string(), z.unknown()).optional(),
});

export type LearnerProfile = z.output<typeof LearnerProfileSchema>;
export type StudySlot = z.output<typeof StudySlotSchema>;
export type Blackout = z.output<typeof BlackoutSchema>;

/* ───────── Course Brief ───────── */

export const BriefOutcomeSchema = z.strictObject({
  id: z.string().min(1).describe("Outcome ID e.g. O1, O2"),
  text: z.string().min(1).describe("Outcome statement"),
  check: z.string().min(1).describe("Measurable verification criteria"),
});

export const DiagnosticQuestionSchema = z.strictObject({
  q: z.string().min(1),
  answer: z.string().min(1),
  correct: z.boolean().optional(),
});

export const LevelSchema = z.strictObject({
  summary: z.string().optional(),
  diagnostic: z.array(DiagnosticQuestionSchema).optional(),
});

export const ScopeSchema = z.strictObject({
  in: z.array(z.string()).default([]),
  out: z.array(z.string()).default([]),
});

export const BriefSchema = z.strictObject({
  subject: z.string().min(1).describe("Subject name"),
  slug: z.string().min(1).describe("URL-friendly slug for the subject folder"),
  goal: z.string().min(1).describe("High level goal"),
  outcomes: z.array(BriefOutcomeSchema).min(1).describe("Measurable outcomes"),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start date must be YYYY-MM-DD"),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "deadline must be YYYY-MM-DD").optional(),
  hoursPerWeek: z.number().min(0.5).describe("Target study hours per week"),
  sourcesOfTruth: z.array(z.string().min(1)).min(1).describe("Primary sources of truth (paths or URLs)"),
  level: LevelSchema.optional(),
  scope: ScopeSchema.optional(),
  constraints: z.array(z.string()).optional(),
  roadmapPath: z.string().optional().describe("Path to rendered ROADMAP.md"),
});

export type Brief = z.output<typeof BriefSchema>;
export type BriefInput = z.input<typeof BriefSchema>;

/* ───────── Source Registry ───────── */

export const SourceQualitySchema = z.strictObject({
  score: z.number().int().min(1).max(5).describe("Quality score from 1 to 5"),
  why: z.string().min(1).describe("Reason for score"),
});

export const SourceSchema = z.strictObject({
  id: z.string().min(1).describe("Source ID e.g. S1, S2"),
  kind: z.enum(SOURCE_KINDS).describe(`Source kind: ${SOURCE_KINDS.join(" | ")}`),
  title: z.string().min(1).describe("Title of the source"),
  author: z.string().optional(),
  date: z.string().optional(),
  url: z.string().optional(),
  path: z.string().optional(),
  label: z.enum(SOURCE_LABELS).describe("Label: course (primary truth) | extension | unverified"),
  quality: SourceQualitySchema,
  accessed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "accessed must be YYYY-MM-DD"),
  capture: z.string().optional().describe("Relative path to captured markdown file e.g. captures/S1.md"),
  license: z.string().optional(),
  notes: z.string().optional(),
});

export type Source = z.output<typeof SourceSchema>;
export type SourceInput = z.input<typeof SourceSchema>;

/* ───────── Facts ───────── */

export const FactSchema = z.strictObject({
  id: z.string().min(1).describe("Fact ID e.g. F1, F2"),
  claim: z.string().min(1).describe("Factual claim in learner language"),
  source: z.string().min(1).describe("Source ID e.g. S1"),
  locator: z.string().min(1).describe("Locator in source e.g. '02:13', 'p. 4', 'Sec. 2.1', 'lines 10-25'"),
  label: z.enum(SOURCE_LABELS).describe("Label: course | extension | unverified"),
  modules: z.array(z.string().min(1)).min(1).describe("Module IDs that use this fact e.g. ['M1']"),
  crossCheck: z.array(z.string().min(1)).optional().describe("IDs of cross-checking sources for numbers/dates"),
});

export type Fact = z.output<typeof FactSchema>;
export type FactInput = z.input<typeof FactSchema>;

/* ───────── Roadmap ───────── */

export const PracticeTierSchema = z.strictObject({
  task: z.string().min(1).describe("Task description"),
  minutes: z.number().int().min(1).optional(),
  dod: z.string().min(1).describe("Definition of Done: checkable criteria"),
});

export const SelfCheckItemSchema = z.strictObject({
  q: z.string().min(1).describe("Self check question"),
  level: z.enum(SELF_CHECK_LEVELS).optional().describe("Cognitive level: remember | explain | predict | apply"),
  answer: z.string().min(1).describe("Answer to the question"),
});

export const MisconceptionSchema = z.strictObject({
  wrong: z.string().min(1).describe("Common mistake or misconception"),
  why: z.string().optional().describe("Why this misconception happens"),
  fix: z.string().min(1).describe("How to understand or fix it"),
});

export const MaterialSchema = z.strictObject({
  title: z.string().min(1),
  source: z.string().optional().describe("Source ID or reference"),
  url: z.string().optional(),
  path: z.string().optional(),
  minutes: z.number().int().min(1).describe("Estimated study minutes"),
  note: z.string().optional(),
});

export const CorePointSchema = z.strictObject({
  text: z.string().min(1).describe("Core knowledge statement"),
  facts: z.array(z.string()).optional().describe("Citing fact IDs e.g. ['F1', 'F2']"),
  label: z.enum(SOURCE_LABELS).optional().describe("Label: course | extension | unverified"),
});

export const RoadmapModuleSchema = z.strictObject({
  id: z.string().min(1).describe("Module ID e.g. M0, M1, M2"),
  title: z.string().min(1).describe("Module title"),
  hours: z.number().min(0.5).describe("Estimated study hours"),
  depends: z.array(z.string()).default([]).describe("Prerequisite module IDs e.g. ['M0']"),
  why: z.string().min(1).describe("Vì sao học"),
  outputs: z.array(z.string().min(1)).min(2).describe("Đầu ra: at least 2 measurable deliverables"),
  core: z.array(CorePointSchema).min(1).describe("Kiến thức cốt lõi"),
  diagram: z.string().optional().describe("Mermaid diagram code or explanation"),
  misconceptions: z.array(MisconceptionSchema).min(1).describe("Hiểu lầm và lỗi hay gặp: at least 1 item"),
  materials: z.array(MaterialSchema).default([]).describe("Tài liệu tham khảo with minutes"),
  practice: z.strictObject({
    warmup: PracticeTierSchema.describe("Khởi động"),
    core: PracticeTierSchema.describe("Cốt lõi"),
    challenge: PracticeTierSchema.describe("Thử thách"),
  }),
  selfCheck: z.array(SelfCheckItemSchema).min(4).describe("Tự kiểm tra: at least 4 questions"),
  checkpoint: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).describe("Checkpoint completion criteria"),
  lessons: z.number().int().min(1).max(10).optional().describe("Number of lessons (default 1, or 2 if hours > 2.5)"),
  theme: z.string().optional().describe("Theme of this module's lesson deck"),
  icon: z.string().optional().describe("Icon for this module's lesson deck"),
});

export type RoadmapModule = z.output<typeof RoadmapModuleSchema>;

export const CapstoneSchema = z.strictObject({
  title: z.string().optional(),
  description: z.string().min(1),
  dod: z.string().optional(),
  scope: z.array(z.string()).optional(),
  minHours: z.number().optional(),
});

export const ReviewScheduleRowSchema = z.strictObject({
  module: z.string().min(1),
  date: z.string().min(1),
  d1: z.string().optional(),
  d3: z.string().optional(),
  d7: z.string().optional(),
  d21: z.string().optional(),
});

export const InterleavedReviewSchema = z.strictObject({
  name: z.string().min(1),
  date: z.string().optional(),
  focus: z.string().min(1),
});

export const ReviewSectionSchema = z.strictObject({
  schedule: z.array(ReviewScheduleRowSchema).optional(),
  interleaved: z.array(InterleavedReviewSchema).optional(),
});

export const OlderMaterialItemSchema = z.strictObject({
  file: z.string().min(1),
  usable: z.string().min(1),
  purpose: z.string().min(1),
});

export const RoadmapSchema = z.strictObject({
  title: z.string().min(1),
  theme: z.string().optional().describe("Overall theme for the course deck e.g. midnight"),
  version: z.union([z.string(), z.number()]).default("1"),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "updated must be YYYY-MM-DD").optional(),
  goalQuote: z.string().optional(),
  outcomes: z.array(z.object({ id: z.string().optional(), text: z.string().min(1), check: z.string().optional() })).optional(),
  prerequisites: z.strictObject({
    summary: z.string().optional(),
    quickSelfTest: z.array(z.strictObject({ q: z.string().min(1), answer: z.string().min(1) })).optional(),
  }).optional(),
  timeBudget: z.strictObject({
    hoursPerWeek: z.number().optional(),
    totalHours: z.number().optional(),
    notes: z.string().optional(),
  }).optional(),
  status: z.strictObject({
    current: z.string().optional(),
    weeklySchedule: z.array(z.strictObject({
      week: z.union([z.number(), z.string()]),
      sessions: z.string(),
      module: z.string(),
      dod: z.string(),
      deadline: z.string().optional(),
    })).optional(),
  }).optional(),
  modules: z.array(RoadmapModuleSchema).min(1),
  capstone: CapstoneSchema.optional(),
  review: ReviewSectionSchema.optional(),
  errorLogNote: z.string().optional(),
  olderMaterial: z.array(OlderMaterialItemSchema).optional(),
  progressTracking: z.array(z.string()).optional(),
});

export type Roadmap = z.output<typeof RoadmapSchema>;
export type RoadmapInput = z.input<typeof RoadmapSchema>;

/* ───────── Validation Helpers with "did you mean" ───────── */

export interface ValidationOutcome<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

function formatZodErrors(issues: z.ZodIssue[], schemaShape?: Record<string, unknown>): string[] {
  return issues.slice(0, 25).map((issue) => {
    let where = "";
    issue.path.forEach((seg) => {
      if (typeof seg === "number") {
        where += `[${seg}]`;
      } else {
        where += where ? `.${String(seg)}` : String(seg);
      }
    });

    let msg = issue.message;
    const issueObj = issue as unknown as Record<string, unknown>;
    if (issue.code === "unrecognized_keys") {
      const keys = (issueObj.keys as string[]) ?? [];
      const allowed = schemaShape ? Object.keys(schemaShape) : [];
      const hints = keys.map((k) => [k, closest(k, allowed)] as const).filter(([, s]) => Boolean(s));
      if (hints.length) {
        msg += ` (did you mean ${hints.map(([k, s]) => `"${s}" for "${k}"`).join(", ")}?)`;
      }
      if (allowed.length) {
        msg += ` - allowed keys: ${allowed.join(", ")}`;
      }
    } else if (issue.code === "invalid_value") {
      const values = (issueObj.values as string[]) ?? (issueObj.options as string[]) ?? [];
      const received = (issueObj.input as string) ?? (issueObj.received as string);
      if (received && values.length) {
        const guess = closest(String(received), values);
        if (guess) {
          msg += ` (did you mean "${guess}"?)`;
        }
      }
    }
    return `${where || "(root)"}: ${msg}`;
  });
}

export function validateBrief(raw: unknown): ValidationOutcome<Brief> {
  const parsed = BriefSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data, errors: [] };
  return {
    ok: false,
    errors: formatZodErrors(parsed.error.issues, BriefSchema.shape),
  };
}

export function validateSource(raw: unknown): ValidationOutcome<Source> {
  const parsed = SourceSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data, errors: [] };
  return {
    ok: false,
    errors: formatZodErrors(parsed.error.issues, SourceSchema.shape),
  };
}

export function validateFact(raw: unknown): ValidationOutcome<Fact> {
  const parsed = FactSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data, errors: [] };
  return {
    ok: false,
    errors: formatZodErrors(parsed.error.issues, FactSchema.shape),
  };
}

export function validateRoadmap(raw: unknown): ValidationOutcome<Roadmap> {
  const parsed = RoadmapSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data, errors: [] };
  return {
    ok: false,
    errors: formatZodErrors(parsed.error.issues, RoadmapSchema.shape),
  };
}

export function validateProfile(raw: unknown): ValidationOutcome<LearnerProfile> {
  const parsed = LearnerProfileSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data, errors: [] };
  return {
    ok: false,
    errors: formatZodErrors(parsed.error.issues, LearnerProfileSchema.shape),
  };
}

/* ───────── Schedule ───────── */

export const ScheduleSessionSchema = z.strictObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  day: z.string().min(1).describe("Vietnamese day of week e.g. 'Thứ Ba'"),
  minutes: z.number().int().min(1).describe("Session minutes"),
  module: z.string().min(1).describe("Module ID or 'Review'"),
  activity: z.string().min(1).describe("Activity description"),
  when: z.string().min(1).describe("When label e.g. 'Tuần 2 · Thứ Ba 20/10'"),
});

export const ScheduleWeekSchema = z.strictObject({
  week: z.number().int().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessions: z.array(ScheduleSessionSchema),
});

export const BlockedDateEntrySchema = z.strictObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(1),
});

export const ModuleCompletionEntrySchema = z.strictObject({
  completedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lastSession: z.string().min(1),
});

export const ScheduleSchema = z.strictObject({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  interleaveEvery: z.number().int().min(1).default(4),
  weeks: z.array(ScheduleWeekSchema),
  moduleCompletion: z.record(z.string(), ModuleCompletionEntrySchema).default({}),
  lessonWhenMap: z.record(z.string(), z.string()).default({}),
  blockedDates: z.array(BlockedDateEntrySchema).default([]),
});

export type ScheduleSession = z.output<typeof ScheduleSessionSchema>;
export type ScheduleWeek = z.output<typeof ScheduleWeekSchema>;
export type Schedule = z.output<typeof ScheduleSchema>;

export function validateSchedule(raw: unknown): ValidationOutcome<Schedule> {
  const parsed = ScheduleSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data, errors: [] };
  return {
    ok: false,
    errors: formatZodErrors(parsed.error.issues, ScheduleSchema.shape),
  };
}

/* ───────── Aurora Course & Course Map ───────── */

export const AURORA_THEMES = ["aurora", "midnight", "daylight", "titanium", "ocean", "sunset", "forest", "paper", "liquid"] as const;
export type AuroraTheme = (typeof AURORA_THEMES)[number];

export const CourseLessonSchema = z.strictObject({
  title: z.string().min(1).describe("Lesson title e.g. 'Cổng lượng tử'"),
  summary: z.string().min(1).optional().describe("One line: what this lesson covers"),
  when: z.string().min(1).optional().describe("When this lesson takes place, e.g. 'Tuần 2 · Thứ Ba 20/10'"),
  dir: z
    .string()
    .regex(/^[A-Za-z0-9._-]+$/, "dir is a plain folder name like 02-cong-luong-tu")
    .optional()
    .describe("Folder name of this lesson inside the course (default: 01-<slug>, 02-<slug>, …)"),
  icon: z.string().min(1).optional().describe("Phosphor or Iconify icon id"),
  theme: z.enum(AURORA_THEMES).optional().describe("Theme of this lesson's deck"),
  accent: z.string().optional(),
  minutes: z.number().int().min(1).max(240).optional().describe("Estimated study time"),
});

export const CourseSchema = z.strictObject({
  $schema: z.string().optional(),
  title: z.string().min(1).describe("Course title"),
  subtitle: z.string().min(1).optional().describe("One line promise of the course"),
  author: z.string().optional(),
  lang: z.string().default("vi"),
  theme: z.enum(AURORA_THEMES).default("midnight"),
  accent: z.string().optional(),
  font: z.enum(["vietnam", "inter", "system"]).default("vietnam"),
  lessons: z.array(CourseLessonSchema).min(1).max(40).describe("Small lessons in study order"),
});

export const CourseMapLessonSchema = z.strictObject({
  module: z.string().min(1),
  part: z.string().optional(),
  dir: z.string().min(1),
  title: z.string().min(1),
  theme: z.enum(AURORA_THEMES),
  icon: z.string().min(1),
  when: z.string().optional(),
  minutes: z.number().int().default(20),
});

export const CourseMapSchema = z.strictObject({
  courseDir: z.string().min(1),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lessons: z.array(CourseMapLessonSchema),
});

export type Course = z.output<typeof CourseSchema>;
export type CourseLesson = z.output<typeof CourseLessonSchema>;
export type CourseMapLesson = z.output<typeof CourseMapLessonSchema>;
export type CourseMap = z.output<typeof CourseMapSchema>;

export function validateCourse(raw: unknown): ValidationOutcome<Course> {
  const parsed = CourseSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data, errors: [] };
  return {
    ok: false,
    errors: formatZodErrors(parsed.error.issues, CourseSchema.shape),
  };
}

export function validateCourseMap(raw: unknown): ValidationOutcome<CourseMap> {
  const parsed = CourseMapSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data, errors: [] };
  return {
    ok: false,
    errors: formatZodErrors(parsed.error.issues, CourseMapSchema.shape),
  };
}

/* ───────── Tasks Map ───────── */

export const TasksMapItemSchema = z.strictObject({
  key: z.string().min(1),
  line: z.string().min(1),
  deadline: z.string().min(1),
  syncedAt: z.string().min(1),
});

export const TasksMapSchema = z.strictObject({
  updated: z.string().min(1),
  tasks: z.record(z.string(), TasksMapItemSchema),
});

export type TasksMap = z.output<typeof TasksMapSchema>;

/* ───────── Error Log & Spaced Reviews ───────── */

export const ErrorLogEntryInputSchema = z.strictObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  module: z.string().optional(),
  lesson: z.string().optional(),
  prediction: z.string().optional(),
  result: z.string().optional(),
  why: z.string().min(1).describe("Nguyên nhân gốc rễ gây lỗi"),
  fix: z.string().min(1).describe("Cách sửa và quy tắc rút ra"),
  source: z.string().optional().describe("Nguồn hoặc tài liệu tham khảo"),
});

export type ErrorLogEntryInput = z.input<typeof ErrorLogEntryInputSchema>;

export const ReviewStepSchema = z.strictObject({
  dayOffset: z.number().int().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  done: z.boolean().default(false),
  doneDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  score: z.union([z.number(), z.string()]).optional(),
});

export const ReviewItemSchema = z.strictObject({
  id: z.string().min(1),
  type: z.enum(["lesson", "error"]),
  title: z.string().min(1),
  module: z.string().optional(),
  lessonDir: z.string().optional(),
  createdDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  steps: z.array(ReviewStepSchema),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const ReviewsDataSchema = z.strictObject({
  updated: z.string().min(1),
  items: z.array(ReviewItemSchema),
});

export type ReviewStep = z.output<typeof ReviewStepSchema>;
export type ReviewItem = z.output<typeof ReviewItemSchema>;
export type ReviewsData = z.output<typeof ReviewsDataSchema>;

export function validateReviewsData(raw: unknown): ValidationOutcome<ReviewsData> {
  const parsed = ReviewsDataSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data, errors: [] };
  return {
    ok: false,
    errors: formatZodErrors(parsed.error.issues, ReviewsDataSchema.shape),
  };
}

/* ───────── Aurora Progress Events & Sync State ───────── */

export const ProgressBaseEventSchema = z.object({
  v: z.number().int().default(1),
  t: z.string().min(1).describe("ISO 8601 timestamp with timezone offset"),
  course: z.string().nullable().optional(),
  lesson: z.string().min(1).describe("Lesson folder name"),
  deck: z.string().optional(),
  slide: z.number().int().min(1).describe("1-based slide index"),
  slideId: z.string().nullable().optional(),
});

export const QuizProgressEventSchema = ProgressBaseEventSchema.extend({
  type: z.literal("quiz"),
  question: z.string().max(200),
  chosen: z.array(z.number().int()),
  answer: z.array(z.number().int()),
  correct: z.boolean(),
});

export const PredictProgressEventSchema = ProgressBaseEventSchema.extend({
  type: z.literal("predict"),
  title: z.string().min(1),
  prediction: z.string(),
  rating: z.enum(["right", "different"]),
  output: z.string().max(300),
});

export const RecallProgressEventSchema = ProgressBaseEventSchema.extend({
  type: z.literal("recall"),
  palace: z.string().min(1),
  station: z.number().int().min(1),
  place: z.string().min(1),
  item: z.string().min(1),
  rating: z.enum(["got", "missed"]),
});

export const CompleteProgressEventSchema = ProgressBaseEventSchema.extend({
  type: z.literal("complete"),
  slides: z.number().int().min(1),
  quiz: z.string().nullable().optional(),
  predictions: z.string().nullable().optional(),
});

export const ProgressEventSchema = z.discriminatedUnion("type", [
  QuizProgressEventSchema,
  PredictProgressEventSchema,
  RecallProgressEventSchema,
  CompleteProgressEventSchema,
]);

export type QuizProgressEvent = z.output<typeof QuizProgressEventSchema>;
export type PredictProgressEvent = z.output<typeof PredictProgressEventSchema>;
export type RecallProgressEvent = z.output<typeof RecallProgressEventSchema>;
export type CompleteProgressEvent = z.output<typeof CompleteProgressEventSchema>;
export type ProgressEvent = z.output<typeof ProgressEventSchema>;

export const ProgressStateSchema = z.object({
  updated: z.string().min(1),
  processedHashes: z.array(z.string()).default([]),
  dedupKeys: z.array(z.string()).default([]),
  lastSyncedFiles: z.array(z.string()).optional(),
  stats: z
    .object({
      totalEvents: z.number().int().default(0),
      quizTotal: z.number().int().default(0),
      quizCorrect: z.number().int().default(0),
      predictRight: z.number().int().default(0),
      predictDifferent: z.number().int().default(0),
      recallGot: z.number().int().default(0),
      recallMissed: z.number().int().default(0),
      lessonsCompleted: z.array(z.string()).default([]),
    })
    .optional(),
});

export type ProgressState = z.output<typeof ProgressStateSchema>;

export function validateProgressState(raw: unknown): ValidationOutcome<ProgressState> {
  const parsed = ProgressStateSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data, errors: [] };
  return {
    ok: false,
    errors: formatZodErrors(parsed.error.issues, ProgressStateSchema.shape),
  };
}

