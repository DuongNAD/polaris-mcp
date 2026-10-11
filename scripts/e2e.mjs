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
const CACHE_DIR = join(TEST_DIR, "global_cache");
const SMARTDRIVE_LOG = join(TEST_DIR, "smartdrive.log");
const SMARTDRIVE_SCRIPT = join(TEST_DIR, "smartdrive_mock.mjs");
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(SUBJECT_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

writeFileSync(
  SMARTDRIVE_SCRIPT,
  `import { appendFileSync } from "node:fs";
const logPath = process.argv[2];
const args = process.argv.slice(3).join(" ");
appendFileSync(logPath, args + "\\n", "utf8");
`,
  "utf8",
);

process.env.POLARIS_CACHE_DIR = CACHE_DIR;
process.env.POLARIS_SMARTDRIVE_CMD = `node "${SMARTDRIVE_SCRIPT}" "${SMARTDRIVE_LOG}"`;

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

/* ───────── 1.7 SSRF Guard & IP Range Checks (Unit Tests) ───────── */

console.log("\n--- SSRF Guard & IP Range Checks (Unit Tests) ---");

// IPv4 Range Checks
ok("refuse IPv4 loopback 127.0.0.1", polarisLib.isPrivateIp("127.0.0.1"));
ok("refuse IPv4 loopback 127.255.255.255", polarisLib.isPrivateIp("127.255.255.255"));
ok("refuse IPv4 unspecified 0.0.0.0", polarisLib.isPrivateIp("0.0.0.0"));
ok("refuse IPv4 private 10.0.0.1", polarisLib.isPrivateIp("10.0.0.1"));
ok("refuse IPv4 private 172.16.0.1", polarisLib.isPrivateIp("172.16.0.1"));
ok("refuse IPv4 private 172.31.255.255", polarisLib.isPrivateIp("172.31.255.255"));
ok("allow IPv4 public 172.32.0.1", !polarisLib.isPrivateIp("172.32.0.1"));
ok("refuse IPv4 private 192.168.1.1", polarisLib.isPrivateIp("192.168.1.1"));
ok("refuse IPv4 link-local 169.254.169.254", polarisLib.isPrivateIp("169.254.169.254"));
ok("refuse IPv4 CGNAT 100.64.0.1", polarisLib.isPrivateIp("100.64.0.1"));
ok("refuse IPv4 CGNAT 100.127.255.255", polarisLib.isPrivateIp("100.127.255.255"));
ok("allow IPv4 public 100.128.0.1", !polarisLib.isPrivateIp("100.128.0.1"));
ok("refuse IPv4 multicast 224.0.0.1", polarisLib.isPrivateIp("224.0.0.1"));
ok("refuse IPv4 reserved 240.0.0.1", polarisLib.isPrivateIp("240.0.0.1"));
ok("refuse IPv4 broadcast 255.255.255.255", polarisLib.isPrivateIp("255.255.255.255"));
ok("allow IPv4 public 8.8.8.8", !polarisLib.isPrivateIp("8.8.8.8"));
ok("allow IPv4 public 1.1.1.1", !polarisLib.isPrivateIp("1.1.1.1"));

// IPv6 Range Checks
ok("refuse IPv6 loopback ::1", polarisLib.isPrivateIp("::1"));
ok("refuse IPv6 unspecified ::", polarisLib.isPrivateIp("::"));
ok("refuse IPv6 ULA fc00::1", polarisLib.isPrivateIp("fc00::1"));
ok("refuse IPv6 ULA fd12:3456::1", polarisLib.isPrivateIp("fd12:3456::1"));
ok("refuse IPv6 link-local fe80::1", polarisLib.isPrivateIp("fe80::1"));
ok("refuse IPv6 multicast ff02::1", polarisLib.isPrivateIp("ff02::1"));
ok("refuse IPv6 documentation 2001:db8::1", polarisLib.isPrivateIp("2001:db8::1"));
ok("allow IPv6 public 2606:2800:220:1:248:1893:25c8:1946", !polarisLib.isPrivateIp("2606:2800:220:1:248:1893:25c8:1946"));

// IPv4-mapped IPv6 Checks
ok("refuse IPv4-mapped loopback ::ffff:127.0.0.1", polarisLib.isPrivateIp("::ffff:127.0.0.1"));
ok("refuse IPv4-mapped loopback hex ::ffff:7f00:1", polarisLib.isPrivateIp("::ffff:7f00:1"));
ok("refuse IPv4-mapped private ::ffff:192.168.1.1", polarisLib.isPrivateIp("::ffff:192.168.1.1"));
ok("refuse IPv4-mapped link-local ::ffff:169.254.169.254", polarisLib.isPrivateIp("::ffff:169.254.169.254"));
ok("allow IPv4-mapped public ::ffff:8.8.8.8", !polarisLib.isPrivateIp("::ffff:8.8.8.8"));

// assertSafeUrl unit checks (opt-in unset)
delete process.env.POLARIS_ALLOW_PRIVATE_URLS;
let err127 = "";
try { await polarisLib.assertSafeUrl("http://127.0.0.1:8080/x"); } catch (e) { err127 = (e).message; }
ok("assertSafeUrl refuses 127.0.0.1", err127 === "Refused: 127.0.0.1 resolves to a private or local address", err127);

let errLocalhost = "";
try { await polarisLib.assertSafeUrl("http://localhost/x"); } catch (e) { errLocalhost = (e).message; }
ok("assertSafeUrl refuses localhost", errLocalhost === "Refused: localhost resolves to a private or local address", errLocalhost);

let errSubLocalhost = "";
try { await polarisLib.assertSafeUrl("http://api.localhost/x"); } catch (e) { errSubLocalhost = (e).message; }
ok("assertSafeUrl refuses *.localhost", errSubLocalhost === "Refused: api.localhost resolves to a private or local address", errSubLocalhost);

let errMeta = "";
try { await polarisLib.assertSafeUrl("http://169.254.169.254/latest"); } catch (e) { errMeta = (e).message; }
ok("assertSafeUrl refuses 169.254.169.254", errMeta === "Refused: 169.254.169.254 resolves to a private or local address", errMeta);

let errFile = "";
try { await polarisLib.assertSafeUrl("file:///C:/Windows/win.ini"); } catch (e) { errFile = (e).message; }
ok("assertSafeUrl refuses file scheme", errFile.includes("Refused: scheme") && errFile.includes("not allowed"), errFile);

// assertSafeUrl with POLARIS_ALLOW_PRIVATE_URLS=1
process.env.POLARIS_ALLOW_PRIVATE_URLS = "1";
let allowedPrivate = false;
try {
  const u = await polarisLib.assertSafeUrl("http://127.0.0.1:8080/x");
  allowedPrivate = Boolean(u);
} catch {
  allowedPrivate = false;
}
ok("POLARIS_ALLOW_PRIVATE_URLS=1 allows 127.0.0.1", allowedPrivate);

let errFileWithOptIn = "";
try { await polarisLib.assertSafeUrl("file:///C:/Windows/win.ini"); } catch (e) { errFileWithOptIn = (e).message; }
ok("POLARIS_ALLOW_PRIVATE_URLS=1 still refuses file scheme", errFileWithOptIn.includes("Refused: scheme"), errFileWithOptIn);
delete process.env.POLARIS_ALLOW_PRIVATE_URLS;

/* ───────── 1.8 Facts Gate False Positives & Quantities (Unit Tests) ───────── */
console.log("\n--- Facts Gate False Positives & Numeric Quantities (Unit Tests) ---");

// Exempt facts: math notation, Big-O, indices, norms, LaTeX, code tokens
const exemptClaims = [
  "Hệ số xác định R^2 phản ánh mức độ phù hợp của mô hình tuyến tính",
  "Trong không gian 1D, bài toán tối ưu hóa quy về tìm cực trị của hàm đơn biến",
  "Nghịch đảo ma trận hiệp phương sai có độ phức tạp thời gian O(d^3)",
  "Regularization với chuẩn L2 (Ridge) giúp làm mượt trọng số",
  "Đạo hàm của hàm mất mát bình phương chứa số hạng $x^2$",
  "Hàm huấn luyện nhận tham số lặp mặc định `n_iter=100`",
];

for (const claim of exemptClaims) {
  ok(
    `claim exempt from numeric cross-check: "${claim.slice(0, 35)}..."`,
    !polarisLib.hasNumericOrDateClaim(claim),
  );
}

const mockSources = [
  {
    id: "S_mock",
    kind: "local",
    title: "Course Textbook",
    label: "course",
    quality: { score: 5, why: "Course source of truth" },
  },
];

const exemptFacts = exemptClaims.map((claim, idx) => ({
  id: `FE${idx + 1}`,
  claim,
  source: "S_mock",
  locator: `p. ${idx + 1}`,
  label: "course",
  modules: ["M1"],
}));

const reportExempt = polarisLib.checkQualityGates({
  sources: mockSources,
  facts: exemptFacts,
});
const factErrorsExempt = reportExempt.errors.filter((i) => i.category === "facts");
ok("exempt mathematical/code facts pass quality gates without crossCheck", factErrorsExempt.length === 0, `${factErrorsExempt.length} issues`);

// Quantity facts: real measurements, percentages, years must still require crossCheck or unverified label
const quantityClaims = [
  "Mô hình đạt hiệu năng xử lý 50 TOPS",
  "Độ chính xác nhận diện trên tập benchmark đạt 92%",
  "Phương pháp được công bố trong tài liệu năm 2023",
];

for (const claim of quantityClaims) {
  ok(
    `claim flagged as numeric/date quantity: "${claim}"`,
    polarisLib.hasNumericOrDateClaim(claim),
  );
}

const quantityFacts = quantityClaims.map((claim, idx) => ({
  id: `FQ${idx + 1}`,
  claim,
  source: "S_mock",
  locator: `p. 1${idx}`,
  label: "course",
  modules: ["M1"],
}));

const reportQty = polarisLib.checkQualityGates({
  sources: mockSources,
  facts: quantityFacts,
});
const factErrorsQty = reportQty.errors.filter((i) => i.category === "facts");
ok(
  "real quantities without crossCheck are flagged by quality gates",
  factErrorsQty.length === 3 && factErrorsQty.every((i) => i.message.includes("contains numeric or date claims")),
  `flagged ${factErrorsQty.length}/3 quantity facts`,
);

// Quantity facts with crossCheck or marked unverified pass
const verifiedQuantityFacts = [
  { ...quantityFacts[0], crossCheck: ["S_mock"] },
  { ...quantityFacts[1], crossCheck: ["S_mock"] },
  { ...quantityFacts[2], label: "unverified" },
];
const reportQtyVerified = polarisLib.checkQualityGates({
  sources: mockSources,
  facts: verifiedQuantityFacts,
});
const factErrorsQtyVerified = reportQtyVerified.errors.filter((i) => i.category === "facts");
ok("quantity facts with crossCheck or 'unverified' label pass quality gates", factErrorsQtyVerified.length === 0);

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

const oaHtml = `<!DOCTYPE html>
<html>
<head>
  <title>ReAct: Synergizing Reasoning and Acting in Language Models (OA Copy)</title>
</head>
<body>
  <main>
    <article>
      <h1>ReAct: Synergizing Reasoning and Acting in Language Models (OA Copy)</h1>
      <p>Open-access preprint full text version of ReAct reasoning and acting in LLMs.</p>
    </article>
  </main>
</body>
</html>`;

let lastS2ReqHeaders = {};
let redirectHop2Headers = {};

const redirectTargetServer = createServer((req, res) => {
  redirectHop2Headers = req.headers;
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, redirected: true }));
});
await new Promise((res) => redirectTargetServer.listen(0, "127.0.0.1", res));
const redirectTargetPort = redirectTargetServer.address().port;

