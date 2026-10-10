import type { Brief, Fact, Roadmap, RoadmapModule, Source } from "./schema.js";
import { todayIso } from "./util.js";

function labelTag(label?: "course" | "extension" | "unverified"): string {
  if (label === "course") return "**[Khóa học]**";
  if (label === "extension") return "**[Mở rộng]**";
  if (label === "unverified") return "**(chưa xác minh)**";
  return "";
}

function levelLabel(level?: string): string {
  switch (level) {
    case "remember":
      return "Nhớ";
    case "explain":
      return "Giải thích";
    case "predict":
      return "Dự đoán";
    case "apply":
      return "Áp dụng";
    default:
      return level ?? "Tự hỏi";
  }
}

function renderMermaidMap(modules: RoadmapModule[]): string {
  const lines: string[] = ["```mermaid", "flowchart TD"];
  
  // Clean node label helper
  const nodeLabel = (m: RoadmapModule) => `${m.id}["${m.id} ${m.title.replace(/["[\]]/g, "'")}"]`;

  // Track connections
  const connected = new Set<string>();
  for (const m of modules) {
    for (const dep of m.depends ?? []) {
      const depMod = modules.find((x) => x.id === dep);
      if (depMod) {
        lines.push(`    ${nodeLabel(depMod)} --> ${nodeLabel(m)}`);
        connected.add(depMod.id);
        connected.add(m.id);
      }
    }
  }

  // Standalone nodes
  for (const m of modules) {
    if (!connected.has(m.id)) {
      lines.push(`    ${nodeLabel(m)}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

export function renderRoadmapMarkdown(params: {
  roadmap: Roadmap;
  brief?: Brief;
  sources?: Source[];
  facts?: Fact[];
  relativePath?: string;
}): string {
  const { roadmap, brief, sources = [], facts = [], relativePath = "04_Roadmaps/ROADMAP.md" } = params;

  const version = roadmap.version ?? "1";
  const updated = roadmap.updated ?? todayIso();
  const sourcesOfTruthStr = brief?.sourcesOfTruth?.join(", ") ?? "tài liệu chính thức";
  const goalStr = roadmap.goalQuote ?? brief?.goal ?? "Khóa học cá nhân hóa";

  const lines: string[] = [];

  // Header & Quote
  lines.push(`# Lộ trình ${roadmap.title} (phiên bản ${version}, cập nhật ${updated})`);
  lines.push("");
  lines.push(`> ${goalStr}. File: \`${relativePath}\`. Nguồn sự thật (source of truth): ${sourcesOfTruthStr}.`);
  lines.push("");

  // Table of Contents
  lines.push("## Mục lục");
  lines.push("");
  lines.push("- [1. Cách dùng lộ trình này](#1-cách-dùng-lộ-trình-này)");
  lines.push("- [2. Bức tranh toàn cảnh](#2-bức-tranh-toàn-cảnh)");
  lines.push("- [3. Trạng thái hiện tại và lịch](#3-trạng-thái-hiện-tại-và-lịch)");
  lines.push("- [4. Các module](#4-các-module)");
  lines.push("- [5. Ôn tập giãn cách và ôn xen kẽ](#5-ôn-tập-giãn-cách-và-ôn-xen-kẽ)");
  lines.push("- [6. Dự án tổng hợp](#6-dự-án-tổng-hợp)");
  lines.push("- [7. Sổ lỗi và cách hỏi DeepTutor](#7-sổ-lỗi-và-cách-hỏi-deeptutor)");
  lines.push("- [8. Tài liệu cũ trong thư mục này](#8-tài-liệu-cũ-trong-thư-mục-này)");
  lines.push("- [9. Theo dõi tiến độ](#9-theo-dõi-tiến-độ)");
  lines.push("- [10. Nguồn tham khảo](#10-nguồn-tham-khảo)");
  lines.push("");

  // 1. How to use
  lines.push("## 1. Cách dùng lộ trình này");
  lines.push("");
  lines.push(
    "**Nhãn:** **[Khóa học]** có trong video hoặc tài liệu chính thức; **[Mở rộng]** không có trong video, nguồn ngoài đã kiểm tra; **(chưa xác minh)** chưa kiểm chứng được, đừng coi là sự thật.",
  );
  lines.push("");
  lines.push(
    '**Vòng lặp một module:** (1) tự chấm 0-2 từng dòng "Đầu ra"; (2) xem đoạn video/tài liệu, đối chiếu lời tiếng Anh trong transcript; ' +
    '(3) đọc "Kiến thức cốt lõi": mô hình tư duy trước, API sau; (4) predict-then-run (dự đoán rồi mới chạy): ghi dự đoán trước mọi lệnh, chỗ lệch là chỗ đáng học; ' +
    '(5) thực hành 3 tầng trong time box, lên tầng khi đạt DoD (Definition of Done: tiêu chí hoàn thành kiểm tra được); ' +
    '(6) viết câu trả lời rồi mới mở "Đáp án"; câu sai -> Sổ lỗi (mục 7) -> lịch ôn (mục 5).',
  );
  lines.push("");
  lines.push(
    "**Buổi 60 phút:** 0-5 ôn câu đến hạn; 5-15 video/tài liệu; 15-50 thực hành một tầng (kẹt quá 15 phút thì hỏi DeepTutor, mục 7); " +
    "50-57 tự kiểm tra, Sổ lỗi; 57-60 ghi điểm dừng và việc kế tiếp. **Buổi 30 phút:** 5 phút ôn + một việc nhỏ (một tài liệu hoặc tầng Khởi động). Buổi lab có thể 90 phút.",
  );
  lines.push("");

  // 2. Big Picture
  lines.push("## 2. Bức tranh toàn cảnh");
  lines.push("");
  lines.push("### 2.1 Năng lực đầu ra");
  lines.push("");
  const outcomes = brief?.outcomes ?? roadmap.outcomes ?? [];
  if (outcomes.length) {
    outcomes.forEach((out, i) => {
      const checkPart = out.check ? ` (Kiểm tra: ${out.check})` : "";
      lines.push(`${i + 1}. ${out.text}${checkPart}`);
    });
  } else {
    lines.push("1. Nắm vững toàn bộ kiến thức cốt lõi và thực hành hoàn chỉnh.");
  }
  lines.push("");

  lines.push("### 2.2 Bản đồ module");
  lines.push("");
  lines.push(renderMermaidMap(roadmap.modules));
  lines.push("");

  lines.push("### 2.3 Kiến thức nền cần có");
  lines.push("");
  if (roadmap.prerequisites?.summary) {
    lines.push(roadmap.prerequisites.summary);
    lines.push("");
  } else {
    lines.push("- Kỹ năng lập trình, sử dụng command line và git cơ bản.");
    lines.push("- Tư duy giải quyết vấn đề và tự học dựa trên bằng chứng.");
    lines.push("");
  }

  if (roadmap.prerequisites?.quickSelfTest?.length) {
    lines.push("**Tự kiểm tra nhanh** (sai từ 2 câu thì ôn nền trước khi vào M1)");
    roadmap.prerequisites.quickSelfTest.forEach((st, i) => {
      lines.push(`${i + 1}. ${st.q}`);
    });
    lines.push("");
    lines.push("<details><summary>Đáp án</summary>");
    lines.push("");
    roadmap.prerequisites.quickSelfTest.forEach((st, i) => {
      lines.push(`${i + 1}. ${st.answer}`);
    });
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  lines.push("### 2.4 Ngân sách thời gian");
  lines.push("");
  const totalModHours = roadmap.modules.reduce((acc, cur) => acc + (cur.hours || 0), 0);
  const hpw = brief?.hoursPerWeek ?? roadmap.timeBudget?.hoursPerWeek ?? 2;
  const tbNotes = roadmap.timeBudget?.notes ?? (brief?.deadline ? `Thời gian dự kiến hoàn thành trước ${brief.deadline}.` : "");
  lines.push(
    `Khóa học ước lượng tổng cộng khoảng ${totalModHours} giờ học. Với nhịp độ ${hpw} giờ/tuần, lộ trình kéo dài khoảng ${Math.ceil(totalModHours / hpw)} tuần. ${tbNotes}`,
  );
  lines.push("");

  // 3. Status and schedule
  lines.push("## 3. Trạng thái hiện tại và lịch");
  lines.push("");
  lines.push("### 3.1 Bạn đang ở đây");
  lines.push("");
  lines.push(roadmap.status?.current ?? `- **Bắt đầu:** ${brief?.start ?? updated}. Toàn bộ tài liệu và mã nguồn tham khảo đã sẵn sàng trong thư mục.`);
  lines.push("");

  lines.push("### 3.2 Lịch theo tuần");
  lines.push("");
  if (roadmap.status?.weeklySchedule?.length) {
    lines.push("| Tuần | Buổi | Module | Sản phẩm / DoD | Hạn |");
    lines.push("|---|---|---|---|---|");
    for (const ws of roadmap.status.weeklySchedule) {
      lines.push(`| ${ws.week} | ${ws.sessions} | ${ws.module} | ${ws.dod} | ${ws.deadline ?? ""} |`);
    }
  } else {
    lines.push("| Tuần | Buổi | Module | Sản phẩm / DoD | Hạn |");
    lines.push("|---|---|---|---|---|");
    roadmap.modules.forEach((m, i) => {
      const week = i + 1;
      const warmupDod = m.practice?.core?.dod ?? "Hoàn thành bài tập cốt lõi";
      lines.push(`| ${week} | Buổi ${week} | ${m.id} ${m.title} | ${warmupDod} | Tuần ${week} |`);
    });
  }
  lines.push("");

  // 4. Modules
  lines.push("## 4. Các module");
  lines.push("");

  const factMap = new Map<string, Fact>();
  facts.forEach((f) => factMap.set(f.id, f));

  for (const m of roadmap.modules) {
    lines.push(`### Module ${m.id} - ${m.title} (ước lượng: ${m.hours} giờ)`);
    lines.push("");
    lines.push(`**Vì sao học:** ${m.why}`);
    lines.push("");
    lines.push("**Đầu ra (làm được sau module):**");
    for (const out of m.outputs) {
      lines.push(`- ${out}`);
    }
    lines.push("");
    lines.push("**Kiến thức cốt lõi**");
    for (const core of m.core) {
      const tag = labelTag(core.label);
      const tagStr = tag ? `${tag} ` : "";
      lines.push(`- ${tagStr}${core.text}`);
    }
    lines.push("");

    if (m.diagram) {
      lines.push(m.diagram.startsWith("```") ? m.diagram : `\`\`\`mermaid\n${m.diagram}\n\`\`\``);
      lines.push("");
    }

    lines.push("**Hiểu lầm và lỗi hay gặp:**");
    for (const misc of m.misconceptions) {
      lines.push(`- "${misc.wrong}" -> ${misc.fix}`);
    }
    lines.push("");

    lines.push("**Tài liệu**");
    if (m.materials?.length) {
      for (const mat of m.materials) {
        const link = mat.url ? `[${mat.title}](${mat.url})` : mat.title;
        const note = mat.note ? ` - ${mat.note}` : "";
        lines.push(`- ${link} (${mat.minutes} phút)${note}`);
      }
    } else {
      lines.push(`- Tài liệu chính thức của module (${m.hours * 30} phút)`);
    }
    lines.push("");

    lines.push("**Thực hành**");
    const wu = m.practice.warmup;
    const co = m.practice.core;
    const ch = m.practice.challenge;
    lines.push(`- Khởi động (${wu.minutes ?? 15} phút): ${wu.task}. DoD: ${wu.dod}.`);
    lines.push(`- Cốt lõi (${co.minutes ?? 45} phút): ${co.task}. DoD: ${co.dod}.`);
    lines.push(`- Thử thách (${ch.minutes ?? 30} phút): ${ch.task}. DoD: ${ch.dod}.`);
    lines.push("");

    lines.push("**Tự kiểm tra**");
    m.selfCheck.forEach((sc, sci) => {
      const lvl = sc.level ? `(${levelLabel(sc.level)}) ` : "";
      lines.push(`${sci + 1}. ${lvl}${sc.q}`);
    });
    lines.push("");
    lines.push("<details><summary>Đáp án</summary>");
    lines.push("");
    m.selfCheck.forEach((sc, sci) => {
      lines.push(`${sci + 1}. ${sc.answer}`);
    });
    lines.push("");
    lines.push("</details>");
    lines.push("");

    const cpStr = Array.isArray(m.checkpoint)
      ? m.checkpoint.map((c) => `[ ] ${c}`).join("; ")
      : `[ ] ${m.checkpoint}`;
    lines.push(`**Checkpoint:** ${cpStr}`);
    lines.push("");
  }

  // 5. Spaced & Interleaved Review
  lines.push("## 5. Ôn tập giãn cách và ôn xen kẽ");
  lines.push("");
  lines.push(
    "Mỗi lượt 5-10 phút: trả lời lại 2-3 câu tự kiểm tra (ưu tiên câu từng sai), đọc lại Sổ lỗi của module; đúng cả lượt D+7 và D+21 thì coi là vững. " +
    "Ngày ôn không phải ngày học thì làm đầu buổi gần nhất; học trễ thì tính lại từ ngày xong thật.",
  );
  lines.push("");

  if (roadmap.review?.schedule?.length) {
    lines.push("| Module | Học xong | D+1 | D+3 | D+7 | D+21 |");
    lines.push("|---|---|---|---|---|---|");
    for (const r of roadmap.review.schedule) {
      lines.push(`| ${r.module} | ${r.date} | ${r.d1 ?? ""} | ${r.d3 ?? ""} | ${r.d7 ?? ""} | ${r.d21 ?? ""} |`);
    }
    lines.push("");
  } else {
    lines.push("| Module | Học xong | D+1 | D+3 | D+7 | D+21 |");
    lines.push("|---|---|---|---|---|---|");
    roadmap.modules.forEach((m) => {
      lines.push(`| ${m.id} | Theo lịch | D+1 | D+3 | D+7 | D+21 |`);
    });
    lines.push("");
  }

  if (roadmap.review?.interleaved?.length) {
    lines.push("**Ôn xen kẽ** (30 phút, trộn module):");
    for (const ir of roadmap.review.interleaved) {
      const datePart = ir.date ? ` (${ir.date})` : "";
      lines.push(`- **${ir.name}${datePart}:** ${ir.focus}`);
    }
    lines.push("");
  }

  // 6. Capstone
  lines.push("## 6. Dự án tổng hợp");
  lines.push("");
  if (roadmap.capstone) {
    const capTitle = roadmap.capstone.title ? `**${roadmap.capstone.title}:** ` : "";
    lines.push(`${capTitle}${roadmap.capstone.description}`);
    if (roadmap.capstone.dod) {
      lines.push(`- **DoD:** ${roadmap.capstone.dod}`);
    }
    if (roadmap.capstone.scope?.length) {
      lines.push(`- **Phạm vi:** ${roadmap.capstone.scope.join("; ")}`);
    }
  } else {
    lines.push("Xây dựng ứng dụng hoàn chỉnh kết hợp kiến thức từ các module, có kiểm thử eval và guardrails an toàn.");
  }
  lines.push("");

  // 7. Error log & DeepTutor
  lines.push("## 7. Sổ lỗi và cách hỏi DeepTutor");
  lines.push("");
  lines.push("**Mẫu Sổ lỗi** (`so_loi.md`, mỗi lỗi một mục):");
  lines.push("");
  lines.push("```text");
  lines.push("Ngày | Module | Loại gap: cấu trúc / ca biên / cú pháp / quy trình");
  lines.push("Triệu chứng (lỗi chính xác, lệnh đã chạy):");
  lines.push("Giả thuyết ban đầu:      Nguyên nhân gốc:      Cách sửa:");
  lines.push('Quy tắc rút ra ("Khi ... thì ..."):      Ôn lại: D+1, D+7');
  lines.push("```");
  lines.push("");
  lines.push(
    "**Hỏi DeepTutor.** Thang gợi ý 5 mức: (1) chỉ ra triệu chứng; (2) câu hỏi dẫn dắt (ranh giới, bất biến, luồng dữ liệu); " +
    '(3) phản ví dụ tối thiểu; (4) mã giả hoặc chữ ký API; (5) code đầy đủ chỉ khi bạn nói rõ "Show me the full code". ' +
    'Hỏi "giải giúp bài này" mà không kèm suy luận thì chỉ nhận mức 1-2. Mẫu: **Mục tiêu** (bài, DoD) / **Đã thử** (2-3 việc, kết quả) / ' +
    "**Lỗi chính xác** (nguyên văn, kèm lệnh) / **Giả thuyết** / **Mức gợi ý muốn nhận**. Không dán API key hay nội dung `.env`.",
  );
  lines.push("");

  // 8. Older Material
  lines.push("## 8. Tài liệu cũ trong thư mục này");
  lines.push("");
  if (roadmap.olderMaterial?.length) {
    lines.push("| File cũ | Dùng được? | Dùng cho việc gì |");
    lines.push("|---|---|---|");
    for (const om of roadmap.olderMaterial) {
      lines.push(`| [${om.file}](${om.file}) | ${om.usable} | ${om.purpose} |`);
    }
  } else {
    lines.push("Tất cả tài liệu tạo mới đều tuân thủ nguyên tắc evidence-based và định dạng của lộ trình.");
  }
  lines.push("");

  // 9. Progress Tracking
  lines.push("## 9. Theo dõi tiến độ");
  lines.push("");
  if (roadmap.progressTracking?.length) {
    for (const pt of roadmap.progressTracking) {
      lines.push(pt.startsWith("-") ? pt : `- [ ] ${pt}`);
    }
  } else {
    roadmap.modules.forEach((m) => {
      lines.push(`- [ ] Module ${m.id}: ${m.title}`);
    });
    lines.push("- [ ] Dự án tổng hợp");
    lines.push("- [ ] Tổng kết và đánh giá");
  }
  lines.push("");

  // 10. References
  lines.push("## 10. Nguồn tham khảo");
  lines.push("");
  if (sources.length) {
    lines.push("| Tên | URL / Đường dẫn | Nhãn | Chất lượng |");
    lines.push("|---|---|---|---|");
    for (const s of sources) {
      const link = s.url ? `[${s.title}](${s.url})` : s.path ? `[${s.title}](${s.path})` : s.title;
      const loc = s.url || s.path || s.kind;
      const lbl = labelTag(s.label);
      const q = s.quality ? `${s.quality.score}/5 (${s.quality.why})` : "-";
      lines.push(`| ${link} | ${loc} | ${lbl} | ${q} |`);
    }
  } else {
    lines.push("| Tên | URL / Đường dẫn | Dùng cho | Kiểm tra |");
    lines.push("|---|---|---|---|");
    lines.push(`| Tài liệu gốc | ${sourcesOfTruthStr} | Toàn bộ khóa học | ${updated} |`);
  }
  lines.push("");

  return lines.join("\n");
}
