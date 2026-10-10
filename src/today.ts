import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  type CourseMap,
  type ProgressState,
  type ReviewsData,
  type Roadmap,
  type Schedule,
} from "./schema.js";
import { getProfile, readBrief, readRoadmap } from "./store.js";
import { getDueReviews } from "./tracking.js";
import { notifySmartDrive } from "./smartdrive.js";
import {
  atomicWriteFile,
  dayOfWeekEn,
  hubDir,
  readJson,
  slugify,
  subjectPaths,
  todayIso,
} from "./util.js";

export interface TodayOptions {
  subject_dir: string;
  date?: string;
  minutes?: number;
  write?: boolean;
  hub?: string;
}

export interface NextLessonInfo {
  dir: string;
  title: string;
  auroraPath: string;
  outlinePath: string;
  module: string;
  practiceTask: string;
  practiceDod: string;
  deadline?: string;
}

export interface TodayResult {
  date: string;
  minutes: number;
  subjectTitle: string;
  dueReviewsCount: number;
  nextLesson?: NextLessonInfo;
  dynamicGoalMarkdown: string;
  written: boolean;
  writtenPath?: string;
  summary: string;
}

export async function getTodayPlan(options: TodayOptions): Promise<TodayResult> {
  const { subject_dir } = options;
  const p = subjectPaths(subject_dir);
  const targetDate = options.date || todayIso();
  const hub = options.hub ? resolve(options.hub) : hubDir();

  const brief = await readBrief(subject_dir);
  const roadmap = await readRoadmap(subject_dir);
  const courseMap = await readJson<CourseMap>(p.courseMapJson);
  const schedule = await readJson<Schedule>(p.scheduleJson);
  const reviewsData = await readJson<ReviewsData>(p.reviewsJson);
  const progressState = await readJson<ProgressState>(p.progressStateJson);
  const profile = await getProfile(hub);

  const subjectTitle = roadmap?.title || brief?.subject || "Khóa học";
  const slug = brief?.slug || slugify(roadmap?.title || "course");

  // Determine session minutes
  let minutes = options.minutes;
  if (!minutes) {
    if (schedule?.weeks) {
      for (const w of schedule.weeks) {
        const found = w.sessions.find((s) => s.date === targetDate);
        if (found) {
          minutes = found.minutes;
          break;
        }
      }
    }
    if (!minutes) {
      const dayEn = dayOfWeekEn(targetDate);
      const slot = profile.slots?.find((s) => s.day === dayEn);
      minutes = slot?.minutes ?? 60;
    }
  }

  // 1. Due reviews
  const due = await getDueReviews(subject_dir, targetDate);

  // 2. Identify completed lessons
  const completedLessonsSet = new Set<string>();
  if (reviewsData?.items) {
    reviewsData.items.forEach((it) => {
      if (it.type === "lesson" && it.lessonDir) {
        completedLessonsSet.add(it.lessonDir);
      }
    });
  }
  if (progressState?.stats?.lessonsCompleted) {
    progressState.stats.lessonsCompleted.forEach((l) => completedLessonsSet.add(l));
  }

  // 3. Find next uncompleted lesson
  let nextLesson: NextLessonInfo | undefined;
  const allLessons = courseMap?.lessons ?? [];

  if (allLessons.length > 0) {
    const uncompleted = allLessons.find((l) => !completedLessonsSet.has(l.dir));
    if (uncompleted) {
      const mod = roadmap?.modules?.find((m) => m.id === uncompleted.module);
      const auroraPath = join("05_Slides", slug, uncompleted.dir).replace(/\\/g, "/");
      const outlinePath = join("polaris", "lessons", `${uncompleted.dir}.outline.md`).replace(/\\/g, "/");

      let practiceTask = "Thực hành bài học";
      let practiceDod = "Đạt tiêu chí hoàn thành bài học";

      if (mod) {
        if (minutes <= 30) {
          practiceTask = mod.practice.warmup.task || mod.practice.core.task;
          practiceDod = mod.practice.warmup.dod || mod.practice.core.dod;
        } else {
          practiceTask = mod.practice.core.task;
          practiceDod = mod.practice.core.dod;
        }
      }

      let deadline: string | undefined;
      if (schedule?.weeks) {
        for (const w of schedule.weeks) {
          const matched = w.sessions.find((s) => s.module === uncompleted.module || s.activity.includes(uncompleted.module));
          if (matched) {
            deadline = `${matched.date} 23:59`;
            break;
          }
        }
      }
      if (!deadline && brief?.deadline) {
        deadline = `${brief.deadline} 23:59`;
      }

      nextLesson = {
        dir: uncompleted.dir,
        title: uncompleted.title,
        auroraPath,
        outlinePath,
        module: uncompleted.module,
        practiceTask,
        practiceDod,
        deadline,
      };
    }
  }

  // 4. Construct Target and Definition of Done (DoD)
  let targetText = "";
  let dodText = "";

  if (due.dueCount > 0 && nextLesson) {
    const reviewSnippets = due.items.slice(0, 2).map((i) => i.title.replace(/^Ôn bài học:\s*|^Sổ lỗi:\s*/, "")).join("; ");
    targetText = `Ôn tập ${due.dueCount} mục đến hạn (${reviewSnippets}...); Học bài ${nextLesson.title} (${nextLesson.dir}); Thực hành: ${nextLesson.practiceTask}.`;
    dodText = `Hoàn thành ôn tập ${due.dueCount} mục; Học bài giảng tại ${nextLesson.auroraPath}; Đạt DoD thực hành: ${nextLesson.practiceDod}; Ghi nhận các điểm lệch vào Sổ lỗi.`;
  } else if (nextLesson) {
    targetText = `Học bài ${nextLesson.title} (${nextLesson.dir}); Thực hành: ${nextLesson.practiceTask}.`;
    dodText = `Học bài giảng tại ${nextLesson.auroraPath}; Đạt DoD thực hành: ${nextLesson.practiceDod}; Ghi nhận các điểm lệch vào Sổ lỗi.`;
  } else if (due.dueCount > 0) {
    targetText = `Ôn tập ${due.dueCount} mục đến hạn trong Sổ lỗi và bài học; Củng cố mental model các kiến thức đã học.`;
    dodText = `Hoàn thành 100% các mục ôn tập đến hạn; Giải thích rõ nguyên nhân và quy tắc sửa cho từng mục Sổ lỗi.`;
  } else {
    targetText = `Toàn bộ bài học và mục ôn tập đã hoàn thành; Thực hiện ôn tổng hợp hoặc tiến hành dự án Capstone.`;
    dodText = `Hoàn thành tự đánh giá toàn khóa học và kiểm tra các tiêu chí đầu ra.`;
  }

  // Format Dynamic Goal Markdown
  const deadlineLine = nextLesson?.deadline ? `- Deadline: ${nextLesson.deadline}` : "";
  const dynamicGoalLines = [
    "## Today's Dynamic Goal",
    `- Date: ${targetDate}`,
    `- Subject: ${subjectTitle}`,
    `- Target: ${targetText}`,
    `- Definition of Done (DoD): ${dodText}`,
    "- Status: In Progress",
    ...(deadlineLine ? [deadlineLine] : []),
    "- Priority: P2",
  ];
  const dynamicGoalMarkdown = dynamicGoalLines.join("\n");

  // Write to ACTIVE_LEARNING.md if requested
  let written = false;
  let activeLearningFile: string | undefined;

  if (options.write) {
    activeLearningFile = join(hub, "ACTIVE_LEARNING.md");
    let existingContent = "";
    let isCrlf = false;

    if (existsSync(activeLearningFile)) {
      existingContent = await readFile(activeLearningFile, "utf8");
      isCrlf = existingContent.includes("\r\n");
    }

    const normalized = existingContent.replace(/\r\n/g, "\n");
    const headingMatch = /^##\s+Today's Dynamic Goal\b/m.exec(normalized);

    let updatedContent = "";
    if (headingMatch) {
      const matchIndex = headingMatch.index;
      const before = normalized.slice(0, matchIndex);
      const afterMatch = normalized.slice(matchIndex + headingMatch[0].length);
      const nextHeadingMatch = /\n##\s+/.exec(afterMatch);

      if (nextHeadingMatch) {
        const nextHeadingIndex = nextHeadingMatch.index;
        const after = afterMatch.slice(nextHeadingIndex);
        updatedContent = before.trimEnd() + "\n\n" + dynamicGoalMarkdown + "\n" + after.trimStart();
      } else {
        updatedContent = before.trimEnd() + "\n\n" + dynamicGoalMarkdown + "\n";
      }
    } else {
      const firstSectionMatch = /\n##\s+/.exec(normalized);
      if (firstSectionMatch) {
        const firstSecIndex = firstSectionMatch.index;
        const before = normalized.slice(0, firstSecIndex);
        const after = normalized.slice(firstSecIndex);
        updatedContent = before.trimEnd() + "\n\n" + dynamicGoalMarkdown + "\n" + after.trimStart();
      } else {
        updatedContent = normalized.trimEnd() ? normalized.trimEnd() + "\n\n" + dynamicGoalMarkdown + "\n" : dynamicGoalMarkdown + "\n";
      }
    }

    const finalOutput = isCrlf ? updatedContent.replace(/\n/g, "\r\n") : updatedContent;
    await atomicWriteFile(activeLearningFile, finalOutput);
    notifySmartDrive(dirname(activeLearningFile));
    written = true;
  }

  // 5. Build summary output
  const lines: string[] = [
    `Kế hoạch phiên học (${minutes} phút) · Ngày ${targetDate}:`,
    "",
    `Môn học: ${subjectTitle}`,
    "",
    "Công thức phiên học (Session Recipe):",
  ];

  if (minutes <= 30) {
    lines.push(
      `  - 5 phút:  Ôn tập giãn cách (${due.dueCount} mục đến hạn)`,
      `  - 25 phút: Thực hành bài học (${nextLesson ? `${nextLesson.title}` : "Củng cố kiến thức"})`,
    );
  } else {
    lines.push(
      `  - 5 phút:  Ôn tập giãn cách (${due.dueCount} mục đến hạn)`,
      `  - 10 phút: Lý thuyết & Neo trí nhớ (${nextLesson ? `${nextLesson.title}` : "Khái niệm cốt lõi"})`,
      `  - 35 phút: Thực hành (${nextLesson ? nextLesson.practiceTask : "Bài tập thực hành"})`,
      `  - 7 phút:  Tự kiểm tra (Self-check & ghi Sổ lỗi)`,
      `  - 3 phút:  Đúc kết & Kế hoạch phiên tiếp theo`,
    );
  }

  if (due.dueCount > 0) {
    lines.push("", `Mục ôn tập đến hạn (${due.dueCount} mục):`);
    due.items.forEach((it, idx) => {
      const tag = it.type === "lesson" ? "[Bài học]" : "[Sổ lỗi]";
      lines.push(`  ${idx + 1}. ${tag} ${it.title} (Hạn: ${it.dueDate})`);
    });
  } else {
    lines.push("", "Mục ôn tập: Không có mục nào bị quá hạn.");
  }

  if (nextLesson) {
    lines.push(
      "",
      `Bài học tiếp theo: ${nextLesson.title} (${nextLesson.dir})`,
      `  - Đường dẫn Aurora: ${nextLesson.auroraPath}`,
      `  - Dàn ý bài học:    ${nextLesson.outlinePath}`,
      `  - Nhiệm vụ thực hành: ${nextLesson.practiceTask}`,
      `  - Tiêu chí hoàn thành (DoD): ${nextLesson.practiceDod}`,
    );
  }

  lines.push("", "Today's Dynamic Goal (Mục tiêu học tập):", dynamicGoalMarkdown);

  if (written && activeLearningFile) {
    lines.push("", `Đã cập nhật mục tiêu vào: ${activeLearningFile}`);
  }

  return {
    date: targetDate,
    minutes,
    subjectTitle,
    dueReviewsCount: due.dueCount,
    nextLesson,
    dynamicGoalMarkdown,
    written,
    writtenPath: activeLearningFile,
    summary: lines.join("\n"),
  };
}
