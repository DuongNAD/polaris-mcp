import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  AURORA_THEMES,
  validateCourse,
  type AuroraTheme,
  type Course,
  type CourseLesson,
  type CourseMap,
  type CourseMapLesson,
  type Fact,
  type RoadmapModule,
} from "./schema.js";
import {
  readBrief,
  readFacts,
  readRoadmap,
  readSources,
} from "./store.js";
import { notifySmartDrive } from "./smartdrive.js";
import {
  atomicWriteFile,
  readJson,
  slugify,
  subjectPaths,
  todayIso,
  writeJson,
} from "./util.js";

const DEFAULT_ICONS = [
  "ph:arrows-clockwise-duotone",
  "ph:bug-beetle-duotone",
  "ph:wrench-duotone",
  "ph:shield-check-duotone",
  "ph:cpu-duotone",
  "ph:plugs-connected-duotone",
  "ph:magnifying-glass-duotone",
  "ph:code-duotone",
  "ph:cloud-sun-duotone",
  "ph:tree-structure-duotone",
  "ph:shield-warning-duotone",
  "ph:flag-checkered-duotone",
  "ph:books-duotone",
];

function pickNextTheme(prevTheme: AuroraTheme | undefined, themeIdx: number): AuroraTheme {
  const available = AURORA_THEMES.filter((t) => t !== prevTheme);
  return available[themeIdx % available.length]!;
}

export interface ExportCourseOptions {
  subject_dir: string;
  course_dir?: string;
}

export interface ExportCourseResult {
  courseJsonPath: string;
  course: Course;
  outlinesGenerated: string[];
  outlinesPreserved: string[];
  summary: string;
}

