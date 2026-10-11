import type { Brief, Fact, Roadmap, Source } from "./schema.js";

export interface QualityIssue {
  category: "brief" | "sources" | "facts" | "roadmap" | "language";
  location: string;
  message: string;
  fix: string;
  level: "error" | "warn";
}

export interface CheckReport {
  ok: boolean;
  errors: QualityIssue[];
  warnings: QualityIssue[];
  summary: string;
  stats: {
    briefOutcomes: number;
    sourcesCount: number;
    factsCount: number;
    modulesCount: number;
    totalHours: number;
  };
}

const OVERCLAIM_REGEX = /\b(100%|luôn luôn|tuyệt đối|always|every model|chắc chắn 100%|hoàn hảo 100%|không bao giờ sai)\b/i;
export const HAS_NUM_OR_DATE_REGEX = /\b(\d+(?:[.,]\d+)?(?:x\b|%|\b)|\d{4}-\d{2}-\d{2})/i;
const CODE_KEYWORDS_REGEX = /\b(code|python|script|api|function|hàm|lập trình|cú pháp|lệnh|terminal|cli|pydantic|mcp|vllm|class|def|import)\b/i;

/**
 * Strip mathematical notations, dimensions, ordinal/structural markers,
 * LaTeX, and inline code from claim text before checking for empirical
 * numeric/date claims that require cross-checking.
 */
