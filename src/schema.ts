import { z } from "zod";
import { closest } from "./util.js";

export const SOURCE_KINDS = ["local", "web", "paper", "video", "book", "course", "notebooklm", "deeptutor"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_LABELS = ["course", "extension", "unverified"] as const;
export type SourceLabel = (typeof SOURCE_LABELS)[number];

export const SELF_CHECK_LEVELS = ["remember", "explain", "predict", "apply"] as const;
export type SelfCheckLevel = (typeof SELF_CHECK_LEVELS)[number];

/* ───────── Learner Profile ───────── */

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