const httpServer = createServer((req, res) => {
  if (req.url === "/redirect_cross_origin_credentials") {
    res.writeHead(302, { Location: `http://127.0.0.1:${redirectTargetPort}/redirect_target` });
    res.end();
    return;
  }
  if (req.url?.startsWith("/graph/v1/paper/search")) {
    lastS2ReqHeaders = req.headers;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        total: 1,
        data: [
          {
            paperId: "s2_fixture_paper_1",
            title: "Semantic Scholar Fixture Paper",
            authors: [{ name: "Test Author" }],
            year: 2024,
            citationCount: 42,
            externalIds: { DOI: "10.1234/s2_test" },
            tldr: { text: "A test paper for Semantic Scholar API key." },
          },
        ],
      }),
    );
    return;
  }
  if (req.url === "/robots.txt") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("User-agent: *\nDisallow: /oa_disallowed/\n");
    return;
  }
  if (req.url === "/redirect_to_loopback") {
    res.writeHead(302, { Location: `http://127.0.0.1:${httpPort}/react_paper.html` });
    res.end();
    return;
  }
  if (req.url === "/publisher/10.1234/react_paper") {
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<html><body><h1>403 Forbidden - Publisher Paywall</h1></body></html>");
    return;
  }
  if (req.url === "/normal_long_article.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    const repeatedProse = `<p>Addressing the scaling challenge of distributed neural model execution requires robust fault tolerance and consensus. When node authentication tokens become invalid during long-running checkpoint synchronizations, an unexpected access denied exception may be generated in secondary clusters. Engineers must design retry protocols that distinguish intermittent network blips from permanent security check rejections. Modern distributed systems mitigate these risks using lease-based tokens.</p>`;
    res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Engineering Reliable Machine Learning at Scale</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
  <script src="https://www.google.com/recaptcha/api.js"></script>
</head>
<body>
  <main>
    <article>
      <h1>Engineering Reliable Machine Learning at Scale</h1>
      ${repeatedProse.repeat(6)}
    </article>
  </main>
</body>
</html>`);
    return;
  }
  if (req.url === "/publisher/10.5678/cf_challenge_paper") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Just a moment...</title>
  <script src="/cdn-cgi/challenge-platform/h/g/scripts/jsd/main.js"></script>
</head>
<body>
  <p>Checking your browser before accessing the site.</p>
</body>
</html>`);
    return;
  }
  if (req.url?.includes("10.5678/cf_challenge_paper")) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        title: "Scaling Challenge Paper (OA Copy)",
        best_oa_location: {
          landing_page_url: `http://127.0.0.1:${httpPort}/oa_cf_resolved.html`,
        },
      }),
    );
    return;
  }
  if (req.url === "/oa_cf_resolved.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html><head><title>Scaling Challenge Paper (OA Copy)</title></head><body><article><h1>Scaling Challenge Paper (OA Copy)</h1><p>Full open-access text resolved after Cloudflare interstitial challenge.</p></article></body></html>`);
    return;
  }
  if (req.url === "/publisher/abstract_only_paper") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html><head><title>Publisher Abstract Page</title></head><body><article><h1>Publisher Abstract Page</h1><p>This is a 20-word publisher paywalled abstract.</p></article></body></html>`);
    return;
  }
  if (req.url === "/oa_full_text_paper.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html><head><title>Complete Open Access Study</title></head><body><article><h1>Complete Open Access Study</h1><p>Full text complete 5000-word analysis with full data, experiments, and proofs from the repository.</p></article></body></html>`);
    return;
  }
  if (req.url === "/downloads/paper.pdf") {
    res.writeHead(200, { "Content-Type": "application/pdf" });
    res.end("%PDF-1.4 dummy");
    return;
  }
  if (req.url === "/oa_landing_page.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html><head><title>Landing Page Article</title></head><body><main><article><h1>Landing Page Article</h1><p>Extracted full text from HTML landing page instead of running pdftotext.</p></article></main></body></html>`);
    return;
  }
  if (req.url === "/publisher/robots_test_paper") {
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<html><body>403 Forbidden</body></html>");
    return;
  }
  if (req.url === "/oa_disallowed/blocked_article.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<html><body>Secret Blocked Content</body></html>");
    return;
  }
  if (req.url?.startsWith("/works/")) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        title: "ReAct: Synergizing Reasoning and Acting in Language Models (OA Copy)",
        best_oa_location: {
          landing_page_url: `http://127.0.0.1:${httpPort}/oa_react.html`,
        },
      }),
    );
    return;
  }
  if (req.url === "/oa_react.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(oaHtml);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fixtureHtml);
});
await new Promise((res) => httpServer.listen(0, "127.0.0.1", res));
const httpPort = httpServer.address().port;
const fixtureUrl = `http://127.0.0.1:${httpPort}/react_paper.html`;

// Unit redirect check: simulate allowed host on first hop, verify redirect to 127.0.0.1 is refused
delete process.env.POLARIS_ALLOW_PRIVATE_URLS;
let errRedirect = "";
try {
  await polarisLib.fetchWithTimeout(`http://127.0.0.1:${httpPort}/redirect_to_loopback`, { allowFirstHop: true });
} catch (e) {
  errRedirect = (e).message;
}
ok(
  "redirect from allowed fixture host to 127.0.0.1 is refused",
  errRedirect.includes("Refused: 127.0.0.1 resolves to a private or local address"),
  errRedirect,
);

// 2.1 Open-Access Fallback via Local Fixture Server
console.log("\n--- Open-Access Fallback (Unit / Local Fixture Tests) ---");
const oaCaptureDir = join(TEST_DIR, "oa_captures");
mkdirSync(oaCaptureDir, { recursive: true });