export function stripNonQuantityTokens(claim: string): string {
  let s = claim;

  // 1. Code blocks and inline code: `n_iter=100`, ```...```
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`[^`\n]*`/g, " ");

  // 2. LaTeX math expressions: $...$ and $$...$$
  s = s.replace(/\$\$[\s\S]*?\$\$/g, " ");
  s = s.replace(/\$[^$\n]+\$/g, " ");

  // 3. Bracketed citations/locators: [p. 4], [pp. 12-15], [02:13], [#anchor]
  s = s.replace(/\[[^\]]*\]/g, " ");

  // 4. Ordinal/structural phrases:
  // e.g. "bước 1", "slide 3", "trang 4", "page 12", "p. 5", "lines 12-25", "dòng 8"
  s = s.replace(
    /\b(?:bước|step|slide|trang|page|pp?\.|lines?|dòng|chương|chapter|phần|part|bài|lesson|mục|sec(?:tion|\.)?)\s*#?\d+(?:\.\d+)*(?:\s*[-–]\s*\d+(?:\.\d+)*)?\b/gi,
    " ",
  );

  // 5. Conventional structural IDs: M1, M2.1, F12, S3, O1
  s = s.replace(/\b[MFS]\d+(?:\.\d+)*\b/gi, " ");
  s = s.replace(/\bO\d+\b/g, " ");

  // 6. Big-O and complexity notations: O(d^3), O(n log n), O(n^2), O(1)
  s = s.replace(/\b(?:Big-?O|Theta|Omega|[Oo]|Ω)\s*\([^)]*\)/g, " ");

  // 7. Norms: L1, L2, l1, l2, L1/L2, l1/l2, L0, L_inf
  s = s.replace(/\b[Ll]\d+(?:\s*[\/]\s*[Ll]\d+)?\b/g, " ");
  s = s.replace(/\b[Ll]_\d+\b/g, " ");

  // 8. Dimensions: 1D, 2D, 3D, 4D, 1-D, 2-D, 2D/3D, n×d, n x d, d x d, (n, 1)
  s = s.replace(/\b\d+-?[dD](?:\s*[\/]\s*\d+-?[dD])?\b/g, " ");
  s = s.replace(/\b[a-zA-Z]\s*[×x*]\s*[a-zA-Z]\b/g, " ");
  s = s.replace(/\b[a-zA-Z]\s*[×x*]\s*\d+\b/g, " ");
  s = s.replace(/\b\d+\s*[×x*]\s*[a-zA-Z]\b/g, " ");
  s = s.replace(/\b\d+\s*×\s*\d+\b/g, " "); // unicode multiply e.g. 1920×1080
  s = s.replace(/\(\s*[a-zA-Z0-9_]+\s*,\s*(?:\d+|[a-zA-Z0-9_]+)?\s*\)/g, " "); // shapes like (n, 1) or (n,)

  // 9. Exponents and indices: R^2, x^2, w_1, a_12, R^(n x d), x²
  s = s.replace(/\b[a-zA-Z]\^\([^)]+\)/g, " "); // R^(n x d)
  s = s.replace(/(?:[a-zA-Z]|[)}\]])\^[+-]?\d+\b/g, " "); // R^2, x^2, (x)^2
  s = s.replace(/\b[a-zA-Z][⁰¹²³⁴⁵⁶⁷⁸⁹]+\b/g, " "); // R², x²
  s = s.replace(/\b[a-zA-Z]+_\d+\b/g, " "); // w_1, x_0
  s = s.replace(/\b[a-zA-Z]+_\([a-zA-Z0-9_+ -]+\)/g, " "); // w_(t+1)

  // 10. Math relation with 0 or 1: = 0, = 1, != 0, > 0, < 1
  s = s.replace(/(?:[=><≥≤≠≈~]|approx|equals?)\s*[01]\b/gi, " ");

  // 11. Conventional model names / hardware revisions: GPT-4, Llama-3
  s = s.replace(/\b[A-Za-z]+-\d+(?:\.\d+)*\b/g, " ");

  return s;
}

export function hasNumericOrDateClaim(claim: string): boolean {
  const stripped = stripNonQuantityTokens(claim);
  return HAS_NUM_OR_DATE_REGEX.test(stripped);
}

/** Detect cycles in module dependency graph */
function detectDependencyCycles(modules: Array<{ id: string; depends?: string[] }>): string[][] {
  const modMap = new Map<string, string[]>();
  modules.forEach((m) => modMap.set(m.id, m.depends ?? []));

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string) {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const deps = modMap.get(node) ?? [];
    for (const dep of deps) {
      if (!visited.has(dep)) {
        dfs(dep);
      } else if (recStack.has(dep)) {
        const cyclePath = [...path.slice(path.indexOf(dep)), dep];
        cycles.push(cyclePath);
      }
    }

    path.pop();
    recStack.delete(node);
  }

  for (const m of modules) {
    if (!visited.has(m.id)) {
      dfs(m.id);
    }
  }

  return cycles;
}

export function checkQualityGates(params: {
  brief?: Brief;
  sources?: Source[];
  facts?: Fact[];
  roadmap?: Roadmap;
}): CheckReport {
  const issues: QualityIssue[] = [];
  const { brief, sources = [], facts = [], roadmap } = params;

  /* ───────── 1. Brief Gates ───────── */
  if (brief) {
    if (!brief.hoursPerWeek || brief.hoursPerWeek <= 0) {
      issues.push({
        category: "brief",
        location: "brief.hoursPerWeek",
        message: "hoursPerWeek is missing or not greater than 0.",
        fix: "Set hoursPerWeek in brief.json to a positive number (e.g. 2 or 3).",
        level: "error",
      });
    }

    if (!brief.start || !/^\d{4}-\d{2}-\d{2}$/.test(brief.start)) {
      issues.push({
        category: "brief",
        location: "brief.start",
        message: `start date "${brief.start}" is missing or not in YYYY-MM-DD format.`,
        fix: "Provide a valid ISO start date (e.g. '2026-10-12').",
        level: "error",
      });
    }

    (brief.outcomes ?? []).forEach((out, i) => {
      if (!out.check || out.check.trim().length === 0) {
        issues.push({
          category: "brief",
          location: `brief.outcomes[${i}] (${out.id})`,
          message: `Outcome "${out.id}" does not have a measurable 'check' verification condition.`,
          fix: "Add a concrete, testable 'check' string explaining how the learner verifies this outcome.",
          level: "error",
        });
      }
    });
  }

  /* ───────── 2. Sources Gates ───────── */
  const sourceIdSet = new Set<string>();
  let hasCourseSource = false;

  sources.forEach((s, i) => {
    sourceIdSet.add(s.id);
    if (s.label === "course") {
      hasCourseSource = true;
    }
    if (!s.label) {
      issues.push({
        category: "sources",
        location: `sources[${i}] (${s.id})`,
        message: `Source "${s.id}" is missing a label.`,
        fix: "Set label to 'course', 'extension', or 'unverified'.",
        level: "error",
      });
    }
    if (!s.quality || typeof s.quality.score !== "number" || s.quality.score < 1 || s.quality.score > 5 || !s.quality.why) {
      issues.push({
        category: "sources",
        location: `sources[${i}] (${s.id}).quality`,
        message: `Source "${s.id}" is missing a quality score (1-5) and reason ('why').`,
        fix: "Add quality: { score: 1..5, why: 'reason' } to the source entry.",
        level: "error",
      });
    }
  });

  if (sources.length > 0 && !hasCourseSource) {
    issues.push({
      category: "sources",
      location: "sources.json",
      message: "At least one source must have label: 'course' (learner source of truth).",
      fix: "Mark the primary course curriculum / transcript source with label: 'course'.",
      level: "error",
    });
  }

  /* ───────── 3. Facts Gates ───────── */
  const factIdSet = new Set<string>();

  facts.forEach((f, i) => {
    factIdSet.add(f.id);
    if (!f.source || !sourceIdSet.has(f.source)) {
      issues.push({
        category: "facts",
        location: `facts[${i}] (${f.id}).source`,
        message: `Fact "${f.id}" references source "${f.source}" which is not found in sources.json.`,
        fix: `Add source "${f.source}" to sources.json or update the fact's source reference.`,
        level: "error",
      });
    }

    if (!f.locator || f.locator.trim().length === 0) {
      issues.push({
        category: "facts",
        location: `facts[${i}] (${f.id}).locator`,
        message: `Fact "${f.id}" is missing a locator (timestamp, page, section, lines).`,
        fix: "Add locator e.g. '02:13', 'p. 4', 'Sec. 2.1', or 'lines 12-25'.",
        level: "error",
      });
    }

    // Number & date cross-check rule (ignores math/structural notation, flags real quantities)
    if (hasNumericOrDateClaim(f.claim)) {
      const hasCrossCheck = Array.isArray(f.crossCheck) && f.crossCheck.length > 0;
      const isUnverified = f.label === "unverified";
      if (!hasCrossCheck && !isUnverified) {
        issues.push({
          category: "facts",
          location: `facts[${i}] (${f.id})`,
          message: `Fact "${f.id}" contains numeric or date claims ("${f.claim.slice(0, 50)}...") but has no crossCheck sources and is not labeled 'unverified'.`,
          fix: "Either add crossCheck: ['S_other'] or change label to 'unverified'.",
          level: "error",
        });
      }
    }
  });

  /* ───────── 4. Roadmap Gates ───────── */
  let totalHours = 0;

  if (roadmap) {
    const modIdSet = new Set<string>(roadmap.modules.map((m) => m.id));

    // Outcome coverage check
    const briefOutcomes = brief?.outcomes ?? (roadmap.outcomes as Array<{ id: string; text: string }> | undefined) ?? [];
    if (briefOutcomes.length > 0) {
      const coveredOutcomeIds = new Set<string>();
      roadmap.modules.forEach((m) => {
        const fullModuleText = [m.title, m.why, ...m.outputs, ...m.core.map((c) => c.text)].join(" ").toLowerCase();
        briefOutcomes.forEach((bo) => {
          if (bo.id && fullModuleText.includes(bo.id.toLowerCase())) {
            coveredOutcomeIds.add(bo.id);
          } else if (fullModuleText.includes(bo.text.toLowerCase().slice(0, 20))) {
            coveredOutcomeIds.add(bo.id || bo.text);
          }
        });
      });
      // If none matched by id, also check if module count >= 1 and outputs exist
      const uncovered = briefOutcomes.filter((bo) => !coveredOutcomeIds.has(bo.id || bo.text));
      if (uncovered.length === briefOutcomes.length && roadmap.modules.length > 0) {
        // Just report warning if no explicit outcome mapping was detected
        issues.push({
          category: "roadmap",
          location: "roadmap.modules",
          message: `Brief outcomes (${briefOutcomes.map((o) => o.id).join(", ")}) should be explicitly mapped in module outputs.`,
          fix: "Mention outcome IDs (e.g. O1, O2) or outcome goals in module outputs.",
          level: "warn",
        });
      }
    }

    // Module dependency cycles & valid references
    const cycles = detectDependencyCycles(roadmap.modules);
    cycles.forEach((c) => {
      issues.push({
        category: "roadmap",
        location: "roadmap.modules.depends",
        message: `Dependency cycle detected: ${c.join(" -> ")}`,
        fix: "Remove circular dependencies between modules.",
        level: "error",
      });
    });

    roadmap.modules.forEach((m, i) => {
      totalHours += m.hours || 0;

      (m.depends ?? []).forEach((dep) => {
        if (!modIdSet.has(dep)) {
          issues.push({
            category: "roadmap",
            location: `roadmap.modules[${i}] (${m.id}).depends`,
            message: `Module "${m.id}" depends on unknown module "${dep}".`,
            fix: `Make sure module "${dep}" exists in roadmap.modules or remove it from depends.`,
            level: "error",
          });
        }
      });

      if (!m.why || m.why.trim().length === 0) {
        issues.push({
          category: "roadmap",
          location: `roadmap.modules[${i}] (${m.id}).why`,
          message: `Module "${m.id}" is missing 'why' (Vì sao học).`,
          fix: "Add a concise 'why' explanation.",
          level: "error",
        });
      }

      if (!m.outputs || m.outputs.length < 2) {
        issues.push({
          category: "roadmap",
          location: `roadmap.modules[${i}] (${m.id}).outputs`,
          message: `Module "${m.id}" must have at least 2 outputs (Đầu ra), found ${m.outputs?.length ?? 0}.`,
          fix: "Add at least two concrete deliverable outputs.",
          level: "error",
        });
      }

      // Core bullets citing facts
      (m.core ?? []).forEach((c, ci) => {
        const citingFacts = c.facts ?? [];
        if (citingFacts.length === 0 && facts.length > 0) {
          issues.push({
            category: "roadmap",
            location: `roadmap.modules[${i}] (${m.id}).core[${ci}]`,
            message: `Core bullet "${c.text.slice(0, 40)}..." does not cite any facts.`,
            fix: "Add facts: ['F1', ...] pointing to verified facts in facts.json.",
            level: "error",
          });
        }
        citingFacts.forEach((fid) => {
          if (!factIdSet.has(fid) && facts.length > 0) {
            issues.push({
              category: "roadmap",
              location: `roadmap.modules[${i}] (${m.id}).core[${ci}].facts`,
              message: `Core bullet references fact "${fid}" which is not found in facts.json.`,
              fix: `Register fact "${fid}" with polaris_fact_add or update reference.`,
              level: "error",
            });
          }
        });
      });

      // Misconceptions
      if (!m.misconceptions || m.misconceptions.length < 1) {
        issues.push({
          category: "roadmap",
          location: `roadmap.modules[${i}] (${m.id}).misconceptions`,
          message: `Module "${m.id}" must have at least 1 misconception (Hiểu lầm và lỗi hay gặp).`,
          fix: "Add misconceptions: [{ wrong: '...', fix: '...' }].",
          level: "error",
        });
      } else {
        m.misconceptions.forEach((misc, mi) => {
          if (!misc.wrong || !misc.fix) {
            issues.push({
              category: "roadmap",
              location: `roadmap.modules[${i}] (${m.id}).misconceptions[${mi}]`,
              message: `Misconception #${mi + 1} must have both 'wrong' and 'fix'.`,
              fix: "Ensure 'wrong' and 'fix' are non-empty strings.",
              level: "error",
            });
          }
        });
      }

      // Materials minutes fit module hours
      const materialsTotalMin = (m.materials ?? []).reduce((acc, cur) => acc + (cur.minutes || 0), 0);
      const moduleTotalMin = (m.hours || 0) * 60;
      if (materialsTotalMin > moduleTotalMin && moduleTotalMin > 0) {
        issues.push({
          category: "roadmap",
          location: `roadmap.modules[${i}] (${m.id}).materials`,
          message: `Materials total ${materialsTotalMin} minutes, which exceeds module estimated time (${moduleTotalMin} minutes).`,
          fix: `Adjust material reading times or increase module hours to accommodate ${materialsTotalMin} min.`,
          level: "warn",
        });
      }

      // 3 Practice tiers with DoD
      if (!m.practice) {
        issues.push({
          category: "roadmap",
          location: `roadmap.modules[${i}] (${m.id}).practice`,
          message: `Module "${m.id}" is missing practice tiers (warmup, core, challenge).`,
          fix: "Add practice: { warmup: {task, dod}, core: {task, dod}, challenge: {task, dod} }.",
          level: "error",
        });
      } else {
        (["warmup", "core", "challenge"] as const).forEach((tier) => {
          const p = m.practice[tier];
          if (!p || !p.task || !p.dod) {
            issues.push({
              category: "roadmap",
              location: `roadmap.modules[${i}] (${m.id}).practice.${tier}`,
              message: `Practice tier '${tier}' is missing 'task' or 'dod'.`,
              fix: `Provide non-empty 'task' and 'dod' (Definition of Done) for '${tier}'.`,
              level: "error",
            });
          }
        });
      }

      // Self check (at least 4 questions, predict if module has code)
      const selfCheckList = m.selfCheck ?? [];
      if (selfCheckList.length < 4) {
        issues.push({
          category: "roadmap",
          location: `roadmap.modules[${i}] (${m.id}).selfCheck`,
          message: `Module "${m.id}" must have at least 4 self-check questions, found ${selfCheckList.length}.`,
          fix: "Add self-check questions with answers in selfCheck array.",
          level: "error",
        });
      }

      const hasCode = CODE_KEYWORDS_REGEX.test([m.title, m.why, ...m.outputs, ...m.core.map((c) => c.text)].join(" "));
      const hasPredict = selfCheckList.some((sc) => sc.level === "predict" || /dự đoán|predict/i.test(sc.q));
      if (hasCode && !hasPredict) {
        issues.push({
          category: "roadmap",
          location: `roadmap.modules[${i}] (${m.id}).selfCheck`,
          message: `Module "${m.id}" involves code/scripts but has no 'predict' self-check question.`,
          fix: "Add at least one question with level: 'predict' asking the learner to predict command/code output before running.",
          level: "error",
        });
      }

      // Checkpoint
      if (!m.checkpoint || (Array.isArray(m.checkpoint) && m.checkpoint.length === 0)) {
        issues.push({
          category: "roadmap",
          location: `roadmap.modules[${i}] (${m.id}).checkpoint`,
          message: `Module "${m.id}" is missing a checkpoint.`,
          fix: "Add a checkpoint checklist or description.",
          level: "error",
        });
      }
    });

    // Time budget check
    if (brief?.deadline && brief?.hoursPerWeek && brief?.start) {
      const msPerDay = 86400000;
      const days = (new Date(brief.deadline).getTime() - new Date(brief.start).getTime()) / msPerDay;
      const weeks = Math.max(1, days / 7);
      const maxBudgetHours = weeks * brief.hoursPerWeek;
      if (totalHours > maxBudgetHours * 1.2) {
        issues.push({
          category: "roadmap",
          location: "roadmap.modules.hours",
          message: `Total roadmap hours (${totalHours}h) exceeds time budget (${maxBudgetHours.toFixed(1)}h over ${weeks.toFixed(0)} weeks at ${brief.hoursPerWeek}h/week).`,
          fix: "Reduce module hours or extend the deadline.",
          level: "warn",
        });
      }
    }
  }

  /* ───────── 5. Language Overclaims Gate ───────── */
  const checkText = (text: string, location: string) => {
    const match = OVERCLAIM_REGEX.exec(text);
    if (match) {
      issues.push({
        category: "language",
        location,
        message: `Overclaim phrase "${match[0]}" detected in text.`,
        fix: "Replace absolute claims ('100%', 'luôn luôn', 'always') with nuanced, evidence-based descriptions.",
        level: "warn",
      });
    }
  };

  if (brief) {
    checkText(brief.goal, "brief.goal");
  }
  if (roadmap) {
    roadmap.modules.forEach((m, i) => {
      checkText(m.why, `roadmap.modules[${i}].why`);
      m.core.forEach((c, ci) => checkText(c.text, `roadmap.modules[${i}].core[${ci}]`));
    });
  }

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warn");

  const summary = errors.length === 0
    ? `Quality gates PASSED with 0 errors and ${warnings.length} warning(s).`
    : `Quality gates FAILED with ${errors.length} error(s) and ${warnings.length} warning(s).`;

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary,
    stats: {
      briefOutcomes: brief?.outcomes.length ?? 0,
      sourcesCount: sources.length,
      factsCount: facts.length,
      modulesCount: roadmap?.modules.length ?? 0,
      totalHours,
    },
  };
}
