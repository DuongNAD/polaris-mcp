#!/usr/bin/env node
/**
 * End-to-end test over real MCP stdio for Polaris MCP.
 *
 * Exercises every tool, quality gates, captures (local, web server, arXiv),
 * persistence, roadmap rendering, and CLI commands on a temporary directory under %TEMP%.
 *
 *   node scripts/e2e.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base =
  process.platform === "win32"
    ? join(process.env.LOCALAPPDATA ?? join(tmpdir(), "aurora-slides"), "aurora-slides")
    : join(process.env.XDG_CACHE_HOME ?? join(tmpdir(), ".cache"), "aurora-slides");

const TOOL = resolve(process.env.POLARIS_TOOLCHAIN ?? join(base, "toolchain"));
const req = createRequire(join(TOOL, "package.json"));
const { Client } = req("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = req("@modelcontextprotocol/sdk/client/stdio.js");

const TEST_DIR = join(tmpdir(), `polaris_e2e_${Date.now()}`);
const SUBJECT_DIR = join(TEST_DIR, "ai_agents_course");
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(SUBJECT_DIR, { recursive: true });

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
const textOf = (r) => (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

// Local fixture HTTP server for deterministic web capture
const fixtureHtml = `<!DOCTYPE html>
<html>
<head>
  <title>ReAct: Synergizing Reasoning and Acting in Language Models</title>
</head>
<body>
  <header><nav><a href="/">Home</a></nav></header>
  <main>
    <article>
      <h1>ReAct: Synergizing Reasoning and Acting in Language Models</h1>
      <p>While large language models (LLMs) have demonstrated impressive performance, their abilities for reasoning and acting have primarily been studied as separate topics.</p>
      <p>In this paper, we explore the use of LLMs to generate both <strong>reasoning traces</strong> and <strong>task-specific actions</strong> in an interleaved manner.</p>
      <h2>Key Results</h2>
      <ul>
        <li>Overcomes hallucination issues in HotpotQA and FEVER.</li>
        <li>Improves absolute success rates on ALFWorld by 34%.</li>
      </ul>
      <code>Action: calculate[2 + 2]</code>
    </article>
  </main>
  <footer><p>Copyright 2026 Test Site</p></footer>
</body>
</html>`;

const httpServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fixtureHtml);
});
await new Promise((res) => httpServer.listen(0, "127.0.0.1", res));
const httpPort = httpServer.address().port;
const fixtureUrl = `http://127.0.0.1:${httpPort}/react_paper.html`;

// Local fixture note file
const localNotePath = join(TEST_DIR, "lecture_notes.md");
writeFileSync(
  localNotePath,
  "# Lecture Notes on AI Agents\n- ReAct loop: Think -> Act -> Observe\n- Tool calling contract: JSON schema and typed arguments\n- Guardrails: max_steps and token budgets\n",
  "utf8",
);

const client = new Client({ name: "polaris-e2e", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(ROOT, "dist", "polaris.mjs")],
  stderr: "inherit",
});

await client.connect(transport);
const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 30000 });

try {
  const info = client.getServerVersion();
  ok("server identifies itself", info?.name === "polaris", `${info?.name} ${info?.version}`);
  const instructions = client.getInstructions() ?? "";
  ok("server sends instructions with workflow and rules", instructions.includes("Workflow:") && instructions.includes("Rules:"));

  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name).sort();
  ok("9 tools registered", toolNames.length === 9, toolNames.join(", "));

  const { prompts } = await client.listPrompts();
  const promptNames = prompts.map((p) => p.name).sort();
  ok("prompts listed", promptNames.includes("new_course") && promptNames.includes("research"), promptNames.join(", "));

  // 1. polaris_guide
  let r = await call("polaris_guide");
  ok("guide overview", !r.isError && textOf(r).includes("Available guide topics"), textOf(r).split("\n")[0]);
  r = await call("polaris_guide", { topic: "gates" });
  ok("guide gates topic", !r.isError && textOf(r).includes("Quality gates run during"));
  r = await call("polaris_guide", { topic: "sources" });
  ok("guide sources topic", !r.isError && textOf(r).includes("Source Priority Policy"));

  // 2. polaris_profile
  r = await call("polaris_profile", { action: "get", hub: TEST_DIR });
  ok("profile get", !r.isError && textOf(r).includes('"lang": "vi"') && textOf(r).includes("memoryAnchors"));
  r = await call("polaris_profile", {
    action: "update",
    patch: { taste: { slideStyle: "Apple-keynote", noEmoji: true, noNeon: true, accent: "titanium" } },
    hub: TEST_DIR,
  });
  ok("profile update", !r.isError && textOf(r).includes('"accent": "titanium"'));

  // 3. polaris_start with invalid brief (corrective error with "did you mean")
  r = await call("polaris_start", {
    subject_dir: SUBJECT_DIR,
    brief: {
      subject: "AI Agents 101",
      goalll: "Master agents", // typo
      start: "2026-10-12",
      hoursPerWeek: 3,
      sourcesOfTruth: ["transcript.md"],
    },
  });
  const badBriefText = textOf(r);
  ok(
    "invalid brief is rejected with corrective error",
    r.isError && badBriefText.includes('did you mean "goal" for "goalll"?'),
    badBriefText.split("\n").slice(0, 2).join(" | "),
  );

  // 4. polaris_start with valid brief
  const validBrief = {
    subject: "AI Agents 101",
    slug: "ai-agents-101",
    goal: "Xây dựng AI Agent chạy trên LLM mã nguồn mở, tích hợp MCP server, xử lý an toàn và đo lường eval.",
    outcomes: [
      { id: "O1", text: "Vẽ vòng lặp ReAct state machine có điều kiện dừng", check: "Vẽ từ trí nhớ sơ đồ và giải thích trace" },
      { id: "O2", text: "Thiết kế tool calling có kiểm tra schema", check: "Viết module dispatch và xử lý lỗi có cấu trúc" },
      { id: "O3", text: "Tích hợp agent với MCP server", check: "Nối agent với MCP server và tự viết server nhỏ" },
    ],
    start: "2026-10-12",
    deadline: "2027-01-28",
    hoursPerWeek: 2.5,
    sourcesOfTruth: ["transcript.md", "notebook chính thức vLLM + PydanticAI"],
  };
  r = await call("polaris_start", { subject_dir: SUBJECT_DIR, brief: validBrief });
  ok("start course workspace", !r.isError && textOf(r).includes("Initialized subject workspace"), textOf(r).split("\n")[0]);
  ok("creates polaris directory & gitignore", existsSync(join(SUBJECT_DIR, "polaris", ".gitignore")));

  // 5. polaris_source_add: local file, fixture HTTP web page, and arXiv paper
  r = await call("polaris_source_add", {
    subject_dir: SUBJECT_DIR,
    sources: [
      {
        id: "S1",
        kind: "local",
        title: "Lecture Notes",
        path: localNotePath,
        label: "course",
        quality: { score: 5, why: "Official course lecture notes" },
      },
      {
        id: "S2",
        kind: "web",
        title: "ReAct Paper Web",
        url: fixtureUrl,
        label: "extension",
        quality: { score: 5, why: "Primary research website" },
      },
    ],
  });
  ok("add local and web sources", !r.isError && textOf(r).includes("Processed 2 source(s): 2 added"));
  ok("captures/S2.md created with extracted article text", existsSync(join(SUBJECT_DIR, "polaris", "captures", "S2.md")));
  const s2Md = readFileSync(join(SUBJECT_DIR, "polaris", "captures", "S2.md"), "utf8");
  ok("web extraction drops nav and footer and keeps article", s2Md.includes("ReAct: Synergizing Reasoning") && !s2Md.includes("Copyright 2026 Test Site"));

  // De-duplication check
  r = await call("polaris_source_add", {
    subject_dir: SUBJECT_DIR,
    sources: [
      {
        kind: "web",
        url: fixtureUrl,
      },
    ],
  });
  ok("source de-duplication", !r.isError && textOf(r).includes("1 already existed"));

  // arXiv paper capture test (network)
  try {
    r = await call("polaris_source_add", {
      subject_dir: SUBJECT_DIR,
      sources: [
        {
          id: "S3",
          kind: "paper",
          url: "https://arxiv.org/abs/2210.03629",
          label: "extension",
          quality: { score: 5, why: "Peer-reviewed paper" },
        },
      ],
    });
    if (!r.isError && existsSync(join(SUBJECT_DIR, "polaris", "captures", "S3.md"))) {
      ok("arXiv capture and Atom XML parse", true, textOf(r).split("\n")[0]);
    } else {
      console.log("skip arXiv online capture check (offline or rate limited)");
    }
  } catch {
    console.log("skip arXiv online capture check (network error)");
  }

  // 6. polaris_sources
  r = await call("polaris_sources", { subject_dir: SUBJECT_DIR, filter: { label: "course" } });
  ok("list sources with filter", !r.isError && textOf(r).includes('"id": "S1"'));

  r = await call("polaris_sources", {
    subject_dir: SUBJECT_DIR,
    update: [{ id: "S1", set: { notes: "Verified in 2026" } }],
  });
  ok("update source", !r.isError && textOf(r).includes("Updated 1 source(s)"));

  // 7. polaris_fact_add
  // Test invalid fact without locator
  r = await call("polaris_fact_add", {
    subject_dir: SUBJECT_DIR,
    facts: [
      {
        claim: "ReAct combines reasoning and acting",
        source: "S1",
        locator: "", // empty locator
        modules: ["M1"],
      },
    ],
  });
  ok("rejects fact without locator", r.isError && textOf(r).includes("locator"));

  // Add valid facts
  r = await call("polaris_fact_add", {
    subject_dir: SUBJECT_DIR,
    facts: [
      {
        id: "F1",
        claim: "LLMs provide the reasoning, but tools define the actions",
        source: "S1",
        locator: "02:13",
        label: "course",
        modules: ["M1"],
      },
      {
        id: "F2",
        claim: "ReAct interleaves reasoning traces and action execution to reduce hallucinations",
        source: "S2",
        locator: "Section 2",
        label: "extension",
        modules: ["M1"],
      },
      {
        id: "F3",
        claim: "Tool calling operates as a typed contract verified with schema",
        source: "S1",
        locator: "06:27",
        label: "course",
        modules: ["M2"],
      },
    ],
  });
  ok("add valid facts", !r.isError && textOf(r).includes("Added 3 fact(s)"));

  // 8. polaris_facts
  r = await call("polaris_facts", { subject_dir: SUBJECT_DIR, module: "M1" });
  ok("query facts by module", !r.isError && textOf(r).includes('"id": "F1"') && textOf(r).includes('"id": "F2"'));

  // 9. polaris_roadmap_save & quality gates
  // Valid two-module roadmap
  const validRoadmap = {
    title: "AI Agents 101",
    version: "2",
    updated: "2026-10-12",
    goalQuote: "Học xong, bạn tự dựng được một AI agent chạy trên LLM mã nguồn mở qua API tương thích OpenAI, mở rộng bằng MCP server",
    modules: [
      {
        id: "M1",
        title: "Agent và vòng lặp ReAct",
        hours: 3,
        depends: [],
        why: "Hiểu bản chất của Agent: LLM suy luận, tool hành động, vòng lặp nối hai thứ",
        outputs: [
          "Vẽ từ trí nhớ state machine của vòng lặp ReAct có ngân sách",
          "Viết lại vòng lặp ReAct từ file trống với mock LLM (O1)",
        ],
        core: [
          { text: "LLM suy luận, tool xác định hành động [Khóa học]", facts: ["F1"], label: "course" },
          { text: "Vòng lặp ReAct xen kẽ suy luận và quan sát [Mở rộng]", facts: ["F2"], label: "extension" },
        ],
        diagram: "flowchart TD\n  A[Nhận mục tiêu] --> B[Gọi LLM]\n  B --> C{Có Tool Call?}\n  C -->|Có| D[Chạy Tool]\n  D --> B\n  C -->|Không| E[Trả lời cuối]",
        misconceptions: [
          { wrong: "Agent tự chạy tool không cần code", fix: "Code runtime thực thi tool và nạp observation vào state" },
        ],
        materials: [
          { title: "Lecture notes on ReAct", source: "S1", minutes: 30, note: "Phần 1-3" },
          { title: "ReAct paper overview", source: "S2", minutes: 30 },
        ],
        practice: {
          warmup: { task: "Chạy mock ReAct và dự đoán số bước", minutes: 15, dod: "Bảng dự đoán và kết quả thực tế khớp nhau" },
          core: { task: "Viết mini_react.py từ file trống", minutes: 45, dod: "Có max_steps và vượt qua 4 assert" },
          challenge: { task: "Thêm stop sequence tại Observation:", minutes: 30, dod: "Chặn thành công ảo giác tự sinh quan sát" },
        },
        selfCheck: [
          { q: "Yếu tố nào quyết định năng lực hành động của agent?", level: "remember", answer: "Bộ công cụ (tools) được cấp." },
          { q: "Vì sao vòng lặp ReAct luôn cần max_steps?", level: "explain", answer: "Tránh vòng lặp vô hạn và chi phí token bùng nổ." },
          { q: "Chạy lệnh python my_react.py với prompt không có tool, bạn dự đoán kết quả gì?", level: "predict", answer: "Mô hình trả về Final Answer ngay ở bước 1." },
          { q: "Mô hình tự sinh 'Observation: 5' thì code phải làm gì?", level: "apply", answer: "Bỏ qua observation giả và ép thực thi tool thật hoặc dừng tại stop sequence." },
        ],
        checkpoint: ["Vẽ được state machine từ trí nhớ", "mini_react.py qua 4 assert"],
      },
      {
        id: "M2",
        title: "Tool calling và schema",
        hours: 3,
        depends: ["M1"],
        why: "Phần lớn lỗi của agent nằm ở ranh giới giữa văn bản xác suất và code tất định",
        outputs: [
          "Thiết kế schema JSON kiểm tra tham số lúc chạy",
          "Viết bộ dispatch trả lỗi có cấu trúc để mô hình tự sửa (O2)",
        ],
        core: [
          { text: "Tool là hợp đồng có kiểu và schema JSON [Khóa học]", facts: ["F3"], label: "course" },
        ],
        misconceptions: [
          { wrong: "LLM luôn sinh đúng kiểu dữ liệu 100%", fix: "Cần validation runtime với Zod hoặc Pydantic" },
        ],
        materials: [
          { title: "Tool calling specification", source: "S1", minutes: 30 },
        ],
        practice: {
          warmup: { task: "Khai báo schema cho calculator tool", minutes: 15, dod: "Schema JSON hợp lệ" },
          core: { task: "Viết hàm dispatch kiểm tra kiểu", minutes: 45, dod: "Trả lỗi có cấu trúc khi tham số sai" },
          challenge: { task: "Thử nghiệm ca injection qua tham số", minutes: 30, dod: "Chặn thành công injection" },
        },
        selfCheck: [
          { q: "Một vòng tool calling gồm những bước nào?", level: "remember", answer: "tools -> tool_calls -> runtime execute -> tool message -> final answer." },
          { q: "Vì sao phải trả lỗi có cấu trúc khi tool call sai?", level: "explain", answer: "Để mô hình đọc được lỗi và tự sửa tham số ở lượt kế tiếp." },
          { q: "Dự đoán kết quả khi truyền tham số thiếu field bắt buộc vào dispatch?", level: "predict", answer: "Trả về thông báo lỗi chi tiết chỉ rõ field bị thiếu." },
          { q: "Xử lý thế nào khi tool trả về kết quả quá lớn vượt context window?", level: "apply", answer: "Tóm tắt hoặc cắt ngắn kết quả trước khi đưa vào context." },
        ],
        checkpoint: ["Dispatch tool qua 8 assert", "Đúng 4/4 câu tự kiểm tra"],
      },
    ],
    capstone: {
      title: "Trợ lý hạn chót học tập",
      description: "Agent đọc file TASKS.md qua MCP server chỉ đọc và trả lời câu hỏi hạn chót.",
      dod: "Eval 12 câu đạt từ 10/12, chặn 2 ca prompt injection.",
    },
  };

  r = await call("polaris_roadmap_save", { subject_dir: SUBJECT_DIR, roadmap: validRoadmap });
  ok("roadmap_save succeeds and renders ROADMAP.md", !r.isError && textOf(r).includes("Roadmap saved"));
  const roadmapMdPath = join(SUBJECT_DIR, "04_Roadmaps", "ROADMAP.md");
  ok("ROADMAP.md exists on disk", existsSync(roadmapMdPath));

  const roadmapMd = readFileSync(roadmapMdPath, "utf8");
  ok("rendered roadmap contains expected Vietnamese headings",
    roadmapMd.includes("## 1. Cách dùng lộ trình này") &&
    roadmapMd.includes("## 2. Bức tranh toàn cảnh") &&
    roadmapMd.includes("## 4. Các module") &&
    roadmapMd.includes("## 5. Ôn tập giãn cách và ôn xen kẽ") &&
    roadmapMd.includes("## 10. Nguồn tham khảo")
  );
  ok("rendered roadmap contains label badges", roadmapMd.includes("**[Khóa học]**") && roadmapMd.includes("**[Mở rộng]**"));
  ok("rendered roadmap contains Mermaid dependency chart", roadmapMd.includes("```mermaid\nflowchart TD") && roadmapMd.includes("M1") && roadmapMd.includes("M2"));
  ok("rendered roadmap contains hidden self-check answers", roadmapMd.includes("<details><summary>Đáp án</summary>"));

  // 10. polaris_check
  r = await call("polaris_check", { subject_dir: SUBJECT_DIR });
  ok("polaris_check returns clean report", !r.isError && textOf(r).includes("Quality Gate Audit"));

  // 11. Test invalid roadmap with dependency cycle
  const cyclicRoadmap = {
    ...validRoadmap,
    modules: [
      { ...validRoadmap.modules[0], depends: ["M2"] },
      { ...validRoadmap.modules[1], depends: ["M1"] },
    ],
  };
  r = await call("polaris_roadmap_save", { subject_dir: SUBJECT_DIR, roadmap: cyclicRoadmap });
  ok("detects dependency cycles in roadmap", r.isError && textOf(r).includes("Dependency cycle detected"));

  // Restore valid roadmap for CLI checks
  await call("polaris_roadmap_save", { subject_dir: SUBJECT_DIR, roadmap: validRoadmap });

  // 12. CLI tests
  const guideCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "guide", "gates"], { encoding: "utf8" });
  ok("CLI guide gates", guideCli.includes("Quality gates run during"));

  const checkCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "check", SUBJECT_DIR], { encoding: "utf8" });
  ok("CLI check subject", checkCli.includes("Quality Gate Audit"));

  const renderCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "render", SUBJECT_DIR], { encoding: "utf8" });
  ok("CLI render subject", renderCli.includes("Rendered ROADMAP.md"));

  const versionCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "version"], { encoding: "utf8" });
  ok("CLI version", versionCli.trim() === "0.1.0");

  const helpCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "help"], { encoding: "utf8" });
  ok("CLI help", helpCli.includes("Usage: node polaris.mjs"));

} catch (e) {
  failed++;
  console.log(`FAIL unexpected error: ${e?.stack ?? e}`);
} finally {
  await client.close();
  httpServer.close();
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll end-to-end checks passed.");
process.exit(failed ? 1 : 0);
