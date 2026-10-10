[English](README.md)

# Polaris MCP

Polaris là một máy chủ Model Context Protocol (MCP) và giao diện dòng lệnh (CLI) giúp các coding agent (Claude Code, Google Antigravity, Cursor) có được cấu trúc, sự bền vững dữ liệu, công cụ khám phá nghiên cứu (research engine), thu thập tài liệu, lập lịch trình học tập, xuất khóa học trình chiếu và các rào chắn chất lượng (quality gates) để xây dựng lộ trình học tập cá nhân hóa dựa trên bằng chứng (evidence-based).

Dự án song hành cùng [Aurora Slides MCP](https://github.com/DuongNAD/aurora-slides-mcp) dùng để dựng bài giảng trình chiếu.

## Nguyên tắc cốt lõi

1. **Agent tư duy, Polaris định hình cấu trúc:** Mọi dữ liệu đều là JSON được kiểm thực chặt chẽ qua Zod schema và xuất ra Markdown hoặc định dạng đầu vào cho Aurora. Lỗi nhập liệu đi kèm gợi ý sửa đổi chính xác ("có phải ý bạn là...").
2. **Dựa trên bằng chứng (Evidence first):** Mọi ý kiến thức cốt lõi đều dẫn chiếu đến facts; mỗi fact đều trỏ về một source kèm định vị cụ thể (mốc thời gian video `[mm:ss]`, số trang `[p. N]`, mục, khoảng dòng). Nhãn phân loại rõ ràng: **[Khóa học]** (nguồn sự thật chính thức), **[Mở rộng]** (nguồn bên ngoài đã xác minh), **(chưa xác minh)** (chưa kiểm chứng).
3. **Phù hợp với người học:** Hồ sơ người học (Learner Profile) quy định ngôn ngữ (tiếng Việt chuẩn dấu), khung giờ học trong tuần (`slots`), ngày bận (`blackouts`), công thức buổi học (30 phút, 60 phút, lab 90 phút), phương pháp tiếp thu (lý thuyết -> neo ghi nhớ -> sổ tay giấy -> thực hành từ dễ đến khó -> đi dạo gợi nhớ; predict-then-run đối với code), và chu kỳ ôn tập ngắt quãng (1, 3, 7, 16, 35 ngày).
4. **Rào chắn chất lượng (Quality gates):** Kiểm tra tự động tính đầy đủ của brief, nhãn và điểm chất lượng nguồn, định vị fact, độ phủ đầu ra, đồ thị phụ thuộc module không vòng lặp (DAG), và cảnh báo các khẳng định quá mức.
5. **Tập tin thuần, không dùng cơ sở dữ liệu phức tạp:** Lưu trữ JSON và Markdown trực tiếp trong thư mục môn học (`polaris/brief.json`, `sources.json`, `facts.json`, `roadmap.json`, `schedule.json`, `course-map.json`, `tasks-map.json`, `reviews.json`, `errorlog.md`, `captures/`, `research/`, `lessons/`). Bản chụp văn bản và cache được giữ cục bộ và bỏ qua trong git (`.gitignore`).

## Cấu trúc thư mục

### Cấp độ Hub trung tâm (`POLARIS_HUB`, mặc định: `D:/02_Learning_Knowledge`)
```
<hub>/
├── AGENTS.md                # Quy tắc chung của hub và hướng dẫn cho AI agent
├── ACTIVE_LEARNING.md       # Mục tiêu ưu tiên, hạn chót P0 và các checkpoint
├── TASKS.md                 # Quản lý tác vụ toàn hub
└── .polaris/
    └── learner.json         # Hồ sơ người học (khung giờ, ngày bận, công thức buổi học, phong cách)
```

### Cấp độ môn học (`<subject>/`)
```
<subject>/
├── 04_Roadmaps/
│   └── ROADMAP.md           # Lộ trình học Markdown chuẩn tiếng Việt 10 mục (kèm lịch & ôn tập)
├── 05_Slides/
│   └── <slug>/
│       └── course.json      # Khóa học Aurora Slides
├── TASKS.md                 # Tác vụ của môn học (đồng bộ dưới mục '## Polaris')
└── polaris/
    ├── .gitignore           # Bỏ qua captures/ và .cache/
    ├── brief.json           # Mục tiêu, đầu ra kiểm tra được, số giờ/tuần, nguồn sự thật
    ├── sources.json         # Sổ đăng ký nguồn tài liệu (video, bài báo, trang web, ghi chú)
    ├── facts.json           # Các sự thật được trích xuất kèm định vị và ID nguồn
    ├── roadmap.json         # Cấu trúc module, 3 tầng thực hành, câu hỏi tự kiểm tra, checkpoint
    ├── schedule.json        # Lịch học xác định theo slot, ngày học và nhãn when
    ├── course-map.json      # Bản đồ ánh xạ ổn định giữa module/bài học và Aurora lesson
    ├── tasks-map.json       # Bản đồ ánh xạ task ID với TASKS.md (chống trùng lặp)
    ├── reviews.json         # Lịch ôn tập ngắt quãng (D+1, D+3, D+7, D+16, D+35)
    ├── errorlog.md          # Sổ lỗi người học với chu kỳ ôn tập các khoảng cách dự đoán
    ├── .cache/              # Bộ nhớ đệm tìm kiếm 24 giờ (git-ignored)
    ├── research/            # Các file danh sách rút gọn tài liệu (vd: 2026-10-10-ai-agents.md)
    ├── captures/            # Bản trích xuất toàn văn từ web/arXiv/YouTube (git-ignored)
    │   ├── S1.md
    │   └── S2.md
    └── lessons/             # Dàn ý bài học skeleton để duyệt trước khi dựng slide
        ├── 01-tong-quan.outline.md
        └── 02-kien-truc.outline.md
```

## Danh sách công cụ (v0.2.0)

Polaris cung cấp 18 công cụ MCP chia theo 5 nhóm chức năng:

### 1. Hồ sơ & Khởi tạo
| Công cụ | Mô tả |
|---|---|
| `polaris_guide` | Tra cứu tài liệu hướng dẫn quy trình, rào chắn chất lượng, chính sách nguồn, công cụ nghiên cứu, lập lịch, xuất slide, theo dõi và phương pháp học. |
| `polaris_profile` | Đọc (`get`) hoặc cập nhật (`update`) hồ sơ người học, khung giờ tuần (`slots`), ngày bận (`blackouts`) và công thức buổi học. |
| `polaris_start` | Khởi tạo thư mục môn học, thiết lập `polaris/brief.json` và cấu hình `.gitignore`. |

### 2. Nghiên cứu & Nguồn tài liệu
| Công cụ | Mô tả |
|---|---|
| `polaris_find` | Tìm kiếm tài liệu học tập qua các nhà cung cấp không cần API key với điểm số, lý do đánh giá và link Open Access. |
| `polaris_research` | Thực thi nghiên cứu đa truy vấn qua nhiều provider, lưu cache 24h, chống trùng lặp, xếp hạng, xuất file shortlist và tùy chọn tự động thêm nguồn. |
| `polaris_source_add` | Đăng ký và thu thập nội dung từ URL web, mã arXiv hoặc file cục bộ (tự động chống trùng lặp). |
| `polaris_capture` | Thu thập toàn văn tài liệu (PDF qua `pdftotext` có đánh dấu trang `[p. N]`, phụ đề YouTube qua `yt-dlp` có mốc thời gian `[mm:ss]`, văn bản web/Wikipedia). |
| `polaris_sources` | Liệt kê, tìm kiếm, lọc hoặc cập nhật thông tin trong sổ đăng ký nguồn `sources.json`. |

### 3. Sự thật, Lộ trình & Rào chắn chất lượng
| Công cụ | Mô tả |
|---|---|
| `polaris_fact_add` | Ghi nhận các luận điểm sự thật kèm ID nguồn và định vị chính xác (timestamp, trang, mục, dòng). |
| `polaris_facts` | Truy vấn và lọc danh sách fact theo từ khóa, mã module hoặc mã nguồn. |
| `polaris_roadmap_save` | Kiểm tra rào chắn chất lượng, lưu `roadmap.json` và kết xuất file `ROADMAP.md`. |
| `polaris_check` | Chạy toàn bộ bài kiểm tra rào chắn chất lượng cho môn học (brief, sources, facts, roadmap, schedule, export). |

### 4. Lập lịch trình & Xuất bài giảng Aurora
| Công cụ | Mô tả |
|---|---|
| `polaris_schedule` | Khớp thời lượng module vào khung giờ tuần của người học theo topo DAG, bỏ qua ngày bận và hạn chót P0 trong `ACTIVE_LEARNING.md`/`TASKS.md`, chèn buổi ôn xen kẽ mỗi N tuần, lưu `schedule.json`, cập nhật bảng tuần mục 3.2 trong `ROADMAP.md` và trả về nhãn `when` tiếng Việt. |
| `polaris_export_course` | Xuất file `course.json` cho Aurora Slides (tách module > 2.5h, đảo theme luân phiên, chọn icon Phosphor) với cơ chế trộn lũy đẳng, và tạo file dàn ý khung `polaris/lessons/<dir>.outline.md`. |

### 5. Theo dõi tiến độ & Đồng bộ tác vụ Hub
| Công cụ | Mô tả |
|---|---|
| `polaris_tasks_sync` | Đồng bộ các bài học và checkpoint vào `<subject>/TASKS.md` dưới mục `## Polaris` theo định dạng chuẩn hub (`- [ ] [Deadline: ...] [Priority: P2] ...`) và chống trùng lặp. |
| `polaris_errorlog_add` | Ghi nhận lỗi dự đoán và khoảng cách hiểu vào `polaris/errorlog.md` ("Sổ lỗi") và lập lịch các mốc ôn tập. |
| `polaris_lesson_done` | Đánh dấu hoàn thành bài học trong `polaris/reviews.json` và lập lịch ôn tập ngắt quãng sau 1, 3, 7, 16 và 35 ngày. |
| `polaris_review_due` | Truy vấn danh sách bài học và mục sổ lỗi đến hạn ôn tập trước hoặc vào ngày chỉ định, sắp xếp cũ nhất lên trước. |

## Bộ máy nghiên cứu và tìm kiếm

Polaris tích hợp bộ máy tìm kiếm tài liệu tự động không cần API key:

### Các nguồn tìm kiếm (Providers)
- **`openalex`**: Tìm kiếm bài báo khoa học, số trích dẫn, tóm tắt tái tạo từ inverted index và link PDF Open Access.
- **`arxiv`**: Giao thức Atom XML API (giới hạn 1 lượt/3s); lấy metadata và tải PDF toàn văn.
- **`semanticscholar`**: Lấy thông tin bài báo, tóm tắt TL;DR, số trích dẫn và liên kết OA (tự động backoff khi gặp HTTP 429/503).
- **`crossref`**: Tra cứu DOI, sách và tạp chí học thuật.
- **`wikipedia`**: Tóm tắt và nội dung toàn văn tiếng Việt (`vi`) và tiếng Anh (`en`).
- **`github`**: Tìm kiếm kho mã nguồn và công cụ chính thức (giới hạn 10 lượt/phút khi không có token).
- **`youtube`**: Tìm kiếm bài giảng và trích xuất phụ đề/transcript qua `yt-dlp`.
- **`brave`**: Tùy chọn tìm kiếm web nếu có `BRAVE_API_KEY`.

### Tiêu chí xếp hạng & Lý do đánh giá
Mỗi tài liệu được chấm điểm (0-100) kèm lý do rõ ràng:
- **Độ ưu tiên loại nguồn**: Nguồn khóa học > Tài liệu kỹ thuật & bài báo > Sách & giáo trình > Video, mã nguồn, web.
- **Độ phù hợp từ khóa**: Khớp từ khóa truy vấn trong tiêu đề và tóm tắt.
- **Độ uy tín & trích dẫn**: Thang đo logarit trích dẫn (`Math.log10(citations + 1)`), sao GitHub, và hội thảo uy tín (ICLR, NeurIPS, Nature...).
- **Tính cập nhật**: Ưu tiên công bố gần đây (>= 2022) và hỗ trợ lọc `year_from`.
- **Open Access**: Cộng điểm cho bài báo có PDF toàn văn truy cập mở.
- **Khớp ngôn ngữ**: Ưu tiên tiếng Việt hoặc tiếng Anh theo yêu cầu.

## Lập lịch & Tích hợp Aurora Slides

1. **Lập lịch xác định (`polaris_schedule`):**
   - Sắp xếp thứ tự học theo đồ thị phụ thuộc (DAG).
   - Khớp giờ học vào các khung giờ cố định của người học (vd: Thứ Ba 30p, Thứ Bảy 60p).
   - Bỏ qua các ngày bận (`blackouts`).
   - Tự động phát hiện các hạn chót P0 chưa tích trong hub (`ACTIVE_LEARNING.md` và `TASKS.md`), tự động dọn trống ngày hạn chót và ngày liền trước.
   - Chèn buổi ôn tập xen kẽ mỗi `interleave_every` tuần (mặc định 4).
   - Cập nhật mục 3.2 trong `ROADMAP.md` thành bảng tuần chính xác với nhãn ngày tiếng Việt.

2. **Xuất khóa học Aurora Slides (`polaris_export_course`):**
   - Tạo file `course.json` nghiêm ngặt theo schema của Aurora Slides.
   - Tự động chia các module dài (> 2.5 giờ hoặc `lessons: 2`) thành các bài học nhỏ (a/b).
   - Đảo luân phiên các theme thị giác (`aurora`, `midnight`, `daylight`, `titanium`, `ocean`, `sunset`, `forest`, `paper`, `liquid`) giữa các bài học liền kề.
   - Chọn icon Phosphor duotone phù hợp với ngữ cảnh module.
   - Trộn lũy đẳng với khóa học đã có qua `course-map.json`.
   - Tạo file dàn ý khung chi tiết bằng tiếng Việt (`polaris/lessons/<dir>.outline.md`) gồm facts dẫn chứng, phương án nhiễu từ hiểu lầm, bài tập thực hành kèm DoD, neo trí nhớ cung điện, trang vở tóm tắt 4-8 dòng và slide-plan.

3. **Đồng bộ tác vụ Hub (`polaris_tasks_sync`):**
   - Thêm bài học và checkpoint vào `<subject>/TASKS.md` dưới mục `## Polaris`.
   - Định dạng chuẩn: `- [ ] [Deadline: YYYY-MM-DD 23:59] [Priority: P2] Học bài <n>: <title>`.
   - Giữ nguyên định dạng xuống dòng và chống trùng lặp qua `polaris/tasks-map.json`.

4. **Ôn tập ngắt quãng & Sổ lỗi:**
   - `polaris_lesson_done` lập lịch ôn tập vào các ngày D+1, D+3, D+7, D+16 và D+35.
   - `polaris_errorlog_add` ghi nhận khoảng cách giữa dự đoán và thực tế vào `polaris/errorlog.md` và theo dõi chu kỳ ôn tập.
   - `polaris_review_due` hiển thị các bài học và lỗi cần ôn trong ngày.

## Quy trình Prompts của Agent

Polaris cung cấp 3 quy trình prompt mẫu:
- **`new_course`**: Toàn bộ quy trình 8 bước có kiểm duyệt: Hồ sơ -> Brief & Chẩn đoán -> Nghiên cứu & Danh sách rút gọn -> Trích xuất Facts -> Xây dựng Lộ trình -> Lập Lịch trình -> Xuất Khóa học & Dàn ý -> Đồng bộ Tác vụ -> Dựng bài học đầu tiên với Aurora.
- **`next_lesson`**: Vòng lặp học tập hàng ngày: Chọn bài học tiếp theo theo lịch -> Cập nhật dàn ý -> Dựng slide với Aurora tuân thủ trích dẫn facts -> Kiểm tra audit slide -> Đồng bộ tác vụ -> Ghi nhận kết quả ôn tập.
- **`research`**: Tìm kiếm tài liệu chuyên sâu cho một module cụ thể trên tất cả các provider không cần API key.

## Kết nối máy chủ MCP

### Dành cho Claude Code
Thêm vào file cấu hình `.mcp.json` của dự án hoặc `~/.claude.json`:
```json
{
  "mcpServers": {
    "polaris": {
      "command": "node",
      "args": ["D:/03_Development_Projects/ai_agents/polaris_mcp/dist/polaris.mjs"],
      "env": {
        "POLARIS_HUB": "D:/02_Learning_Knowledge",
        "POLARIS_TOOLCHAIN": "C:/Users/Admin/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Local/aurora-slides/toolchain"
      }
    }
  }
}
```

### Dành cho Google Antigravity
Thêm vào cấu hình máy chủ MCP của Antigravity:
```json
{
  "polaris": {
    "command": "node",
    "args": ["D:/03_Development_Projects/ai_agents/polaris_mcp/dist/polaris.mjs"],
    "env": {
      "POLARIS_HUB": "D:/02_Learning_Knowledge",
      "POLARIS_TOOLCHAIN": "C:/Users/Admin/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Local/aurora-slides/toolchain"
    }
  }
}
```

## Sử dụng qua dòng lệnh (CLI)

Chạy trực tiếp qua Node.js:

```bash
# Khởi động máy chủ MCP qua stdio
node dist/polaris.mjs

# Kiểm tra rào chắn chất lượng cho thư mục môn học
node dist/polaris.mjs check <subject_dir>

# Kết xuất lại ROADMAP.md từ polaris/roadmap.json
node dist/polaris.mjs render <subject_dir>

# Tính toán lịch học và cập nhật mục 3.2 trong ROADMAP.md
node dist/polaris.mjs schedule <subject_dir>

# Xuất file course.json cho Aurora Slides và các file dàn ý bài học
node dist/polaris.mjs export <subject_dir>

# Đồng bộ bài học vào <subject>/TASKS.md
node dist/polaris.mjs tasks <subject_dir>

# Xem tài liệu hướng dẫn (topics: overview, pipeline, gates, sources, roadmap, research, schedule, export, tracking, learner, rules)
node dist/polaris.mjs guide [topic]

# Xem phiên bản & trợ giúp
node dist/polaris.mjs version
node dist/polaris.mjs help
```

## Rào chắn chất lượng (Quality Gates)

- **Brief:** Định rõ `hoursPerWeek` và ngày `start`; mọi outcome đều có chuỗi kiểm thử `check`.
- **Sources:** Ít nhất một nguồn mang nhãn `course`; mọi nguồn đều có nhãn và điểm chất lượng (1-5) kèm lý do.
- **Facts:** Mọi fact đều trỏ đến ID nguồn hợp lệ và có locator; số liệu và ngày tháng phải có `crossCheck` hoặc mang nhãn `unverified`.
- **Roadmap:** Mọi outcome trong brief đều được bao phủ; các module có đầy đủ `why`, ≥ 2 `outputs`, `core` dẫn chứng facts, ≥ 1 `misconception` kèm fix, thời lượng tài liệu khớp thời gian module, 3 tầng thực hành (`warmup`, `core`, `challenge`) kèm DoD, ≥ 4 câu hỏi `selfCheck` (kèm câu hỏi `predict` khi có code), `checkpoint` rõ ràng, và không bị phụ thuộc vòng tròn.
- **Language:** Phát hiện các khẳng định tuyệt đối quá đà ("100%", "luôn luôn", "tuyệt đối", "always", "every model").

## Toolchain & Build

Polaris tuân thủ phân tách thư mục cho ổ đĩa cluster lớn (exFAT): `node_modules` nằm trong `POLARIS_TOOLCHAIN` (mặc định trỏ về `%LOCALAPPDATA%/aurora-slides/toolchain`).

```powershell
# Trong PowerShell:
$env:POLARIS_TOOLCHAIN = "C:\Users\Admin\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\aurora-slides\toolchain"

# Kiểm tra kiểu TypeScript & đóng gói file đơn dist/polaris.mjs:
node scripts/build.mjs --check

# Chạy bộ kiểm thử tự động e2e:
node scripts/e2e.mjs
```

## Bản quyền

MIT License - Copyright (c) 2026 DuongNAD.