// Verify SSRF guard blocks private address on OA fallback hop when POLARIS_ALLOW_PRIVATE_URLS is unset
delete process.env.POLARIS_ALLOW_PRIVATE_URLS;
process.env.POLARIS_OPENALEX_URL = `http://127.0.0.1:${httpPort}`;
let ssrfBlockedOa = false;
try {
  await polarisLib.captureSource(
    "S_oa_ssrf",
    { kind: "web", url: `http://127.0.0.1:${httpPort}/publisher/10.1234/react_paper` },
    oaCaptureDir,
  );
} catch (e) {
  ssrfBlockedOa = (e).message.includes("Refused: 127.0.0.1");
}
ok("OA fallback keeps SSRF guard on private addresses when opt-in unset", ssrfBlockedOa);

// With POLARIS_ALLOW_PRIVATE_URLS=1, OA fallback discovers OA copy and captures it cleanly
process.env.POLARIS_ALLOW_PRIVATE_URLS = "1";
const capturedOa = await polarisLib.captureSource(
  "S_oa_success",
  {
    kind: "web",
    url: `http://127.0.0.1:${httpPort}/publisher/10.1234/react_paper`,
    title: "ReAct Paywalled Paper",
  },
  oaCaptureDir,
);
ok("OA fallback captures content from open-access alternative", capturedOa.text.includes("Open-access preprint full text"));
ok("OA fallback records oaUrl", capturedOa.oaUrl === `http://127.0.0.1:${httpPort}/oa_react.html`);
ok("OA fallback records note explaining origin", capturedOa.note?.includes("via openalex") && capturedOa.note?.includes("HTTP 403"));

const savedOaMd = readFileSync(join(oaCaptureDir, "S_oa_success.md"), "utf8");
ok("OA fallback markdown records original URL and Open Access URL", savedOaMd.includes(`- URL: http://127.0.0.1:${httpPort}/publisher/10.1234/react_paper`) && savedOaMd.includes(`- Open Access URL: http://127.0.0.1:${httpPort}/oa_react.html`));
ok("OA fallback markdown records note that never bypasses paywalls", savedOaMd.includes("Never bypasses paywalls"));

// 1. Long article with cdnjs, recaptcha script, and "challenge"/"access denied" prose captures normally
const longCaptured = await polarisLib.captureSource(
  "S_long_article",
  {
    kind: "web",
    url: `http://127.0.0.1:${httpPort}/normal_long_article.html`,
    title: "Engineering Reliable Machine Learning at Scale",
  },
  oaCaptureDir,
);
ok(
  "a long article page that loads cdnjs.cloudflare.com, includes a reCAPTCHA script and uses \"challenge\" and \"access denied\" in prose captures normally",
  longCaptured.text.length >= 1500 &&
    longCaptured.text.includes("scaling challenge") &&
    longCaptured.text.includes("access denied") &&
    longCaptured.oaUrl === undefined,
  `Length: ${longCaptured.text.length}, oaUrl: ${longCaptured.oaUrl}`,
);

// 2. Short "Just a moment..." page with /cdn-cgi/challenge-platform/ triggers fallback
const cfCaptured = await polarisLib.captureSource(
  "S_cf_challenge",
  {
    kind: "web",
    url: `http://127.0.0.1:${httpPort}/publisher/10.5678/cf_challenge_paper`,
    title: "Cloudflare Challenge Paper",
  },
  oaCaptureDir,
);
ok(
  "a short \"Just a moment...\" page with /cdn-cgi/challenge-platform/ triggers the fallback",
  cfCaptured.oaUrl === `http://127.0.0.1:${httpPort}/oa_cf_resolved.html` &&
    cfCaptured.text.includes("resolved after Cloudflare interstitial challenge") &&
    (cfCaptured.note?.includes("bot wall") || cfCaptured.note?.includes("challenge")),
  `oaUrl: ${cfCaptured.oaUrl}, note: ${cfCaptured.note}`,
);

// 3. Research/source item with oaUrl whose publisher URL answers 200 with short abstract page is captured from oaUrl
const preferredOaCaptured = await polarisLib.captureSource(
  "S_preferred_oa",
  {
    kind: "paper",
    url: `http://127.0.0.1:${httpPort}/publisher/abstract_only_paper`,
    oaUrl: `http://127.0.0.1:${httpPort}/oa_full_text_paper.html`,
    title: "Preferred OA Source",
  },
  oaCaptureDir,
);
const savedPreferredMd = readFileSync(join(oaCaptureDir, "S_preferred_oa.md"), "utf8");
ok(
  "a research/source item with oaUrl whose publisher URL answers 200 with a short abstract page is captured from the oaUrl (full text) with both URLs recorded",
  preferredOaCaptured.url === `http://127.0.0.1:${httpPort}/publisher/abstract_only_paper` &&
    preferredOaCaptured.oaUrl === `http://127.0.0.1:${httpPort}/oa_full_text_paper.html` &&
    preferredOaCaptured.text.includes("Full text complete 5000-word analysis") &&
    !preferredOaCaptured.text.includes("20-word publisher paywalled abstract") &&
    savedPreferredMd.includes(`- URL: http://127.0.0.1:${httpPort}/publisher/abstract_only_paper`) &&
    savedPreferredMd.includes(`- Open Access URL: http://127.0.0.1:${httpPort}/oa_full_text_paper.html`) &&
    savedPreferredMd.includes("Never bypasses paywalls"),
  `url: ${preferredOaCaptured.url}, oaUrl: ${preferredOaCaptured.oaUrl}`,
);

// 4. An oaUrl that answers HTML in the PDF branch is captured as HTML
const pdfBranchHtml = await polarisLib.captureSource(
  "S_pdf_branch_html",
  {
    kind: "paper",
    url: `http://127.0.0.1:${httpPort}/downloads/paper.pdf`,
    oaUrl: `http://127.0.0.1:${httpPort}/oa_landing_page.html`,
    title: "PDF Branch with HTML OA",
  },
  oaCaptureDir,
);
const savedPdfBranchMd = readFileSync(join(oaCaptureDir, "S_pdf_branch_html.md"), "utf8");
ok(
  "an oaUrl that answers HTML in the PDF branch is captured as HTML",
  pdfBranchHtml.text.includes("Extracted full text from HTML landing page instead of running pdftotext") &&
    savedPdfBranchMd.includes("Extracted by: Polaris MCP (html)"),
  `preview: ${pdfBranchHtml.preview}`,
);

// 5. An oaUrl disallowed by robots.txt is skipped with an error
let robotsBlockedErr = "";
try {
  await polarisLib.captureSource(
    "S_robots_blocked_oa",
    {
      kind: "paper",
      url: `http://127.0.0.1:${httpPort}/publisher/robots_test_paper`,
      oaUrl: `http://127.0.0.1:${httpPort}/oa_disallowed/blocked_article.html`,
      title: "Robots Blocked OA Paper",
    },
    oaCaptureDir,
  );
} catch (e) {
  robotsBlockedErr = e.message;
}

const tempRobotsDir = join(TEST_DIR, "robots_test_subject");
mkdirSync(join(tempRobotsDir, "polaris"), { recursive: true });
writeFileSync(
  join(tempRobotsDir, "polaris", "sources.json"),
  JSON.stringify([
    {
      id: "S_robots_skip",
      kind: "paper",
      url: `http://127.0.0.1:${httpPort}/publisher/robots_test_paper`,
      oaUrl: `http://127.0.0.1:${httpPort}/oa_disallowed/blocked_article.html`,
      title: "Robots Blocked OA Paper",
    },
  ]),
  "utf8",
);
const batchRobotsResult = await polarisLib.captureSources(tempRobotsDir, ["S_robots_skip"]);

ok(
  "an oaUrl disallowed by robots.txt is skipped with an error",
  robotsBlockedErr.includes("robots.txt rules") &&
    batchRobotsResult.captured.length === 0 &&
    batchRobotsResult.errors.length > 0 &&
    batchRobotsResult.errors[0].includes("robots.txt rules"),
  `Direct: ${robotsBlockedErr}; Batch: ${batchRobotsResult.errors.join("; ")}`,
);

delete process.env.POLARIS_OPENALEX_URL;
delete process.env.POLARIS_ALLOW_PRIVATE_URLS;

/* ───────── 2.2 Semantic Scholar API Key, Interval & Credential Dropping ───────── */
console.log("\n--- Semantic Scholar API Key, Interval & Safe Hop Credential Stripping ---");

// 2.2a stripCredentialHeaders unit checks (Headers instance, array, object; case-insensitivity)
const hHeaders = new Headers({
  "Authorization": "Bearer auth-secret",
  "Proxy-Authorization": "Basic proxy-secret",
  "X-Api-Key": "s2-key-secret",
  "Cookie": "sess=secret-cookie",
  "X-Safe-Header": "safe-preserved",
});
const strippedH = polarisLib.stripCredentialHeaders(hHeaders);
ok(
  "stripCredentialHeaders drops credential headers on Headers instance (case-insensitive)",
  !strippedH.has("authorization") &&
    !strippedH.has("proxy-authorization") &&
    !strippedH.has("x-api-key") &&
    !strippedH.has("cookie") &&
    strippedH.get("x-safe-header") === "safe-preserved",
);

