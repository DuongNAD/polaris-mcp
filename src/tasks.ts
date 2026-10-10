import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CourseMap,
  type Roadmap,
  type Schedule,
  type TasksMap,
} from "./schema.js";
import {
  readBrief,
  readRoadmap,
} from "./store.js";
import { notifySmartDrive } from "./smartdrive.js";
import {
  atomicWriteFile,
  readJson,
  subjectPaths,
  todayIso,
  writeJson,
} from "./util.js";

export interface TasksSyncResult {
  tasksFilePath: string;
  addedCount: number;
  existingCount: number;
  tasksAdded: string[];
  summary: string;
}

export async function syncTasks(subjectDir: string): Promise<TasksSyncResult> {
  const p = subjectPaths(subjectDir);

  const roadmap = await readRoadmap(subjectDir);
  const brief = await readBrief(subjectDir);
  const schedule = await readJson<Schedule>(p.scheduleJson);
  const courseMap = await readJson<CourseMap>(p.courseMapJson);

  if (!roadmap || !roadmap.modules || roadmap.modules.length === 0) {
    throw new Error(`Cannot sync tasks: no roadmap found in ${p.roadmapJson}. Run polaris_roadmap_save first.`);
  }

  const defaultDate = brief?.start || todayIso();

  // 1. Gather all required tasks
  const candidateTasks: Array<{
    key: string;
    line: string;
    deadline: string;
  }> = [];

  // A. Lesson tasks
  if (courseMap && courseMap.lessons && courseMap.lessons.length > 0) {
    courseMap.lessons.forEach((l, idx) => {
      const lessonNum = idx + 1;
      const lessonKey = `lesson_${l.dir}`;

      // Find session date in schedule
      let sessDate = defaultDate;
      if (schedule && schedule.weeks) {
        for (const w of schedule.weeks) {
          const matched = w.sessions.find(
            (s) => s.module === l.module || s.activity.includes(l.module),
          );
          if (matched) {
            sessDate = matched.date;
            break;
          }
        }
      }

      const line = `- [ ] [Deadline: ${sessDate} 23:59] [Priority: P2] Học bài ${lessonNum}: ${l.title}`;
      candidateTasks.push({
        key: lessonKey,
        line,
        deadline: `${sessDate} 23:59`,
      });
    });
  } else {
    // Fallback if courseMap not yet exported
    roadmap.modules.forEach((m, idx) => {
      const lessonNum = idx + 1;
      const lessonKey = `lesson_mod_${m.id}`;
      const sessDate = schedule?.moduleCompletion?.[m.id]?.completedDate || defaultDate;
      const line = `- [ ] [Deadline: ${sessDate} 23:59] [Priority: P2] Học bài ${lessonNum}: ${m.title}`;
      candidateTasks.push({
        key: lessonKey,
        line,
        deadline: `${sessDate} 23:59`,
      });
    });
  }

  // B. Module Checkpoint tasks
  roadmap.modules.forEach((m) => {
    const cpKey = `checkpoint_${m.id}`;
    const cpText = Array.isArray(m.checkpoint) ? m.checkpoint.join("; ") : m.checkpoint;
    const lastSessionDate = schedule?.moduleCompletion?.[m.id]?.completedDate || defaultDate;
    const line = `- [ ] [Deadline: ${lastSessionDate} 23:59] [Priority: P2] Checkpoint Module ${m.id}: ${cpText}`;
    candidateTasks.push({
      key: cpKey,
      line,
      deadline: `${lastSessionDate} 23:59`,
    });
  });

  // 2. Read existing TASKS.md & detect line endings
  let existingContent = "";
  let isCrlf = false;

  if (existsSync(p.tasksMd)) {
    existingContent = await readFile(p.tasksMd, "utf8");
    isCrlf = existingContent.includes("\r\n");
  }

  const eol = isCrlf ? "\r\n" : "\n";
  const existingLines = new Set(
    existingContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  );

  // 3. Load tasks-map.json
  const tasksMapData: TasksMap = (await readJson<TasksMap>(p.tasksMapJson)) ?? {
    updated: todayIso(),
    tasks: {},
  };

  const tasksToAdd: string[] = [];
  let existingCount = 0;

  candidateTasks.forEach((c) => {
    // Normalize task text without prefix checkbox to check duplication
    const normalizedText = c.line.replace(/^- \[[ x]\]\s*/i, "").trim();
    const alreadyPresent = Array.from(existingLines).some((line) =>
      line.replace(/^- \[[ x]\]\s*/i, "").trim() === normalizedText,
    );

    if (alreadyPresent || tasksMapData.tasks[c.key]) {
      existingCount++;
    } else {
      tasksToAdd.push(c.line);
      tasksMapData.tasks[c.key] = {
        key: c.key,
        line: c.line,
        deadline: c.deadline,
        syncedAt: todayIso(),
      };
    }
  });

  // 4. Append to TASKS.md if new tasks exist
  if (tasksToAdd.length > 0) {
    let updatedContent = existingContent;
    const hasPolarisSection = /##\s+Polaris/i.test(existingContent);

    if (!hasPolarisSection) {
      if (updatedContent.trim().length > 0) {
        updatedContent = updatedContent.trimEnd() + `${eol}${eol}## Polaris${eol}`;
      } else {
        updatedContent = `# Tasks${eol}${eol}## Polaris${eol}`;
      }
    } else {
      updatedContent = updatedContent.trimEnd() + eol;
    }

    updatedContent += tasksToAdd.join(eol) + eol;
    await atomicWriteFile(p.tasksMd, updatedContent);

    tasksMapData.updated = todayIso();
    await writeJson(p.tasksMapJson, tasksMapData);
    notifySmartDrive(p.polarisDir);
  }

  const lines = [
    `Tasks sync complete for ${p.tasksMd}`,
    `Tasks added: ${tasksToAdd.length}`,
    `Existing / up-to-date tasks: ${existingCount}`,
  ];

  if (tasksToAdd.length > 0) {
    lines.push("", "Appended Tasks to ## Polaris:", ...tasksToAdd.map((t) => `  ${t}`));
  }

  return {
    tasksFilePath: p.tasksMd,
    addedCount: tasksToAdd.length,
    existingCount,
    tasksAdded: tasksToAdd,
    summary: lines.join("\n"),
  };
}
