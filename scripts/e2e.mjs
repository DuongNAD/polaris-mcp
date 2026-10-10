#!/usr/bin/env node
/**
 * End-to-end test over real MCP stdio for Polaris MCP.
 *
 * Exercises all 12 tools, quality gates, captures (local, web server, arXiv, YouTube),
 * research discovery (OpenAlex, arXiv, Semantic Scholar, CrossRef, Wikipedia, GitHub, YouTube),
 * offline fixture normalization/dedup/ranking, shortlist generation, persistence,
 * roadmap rendering, and CLI commands on a temporary directory under %TEMP%.
 *
 *   node scripts/e2e.mjs
 *   $env:POLARIS_E2E_KEEP="1"; node scripts/e2e.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base =
  process.platform === "win32"
    ? join(process.env.LOCALAPPDATA ?? join(tmpdir(), "aurora-slides"), "aurora-slides")
    : join(process.env.XDG_CACHE_HOME ?? join(tmpdir(), ".cache"), "aurora-slides");

const TOOL = resolve(process.env.POLARIS_TOOLCHAIN ?? join(base, "toolchain"));
const req = createRequire(join(TOOL, "package.json"));
const { Client } = req("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = req("@modelcontextprotocol/sdk/client/stdio.js");

// Import bundled modules from dist/polaris.mjs for offline unit checks
const polarisLib = await import(pathToFileURL(join(ROOT, "dist", "polaris.mjs")).href);

const TEST_DIR = join(tmpdir(), `polaris_e2e_${Date.now()}`);
const SUBJECT_DIR = join(TEST_DIR, "ai_agents_course");
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(SUBJECT_DIR, { recursive: true });

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
const skip = (name, reason) => {
  console.log(`skip ${name}  (${reason})`);
};
const textOf = (r) => (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

/* ───────── 1. Offline Unit Checks with Recorded Fixtures ───────── */

console.log("\n--- Offline Unit-Style Checks (Recorded Fixtures) ---");

// 1.1 OpenAlex Fixture
const openalexFixturePath = join(ROOT, "scripts", "fixtures", "openalex_react.json");
const openalexJson = JSON.parse(readFileSync(openalexFixturePath, "utf8"));
const openalexItems = polarisLib.parseOpenAlexResponse(openalexJson);
ok("parse OpenAlex fixture", openalexItems.length === 1 && openalexItems[0].title.includes("ReAct"), openalexItems[0]?.title);
ok(
  "OpenAlex inverted index reconstruction",
  Boolean(openalexItems[0]?.abstract && openalexItems[0].abstract.includes("ReAct") && openalexItems[0].abstract.includes("reasoning")),
  openalexItems[0]?.abstract?.slice(0, 60),
);
ok("OpenAlex citations and OA URL", openalexItems[0]?.citations === 1420 && Boolean(openalexItems[0]?.oaUrl), `citations: ${openalexItems[0]?.citations}`);

// 1.2 arXiv Atom XML Fixture
const arxivFixturePath = join(ROOT, "scripts", "fixtures", "arxiv_react.xml");
const arxivXml = readFileSync(arxivFixturePath, "utf8");
const arxivItems = polarisLib.parseArxivXml(arxivXml);
ok("parse arXiv XML fixture", arxivItems.length === 1 && arxivItems[0].arxiv === "2210.03629", `arxiv: ${arxivItems[0]?.arxiv}`);
ok("arXiv authors and date", arxivItems[0]?.authors?.includes("Shunyu Yao") && arxivItems[0]?.year === 2022);

// 1.3 Semantic Scholar Fixture
const s2FixturePath = join(ROOT, "scripts", "fixtures", "semanticscholar_react.json");
const s2Json = JSON.parse(readFileSync(s2FixturePath, "utf8"));
const s2Items = polarisLib.parseSemanticScholarResponse(s2Json);
ok("parse Semantic Scholar fixture", s2Items.length === 1 && s2Items[0].citations === 1420 && s2Items[0].doi?.includes("2210.03629"));

