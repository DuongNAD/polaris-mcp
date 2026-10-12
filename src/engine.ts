/**
 * Review engine resolution.
 *
 * - `vega`: one adaptive scheduler (Vega, FSRS). Polaris keeps the human-readable error log ("Sổ lỗi") and hands review
 *   items to Vega through the shared inbox (`<hub>/.vega/inbox/`, contract vega-card-inbox.v1). No fixed D+ steps.
 * - `fixed`: Polaris schedules its own D+ steps (`method.spacedReviewDays`, default 1, 3, 7, 16, 35) in reviews.json.
 *
 * Effective engine: `method.reviewEngine` of the learner profile when set; otherwise `vega` when `<hub>/.vega/` exists,
 * otherwise `fixed`. Resolution only reads: it never creates the profile or the `.vega` folder.
 */
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateProfile, type ReviewEngine } from "./schema.js";
import { hubDir, profilePath, readJson } from "./util.js";

export interface ReviewEngineInfo {
  engine: ReviewEngine;
  /** `profile` = explicit `method.reviewEngine`; `auto` = decided by the presence of `<hub>/.vega/`. */
  source: "profile" | "auto";
  /** Absolute learning hub root the decision was made for. */
  hub: string;
  vegaDir: string;
  vegaDirExists: boolean;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export async function resolveReviewEngine(hub?: string): Promise<ReviewEngineInfo> {
  const hubAbs = hub ? resolve(hub) : hubDir();
  const vegaDir = join(hubAbs, ".vega");
  const vegaDirExists = isDirectory(vegaDir);

  let explicit: ReviewEngine | undefined;
  const raw = await readJson<unknown>(profilePath(hubAbs));
  if (raw !== undefined) {
    const parsed = validateProfile(raw);
    if (parsed.ok) explicit = parsed.value?.method?.reviewEngine;
  }

  if (explicit) {
    return { engine: explicit, source: "profile", hub: hubAbs, vegaDir, vegaDirExists };
  }
  return { engine: vegaDirExists ? "vega" : "fixed", source: "auto", hub: hubAbs, vegaDir, vegaDirExists };
}

/** One learner-facing line (Vietnamese) saying which engine is in force and why. */
export function describeReviewEngine(info: ReviewEngineInfo): string {
  const vegaPath = info.vegaDir.replace(/\\/g, "/");
  const why =
    info.source === "profile"
      ? "đặt trong hồ sơ người học, method.reviewEngine"
      : info.vegaDirExists
        ? `tự nhận diện, có thư mục ${vegaPath}`
        : `tự nhận diện, chưa có thư mục ${vegaPath}`;
  return `Bộ máy ôn tập hiệu lực (reviewEngine): ${info.engine} — ${why}`;
}
