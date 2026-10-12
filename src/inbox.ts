/**
 * Vega card inbox, contract `vega-card-inbox.v1` (shared by Vega, Polaris, Orion, Mira, Constellation).
 *
 * One adaptive scheduler (Vega, FSRS) owns every spaced review. Producers such as Polaris only drop card candidates
 * into `<hub>/.vega/inbox/`; Vega validates, de-duplicates by `key` and schedules them. Producers never write
 * `.vega/cards.json` or `.vega/reviews.jsonl`, and never append to or rewrite an existing inbox file.
 *
 * Files: `<producer>-<YYYYMMDDTHHmmss>-<6 lowercase hex>.jsonl` (UTC stamp), UTF-8, one JSON object per line,
 * trailing newline, written as `<name>.jsonl.tmp` first and then renamed (consumers ignore `*.tmp`).
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { closest, hubDir } from "./util.js";

export const INBOX_CONTRACT = "vega-card-inbox.v1";

export const INBOX_PRODUCERS = ["polaris", "orion", "mira", "aurora", "sirius", "manual"] as const;
export type InboxProducer = (typeof INBOX_PRODUCERS)[number];

export const INBOX_CARD_KINDS = ["basic", "cloze", "reverse"] as const;
export type InboxCardKind = (typeof INBOX_CARD_KINDS)[number];

export const INBOX_ORIGIN_KINDS = [
  "polaris-fact",
  "polaris-errorlog",
  "polaris-selfcheck",
  "aurora-quiz",
  "aurora-predict",
  "orion-attempt",
  "mira-stop",
  "manual",
] as const;
export type InboxOriginKind = (typeof INBOX_ORIGIN_KINDS)[number];

/** Field limits of the contract (UTF-16 length, the strictest reading of "chars"). */
export const INBOX_LIMITS = {
  key: 200,
  subject: 120,
  deck: 120,
  front: 600,
  back: 1200,
  hint: 200,
  hook: 200,
  reason: 200,
  tags: 10,
  tag: 40,
  originPath: 400,
  originLocator: 120,
  originHref: 400,
} as const;

export interface InboxOrigin {
  kind: InboxOriginKind;
  path: string;
  locator?: string;
  href?: string;
}

export interface InboxLine {
  v: 1;
  t: string;
  producer: InboxProducer;
  key: string;
  subject: string;
  deck?: string;
  kind?: InboxCardKind;
  front: string;
  back: string;
  hint?: string;
  hook?: string;
  origin: InboxOrigin;
  tags?: string[];
  reason?: string;
}

/** `<producer>-<YYYYMMDDTHHmmss>-<6 lowercase hex>.jsonl` */
export const INBOX_FILE_NAME_RE = /^(polaris|orion|mira|aurora|sirius|manual)-\d{8}T\d{6}-[0-9a-f]{6}\.jsonl$/;

const LINE_FIELDS = [
  "v",
  "t",
  "producer",
  "key",
  "subject",
  "deck",
  "kind",
  "front",
  "back",
  "hint",
  "hook",
  "origin",
  "tags",
  "reason",
] as const;
const ORIGIN_FIELDS = ["kind", "path", "locator", "href"] as const;

/** Emoji with default emoji presentation plus the variation selector-16 (arrows, ticks and symbols stay). */
const EMOJI_PATTERN = "\\p{Emoji_Presentation}|\\uFE0F";
const EMOJI_RE = new RegExp(EMOJI_PATTERN, "gu");
const EMOJI_TEST_RE = new RegExp(EMOJI_PATTERN, "u");
/** U+2028 / U+2029 are valid inside JSON strings but split lines for readers such as Node's readline. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const BACKSLASH = String.fromCharCode(0x5c);
const ELLIPSIS = String.fromCharCode(0x2026);
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function stripEmoji(s: string): string {
  return s.replace(EMOJI_RE, "");
}

/** Trim and cut to `max` UTF-16 units, ending with an ellipsis when cut (never splits a surrogate pair). */
export function clampText(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  let cut = t.slice(0, Math.max(0, max - 1));
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trimEnd() + ELLIPSIS;
}