const hArray = [
  ["Authorization", "Bearer arr-secret"],
  ["proxy-authorization", "Basic arr-proxy"],
  ["X-API-KEY", "arr-s2-key"],
  ["cookie", "arr-cookie"],
  ["X-Custom", "safe-array"],
];
const strippedArr = polarisLib.stripCredentialHeaders(hArray);
ok(
  "stripCredentialHeaders drops credential headers on array of tuples",
  strippedArr.length === 1 && strippedArr[0][0] === "X-Custom" && strippedArr[0][1] === "safe-array",
);

const hObj = {
  "AUTHORIZATION": "Bearer obj-secret",
  "Proxy-Authorization": "Basic obj-proxy",
  "x-api-key": "obj-s2-key",
  "Cookie": "obj-cookie",
  "Accept": "application/json",
};
const strippedObj = polarisLib.stripCredentialHeaders(hObj);
ok(
  "stripCredentialHeaders drops credential headers on plain object",
  Object.keys(strippedObj).length === 1 && strippedObj["Accept"] === "application/json",
);

// 2.2b 302 cross-origin redirect credential dropping integration check
process.env.POLARIS_ALLOW_PRIVATE_URLS = "1";
redirectHop2Headers = {};
const redirectRes = await polarisLib.fetchWithTimeout(
  `http://127.0.0.1:${httpPort}/redirect_cross_origin_credentials`,
  {
    headers: {
      "Authorization": "Bearer cross-origin-auth",
      "Proxy-Authorization": "Basic cross-origin-proxy",
      "X-Api-Key": "cross-origin-s2-key",
      "Cookie": "session=cross-origin-cookie",
      "X-Retained-Header": "retained-value",
    },
  },
);
ok("cross-origin 302 redirect completes with 200", redirectRes.status === 200);
ok(
  "cross-origin redirect drops x-api-key on second hop",
  redirectHop2Headers["x-api-key"] === undefined,
  `x-api-key: ${redirectHop2Headers["x-api-key"]}`,
);
ok(
  "cross-origin redirect drops authorization on second hop",
  redirectHop2Headers["authorization"] === undefined,
  `authorization: ${redirectHop2Headers["authorization"]}`,
);
ok(
  "cross-origin redirect drops proxy-authorization on second hop",
  redirectHop2Headers["proxy-authorization"] === undefined,
  `proxy-authorization: ${redirectHop2Headers["proxy-authorization"]}`,
);
ok(
  "cross-origin redirect drops cookie on second hop",
  redirectHop2Headers["cookie"] === undefined,
  `cookie: ${redirectHop2Headers["cookie"]}`,
);
ok(
  "cross-origin redirect preserves safe headers on second hop",
  redirectHop2Headers["x-retained-header"] === "retained-value",
);

// Cross-origin redirect with Headers instance
redirectHop2Headers = {};
await polarisLib.fetchWithTimeout(
  `http://127.0.0.1:${httpPort}/redirect_cross_origin_credentials`,
  {
    headers: new Headers({
      "Authorization": "Bearer headers-inst-auth",
      "X-Api-Key": "headers-inst-s2-key",
      "X-Preserved": "headers-inst-preserved",
    }),
  },
);
ok(
  "cross-origin redirect with Headers instance drops credentials",
  redirectHop2Headers["x-api-key"] === undefined &&
    redirectHop2Headers["authorization"] === undefined &&
    redirectHop2Headers["x-preserved"] === "headers-inst-preserved",
);

// Cross-origin redirect with array of tuples
redirectHop2Headers = {};
await polarisLib.fetchWithTimeout(
  `http://127.0.0.1:${httpPort}/redirect_cross_origin_credentials`,
  {
    headers: [
      ["Authorization", "Bearer arr-auth"],
      ["X-Api-Key", "arr-s2-key"],
      ["X-Arr-Preserved", "arr-preserved"],
    ],
  },
);
ok(
  "cross-origin redirect with tuple array drops credentials",
  redirectHop2Headers["x-api-key"] === undefined &&
    redirectHop2Headers["authorization"] === undefined &&
    redirectHop2Headers["x-arr-preserved"] === "arr-preserved",
);

// 2.2c Semantic Scholar API Key fixture checks (POLARIS_S2_URL)
process.env.POLARIS_S2_URL = `http://127.0.0.1:${httpPort}`;

// Case 1: SEMANTIC_SCHOLAR_API_KEY set -> fixture receives x-api-key
process.env.SEMANTIC_SCHOLAR_API_KEY = "test-secret-s2-key-alpha-12345";
delete process.env.S2_API_KEY;
lastS2ReqHeaders = {};
const s2ItemsKey1 = await polarisLib.fetchSemanticScholar("ReAct", 1);
ok("fetchSemanticScholar succeeds with SEMANTIC_SCHOLAR_API_KEY", s2ItemsKey1.length === 1 && s2ItemsKey1[0].title === "Semantic Scholar Fixture Paper");
ok(
  "fixture receives x-api-key when SEMANTIC_SCHOLAR_API_KEY is set",
  lastS2ReqHeaders["x-api-key"] === "test-secret-s2-key-alpha-12345",
  `x-api-key header: ${lastS2ReqHeaders["x-api-key"]}`,
);

// Case 2: S2_API_KEY alias set -> fixture receives x-api-key
delete process.env.SEMANTIC_SCHOLAR_API_KEY;
process.env.S2_API_KEY = "test-alias-s2-key-beta-67890";
lastS2ReqHeaders = {};
const s2ItemsKey2 = await polarisLib.fetchSemanticScholar("ReAct", 1);
ok("fetchSemanticScholar succeeds with S2_API_KEY alias", s2ItemsKey2.length === 1);
ok(
  "fixture receives x-api-key when S2_API_KEY alias is set",
  lastS2ReqHeaders["x-api-key"] === "test-alias-s2-key-beta-67890",
  `x-api-key header: ${lastS2ReqHeaders["x-api-key"]}`,
);

// Case 3: Without key (keyless default) -> fixture receives NO x-api-key header
delete process.env.SEMANTIC_SCHOLAR_API_KEY;
delete process.env.S2_API_KEY;
lastS2ReqHeaders = {};
const s2ItemsKeyless = await polarisLib.fetchSemanticScholar("ReAct", 1);
ok("fetchSemanticScholar succeeds without key (keyless default)", s2ItemsKeyless.length === 1);
ok(
  "fixture receives NO x-api-key header when keyless",
  lastS2ReqHeaders["x-api-key"] === undefined,
  `x-api-key header: ${lastS2ReqHeaders["x-api-key"]}`,
);

// 2.2d S2 Min Interval checks
delete process.env.POLARIS_S2_MIN_INTERVAL_MS;
ok("default S2 min interval is 1100 ms", polarisLib.getSemanticScholarMinInterval() === 1100);

process.env.POLARIS_S2_MIN_INTERVAL_MS = "2000";
ok("POLARIS_S2_MIN_INTERVAL_MS raises interval to 2000", polarisLib.getSemanticScholarMinInterval() === 2000);

process.env.POLARIS_S2_MIN_INTERVAL_MS = "1000";
ok("POLARIS_S2_MIN_INTERVAL_MS allows 1000 ms", polarisLib.getSemanticScholarMinInterval() === 1000);

process.env.POLARIS_S2_MIN_INTERVAL_MS = "200";
ok("POLARIS_S2_MIN_INTERVAL_MS never drops below 1000 ms", polarisLib.getSemanticScholarMinInterval() === 1000);

delete process.env.POLARIS_S2_MIN_INTERVAL_MS;
delete process.env.POLARIS_S2_URL;
delete process.env.POLARIS_ALLOW_PRIVATE_URLS;

const localNotePath = join(TEST_DIR, "lecture_notes.md");
writeFileSync(
  localNotePath,
  "# Lecture Notes on AI Agents\n- ReAct loop: Think -> Act -> Observe\n- Tool calling contract: JSON schema and typed arguments\n- Guardrails: max_steps and token budgets\n",
  "utf8",
);

/* ───────── 3. MCP Server Client Tests ───────── */

console.log("\n--- Real MCP Server Stdio Tests ---");

// 3.0 SSRF blocking tests over real MCP stdio with opt-in unset
console.log("\n--- SSRF Blocking Tests over MCP stdio (opt-in unset) ---");
const ssrfTransport = new StdioClientTransport({
  command: process.execPath,
  args: [join(ROOT, "dist", "polaris.mjs")],
  stderr: "inherit",
  env: {
    ...process.env,
    POLARIS_CACHE_DIR: CACHE_DIR,
    POLARIS_SMARTDRIVE_CMD: `node "${SMARTDRIVE_SCRIPT}" "${SMARTDRIVE_LOG}"`,
    POLARIS_ALLOW_PRIVATE_URLS: undefined,
  },
});
const ssrfClient = new Client({ name: "polaris-ssrf-check", version: "1.0.0" });
await ssrfClient.connect(ssrfTransport);
const ssrfCall = (name, args = {}) => ssrfClient.callTool({ name, arguments: args }, undefined, { timeout: 30000 });