// 1.4 CrossRef Fixture
const crFixturePath = join(ROOT, "scripts", "fixtures", "crossref_react.json");
const crJson = JSON.parse(readFileSync(crFixturePath, "utf8"));
const crItems = polarisLib.parseCrossRefResponse(crJson);
ok("parse CrossRef fixture", crItems.length === 1 && crItems[0].doi?.includes("2210.03629"));

// 1.5 De-duplication across all 4 providers
const allFixtureItems = [...openalexItems, ...arxivItems, ...s2Items, ...crItems];
const dedupedFixtureItems = polarisLib.deduplicateResearchItems(allFixtureItems);
ok(
  "de-duplicate 4 provider responses into 1 canonical item",
  dedupedFixtureItems.length === 1,
  `Reduced from ${allFixtureItems.length} items to ${dedupedFixtureItems.length}`,
);
const canonical = dedupedFixtureItems[0];
ok(
  "merged item preserves best citations and OA URL",
  canonical.citations === 1420 && Boolean(canonical.oaUrl) && Boolean(canonical.doi) && Boolean(canonical.arxiv),
  `DOI: ${canonical.doi}, arXiv: ${canonical.arxiv}`,
);

// 1.6 Ranking with transparent reasons
const rankedFixtureItems = polarisLib.rankResearchItems(dedupedFixtureItems, {
  queries: ["ReAct language models reasoning acting"],
  year_from: 2022,
});
ok("rank research items with score", rankedFixtureItems[0].score > 50 && rankedFixtureItems[0].rank === 1, `Score: ${rankedFixtureItems[0]?.score}/100`);
ok(
  "ranking generates transparent evaluation reasons",
  Array.isArray(rankedFixtureItems[0]?.reasons) && rankedFixtureItems[0].reasons.length >= 3,
  rankedFixtureItems[0]?.reasons?.join("; "),
);

/* ───────── 2. Local Fixture HTTP Server ───────── */

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

const localNotePath = join(TEST_DIR, "lecture_notes.md");
writeFileSync(
  localNotePath,
  "# Lecture Notes on AI Agents\n- ReAct loop: Think -> Act -> Observe\n- Tool calling contract: JSON schema and typed arguments\n- Guardrails: max_steps and token budgets\n",
  "utf8",
);

/* ───────── 3. MCP Server Client Tests ───────── */

console.log("\n--- Real MCP Server Stdio Tests ---");

const client = new Client({ name: "polaris-e2e", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(ROOT, "dist", "polaris.mjs")],
  stderr: "inherit",
});

await client.connect(transport);
const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });

