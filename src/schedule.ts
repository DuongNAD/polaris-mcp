import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { checkQualityGates } from "./check.js";
import { renderRoadmapMarkdown } from "./render.js";
import {
  ScheduleSchema,
  type Brief,
  type LearnerProfile,
  type Roadmap,
  type RoadmapModule,
  type Schedule,
  type ScheduleSession,
  type ScheduleWeek,
} from "./schema.js";
import {
  getProfile,
  readBrief,
  readFacts,
  readRoadmap,
  readSources,
  saveRoadmap,
} from "./store.js";
import {
  addDays,
  atomicWriteFile,
  dayOfWeekEn,
  dayOfWeekVi,
  daysBetween,
  formatIsoDate,
  formatWhenLabel,
  hubDir,
  parseIsoDate,
  shortDayVi,
  subjectPaths,
  todayIso,
  writeJson,
} from "./util.js";

/* ───────── Topological Sort ───────── */

export function topologicalSortModules(modules: RoadmapModule[]): RoadmapModule[] {
  const modMap = new Map<string, RoadmapModule>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  modules.forEach((m) => {
    modMap.set(m.id, m);
    inDegree.set(m.id, 0);
    adj.set(m.id, []);
  });

  modules.forEach((m) => {
    (m.depends ?? []).forEach((depId) => {
      if (modMap.has(depId)) {
        adj.get(depId)!.push(m.id);
        inDegree.set(m.id, (inDegree.get(m.id) ?? 0) + 1);
      }
    });
  });

  // Kahn's algorithm
  const queue: RoadmapModule[] = [];
  modules.forEach((m) => {
    if ((inDegree.get(m.id) ?? 0) === 0) {
      queue.push(m);
    }
  });

  const sorted: RoadmapModule[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const neighbors = adj.get(current.id) ?? [];
    for (const nId of neighbors) {
      const deg = (inDegree.get(nId) ?? 1) - 1;
      inDegree.set(nId, deg);
      if (deg === 0) {
        queue.push(modMap.get(nId)!);
      }
    }
  }

  if (sorted.length !== modules.length) {
    throw new Error("Dependency cycle detected among modules; cannot determine deterministic study schedule.");
  }

  return sorted;
}

/* ───────── P0 Deadline Detection from Hub ───────── */

export interface P0Deadline {
  date: string;
  title: string;
  sourceFile: string;
}

export async function findP0Deadlines(hubPath?: string, subjectDir?: string): Promise<P0Deadline[]> {
  const root = hubPath ? resolve(hubPath) : hubDir();
  const candidates = [
    join(root, "ACTIVE_LEARNING.md"),
    join(root, "TASKS.md"),
  ];

  if (subjectDir) {
    candidates.push(join(resolve(subjectDir), "TASKS.md"));
  }

  const deadlines: P0Deadline[] = [];
  const p0Regex = /- \[\s*\]\s*\[Deadline:\s*(\d{4}-\d{2}-\d{2})(?:\s+\d{2}:\d{2})?\]\s*\[Priority:\s*P0\]\s*(.*)/i;
  const p0RegexAlt = /- \[\s*\]\s*\[Priority:\s*P0\]\s*\[Deadline:\s*(\d{4}-\d{2}-\d{2})(?:\s+\d{2}:\d{2})?\]\s*(.*)/i;

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const content = await readFile(filePath, "utf8");
      const lines = content.split("\n");
      for (const line of lines) {
        let match = p0Regex.exec(line);
        if (!match) match = p0RegexAlt.exec(line);
        if (match && match[1]) {
          deadlines.push({
            date: match[1],
            title: (match[2] ?? "").trim(),
            sourceFile: filePath,
          });
        }
      }
    } catch {
      // ignore read error
    }
  }

  return deadlines;
}

/* ───────── Schedule Generation ───────── */

export interface ScheduleOptions {
  subject_dir: string;
  start?: string;
  until?: string;
  interleave_every?: number;
  hub?: string;
}