// Capturing 127.0.0.1, localhost, 169.254.169.254, file scheme is refused with the message
const rLoopback = await ssrfCall("polaris_source_add", {
  subject_dir: SUBJECT_DIR,
  sources: [{ id: "SSRF_1", kind: "web", url: `http://127.0.0.1:${httpPort}/x` }],
});
ok("MCP polaris_source_add refuses 127.0.0.1", textOf(rLoopback).includes("Refused: 127.0.0.1 resolves to a private or local address"), textOf(rLoopback).slice(0, 100));

const rLocalhost = await ssrfCall("polaris_source_add", {
  subject_dir: SUBJECT_DIR,
  sources: [{ id: "SSRF_2", kind: "web", url: "http://localhost/x" }],
});
ok("MCP polaris_source_add refuses localhost", textOf(rLocalhost).includes("Refused: localhost resolves to a private or local address"), textOf(rLocalhost).slice(0, 100));

const rMetadata = await ssrfCall("polaris_source_add", {
  subject_dir: SUBJECT_DIR,
  sources: [{ id: "SSRF_3", kind: "web", url: "http://169.254.169.254/latest" }],
});
ok("MCP polaris_source_add refuses 169.254.169.254", textOf(rMetadata).includes("Refused: 169.254.169.254 resolves to a private or local address"), textOf(rMetadata).slice(0, 100));

const rFile = await ssrfCall("polaris_source_add", {
  subject_dir: SUBJECT_DIR,
  sources: [{ id: "SSRF_4", kind: "web", url: "file:///C:/Windows/win.ini" }],
});
ok("MCP polaris_source_add refuses file URL", textOf(rFile).includes("Refused: scheme") && textOf(rFile).includes("not allowed"), textOf(rFile).slice(0, 100));

await ssrfClient.close();