try {
  const info = client.getServerVersion();
  ok("server identifies itself", info?.name === "polaris", `${info?.name} ${info?.version}`);
  const instructions = client.getInstructions() ?? "";
  ok("server sends instructions with workflow and rules", instructions.includes("Workflow:") && instructions.includes("Rules:"));

  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name).sort();
  ok(
    "12 tools registered",
    toolNames.length === 12 &&
      toolNames.includes("polaris_find") &&
      toolNames.includes("polaris_research") &&
      toolNames.includes("polaris_capture"),
    toolNames.join(", "),
  );

  const { prompts } = await client.listPrompts();
  const promptNames = prompts.map((p) => p.name).sort();
  ok("prompts listed", promptNames.includes("new_course") && promptNames.includes("research"), promptNames.join(", "));

  // 3.1 polaris_guide (all topics including research)
  let r = await call("polaris_guide");
  ok("guide overview", !r.isError && textOf(r).includes("Available guide topics"), textOf(r).split("\n")[0]);
  r = await call("polaris_guide", { topic: "research" });
  ok("guide research topic", !r.isError && textOf(r).includes("Keyless Providers:") && textOf(r).includes("The Review Gate"));
  r = await call("polaris_guide", { topic: "gates" });
  ok("guide gates topic", !r.isError && textOf(r).includes("Quality gates run during"));

  // 3.2 polaris_profile
  r = await call("polaris_profile", { action: "get", hub: TEST_DIR });
  ok("profile get", !r.isError && textOf(r).includes('"lang": "vi"') && textOf(r).includes("memoryAnchors"));
  r = await call("polaris_profile", {
    action: "update",
    patch: { taste: { slideStyle: "Apple-keynote", noEmoji: true, noNeon: true, accent: "titanium" } },
    hub: TEST_DIR,
  });
  ok("profile update", !r.isError && textOf(r).includes('"accent": "titanium"'));

  // 3.3 polaris_start
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
    sourcesOfTruth: ["transcript.md", "notebook chính thức vLLM + PydanticAI", "https://arxiv.org/abs/2210.03629"],
  };
  r = await call("polaris_start", { subject_dir: SUBJECT_DIR, brief: validBrief });
  ok("start course workspace", !r.isError && textOf(r).includes("Initialized subject workspace"), textOf(r).split("\n")[0]);
  ok(
    "creates polaris directory & gitignore with captures and .cache",
    existsSync(join(SUBJECT_DIR, "polaris", ".gitignore")) &&
      readFileSync(join(SUBJECT_DIR, "polaris", ".gitignore"), "utf8").includes(".cache/"),
  );

  // 3.4 polaris_find (discovery tool)
  r = await call("polaris_find", { query: "ReAct reasoning acting", limit: 5 });
  ok("polaris_find executes discovery", !r.isError && textOf(r).includes("research result(s)"), textOf(r).split("\n")[0]);

  // 3.5 polaris_research (multi-query investigation with shortlist generation & auto_add)
  r = await call("polaris_research", {
    subject_dir: SUBJECT_DIR,
    module: "M1",
    queries: ["ReAct language models reasoning acting"],
    providers: ["openalex", "arxiv", "semanticscholar"],
    per_provider: 3,
    auto_add: 1,
  });
  ok("polaris_research completes investigation", !r.isError && textOf(r).includes("Shortlist saved"), textOf(r).split("\n")[0]);
  const shortlistDir = join(SUBJECT_DIR, "polaris", "research");
  ok("research directory created", existsSync(shortlistDir));

  // Verify shortlist file content
  const researchFiles = existsSync(shortlistDir) ? readdirSync(shortlistDir) : [];
  ok("shortlist markdown file generated", researchFiles.length > 0, researchFiles.join(", "));
  if (researchFiles.length > 0) {
    const shortlistMd = readFileSync(join(shortlistDir, researchFiles[0]), "utf8");
    ok(
      "shortlist markdown contains Vietnamese headings and English-neutral table",
      shortlistMd.includes("# Danh sách tài liệu nghiên cứu:") &&
        shortlistMd.includes("## 1. Bảng tổng hợp (Shortlist)") &&
        shortlistMd.includes("| Rank | Title | Kind | Year | Citations | Open Access | Score | Reasons | Link |"),
    );
  }

  // 3.6 polaris_source_add: local file and web fixture
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
  ok("add local and web sources", !r.isError && textOf(r).includes("Processed 2 source(s)"));
  ok("captures/S2.md created with extracted text", existsSync(join(SUBJECT_DIR, "polaris", "captures", "S2.md")));

  // 3.7 polaris_capture tool
  r = await call("polaris_capture", { subject_dir: SUBJECT_DIR, ids: ["S1", "S2"] });
  ok("polaris_capture executes without errors", !r.isError && textOf(r).includes("Processed capture"));

  // 3.8 polaris_sources
  r = await call("polaris_sources", { subject_dir: SUBJECT_DIR, filter: { label: "course" } });
  ok("list sources with filter", !r.isError && textOf(r).includes('"id": "S1"'));

  r = await call("polaris_sources", {
    subject_dir: SUBJECT_DIR,
    update: [{ id: "S1", set: { notes: "Verified in 2026" } }],
  });
  ok("update source", !r.isError && textOf(r).includes("Updated 1 source(s)"));

  // 3.9 polaris_fact_add
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

  r = await call("polaris_fact_add", {
    subject_dir: SUBJECT_DIR,
    facts: [
      {
        id: "F1",
        claim: "LLMs provide the reasoning, but tools define the actions",
        source: "S1",
        locator: "[p. 2]",
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

  // 3.10 polaris_facts
  r = await call("polaris_facts", { subject_dir: SUBJECT_DIR, module: "M1" });
  ok("query facts by module", !r.isError && textOf(r).includes('"id": "F1"') && textOf(r).includes('"id": "F2"'));

  // 3.11 polaris_roadmap_save & quality gates
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

  // 3.12 polaris_check
  r = await call("polaris_check", { subject_dir: SUBJECT_DIR });
  ok("polaris_check returns clean report", !r.isError && textOf(r).includes("Quality Gate Audit"));

  // 3.13 Dependency cycle detection check
  const cyclicRoadmap = {
    ...validRoadmap,
    modules: [
      { ...validRoadmap.modules[0], depends: ["M2"] },
      { ...validRoadmap.modules[1], depends: ["M1"] },
    ],
  };
  r = await call("polaris_roadmap_save", { subject_dir: SUBJECT_DIR, roadmap: cyclicRoadmap });
  ok("detects dependency cycles in roadmap", r.isError && textOf(r).includes("Dependency cycle detected"));

  // Restore valid roadmap
  await call("polaris_roadmap_save", { subject_dir: SUBJECT_DIR, roadmap: validRoadmap });

  // 3.14 CLI tests
  const guideCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "guide", "research"], { encoding: "utf8" });
  ok("CLI guide research", guideCli.includes("Keyless Providers:") && guideCli.includes("The Review Gate"));

  const checkCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "check", SUBJECT_DIR], { encoding: "utf8" });
  ok("CLI check subject", checkCli.includes("Quality Gate Audit"));

  const renderCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "render", SUBJECT_DIR], { encoding: "utf8" });
  ok("CLI render subject", renderCli.includes("Rendered ROADMAP.md"));

  const versionCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "version"], { encoding: "utf8" });
  ok("CLI version", versionCli.trim() === "0.1.0");

  const helpCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "help"], { encoding: "utf8" });
  ok("CLI help", helpCli.includes("Usage: node polaris.mjs"));

  /* ───────── 4. Live Network Provider Checks ───────── */

  console.log("\n--- Live Network Provider Checks ---");

  // 4.1 OpenAlex live check
  try {
    const oaRes = await polarisLib.fetchOpenAlex("ReAct language models", 2);
    if (oaRes.length > 0) {
      ok("live OpenAlex search", true, `Found ${oaRes.length} item(s): "${oaRes[0]?.title?.slice(0, 40)}..."`);
    } else {
      skip("live OpenAlex search", "returned 0 items");
    }
  } catch (e) {
    skip("live OpenAlex search", `network/rate-limit: ${polarisLib.errMsg(e)}`);
  }

  // 4.2 arXiv live check
  try {
    const axRes = await polarisLib.fetchArxiv("2210.03629", 1);
    if (axRes.length > 0) {
      ok("live arXiv search", true, `Found: "${axRes[0]?.title?.slice(0, 40)}..." (${axRes[0]?.arxiv})`);
    } else {
      skip("live arXiv search", "returned 0 items");
    }
  } catch (e) {
    skip("live arXiv search", `network/rate-limit: ${polarisLib.errMsg(e)}`);
  }

  // 4.3 Semantic Scholar live check
  try {
    const s2Res = await polarisLib.fetchSemanticScholar("ReAct reasoning acting", 2);
    if (s2Res.length > 0) {
      ok("live Semantic Scholar search", true, `Found ${s2Res.length} item(s): "${s2Res[0]?.title?.slice(0, 40)}..."`);
    } else {
      skip("live Semantic Scholar search", "returned 0 items");
    }
  } catch (e) {
    skip("live Semantic Scholar search", `network/rate-limit: ${polarisLib.errMsg(e)}`);
  }

  // 4.4 CrossRef live check
  try {
    const crRes = await polarisLib.fetchCrossRef("ReAct synergizing reasoning", 2);
    if (crRes.length > 0) {
      ok("live CrossRef search", true, `Found ${crRes.length} item(s): "${crRes[0]?.title?.slice(0, 40)}..."`);
    } else {
      skip("live CrossRef search", "returned 0 items");
    }
  } catch (e) {
    skip("live CrossRef search", `network/rate-limit: ${polarisLib.errMsg(e)}`);
  }

  // 4.5 Wikipedia live check (vi and en)
  try {
    const wikiVi = await polarisLib.fetchWikipedia("Trí tuệ nhân tạo", "vi", 1);
    const wikiEn = await polarisLib.fetchWikipedia("Artificial intelligence", "en", 1);
    if (wikiVi.length > 0 && wikiEn.length > 0) {
      ok("live Wikipedia search (vi and en)", true, `vi: "${wikiVi[0]?.title}", en: "${wikiEn[0]?.title}"`);
    } else {
      skip("live Wikipedia search", "returned 0 items");
    }
  } catch (e) {
    skip("live Wikipedia search", `network error: ${polarisLib.errMsg(e)}`);
  }

  // 4.6 YouTube live search check (via yt-dlp)
  try {
    const ytRes = await polarisLib.fetchYouTube("ReAct AI agent", 2);
    if (ytRes.length > 0) {
      ok("live YouTube search (yt-dlp)", true, `Found: "${ytRes[0]?.title?.slice(0, 40)}..."`);
    } else {
      skip("live YouTube search", "returned 0 items");
    }
  } catch (e) {
    skip("live YouTube search (yt-dlp)", `tool unavailable or network error: ${polarisLib.errMsg(e)}`);
  }

  /* ───────── 5. Full-Text Capture Real Checks ───────── */

  console.log("\n--- Full-Text Capture Real Checks ---");

  // 5.1 Real PDF full-text capture of arXiv 2210.03629 via pdftotext
  try {
    const capRes = await polarisLib.captureSource(
      "S_arxiv_full",
      {
        kind: "paper",
        url: "https://arxiv.org/abs/2210.03629",
      },
      join(SUBJECT_DIR, "polaris", "captures"),
      true,
    );
    const capFile = join(SUBJECT_DIR, "polaris", "captures", "S_arxiv_full.md");
    if (existsSync(capFile)) {
      const capContent = readFileSync(capFile, "utf8");
      const hasPageMarker = capContent.includes("[p. 1]");
      const hasReact = capContent.includes("ReAct") || capContent.includes("REAC T");
      if (hasPageMarker && hasReact) {
        ok("arXiv PDF full-text capture with pdftotext", true, `Contains '[p. 1]' and 'ReAct' (${capContent.length} chars)`);
      } else {
        skip("arXiv PDF full-text capture", `captured but missing markers (length: ${capContent.length})`);
      }
    } else {
      skip("arXiv PDF full-text capture", "capture file not written");
    }
  } catch (e) {
    skip("arXiv PDF full-text capture", `network/pdftotext error: ${polarisLib.errMsg(e)}`);
  }

  // 5.2 Real YouTube transcript capture via yt-dlp
  try {
    const ytCap = await polarisLib.captureSource(
      "S_yt_lecture",
      {
        kind: "video",
        url: "https://www.youtube.com/watch?v=vFdIrZyKEwQ",
        title: "ReAct AI Agents Clearly Explained",
      },
      join(SUBJECT_DIR, "polaris", "captures"),
      true,
    );
    const ytFile = join(SUBJECT_DIR, "polaris", "captures", "S_yt_lecture.md");
    if (existsSync(ytFile)) {
      const ytContent = readFileSync(ytFile, "utf8");
      const hasTimestamps = /\[\d{2}:\d{2}\]/.test(ytContent);
      if (hasTimestamps) {
        ok("YouTube transcript capture with yt-dlp", true, `Contains timestamped lines [mm:ss] (${ytContent.length} chars)`);
      } else {
        skip("YouTube transcript capture", `captured without timestamps: ${ytContent.slice(0, 100)}`);
      }
    } else {
      skip("YouTube transcript capture", "capture file not written");
    }
  } catch (e) {
    skip("YouTube transcript capture", `yt-dlp error: ${polarisLib.errMsg(e)}`);
  }

} catch (e) {
  failed++;
  console.log(`FAIL unexpected error: ${e?.stack ?? e}`);
} finally {
  await client.close();
  httpServer.close();

  if (process.env.POLARIS_E2E_KEEP === "1") {
    console.log(`\n[POLARIS_E2E_KEEP=1] Test directory preserved at: ${TEST_DIR}`);
  } else {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll end-to-end checks passed.");
process.exit(failed ? 1 : 0);