export interface ScheduleResult {
  schedule: Schedule;
  whenLabels: Record<string, string>;
  renderedRoadmapPath: string;
  summary: string;
}

export async function buildSchedule(options: ScheduleOptions): Promise<ScheduleResult> {
  const { subject_dir, start, until, interleave_every = 4, hub } = options;
  const p = subjectPaths(subject_dir);

  const profile = await getProfile(hub);
  const brief = await readBrief(subject_dir);
  const roadmap = await readRoadmap(subject_dir);

  if (!roadmap || !roadmap.modules || roadmap.modules.length === 0) {
    throw new Error(`Cannot schedule: no modules found in roadmap (${p.roadmapJson}). Run polaris_roadmap_save first.`);
  }

  const startDateIso = start || brief?.start || todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateIso)) {
    throw new Error(`Invalid start date: "${startDateIso}". Must be YYYY-MM-DD.`);
  }

  // 1. Order modules topologically
  const sortedModules = topologicalSortModules(roadmap.modules);

  // 2. Identify blocked dates (blackouts + P0 deadlines & day before)
  const blockedMap = new Map<string, string>();

  // Profile blackouts
  (profile.blackouts ?? []).forEach((b) => {
    let curr = b.from;
    while (curr <= b.to) {
      blockedMap.set(curr, `Blackout: ${b.reason || "Learner blackout"}`);
      curr = addDays(curr, 1);
    }
  });

  // Hub P0 deadlines (skip day of deadline and day before)
  const p0s = await findP0Deadlines(hub, subject_dir);
  p0s.forEach((d) => {
    blockedMap.set(d.date, `P0 Deadline: ${d.title || "Hard commitment"}`);
    const dayBefore = addDays(d.date, -1);
    if (!blockedMap.has(dayBefore)) {
      blockedMap.set(dayBefore, `Day before P0 deadline (${d.date}): ${d.title || "Prep"}`);
    }
  });

  // 3. Learner Slots
  const slots = (profile.slots && profile.slots.length > 0)
    ? profile.slots
    : [
        { day: "Tue" as const, minutes: 30 },
        { day: "Sat" as const, minutes: 60 },
      ];

  // Find Monday of starting week
  const startDate = parseIsoDate(startDateIso);
  const startDayIdx = startDate.getUTCDay(); // 0 = Sun, 1 = Mon ...
  const daysToMonday = (startDayIdx + 6) % 7;
  const week1MondayIso = addDays(startDateIso, -daysToMonday);

  // 4. Fill schedule
  const weeks: ScheduleWeek[] = [];
  const moduleCompletion: Record<string, { completedDate: string; lastSession: string }> = {};
  const lessonWhenMap: Record<string, string> = {};
  const moduleSessionCounts = new Map<string, number>();

  let modIdx = 0;
  let remainingMinutes = sortedModules[0]!.hours * 60;
  let currentModule = sortedModules[0]!;

  let currentDateIso = startDateIso;
  let interleavedReviewCount = 0;
  const completedModulesList: string[] = [];

  const maxDays = 365; // cap to 1 year
  let dayCount = 0;

  while (modIdx < sortedModules.length && dayCount < maxDays) {
    if (until && currentDateIso > until) break;

    const currentDayEn = dayOfWeekEn(currentDateIso);
    const matchedSlots = slots.filter((s) => s.day === currentDayEn);

    // Calculate current week number relative to Week 1 Monday
    const daysFromStartMonday = daysBetween(week1MondayIso, currentDateIso);
    const weekNum = 1 + Math.floor(daysFromStartMonday / 7);

    // Ensure week container exists
    let weekObj = weeks.find((w) => w.week === weekNum);
    if (!weekObj) {
      const weekMondayIso = addDays(week1MondayIso, (weekNum - 1) * 7);
      const weekSundayIso = addDays(weekMondayIso, 6);
      weekObj = {
        week: weekNum,
        from: weekMondayIso,
        to: weekSundayIso,
        sessions: [],
      };
      weeks.push(weekObj);
    }

    if (matchedSlots.length > 0) {
      for (const slot of matchedSlots) {
        if (modIdx >= sortedModules.length) break;

        // Check if blocked
        if (blockedMap.has(currentDateIso)) {
          // Blocked day, skip slot
          continue;
        }

        // Check for interleaved review every N weeks
        const isInterleavedWeek = weekNum > 1 && weekNum % interleave_every === 0;
        const reviewAlreadyDoneForWeek = weekObj.sessions.some((s) => s.module === "Review");

        if (isInterleavedWeek && !reviewAlreadyDoneForWeek && completedModulesList.length > 0) {
          interleavedReviewCount++;
          const reviewWhen = formatWhenLabel(currentDateIso, startDateIso, weekNum);
          const reviewSess: ScheduleSession = {
            date: currentDateIso,
            day: dayOfWeekVi(currentDateIso),
            minutes: slot.minutes,
            module: "Review",
            activity: `Ôn xen kẽ ${interleavedReviewCount} (${completedModulesList.join(", ")})`,
            when: reviewWhen,
          };
          weekObj.sessions.push(reviewSess);
          continue;
        }

        // Assign module work
        const sessMinutes = slot.minutes;
        const whenLabel = formatWhenLabel(currentDateIso, startDateIso, weekNum);

        const currentCount = moduleSessionCounts.get(currentModule.id) ?? 0;
        moduleSessionCounts.set(currentModule.id, currentCount + 1);

        // Lesson When mapping
        const lessonKey = `${currentModule.id}_${currentCount}`;
        if (!lessonWhenMap[lessonKey]) {
          lessonWhenMap[lessonKey] = whenLabel;
        }
        if (!lessonWhenMap[currentModule.id]) {
          lessonWhenMap[currentModule.id] = whenLabel;
        }

        const session: ScheduleSession = {
          date: currentDateIso,
          day: dayOfWeekVi(currentDateIso),
          minutes: sessMinutes,
          module: currentModule.id,
          activity: `Module ${currentModule.id}: ${currentModule.title}`,
          when: whenLabel,
        };
        weekObj.sessions.push(session);

        remainingMinutes -= sessMinutes;

        if (remainingMinutes <= 0) {
          // Module completed
          completedModulesList.push(currentModule.id);
          moduleCompletion[currentModule.id] = {
            completedDate: currentDateIso,
            lastSession: whenLabel,
          };

          modIdx++;
          if (modIdx < sortedModules.length) {
            currentModule = sortedModules[modIdx]!;
            remainingMinutes = currentModule.hours * 60;
          }
        }
      }
    }

    currentDateIso = addDays(currentDateIso, 1);
    dayCount++;
  }

  // Filter weeks with sessions
  const activeWeeks = weeks.filter((w) => w.sessions.length > 0);

  const blockedList = Array.from(blockedMap.entries()).map(([date, reason]) => ({
    date,
    reason,
  }));

  const scheduleData: Schedule = {
    startDate: startDateIso,
    interleaveEvery: interleave_every,
    weeks: activeWeeks,
    moduleCompletion,
    lessonWhenMap,
    blockedDates: blockedList,
  };

  // 5. Update roadmap.json Section 3.2 weekly table & Section 5 spaced review
  const weeklyScheduleRows: Array<{
    week: number;
    sessions: string;
    module: string;
    dod: string;
    deadline?: string;
  }> = [];

  for (const w of activeWeeks) {
    // Format sessions: "Ba 10-13 (30'), Bảy 10-17 (60')"
    const sessStr = w.sessions
      .map((s) => {
        const shortD = shortDayVi(s.date);
        const md = s.date.slice(5); // MM-DD
        const yr = s.date.slice(0, 4);
        const isDiffYr = yr !== startDateIso.slice(0, 4);
        const dateDisplay = isDiffYr ? `${yr}-${md}` : md;
        return `${shortD} ${dateDisplay} (${s.minutes}')`;
      })
      .join(", ");

    // Modules in this week
    const modSet = new Set<string>();
    w.sessions.forEach((s) => {
      if (s.module === "Review") {
        modSet.add(s.activity.split("(")[0]!.trim());
      } else {
        modSet.add(s.module);
      }
    });
    const modStr = Array.from(modSet).join("; ");

    // Pick DoD from practice of the primary module worked on
    const firstModId = w.sessions.find((s) => s.module !== "Review")?.module;
    const targetMod = sortedModules.find((m) => m.id === firstModId);
    const dodStr = targetMod?.practice?.core?.dod ?? targetMod?.practice?.warmup?.dod ?? "Hoàn thành bài tập theo DoD";

    // Deadline check
    const completedInWeek = Object.entries(moduleCompletion).find(
      ([, val]) => val.completedDate >= w.from && val.completedDate <= w.to,
    );
    let deadlineStr = "";
    if (completedInWeek) {
      deadlineStr = `${completedInWeek[1].completedDate} (${completedInWeek[0]})`;
    }

    weeklyScheduleRows.push({
      week: w.week,
      sessions: sessStr,
      module: modStr,
      dod: dodStr,
      deadline: deadlineStr,
    });
  }

  // Build Spaced Review Table rows (Section 5)
  const reviewScheduleRows: Array<{
    module: string;
    date: string;
    d1: string;
    d3: string;
    d7: string;
    d21: string;
  }> = [];

  for (const m of sortedModules) {
    const comp = moduleCompletion[m.id];
    if (comp) {
      const cDate = comp.completedDate;
      reviewScheduleRows.push({
        module: m.id,
        date: cDate,
        d1: addDays(cDate, 1).slice(5),
        d3: addDays(cDate, 3).slice(5),
        d7: addDays(cDate, 7).slice(5),
        d21: addDays(cDate, 21).slice(5),
      });
    } else {
      reviewScheduleRows.push({
        module: m.id,
        date: "Theo lịch",
        d1: "D+1",
        d3: "D+3",
        d7: "D+7",
        d21: "D+21",
      });
    }
  }

  // Interleaved review entries
  const interleavedRows: Array<{ name: string; date?: string; focus: string }> = [];
  activeWeeks.forEach((w) => {
    const revSess = w.sessions.find((s) => s.module === "Review");
    if (revSess) {
      interleavedRows.push({
        name: revSess.activity,
        date: revSess.date,
        focus: `Ôn tập, trả lời lại câu hỏi tự kiểm tra và kiểm tra Sổ lỗi cho các module hoàn thành trước đó.`,
      });
    }
  });

  const updatedRoadmap: Roadmap = {
    ...roadmap,
    status: {
      ...roadmap.status,
      current: roadmap.status?.current ?? `- **Lịch học chính thức:** Bắt đầu ${startDateIso}, cập nhật theo slots và cam kết cá nhân.`,
      weeklySchedule: weeklyScheduleRows,
    },
    review: {
      schedule: reviewScheduleRows,
      interleaved: interleavedRows.length > 0 ? interleavedRows : roadmap.review?.interleaved,
    },
  };

  // Write schedule.json
  await writeJson(p.scheduleJson, scheduleData);

  // Save roadmap & re-render ROADMAP.md
  const saveRes = await saveRoadmap(subject_dir, updatedRoadmap);

  const lines = [
    `Schedule generated successfully for ${sortedModules.length} module(s) across ${activeWeeks.length} active week(s).`,
    `Schedule saved to: ${p.scheduleJson}`,
    `ROADMAP.md re-rendered: ${saveRes.renderedPath}`,
    "",
    "Module Completion Dates:",
    ...Object.entries(moduleCompletion).map(([mId, c]) => `  - Module ${mId}: Completed on ${c.completedDate} (${c.lastSession})`),
  ];

  if (blockedList.length > 0) {
    lines.push("", "Skipped / Blocked Dates:", ...blockedList.map((b) => `  - ${b.date}: ${b.reason}`));
  }

  return {
    schedule: scheduleData,
    whenLabels: lessonWhenMap,
    renderedRoadmapPath: saveRes.renderedPath,
    summary: lines.join("\n"),
  };
}