export async function exportCourse(options: ExportCourseOptions): Promise<ExportCourseResult> {
  const { subject_dir, course_dir } = options;
  const p = subjectPaths(subject_dir);

  const brief = await readBrief(subject_dir);
  const roadmap = await readRoadmap(subject_dir);
  const facts = await readFacts(subject_dir);
  const sources = await readSources(subject_dir);

  if (!roadmap || !roadmap.modules || roadmap.modules.length === 0) {
    throw new Error(`Cannot export course: no modules found in roadmap (${p.roadmapJson}). Run polaris_roadmap_save first.`);
  }

  const slug = brief?.slug || slugify(roadmap.title || "course");
  const targetCourseDir = course_dir ? resolve(p.dir, course_dir) : join(p.dir, "05_Slides", slug);
  await mkdir(targetCourseDir, { recursive: true });
  await mkdir(p.lessonsDir, { recursive: true });

  const scheduleRaw = await readJson<{ lessonWhenMap?: Record<string, string> }>(p.scheduleJson);
  const whenMap = scheduleRaw?.lessonWhenMap ?? {};

  // Read existing course-map.json or course.json if any for idempotent merge
  const existingMap = await readJson<CourseMap>(p.courseMapJson);
  const existingCoursePath = join(targetCourseDir, "course.json");
  const existingCourse = await readJson<Course>(existingCoursePath);

  const existingLessonsByDir = new Map<string, CourseLesson>();
  if (existingCourse?.lessons) {
    existingCourse.lessons.forEach((l) => {
      if (l.dir) existingLessonsByDir.set(l.dir, l);
    });
  }

  const existingMapByModule = new Map<string, CourseMapLesson>();
  if (existingMap?.lessons) {
    existingMap.lessons.forEach((l) => {
      const key = `${l.module}_${l.part || "a"}`;
      existingMapByModule.set(key, l);
    });
  }

  // Build lessons
  const lessons: Array<{
    module: RoadmapModule;
    part?: string;
    dir: string;
    title: string;
    summary: string;
    theme: AuroraTheme;
    icon: string;
    minutes: number;
    when?: string;
  }> = [];

  let lessonCounter = 1;
  let prevTheme: AuroraTheme | undefined;
  let themeCounter = 0;

  for (const mod of roadmap.modules) {
    const numLessons = (typeof mod.lessons === "number" && mod.lessons >= 1)
      ? mod.lessons
      : mod.hours > 2.5
        ? 2
        : 1;

    const modThemeOverride = (mod.theme && AURORA_THEMES.includes(mod.theme as AuroraTheme))
      ? (mod.theme as AuroraTheme)
      : undefined;

    if (numLessons === 1) {
      const mapKey = `${mod.id}_a`;
      const prevMap = existingMapByModule.get(mapKey);
      const padNum = String(lessonCounter).padStart(2, "0");
      const defaultDir = `${padNum}-${slugify(mod.title)}`;
      const dir = prevMap?.dir ?? defaultDir;

      const existingL = existingLessonsByDir.get(dir);
      const theme: AuroraTheme = modThemeOverride
        ?? (existingL?.theme as AuroraTheme)
        ?? prevMap?.theme
        ?? pickNextTheme(prevTheme, themeCounter++);
      prevTheme = theme;

      const icon = mod.icon
        ?? existingL?.icon
        ?? prevMap?.icon
        ?? DEFAULT_ICONS[(lessonCounter - 1) % DEFAULT_ICONS.length]!;

      const when = whenMap[`${mod.id}_0`] ?? whenMap[mod.id] ?? existingL?.when ?? prevMap?.when;
      const title = existingL?.title ?? prevMap?.title ?? mod.title;
      const summary = existingL?.summary ?? mod.outputs[0] ?? mod.why;
      const minutes = existingL?.minutes ?? 20;

      lessons.push({
        module: mod,
        part: "a",
        dir,
        title,
        summary,
        theme,
        icon,
        minutes,
        when,
      });

      lessonCounter++;
    } else {
      // 2 lessons (a/b)
      for (let partIdx = 0; partIdx < numLessons; partIdx++) {
        const partLetter = partIdx === 0 ? "a" : "b";
        const mapKey = `${mod.id}_${partLetter}`;
        const prevMap = existingMapByModule.get(mapKey);

        const padNum = String(lessonCounter).padStart(2, "0");
        const defaultDir = `${padNum}-${slugify(mod.title)}-${partLetter}`;
        const dir = prevMap?.dir ?? defaultDir;

        const existingL = existingLessonsByDir.get(dir);
        const theme: AuroraTheme = modThemeOverride && partIdx === 0
          ? modThemeOverride
          : (existingL?.theme as AuroraTheme)
            ?? prevMap?.theme
            ?? pickNextTheme(prevTheme, themeCounter++);
        prevTheme = theme;

        const icon = mod.icon
          ?? existingL?.icon
          ?? prevMap?.icon
          ?? DEFAULT_ICONS[(lessonCounter - 1) % DEFAULT_ICONS.length]!;

        const when = whenMap[`${mod.id}_${partIdx}`] ?? whenMap[mod.id] ?? existingL?.when ?? prevMap?.when;

        const partTitle = partIdx === 0
          ? `${mod.title}: Khái niệm cốt lõi`
          : `${mod.title}: Thực hành và Mổ xẻ`;
        const title = existingL?.title ?? prevMap?.title ?? partTitle;
        const summary = existingL?.summary
          ?? (partIdx === 0 ? mod.outputs[0] : (mod.outputs[1] ?? mod.practice.core.task))
          ?? mod.why;
        const minutes = existingL?.minutes ?? (partIdx === 0 ? 20 : 25);

        lessons.push({
          module: mod,
          part: partLetter,
          dir,
          title,
          summary,
          theme,
          icon,
          minutes,
          when,
        });

        lessonCounter++;
      }
    }
  }

  // 1. Build strict Aurora course.json
  const courseLessons: CourseLesson[] = lessons.map((l) => {
    const obj: CourseLesson = {
      title: l.title,
      summary: l.summary,
      when: l.when,
      dir: l.dir,
      icon: l.icon,
      theme: l.theme,
      minutes: l.minutes,
    };
    return obj;
  });

  const courseData: Course = {
    title: roadmap.title || brief?.subject || "Khóa học",
    subtitle: brief?.goal || roadmap.goalQuote || "Lộ trình học tập cá nhân hóa",
    theme: (roadmap.theme as AuroraTheme) || "midnight",
    lang: "vi",
    font: "vietnam",
    lessons: courseLessons,
  };

  const vCourse = validateCourse(courseData);
  if (!vCourse.ok || !vCourse.value) {
    throw new Error(`Generated course.json failed validation:\n${vCourse.errors.join("\n")}`);
  }

  await writeJson(existingCoursePath, vCourse.value);

  // 2. Save course-map.json
  const courseMapData: CourseMap = {
    courseDir: targetCourseDir,
    updated: todayIso(),
    lessons: lessons.map((l) => ({
      module: l.module.id,
      part: l.part,
      dir: l.dir,
      title: l.title,
      theme: l.theme,
      icon: l.icon,
      when: l.when,
      minutes: l.minutes,
    })),
  };
  await writeJson(p.courseMapJson, courseMapData);

  // 3. Generate Lesson Outline Skeletons in polaris/lessons/<dir>.outline.md
  const outlinesGenerated: string[] = [];
  const outlinesPreserved: string[] = [];

  for (const l of lessons) {
    const mod = l.module;
    const modFacts = facts.filter((f) => f.modules.includes(mod.id));
    const modMaterials = mod.materials ?? [];

    const outlinePath = join(p.lessonsDir, `${l.dir}.outline.md`);
    const isNew = !existsSync(outlinePath);
    const targetFile = isNew ? outlinePath : join(p.lessonsDir, `${l.dir}.outline.new.md`);

    const outlineContent = renderLessonOutline({
      lesson: l,
      module: mod,
      facts: modFacts,
      materials: modMaterials,
    });

    await atomicWriteFile(targetFile, outlineContent);

    if (isNew) {
      outlinesGenerated.push(`${l.dir}.outline.md`);
    } else {
      outlinesPreserved.push(`${l.dir}.outline.new.md (existing preserved)`);
    }
  }

  const lines = [
    `Course exported successfully to ${existingCoursePath}`,
    `Generated ${lessons.length} lesson(s) across ${roadmap.modules.length} module(s).`,
    `Course map saved to ${p.courseMapJson}`,
    "",
    "Lessons:",
    ...lessons.map((l) => `  - [${l.dir}] "${l.title}" (${l.theme}, ${l.minutes}m) - When: ${l.when || "chưa xếp lịch"}`),
    "",
    `Lesson Outlines in ${p.lessonsDir}:`,
    ...outlinesGenerated.map((o) => `  - Created: ${o}`),
    ...outlinesPreserved.map((o) => `  - Existing outline preserved; wrote new candidate to: ${o}`),
  ];

  notifySmartDrive(p.polarisDir);
  notifySmartDrive(targetCourseDir);

  return {
    courseJsonPath: existingCoursePath,
    course: vCourse.value,
    outlinesGenerated,
    outlinesPreserved,
    summary: lines.join("\n"),
  };
}