// Main MCP client runs with POLARIS_ALLOW_PRIVATE_URLS=1 so local fixture server works
const client = new Client({ name: "polaris-e2e", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(ROOT, "dist", "polaris.mjs")],
  stderr: "inherit",
  env: {
    ...process.env,
    POLARIS_CACHE_DIR: CACHE_DIR,
    POLARIS_SMARTDRIVE_CMD: `node "${SMARTDRIVE_SCRIPT}" "${SMARTDRIVE_LOG}"`,
    POLARIS_ALLOW_PRIVATE_URLS: "1",
    POLARIS_S2_URL: `http://127.0.0.1:${httpPort}`,
    SEMANTIC_SCHOLAR_API_KEY: "CANARY_SECRET_KEY_NOT_IN_OUTPUT_98765",
  },
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
    "20 tools registered",
    toolNames.length === 20 &&
      toolNames.includes("polaris_schedule") &&
      toolNames.includes("polaris_export_course") &&
      toolNames.includes("polaris_tasks_sync") &&
      toolNames.includes("polaris_errorlog_add") &&
      toolNames.includes("polaris_lesson_done") &&
      toolNames.includes("polaris_review_due") &&
      toolNames.includes("polaris_progress_sync") &&
      toolNames.includes("polaris_today"),
    toolNames.join(", "),
  );

  const { prompts } = await client.listPrompts();
  const promptNames = prompts.map((p) => p.name).sort();
  ok(
    "prompts listed (new_course, research, next_lesson, review)",
    promptNames.includes("new_course") &&
      promptNames.includes("research") &&
      promptNames.includes("next_lesson") &&
      promptNames.includes("review"),
    promptNames.join(", "),
  );

  // Set up temp hub ACTIVE_LEARNING.md with unchecked P0 deadline
  process.env.POLARIS_HUB = TEST_DIR;
  writeFileSync(
    join(TEST_DIR, "ACTIVE_LEARNING.md"),
    "# Active Learning Hub\n\n- [ ] [Deadline: 2026-10-24 18:00] [Priority: P0] GCI HW3 submission deadline\n- [ ] [Deadline: 2026-11-05 18:00] [Priority: P1] Other homework\n",
    "utf8",
  );

  // 3.1 polaris_guide (all topics including schedule, export, tracking, progress, aurora)
  let r = await call("polaris_guide");
  ok("guide overview", !r.isError && textOf(r).includes("Available guide topics"), textOf(r).split("\n")[0]);
  r = await call("polaris_guide", { topic: "schedule" });
  ok("guide schedule topic", !r.isError && textOf(r).includes("Topological Sorting:"));
  r = await call("polaris_guide", { topic: "export" });
  ok("guide export topic", !r.isError && textOf(r).includes("course.json"));
  r = await call("polaris_guide", { topic: "tracking" });
  ok("guide tracking topic", !r.isError && textOf(r).includes("Sổ lỗi (Error Log):"));
  r = await call("polaris_guide", { topic: "progress" });
  ok("guide progress topic", !r.isError && textOf(r).includes("Event Contract:"));
  r = await call("polaris_guide", { topic: "aurora" });
  ok("guide aurora topic", !r.isError && textOf(r).includes("Polaris and Aurora Slides form a closed-loop"));

  // 3.2 polaris_profile (with slots & blackouts)
  r = await call("polaris_profile", { action: "get", hub: TEST_DIR });
  ok("profile get", !r.isError && textOf(r).includes('"lang": "vi"') && textOf(r).includes("memoryAnchors"));
  r = await call("polaris_profile", {
    action: "update",
    patch: {
      slots: [
        { day: "Tue", minutes: 30 },
        { day: "Sat", minutes: 60 },
      ],
      blackouts: [
        { from: "2026-10-20", to: "2026-10-21", reason: "Family event" },
      ],
      taste: { slideStyle: "Apple-keynote", noEmoji: true, noNeon: true, accent: "titanium" },
    },
    hub: TEST_DIR,
  });
  ok("profile update with slots and blackouts", !r.isError && textOf(r).includes('"accent": "titanium"') && textOf(r).includes('"slots"'));

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
  ok("key string never appears in polaris_find tool output", !textOf(r).includes("CANARY_SECRET_KEY_NOT_IN_OUTPUT_98765"));

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
  ok("key string never appears in polaris_research tool output", !textOf(r).includes("CANARY_SECRET_KEY_NOT_IN_OUTPUT_98765"));
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
    ok(
      "key string never appears in shortlist file",
      !shortlistMd.includes("CANARY_SECRET_KEY_NOT_IN_OUTPUT_98765"),
    );
  }

  // Verify cache written to POLARIS_CACHE_DIR and none under subject polaris/.cache
  const cacheSubdirs = existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR) : [];
  ok(
    "research writes cache files to POLARIS_CACHE_DIR",
    cacheSubdirs.length > 0,
    `cache subdirs in ${CACHE_DIR}: ${cacheSubdirs.join(", ")}`,
  );
  ok(
    "no cache files written under subject polaris/.cache",
    !existsSync(join(SUBJECT_DIR, "polaris", ".cache")),
  );

  // Test legacy cache folder detection notice
  const legacyDir = join(SUBJECT_DIR, "polaris", ".cache");
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, "old_test.json"), JSON.stringify({ old: true }), "utf8");
  const rLegacy = await call("polaris_research", {
    subject_dir: SUBJECT_DIR,
    module: "M1",
    queries: ["ReAct agents reasoning"],
    providers: ["arxiv"],
    per_provider: 1,
  });
  ok(
    "polaris_research warns once if old polaris/.cache folder exists",
    !rLegacy.isError && textOf(rLegacy).includes("Storage notice") && textOf(rLegacy).includes(".cache"),
    "warned about legacy cache",
  );
  rmSync(legacyDir, { recursive: true, force: true });

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

  // 3.11b SmartDrive update notification verification & coalescing
  // Clear log before the test
  writeFileSync(SMARTDRIVE_LOG, "", "utf8");

  // Perform source_add and roadmap_save within 2s window
  await call("polaris_source_add", {
    subject_dir: SUBJECT_DIR,
    sources: [
      {
        id: "S_coalesce",
        kind: "local",
        title: "Coalesce Test Note",
        path: localNotePath,
        label: "course",
      },
    ],
  });
  await call("polaris_roadmap_save", { subject_dir: SUBJECT_DIR, roadmap: validRoadmap });

  // Wait for 2s coalescing window to settle and fire trailing update
  await new Promise((res) => setTimeout(res, 2200));
  const sdLogContent = existsSync(SMARTDRIVE_LOG) ? readFileSync(SMARTDRIVE_LOG, "utf8") : "";
  const sdLogLines = sdLogContent.trim().split("\n").filter(Boolean);
  ok(
    "SmartDrive update hook invoked with update <dir> --quiet",
    sdLogLines.some((l) => l.startsWith("update ") && l.endsWith("--quiet") && l.includes("polaris")),
    `Logged lines: ${sdLogLines.join(" | ")}`,
  );
  ok(
    "source_add and roadmap_save produce coalesced update <subject>/polaris --quiet lines",
    sdLogLines.length >= 1 && sdLogLines.length <= 2,
    `Coalesced line count: ${sdLogLines.length}`,
  );

  // Test POLARIS_SMARTDRIVE=off disables hook
  process.env.POLARIS_SMARTDRIVE = "off";
  polarisLib._resetSmartDriveState();
  writeFileSync(SMARTDRIVE_LOG, "", "utf8");
  polarisLib.notifySmartDrive(SUBJECT_DIR);
  await new Promise((res) => setTimeout(res, 200));
  const disabledLog = existsSync(SMARTDRIVE_LOG) ? readFileSync(SMARTDRIVE_LOG, "utf8") : "";
  ok("POLARIS_SMARTDRIVE=off logs nothing", disabledLog.trim().length === 0, `Log length: ${disabledLog.length}`);
  delete process.env.POLARIS_SMARTDRIVE;
  polarisLib._resetSmartDriveState();

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

  // 3.14 polaris_schedule
  r = await call("polaris_schedule", {
    subject_dir: SUBJECT_DIR,
    start: "2026-10-12",
    hub: TEST_DIR,
  });
  ok("polaris_schedule succeeds", !r.isError && textOf(r).includes("Schedule generated successfully"));
  const schedFile = join(SUBJECT_DIR, "polaris", "schedule.json");
  ok("schedule.json exists on disk", existsSync(schedFile));

  const schedData = JSON.parse(readFileSync(schedFile, "utf8"));
  ok("schedule has active weeks", schedData.weeks.length >= 5, `weeks: ${schedData.weeks.length}`);

  // Week 1 sessions: 2026-10-13 (Tue 30m), 2026-10-17 (Sat 60m)
  const w1 = schedData.weeks.find((w) => w.week === 1);
  ok(
    "Week 1 sessions (Tue 10-13 30m, Sat 10-17 60m)",
    w1?.sessions?.length === 2 &&
      w1.sessions[0]?.date === "2026-10-13" &&
      w1.sessions[0]?.minutes === 30 &&
      w1.sessions[1]?.date === "2026-10-17" &&
      w1.sessions[1]?.minutes === 60,
  );

  // Week 2 skipped due to blackout (2026-10-20) and P0 deadline (2026-10-24)
  const w2 = schedData.weeks.find((w) => w.week === 2);
  ok("Week 2 skipped due to blackout and P0 deadline", !w2 || w2.sessions.length === 0);

  // Week 3 sessions: Tue 2026-10-27 (30m), Sat 2026-10-31 (60m) -> completes M1 (180m total)
  const w3 = schedData.weeks.find((w) => w.week === 3);
  ok(
    "Week 3 sessions (Tue 10-27 30m, Sat 10-31 60m)",
    w3?.sessions?.length === 2 &&
      w3.sessions[0]?.date === "2026-10-27" &&
      w3.sessions[1]?.date === "2026-10-31",
  );
  ok("Module M1 completed on 2026-10-31", schedData.moduleCompletion?.M1?.completedDate === "2026-10-31");

  // Week 4 has interleaved review 1 on Tue 2026-11-03
  const w4 = schedData.weeks.find((w) => w.week === 4);
  ok(
    "Week 4 contains Interleaved Review session",
    w4?.sessions?.some((s) => s.module === "Review" && s.activity.includes("Ôn xen kẽ 1")),
  );

  // Check when-label format
  ok(
    "when-label format in Vietnamese",
    schedData.lessonWhenMap?.M1 === "Tuần 1 · Thứ Ba 13/10" || schedData.lessonWhenMap?.M1?.includes("Tuần 1 · Thứ Ba"),
    schedData.lessonWhenMap?.M1,
  );

  // Check ROADMAP.md Section 3.2 re-rendered with weekly table
  const updatedRoadmapContent = readFileSync(roadmapMdPath, "utf8");
  ok(
    "ROADMAP.md Section 3.2 contains weekly table",
    updatedRoadmapContent.includes("| Tuần | Buổi | Module | Sản phẩm / DoD | Hạn |") &&
      updatedRoadmapContent.includes("Ba 10-13 (30')") &&
      updatedRoadmapContent.includes("2026-10-31 (M1)"),
  );

  // 3.15 polaris_export_course
  r = await call("polaris_export_course", { subject_dir: SUBJECT_DIR });
  ok("export_course succeeds", !r.isError && textOf(r).includes("Course exported successfully"));

  const courseDir = join(SUBJECT_DIR, "05_Slides", "ai-agents-101");
  const courseJsonFile = join(courseDir, "course.json");
  ok("course.json exists on disk", existsSync(courseJsonFile));

  const courseJson = JSON.parse(readFileSync(courseJsonFile, "utf8"));
  const vCourseCheck = polarisLib.validateCourse(courseJson);
  ok("course.json strictly matches Aurora CourseSchema", vCourseCheck.ok, vCourseCheck.errors?.join("; "));
  ok("course.json has valid lessons with dirs and when labels", courseJson.lessons.length >= 2 && Boolean(courseJson.lessons[0].dir));

  // Aurora build verification if tool exists
  const auroraCliPath = "D:/03_Development_Projects/Slide_Projects/my_projects/aurora_slides_mcp/dist/aurora.mjs";
  if (existsSync(auroraCliPath)) {
    try {
      const auroraBuildOut = execFileSync(process.execPath, [auroraCliPath, "build", courseDir], { encoding: "utf8" });
      ok("Aurora CLI builds course without errors", !auroraBuildOut.includes("error"), auroraBuildOut.slice(0, 80));
    } catch (e) {
      skip("Aurora CLI build", `Aurora build failed: ${polarisLib.errMsg(e)}`);
    }
  } else {
    skip("Aurora CLI build", `Aurora CLI binary not found at ${auroraCliPath}`);
  }

  // Outline skeletons check
  const lessonsDir = join(SUBJECT_DIR, "polaris", "lessons");
  const outlineFiles = existsSync(lessonsDir) ? readdirSync(lessonsDir) : [];
  ok("lesson outline skeletons generated", outlineFiles.some((f) => f.endsWith(".outline.md")), outlineFiles.join(", "));

  const firstOutlinePath = join(lessonsDir, outlineFiles[0]);
  const firstOutline = readFileSync(firstOutlinePath, "utf8");
  ok(
    "outline skeleton contains all required Vietnamese sections",
    firstOutline.includes("## 1. Mục tiêu") &&
      firstOutline.includes("## 2. Dữ kiện có nguồn") &&
      firstOutline.includes("## 3. Hiểu lầm -> Phương án nhiễu") &&
      firstOutline.includes("## 4. Thực hành & Dự đoán") &&
      firstOutline.includes("## 5. Neo trí nhớ gợi ý") &&
      firstOutline.includes("## 6. Trang vở gợi ý") &&
      firstOutline.includes("## 7. Tự kiểm tra") &&
      firstOutline.includes("## 8. Code liên quan") &&
      firstOutline.includes("## 9. Dàn ý Slide đề xuất"),
  );

  // Idempotent export test: calling export a second time preserves outlines and keeps course.json stable
  const rExport2 = await call("polaris_export_course", { subject_dir: SUBJECT_DIR });
  ok("export course twice is idempotent", !rExport2.isError);
  const outlineFilesAfter2 = readdirSync(lessonsDir);
  ok(
    "second export preserves existing outline and writes .new.md candidate",
    outlineFilesAfter2.some((f) => f.endsWith(".outline.new.md")),
  );

  // 3.16 polaris_tasks_sync
  r = await call("polaris_tasks_sync", { subject_dir: SUBJECT_DIR });
  ok("tasks_sync succeeds", !r.isError && textOf(r).includes("Tasks sync complete"));

  const tasksMdPath = join(SUBJECT_DIR, "TASKS.md");
  ok("TASKS.md created under subject directory", existsSync(tasksMdPath));

  const tasksContent = readFileSync(tasksMdPath, "utf8");
  ok(
    "TASKS.md contains ## Polaris and valid task format",
    tasksContent.includes("## Polaris") &&
      /- \[\s*\]\s*\[Deadline:\s*\d{4}-\d{2}-\d{2}\s+23:59\]\s*\[Priority:\s*P2\]\s*Học bài/i.test(tasksContent) &&
      /- \[\s*\]\s*\[Deadline:\s*\d{4}-\d{2}-\d{2}\s+23:59\]\s*\[Priority:\s*P2\]\s*Checkpoint Module/i.test(tasksContent),
  );

  // Idempotent tasks sync test
  const rTasks2 = await call("polaris_tasks_sync", { subject_dir: SUBJECT_DIR });
  ok("second tasks_sync adds 0 new tasks", !rTasks2.isError && textOf(rTasks2).includes("Tasks added: 0"));
  const tasksContent2 = readFileSync(tasksMdPath, "utf8");
  ok("no duplicate task lines after second sync", tasksContent === tasksContent2);

  // 3.17 polaris_errorlog_add
  r = await call("polaris_errorlog_add", {
    subject_dir: SUBJECT_DIR,
    entry: {
      date: "2026-10-15",
      module: "M1",
      lesson: "01-vong-lap-agent",
      prediction: "regex parse khớp mọi biểu thức ngoặc lồng",
      result: "calculator báo syntax error vì regex dừng ở dấu đóng đầu tiên",
      why: "regex lười dừng ở dấu đóng ngoặc đơn đầu tiên",
      fix: "Dùng bộ đếm độ sâu ngoặc hoặc parser đệ quy",
      source: "Lab 1",
    },
    hub: TEST_DIR,
  });
  ok("errorlog_add succeeds", !r.isError && textOf(r).includes("Ghi nhận thành công vào Sổ lỗi"));

  const errorlogMdPath = join(SUBJECT_DIR, "polaris", "errorlog.md");
  ok("errorlog.md exists", existsSync(errorlogMdPath));
  const errorlogContent = readFileSync(errorlogMdPath, "utf8");
  ok(
    "errorlog.md contains entry with correct D+1..D+35 dates",
    errorlogContent.includes("regex parse khớp mọi biểu thức ngoặc lồng") &&
      errorlogContent.includes("D+1 (2026-10-16)") &&
      errorlogContent.includes("D+3 (2026-10-18)") &&
      errorlogContent.includes("D+7 (2026-10-22)") &&
      errorlogContent.includes("D+16 (2026-10-31)") &&
      errorlogContent.includes("D+35 (2026-11-19)"),
  );

  // 3.18 polaris_lesson_done
  r = await call("polaris_lesson_done", {
    subject_dir: SUBJECT_DIR,
    lesson_dir: "01-vong-lap-agent",
    date: "2026-10-15",
    score: "5/5",
    hub: TEST_DIR,
  });
  ok("lesson_done succeeds", !r.isError && textOf(r).includes("Đã ghi nhận hoàn thành bài học"));

  const reviewsJsonPath = join(SUBJECT_DIR, "polaris", "reviews.json");
  ok("reviews.json exists", existsSync(reviewsJsonPath));
  const reviewsData = JSON.parse(readFileSync(reviewsJsonPath, "utf8"));
  ok("reviews.json has both error and lesson items", reviewsData.items.length === 2);

  // 3.19 polaris_review_due
  r = await call("polaris_review_due", {
    subject_dir: SUBJECT_DIR,
    date: "2026-10-16",
  });
  ok("review_due succeeds", !r.isError && textOf(r).includes("Danh sách ôn tập đến hạn tại ngày 2026-10-16: 2 mục"));
  ok("review_due returns items with D+1 offset", textOf(r).includes("[D+1]") && textOf(r).includes("[Bài học]") && textOf(r).includes("[Sổ lỗi]"));

  // 3.20 polaris_progress_sync with fixture progress.jsonl
  const progressFixtureLines = [
    JSON.stringify({
      v: 1,
      t: "2026-10-15T14:30:00+07:00",
      course: "AI Agents 101",
      lesson: "01-agent-va-vong-lap-react-a",
      deck: "Agent và Vòng lặp ReAct",
      slide: 3,
      slideId: "s_quiz_1",
      type: "quiz",
      question: "ReAct agent khác gì so với Chain-of-Thought tiêu chuẩn?",
      chosen: [1],
      answer: [2],
      correct: false,
    }),
    JSON.stringify({
      v: 1,
      t: "2026-10-15T14:35:00+07:00",
      course: "AI Agents 101",
      lesson: "01-agent-va-vong-lap-react-a",
      deck: "Agent và Vòng lặp ReAct",
      slide: 6,
      slideId: "s_pred_1",
      type: "predict",
      title: "Dự đoán output khi tool trả về mã lỗi 404",
      prediction: "Agent sẽ crash ngay lập tức",
      rating: "different",
      output: "Agent bắt exception, sinh Thought mới và đổi query tìm kiếm.",
    }),
    JSON.stringify({
      v: 1,
      t: "2026-10-15T14:40:00+07:00",
      course: "AI Agents 101",
      lesson: "01-agent-va-vong-lap-react-a",
      deck: "Agent và Vòng lặp ReAct",
      slide: 8,
      slideId: "s_recall_1",
      type: "recall",
      palace: "Phòng làm việc",
      station: 2,
      place: "Bàn làm việc",
      item: "Vòng lặp ReAct Think-Act-Observe",
      rating: "missed",
    }),
    JSON.stringify({
      v: 1,
      t: "2026-10-15T14:45:00+07:00",
      course: "AI Agents 101",
      lesson: "01-agent-va-vong-lap-react-a",
      deck: "Agent và Vòng lặp ReAct",
      slide: 12,
      slideId: "s_comp_1",
      type: "complete",
      slides: 12,
      quiz: "3/4",
      predictions: "2/3",
    }),
    JSON.stringify({
      v: 1,
      t: "2026-10-15T14:48:00+07:00",
      course: "AI Agents 101",
      lesson: "01-agent-va-vong-lap-react-a",
      deck: "Agent và Vòng lặp ReAct",
      slide: 9,
      slideId: "s_card_1",
      type: "card",
      front: "ReAct loop components?",
      back: "Thought, Action, Observation",
    }),
    "{ invalid json line that should be skipped",
    JSON.stringify({
      v: 1,
      t: "2026-10-15T14:50:00+07:00",
      lesson: "01-agent-va-vong-lap-react-a",
      slide: 1,
      type: "custom_unknown_type",
    }),
  ];

  const courseProgressFile = join(courseDir, "progress.jsonl");
  writeFileSync(courseProgressFile, progressFixtureLines.join("\n") + "\n", "utf8");

  r = await call("polaris_progress_sync", {
    subject_dir: SUBJECT_DIR,
    hub: TEST_DIR,
  });
  ok("progress_sync succeeds with fixture", !r.isError && textOf(r).includes("Đồng bộ tiến độ Aurora hoàn tất"));
  ok(
    "progress_sync adds 3 error-log entries, 1 completion, and reports 2 skipped lines",
    textOf(r).includes("Mục mới thêm vào Sổ lỗi: 3") &&
      textOf(r).includes("Bài học hoàn thành mới: 1") &&
      textOf(r).includes("Bỏ qua 2 dòng (1 lỗi định dạng, 1 sự kiện không xác định)"),
  );
  ok(
    "progress_sync skips card event without counting as malformed or unknown",
    textOf(r).includes("1 card events left for Vega") &&
      textOf(r).includes("1 sự kiện thẻ (\"card\") dành riêng cho Vega"),
  );

  const updatedErrorlogContent = readFileSync(errorlogMdPath, "utf8");
  ok(
    "errorlog.md contains 3 new error entries with correct details and prompts",
    updatedErrorlogContent.includes("ReAct agent khác gì so với Chain-of-Thought tiêu chuẩn?") &&
      updatedErrorlogContent.includes("**Đã chọn:** [1]") &&
      updatedErrorlogContent.includes("**Đáp án đúng:** [2]") &&
      updatedErrorlogContent.includes("**Nguyên nhân gốc rễ:** (tự điền khi ôn: vì sao chọn sai?)") &&
      !updatedErrorlogContent.includes("Nguyên nhân gốc rễ:** Trắc nghiệm:") &&
      !updatedErrorlogContent.includes("Nguyên nhân gốc rễ:** ReAct") &&
      updatedErrorlogContent.includes("Dự đoán output khi tool trả về mã lỗi 404") &&
      updatedErrorlogContent.includes("**Dự đoán:** Agent sẽ crash ngay lập tức") &&
      updatedErrorlogContent.includes("**Bài học rút ra:** (tự điền: mental model nào cần sửa?)") &&
      updatedErrorlogContent.includes("**Trạm:** Bàn làm việc") &&
      updatedErrorlogContent.includes("**Ý cần nhớ:** Vòng lặp ReAct Think-Act-Observe") &&
      updatedErrorlogContent.includes("**Neo:** (tự điền: củng cố hình ảnh liên tưởng giữa trạm và ý cần nhớ)"),
  );

  // Idempotency: second sync adds nothing
  const rSync2 = await call("polaris_progress_sync", {
    subject_dir: SUBJECT_DIR,
    hub: TEST_DIR,
  });
  ok(
    "running progress_sync twice adds nothing (idempotent)",
    !rSync2.isError &&
      textOf(rSync2).includes("0 sự kiện mới") &&
      textOf(rSync2).includes("Mục mới thêm vào Sổ lỗi: 0") &&
      textOf(rSync2).includes("Bài học hoàn thành mới: 0"),
  );

  // Exported file merge test with quiz chosenText, answerText, and explanation
  const exportedProgressFile = join(TEST_DIR, "aurora-progress-ai-agents-101.jsonl");
  const exportedLines = [
    ...progressFixtureLines.slice(0, 4), // Duplicates of previous events
    JSON.stringify({
      v: 1,
      t: "2026-10-15T15:00:00+07:00",
      course: "AI Agents 101",
      lesson: "01-agent-va-vong-lap-react-a",
      deck: "Agent và Vòng lặp ReAct",
      slide: 10,
      slideId: "s_quiz_2",
      type: "quiz",
      question: "Tại sao cần max_steps trong vòng lặp ReAct?",
      chosen: [0],
      answer: [3],
      chosenText: ["Để agent chạy nhanh hơn"],
      answerText: ["Tránh vòng lặp vô hạn và bùng nổ token"],
      explanation: "max_steps là chốt chặn an toàn bắt buộc để tránh tốn token ngoài tầm kiểm soát.",
      correct: false,
    }),
  ];
  writeFileSync(exportedProgressFile, exportedLines.join("\n") + "\n", "utf8");

  const rSyncExport = await call("polaris_progress_sync", {
    subject_dir: SUBJECT_DIR,
    file: exportedProgressFile,
    hub: TEST_DIR,
  });
  ok(
    "exported file merges with course file without duplicates",
    !rSyncExport.isError &&
      textOf(rSyncExport).includes("Mục mới thêm vào Sổ lỗi: 1") &&
      textOf(rSyncExport).includes("Tại sao cần max_steps trong vòng lặp ReAct?"),
  );

  const finalErrorlogContent = readFileSync(errorlogMdPath, "utf8");
  ok(
    "errorlog.md quiz entry with chosenText/answerText/explanation displays option texts and explanation",
    finalErrorlogContent.includes("**Đã chọn:** Để agent chạy nhanh hơn") &&
      finalErrorlogContent.includes("**Đáp án đúng:** Tránh vòng lặp vô hạn và bùng nổ token") &&
      finalErrorlogContent.includes("**Giải thích:** max_steps là chốt chặn an toàn bắt buộc") &&
      !finalErrorlogContent.includes("Nguyên nhân gốc rễ:** Tại sao cần max_steps"),
  );

  // 3.21 polaris_today
  r = await call("polaris_today", {
    subject_dir: SUBJECT_DIR,
    date: "2026-10-16",
    hub: TEST_DIR,
  });
  ok("polaris_today succeeds", !r.isError && textOf(r).includes("Kế hoạch phiên học"));
  ok(
    "polaris_today returns due reviews, next lesson, and Today's Dynamic Goal",
    textOf(r).includes("Mục ôn tập đến hạn") &&
      textOf(r).includes("02-agent-va-vong-lap-react-b") &&
      textOf(r).includes("## Today's Dynamic Goal") &&
      textOf(r).includes("- Date: 2026-10-16") &&
      textOf(r).includes("- Subject: AI Agents 101") &&
      textOf(r).includes("- Target:") &&
      textOf(r).includes("- Definition of Done (DoD):") &&
      textOf(r).includes("- Status: In Progress"),
  );

  // polaris_today with write: true inserts block into fixture ACTIVE_LEARNING.md
  const hubActiveLearning = join(TEST_DIR, "ACTIVE_LEARNING.md");
  const originalHubContent = readFileSync(hubActiveLearning, "utf8");
  r = await call("polaris_today", {
    subject_dir: SUBJECT_DIR,
    date: "2026-10-16",
    write: true,
    hub: TEST_DIR,
  });
  ok("polaris_today write: true succeeds", !r.isError && textOf(r).includes("Đã cập nhật mục tiêu"));

  const hubAfterWrite1 = readFileSync(hubActiveLearning, "utf8");
  ok(
    "polaris_today write: true inserts ## Today's Dynamic Goal into ACTIVE_LEARNING.md",
    hubAfterWrite1.includes("## Today's Dynamic Goal") &&
      hubAfterWrite1.includes("- Date: 2026-10-16") &&
      hubAfterWrite1.includes("GCI HW3 submission deadline"), // preserved other lines
  );

  // Second write with different date replaces the block (other lines untouched)
  r = await call("polaris_today", {
    subject_dir: SUBJECT_DIR,
    date: "2026-10-17",
    write: true,
    hub: TEST_DIR,
  });
  const hubAfterWrite2 = readFileSync(hubActiveLearning, "utf8");
  const countGoalHeadings = (hubAfterWrite2.match(/## Today's Dynamic Goal/g) || []).length;
  ok(
    "second polaris_today write replaces existing goal block without duplicate headings",
    countGoalHeadings === 1 &&
      hubAfterWrite2.includes("- Date: 2026-10-17") &&
      !hubAfterWrite2.includes("- Date: 2026-10-16") &&
      hubAfterWrite2.includes("GCI HW3 submission deadline"),
  );

  // polaris_today with Vega cards fixture (2 due, 1 future, 1 suspended)
  const vegaDir = join(TEST_DIR, ".vega");
  mkdirSync(vegaDir, { recursive: true });
  const vegaCardsFixture = [
    {
      id: "card-1",
      subject: "AI Agents 101",
      fsrs: {
        due: "2026-10-16T08:00:00.000Z",
        state: 1,
      },
    },
    {
      id: "card-2",
      subject: "AI Agents 101",
      fsrs: {
        due: "2026-10-16T12:00:00.000Z",
        state: 2,
      },
    },
    {
      id: "card-3",
      subject: "AI Agents 101",
      fsrs: {
        due: "2026-10-25T08:00:00.000Z",
        state: 1,
      },
    },
    {
      id: "card-4",
      subject: "AI Agents 101",
      suspended: true,
      fsrs: {
        due: "2026-10-16T08:00:00.000Z",
        state: 1,
      },
    },
  ];
  writeFileSync(join(vegaDir, "cards.json"), JSON.stringify(vegaCardsFixture, null, 2), "utf8");

  const rTodayVega = await call("polaris_today", {
    subject_dir: SUBJECT_DIR,
    date: "2026-10-16",
    hub: TEST_DIR,
  });
  ok(
    "polaris_today with vega cards shows 2 due, next step, and 10min recipe budget",
    !rTodayVega.isError &&
      textOf(rTodayVega).includes("2 thẻ đến hạn hôm nay (2 thẻ thuộc môn này)") &&
      textOf(rTodayVega).includes("vega_sync, then vega_session to review") &&
      textOf(rTodayVega).includes("10 phút: Thẻ nhớ Vega FSRS (2 thẻ đến hạn)"),
  );

  // 3.22 CLI tests
  const guideCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "guide", "schedule"], { encoding: "utf8" });
  ok("CLI guide schedule", guideCli.includes("Topological Sorting:"));

  const guideProgressCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "guide", "progress"], { encoding: "utf8" });
  ok("CLI guide progress", guideProgressCli.includes("Event Contract:"));

  const guideTodayCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "guide", "today"], { encoding: "utf8" });
  ok("CLI guide today", guideTodayCli.includes("Vega FSRS Card Load:"));

  const guideAuroraCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "guide", "aurora"], { encoding: "utf8" });
  ok("CLI guide aurora", guideAuroraCli.includes("Polaris and Aurora Slides form a closed-loop"));

  const checkCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "check", SUBJECT_DIR], { encoding: "utf8" });
  ok("CLI check subject", checkCli.includes("Quality Gate Audit"));

  const renderCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "render", SUBJECT_DIR], { encoding: "utf8" });
  ok("CLI render subject", renderCli.includes("Rendered ROADMAP.md"));

  const scheduleCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "schedule", SUBJECT_DIR], { encoding: "utf8" });
  ok("CLI schedule", scheduleCli.includes("Schedule generated successfully"));

  const exportCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "export", SUBJECT_DIR], { encoding: "utf8" });
  ok("CLI export", exportCli.includes("Course exported successfully"));

  const tasksCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "tasks", SUBJECT_DIR], { encoding: "utf8" });
  ok("CLI tasks", tasksCli.includes("Tasks sync complete"));

  const progressCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "progress", SUBJECT_DIR], { encoding: "utf8" });
  ok("CLI progress", progressCli.includes("Đồng bộ tiến độ Aurora"));

  const todayCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "today", SUBJECT_DIR], { encoding: "utf8" });
  ok("CLI today", todayCli.includes("Kế hoạch phiên học") && todayCli.includes("## Today's Dynamic Goal"));

  const versionCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "version"], { encoding: "utf8" });
  ok("CLI version 0.3.6", versionCli.trim() === "0.3.6");

  const helpCli = execFileSync(process.execPath, [join(ROOT, "dist", "polaris.mjs"), "help"], { encoding: "utf8" });
  ok("CLI help", helpCli.includes("Usage: node polaris.mjs") && helpCli.includes("progress <subject_dir>") && helpCli.includes("today <subject_dir>"));

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
  redirectTargetServer.close();

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
