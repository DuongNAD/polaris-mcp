[English](README.md)

# Polaris MCP

Polaris là một máy chủ Model Context Protocol (MCP) và giao diện dòng lệnh (CLI) giúp các coding agent (Claude Code, Google Antigravity, Cursor) có được cấu trúc, sự bền vững dữ liệu, công cụ khám phá nghiên cứu (research engine), thu thập tài liệu và các rào chắn chất lượng (quality gates) để xây dựng lộ trình học tập cá nhân hóa dựa trên bằng chứng (evidence-based).

Dự án song hành cùng [Aurora Slides MCP](https://github.com/DuongNAD/aurora-slides-mcp) dùng để dựng bài giảng trình chiếu.

## Nguyên tắc cốt lõi

1. **Agent tư duy, Polaris định hình cấu trúc:** Mọi dữ liệu đều là JSON được kiểm thực chặt chẽ qua Zod schema và xuất ra Markdown hoặc định dạng đầu vào cho Aurora. Lỗi nhập liệu đi kèm gợi ý sửa đổi chính xác ("có phải ý bạn là...").
2. **Dựa trên bằng chứng (Evidence first):** Mọi ý kiến thức cốt lõi đều dẫn chiếu đến facts; mỗi fact đều trỏ về một source kèm định vị cụ thể (mốc thời gian video `[mm:ss]`, số trang `[p. N]`, mục, khoảng dòng). Nhãn phân loại rõ ràng: **[Khóa học]** (nguồn sự thật chính thức), **[Mở rộng]** (nguồn bên ngoài đã xác minh), **(chưa xác minh)** (chưa kiểm chứng).
3. **Phù hợp với người học:** Hồ sơ người học (Learner Profile) quy định ngôn ngữ (tiếng Việt chuẩn dấu), công thức buổi học (30 phút, 60 phút, lab 90 phút), phương pháp tiếp thu (lý thuyết -> neo ghi nhớ -> sổ tay giấy -> thực hành từ dễ đến khó -> đi dạo gợi nhớ; predict-then-run đối với code), và các hạn mức thời gian.
4. **Rào chắn chất lượng (Quality gates):** Kiểm tra tự động tính đầy đủ của brief, nhãn và điểm chất lượng nguồn, định vị fact, độ phủ đầu ra, đồ thị phụ thuộc module không vòng lặp (DAG), và cảnh báo các khẳng định quá mức.
5. **Tập tin thuần, không dùng cơ sở dữ liệu phức tạp:** Lưu trữ JSON và Markdown trực tiếp trong thư mục môn học (`polaris/brief.json`, `sources.json`, `facts.json`, `roadmap.json`, `captures/`, `research/`). Bản chụp văn bản và cache được giữ cục bộ và bỏ qua trong git (`.gitignore`).

## Cấu trúc thư mục

### Cấp độ Hub trung tâm (`POLARIS_HUB`, mặc định: `D:/02_Learning_Knowledge`)
```
<hub>/
└── .polaris/
    └── learner.json         # Hồ sơ người học (phương pháp, thời lượng buổi học, phong cách, cam kết)
```

### Cấp độ môn học (`<subject>/polaris/`)
```
<subject>/
├── 04_Roadmaps/
│   └── ROADMAP.md           # Lộ trình học Markdown chuẩn tiếng Việt 10 mục
└── polaris/
    ├── .gitignore           # Bỏ qua captures/ và .cache/
    ├── brief.json           # Mục tiêu, đầu ra kiểm tra được, số giờ/tuần, nguồn sự thật
    ├── sources.json         # Sổ đăng ký nguồn tài liệu (video, bài báo, trang web, ghi chú)
    ├── facts.json           # Các sự thật được trích xuất kèm định vị và ID nguồn
    ├── roadmap.json         # Cấu trúc module, 3 tầng thực hành, câu hỏi tự kiểm tra, checkpoint
    ├── .cache/              # Bộ nhớ đệm tìm kiếm 24 giờ (git-ignored)
    ├── research/            # Các file danh sách rút gọn tài liệu (vd: 2026-10-10-ai-agents.md)
    └── captures/            # Bản trích xuất toàn văn từ web/arXiv/YouTube (git-ignored)
        ├── S1.md
        └── S2.md
```

## Danh sách công cụ (v0.1 & v0.2a)

| Công cụ | Mô tả |
|---|---|
| `polaris_guide` | Tra cứu tài liệu hướng dẫn quy trình, rào chắn chất lượng, chính sách nguồn, công cụ nghiên cứu và phương pháp học. |
| `polaris_profile` | Đọc (`get`) hoặc cập nhật (`update`) hồ sơ và thói quen học tập của người học. |
| `polaris_start` | Khởi tạo thư mục môn học, thiết lập `polaris/brief.json` và cấu hình `.gitignore`. |
| `polaris_find` | Tìm kiếm tài liệu học tập qua các nhà cung cấp không cần API key với điểm số, lý do đánh giá và link Open Access. |
| `polaris_research` | Thực thi nghiên cứu đa truy vấn qua nhiều provider, lưu cache 24h, chống trùng lặp, xếp hạng, xuất file shortlist và tùy chọn tự động thêm nguồn. |
| `polaris_source_add` | Đăng ký và thu thập nội dung từ URL web, mã arXiv hoặc file cục bộ (tự động chống trùng lặp). |
| `polaris_capture` | Thu thập toàn văn tài liệu (PDF qua `pdftotext` có đánh dấu trang `[p. N]`, phụ đề YouTube qua `yt-dlp` có mốc thời gian `[mm:ss]`, văn bản web/Wikipedia). |
| `polaris_sources` | Liệt kê, tìm kiếm, lọc hoặc cập nhật thông tin trong sổ đăng ký nguồn `sources.json`. |
| `polaris_fact_add` | Ghi nhận các luận điểm sự thật kèm ID nguồn và định vị chính xác (timestamp, trang, mục, dòng). |
| `polaris_facts` | Truy vấn và lọc danh sách fact theo từ khóa, mã module hoặc mã nguồn. |
| `polaris_roadmap_save` | Kiểm tra rào chắn chất lượng, lưu `roadmap.json` và kết xuất file `ROADMAP.md`. |
| `polaris_check` | Chạy toàn bộ bài kiểm tra rào chắn chất lượng cho môn học. |

## Bộ máy nghiên cứu và tìm kiếm (v0.2a)

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

### Cổng duyệt tài liệu (Review Gate)
1. Agent gọi `polaris_research` với các từ khóa tìm kiếm cho module mục tiêu.
2. Polaris xuất file shortlist `polaris/research/<yyyy-mm-dd>-<slug>.md` gồm bảng tổng hợp và phân tích lý do đánh giá.
3. Agent trình bày top 10 kết quả cho người học duyệt trước khi đưa vào lộ trình (trừ khi bật chế độ `auto_add > 0`).
4. Các nguồn được duyệt sẽ được chụp toàn văn (đánh dấu trang `[p. N]`, mốc thời gian `[mm:ss]`) vào `captures/<id>.md`.

## Sử dụng qua dòng lệnh (CLI)

Chạy trực tiếp qua Node.js:

```bash
# Khởi động máy chủ MCP qua stdio
node dist/polaris.mjs

# Kiểm tra rào chắn chất lượng cho thư mục môn học
node dist/polaris.mjs check <subject_dir>

# Kết xuất lại ROADMAP.md từ polaris/roadmap.json
node dist/polaris.mjs render <subject_dir>

# Xem tài liệu hướng dẫn (topics: overview, pipeline, gates, sources, roadmap, research, learner, rules)
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