/* ───────── Outline Markdown Template ───────── */

interface RenderOutlineParams {
  lesson: {
    title: string;
    dir: string;
    theme: AuroraTheme;
    icon: string;
    minutes: number;
    when?: string;
  };
  module: RoadmapModule;
  facts: Fact[];
  materials: RoadmapModule["materials"];
}

function renderLessonOutline(params: RenderOutlineParams): string {
  const { lesson, module: m, facts, materials } = params;

  const lines: string[] = [];
  lines.push(`# Đề cương bài học: ${lesson.title}`);
  lines.push("");
  lines.push(`- **Module:** ${m.id} - ${m.title}`);
  lines.push(`- **Thời gian (when):** ${lesson.when || "Theo lịch học"}`);
  lines.push(`- **Thời lượng:** ${lesson.minutes} phút`);
  lines.push(`- **Theme:** ${lesson.theme}`);
  lines.push(`- **Icon:** \`${lesson.icon}\``);
  lines.push("");

  // 1. Mục tiêu
  lines.push("## 1. Mục tiêu (Đầu ra)");
  m.outputs.forEach((out) => {
    lines.push(`- ${out}`);
  });
  lines.push("");

  // 2. Dữ kiện có nguồn
  lines.push("## 2. Dữ kiện có nguồn (Dùng cho slide `source`)");
  if (facts.length > 0) {
    facts.forEach((f) => {
      const lbl = f.label === "course" ? "[Khóa học]" : f.label === "extension" ? "[Mở rộng]" : "(chưa xác minh)";
      lines.push(`- [${f.id}] "${f.claim}" — Nguồn: ${f.source} @ ${f.locator} ${lbl}`);
    });
  } else {
    lines.push(`- Tài liệu chính thức của module ${m.id}`);
  }
  lines.push("");

  // 3. Hiểu lầm -> phương án nhiễu cho quiz
  lines.push("## 3. Hiểu lầm -> Phương án nhiễu cho Quiz");
  m.misconceptions.forEach((misc, i) => {
    lines.push(`### Hiểu lầm ${i + 1}: "${misc.wrong}"`);
    if (misc.why) lines.push(`- **Nguyên nhân hiểu sai:** ${misc.why}`);
    lines.push(`- **Bản chất đúng:** ${misc.fix}`);
    lines.push(`- **Gợi ý phương án nhiễu (distractor):** Đưa quan niệm sai "${misc.wrong}" vào làm đáp án bẫy trong câu hỏi quiz trắc nghiệm.`);
    lines.push("");
  });

  // 4. Thực hành
  lines.push("## 4. Thực hành & Dự đoán (Predict-then-Run)");
  lines.push(`- **Khởi động (15'):** ${m.practice.warmup.task}`);
  lines.push(`  - *DoD:* ${m.practice.warmup.dod}`);
  lines.push(`- **Cốt lõi (45'):** ${m.practice.core.task}`);
  lines.push(`  - *DoD:* ${m.practice.core.dod}`);
  lines.push(`- **Thử thách (30'):** ${m.practice.challenge.task}`);
  lines.push(`  - *DoD:* ${m.practice.challenge.dod}`);
  lines.push("*(Lưu ý: Không viết code giải bài tập ở đây; chỉ đưa ra ý tưởng slide bài tập và tiêu chuẩn hoàn thành DoD)*");
  lines.push("");

  // 5. Neo trí nhớ gợi ý
  lines.push("## 5. Neo trí nhớ gợi ý (Memory Anchors)");
  lines.push("- **Memory Palace (Lâu đài ký ức):** Đặt các bước thực thi tuần tự tại các vị trí quen thuộc trong nhà (Cửa chính -> Phòng khách -> Bàn làm việc -> Giá sách).");
  lines.push("- **Picture Anchors (Hình ảnh trực quan):** Biểu tượng cụ thể cho các khái niệm trừu tượng (ví dụ: cái phích cắm cho MCP, cái cân cho token budget).");
  lines.push("- **Analogy (Ẩn dụ):** So sánh cơ chế với đời sống thực tế và chỉ rõ ranh giới mà phép ẩn dụ không còn đúng.");
  lines.push("- **Mnemonic:** Câu khẩu hiệu hoặc từ khóa tóm lược nguyên tắc bất biến.");
  lines.push("");

  // 6. Trang vở gợi ý
  lines.push("## 6. Trang vở gợi ý (Notebook: 4-8 dòng chép tay)");
  lines.push("```text");
  lines.push(`1. ${m.title}: ${m.why}`);
  if (m.core[0]) lines.push(`2. ${m.core[0].text}`);
  if (m.core[1]) lines.push(`3. ${m.core[1].text}`);
  lines.push(`4. Quy tắc: ${m.misconceptions[0]?.fix || "Kiểm tra kỹ trước khi thực thi"}`);
  lines.push(`5. Checkpoint: ${Array.isArray(m.checkpoint) ? m.checkpoint[0] : m.checkpoint}`);
  lines.push("```");
  lines.push("");

  // 7. Tự kiểm tra
  lines.push("## 7. Tự kiểm tra (Quiz / Flashcards)");
  m.selfCheck.forEach((sc, i) => {
    const lvl = sc.level ? `(${sc.level}) ` : "";
    lines.push(`${i + 1}. ${lvl}${sc.q}`);
    lines.push(`   - *Đáp án:* ${sc.answer}`);
  });
  lines.push("");

  // 8. Code liên quan
  lines.push("## 8. Code liên quan (Materials)");
  if (materials.length > 0) {
    materials.forEach((mat) => {
      const pth = mat.path ? `path: \`${mat.path}\`` : "";
      const url = mat.url ? `url: ${mat.url}` : "";
      lines.push(`- **${mat.title}** (${mat.minutes} phút) ${pth} ${url}`);
      lines.push(`  - Gợi ý slide: dùng slide \`split\` hoặc \`code-run\` với file \`${mat.path || mat.title}\` và trích dẫn dòng cốt lõi.`);
    });
  } else {
    lines.push(`- Tham chiếu tài liệu mã nguồn trong thư mục \`03_Materials_Code\`.`);
  }
  lines.push("");

  // 9. Dàn ý Slide đề xuất
  lines.push("## 9. Dàn ý Slide đề xuất (Slide Plan Skeleton)");
  lines.push("1. `title`: Tiêu đề bài học và cam kết đầu ra rõ ràng");
  lines.push("2. `big-fact` / `split`: Trực giác nền tảng và lý thuyết cốt lõi kèm citation `source`");
  lines.push("3. `steps` / `cards`: Neo trí nhớ (Memory anchors, hình ảnh hóa hoặc memory palace)");
  lines.push("4. `quote` / `markdown`: Trang vở ghi chép (Notebook 4-8 dòng chép tay)");
  lines.push("5. `code-run` / `split`: Dự đoán kết quả rồi mới chạy (Predict-then-run, dễ -> khó)");
  lines.push("6. `quiz`: Câu hỏi trắc nghiệm kiểm tra nhanh với phương án nhiễu từ hiểu lầm");
  lines.push("7. `bullets` / `steps`: Đi bộ hồi tưởng (Recall walk qua các chặng)");
  lines.push("8. `summary`: Tổng kết kiến thức và bài tập tiếp theo");
  lines.push("");

  return lines.join("\n");
}