export interface InboxValidation {
  ok: boolean;
  errors: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkString(
  errors: string[],
  where: string,
  value: unknown,
  min: number,
  max: number,
  options: { required?: boolean; nonBlank?: boolean } = {},
): value is string {
  if (value === undefined) {
    if (options.required) errors.push(`${where}: required`);
    return false;
  }
  if (typeof value !== "string") {
    errors.push(`${where}: must be a string`);
    return false;
  }
  if (value.length < min || value.length > max) {
    errors.push(`${where}: must be ${min}-${max} chars (got ${value.length})`);
    return false;
  }
  if (options.nonBlank && value.trim().length === 0) {
    errors.push(`${where}: must not be blank`);
    return false;
  }
  return true;
}

function rejectUnknownKeys(errors: string[], where: string, obj: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      const guess = closest(k, [...allowed]);
      errors.push(`${where ? `${where}.` : ""}${k}: unknown field${guess ? ` (did you mean "${guess}"?)` : ""}`);
    }
  }
}

/** Validate one inbox line against the contract. Unknown fields are rejected. */
export function validateInboxLine(raw: unknown): InboxValidation {
  const errors: string[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ["line: must be a JSON object"] };
  }

  rejectUnknownKeys(errors, "", raw, LINE_FIELDS);

  if (raw.v !== 1) errors.push(`v: must be the integer 1 (got ${JSON.stringify(raw.v)})`);

  if (checkString(errors, "t", raw.t, 1, 64, { required: true })) {
    if (!ISO_DATE_TIME_RE.test(raw.t) || Number.isNaN(Date.parse(raw.t))) {
      errors.push(`t: must be an ISO 8601 date-time with offset or Z, e.g. 2026-10-12T08:30:00Z (got "${raw.t}")`);
    }
  }

  let producer: string | undefined;
  if (typeof raw.producer !== "string") {
    errors.push("producer: required string");
  } else if (!(INBOX_PRODUCERS as readonly string[]).includes(raw.producer)) {
    const guess = closest(raw.producer, [...INBOX_PRODUCERS]);
    errors.push(`producer: must be one of ${INBOX_PRODUCERS.join(", ")}${guess ? ` (did you mean "${guess}"?)` : ""}`);
  } else {
    producer = raw.producer;
  }

  if (checkString(errors, "key", raw.key, 1, INBOX_LIMITS.key, { required: true, nonBlank: true }) && producer) {
    const prefix = `${producer}:`;
    if (!raw.key.startsWith(prefix)) {
      errors.push(`key: must start with "${prefix}"`);
    } else if (raw.key.length === prefix.length) {
      errors.push(`key: nothing after the "${prefix}" prefix`);
    }
  }

  checkString(errors, "subject", raw.subject, 1, INBOX_LIMITS.subject, { required: true, nonBlank: true });
  checkString(errors, "deck", raw.deck, 0, INBOX_LIMITS.deck);

  if (raw.kind !== undefined && !(INBOX_CARD_KINDS as readonly unknown[]).includes(raw.kind)) {
    errors.push(`kind: must be one of ${INBOX_CARD_KINDS.join(", ")}`);
  }

  if (checkString(errors, "front", raw.front, 1, INBOX_LIMITS.front, { required: true, nonBlank: true })) {
    if (EMOJI_TEST_RE.test(raw.front)) errors.push("front: must not contain emoji");
  }
  checkString(errors, "back", raw.back, 0, INBOX_LIMITS.back, { required: true });
  checkString(errors, "hint", raw.hint, 0, INBOX_LIMITS.hint);
  checkString(errors, "hook", raw.hook, 0, INBOX_LIMITS.hook);
  checkString(errors, "reason", raw.reason, 0, INBOX_LIMITS.reason);

  if (raw.origin === undefined) {
    errors.push("origin: required");
  } else if (!isPlainObject(raw.origin)) {
    errors.push("origin: must be an object");
  } else {
    const origin = raw.origin;
    rejectUnknownKeys(errors, "origin", origin, ORIGIN_FIELDS);
    if (typeof origin.kind !== "string" || !(INBOX_ORIGIN_KINDS as readonly string[]).includes(origin.kind)) {
      errors.push(`origin.kind: must be one of ${INBOX_ORIGIN_KINDS.join(", ")}`);
    }
    checkString(errors, "origin.path", origin.path, 1, INBOX_LIMITS.originPath, { required: true });
    checkString(errors, "origin.locator", origin.locator, 0, INBOX_LIMITS.originLocator);
    checkString(errors, "origin.href", origin.href, 0, INBOX_LIMITS.originHref);
  }

  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags)) {
      errors.push("tags: must be an array of strings");
    } else {
      if (raw.tags.length > INBOX_LIMITS.tags) errors.push(`tags: at most ${INBOX_LIMITS.tags} items (got ${raw.tags.length})`);
      raw.tags.forEach((tag, i) => {
        checkString(errors, `tags[${i}]`, tag, 1, INBOX_LIMITS.tag, { required: true });
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Thrown before anything is written when at least one line would break the contract. */
export class InboxValidationError extends Error {
  readonly problems: Array<{ key: string; errors: string[] }>;

  constructor(problems: Array<{ key: string; errors: string[] }>) {
    const detail = problems.map((p) => `  - ${p.key}: ${p.errors.join("; ")}`).join("\n");
    super(
      `Invalid Vega inbox card(s) (contract ${INBOX_CONTRACT}); nothing was written to the inbox:\n${detail}`,
    );
    this.name = "InboxValidationError";
    this.problems = problems;
  }
}

export function inboxDir(hub?: string): string {
  return join(hub ? resolve(hub) : hubDir(), ".vega", "inbox");
}

/** `<producer>-<YYYYMMDDTHHmmss>-<6 hex>.jsonl`; the stamp is UTC. */
export function inboxFileName(producer: InboxProducer, now: Date = new Date(), suffix?: string): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replace(/[-:]/g, "");
  return `${producer}-${stamp}-${suffix ?? randomBytes(3).toString("hex")}.jsonl`;
}

/** One JSON object per line; U+2028/U+2029 are escaped so line readers never split a card. */
export function serializeInboxLine(line: InboxLine): string {
  return JSON.stringify(line)
    .split(LINE_SEPARATOR)
    .join(BACKSLASH + "u2028")
    .split(PARAGRAPH_SEPARATOR)
    .join(BACKSLASH + "u2029");
}

/** Windows can briefly lock a fresh file (antivirus, indexer); retry the rename a few times before giving up. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!transient || attempt >= 4) throw err;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 40 * (attempt + 1)));
    }
  }
}

export interface InboxWriteResult {
  /** Absolute path of the new inbox file; undefined when there was nothing to write. */
  file?: string;
  fileName?: string;
  dir: string;
  /** Lines written. */
  written: number;
  /** Lines dropped because their key already appeared earlier in the same batch. */
  duplicatesInBatch: number;
}

/**
 * Write one new inbox file for a producer batch. Every line is validated first; if any line is invalid nothing is
 * written and an {@link InboxValidationError} lists the problems. Lines with a repeated key inside the batch are
 * dropped (Vega would skip them as duplicates anyway). The write is atomic: `<name>.jsonl.tmp`, then rename.
 */
export async function writeInboxBatch(
  hub: string | undefined,
  producer: InboxProducer,
  lines: InboxLine[],
  now: Date = new Date(),
): Promise<InboxWriteResult> {
  const dir = inboxDir(hub);
  const accepted: InboxLine[] = [];
  const problems: Array<{ key: string; errors: string[] }> = [];
  const seen = new Set<string>();
  let duplicatesInBatch = 0;

  for (const line of lines) {
    const check = validateInboxLine(line);
    const errors = [...check.errors];
    if (isPlainObject(line) && line.producer !== producer) {
      errors.push(`producer: this batch belongs to "${producer}"`);
    }
    if (errors.length > 0) {
      const key = isPlainObject(line) && typeof line.key === "string" ? line.key : "(no key)";
      problems.push({ key, errors });
      continue;
    }
    if (seen.has(line.key)) {
      duplicatesInBatch++;
      continue;
    }
    seen.add(line.key);
    accepted.push(line);
  }

  if (problems.length > 0) throw new InboxValidationError(problems);
  if (accepted.length === 0) return { dir, written: 0, duplicatesInBatch };

  const body = accepted.map(serializeInboxLine).join("\n") + "\n";
  await mkdir(dir, { recursive: true });

  for (let attempt = 0; attempt < 8; attempt++) {
    const fileName = inboxFileName(producer, now);
    const finalPath = join(dir, fileName);
    if (existsSync(finalPath)) continue;
    const tmpPath = `${finalPath}.tmp`;
    try {
      await writeFile(tmpPath, body, { encoding: "utf8", flag: "wx" });
      await renameWithRetry(tmpPath, finalPath);
      return { file: finalPath, fileName, dir, written: accepted.length, duplicatesInBatch };
    } catch (err) {
      try {
        if (existsSync(tmpPath)) await unlink(tmpPath);
      } catch {
        // ignore cleanup error
      }
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
  }
  throw new Error(`Could not allocate a unique inbox file name in ${dir}`);
}
