# tour-saas — MVP báo giá + lịch trình tour bằng AI

Công cụ nội bộ cho **một agency du lịch Việt Nam tự vận hành**. Hiện thực đúng "mũi nhọn" (wedge) mà nghiên cứu thị trường chỉ ra:

> Nhập yêu cầu khách bằng tiếng Việt → **AI dựng lịch trình** + **chiết tính giá trên KHO NHÀ CUNG CẤP RIÊNG** (net → markup → VAT → giá bán) → **proposal có brand** (link đẹp / in PDF).

Đây là 3 thứ tạo hào mà ToursMS chưa chứng minh được và TravelMaster không có: **dữ liệu giá riêng + tiếng Việt + báo giá có margin**.

## Chạy thử

```bash
cd tour-saas
npm install
cp .env.example .env      # (tuỳ chọn) điền ANTHROPIC_API_KEY để bật AI thật
npm start                 # http://localhost:3000
npm test                  # kiểm thử phần chiết tính giá (phần tiền)
```

- **Không có `ANTHROPIC_API_KEY`** → app vẫn chạy đầy đủ luồng bằng **fallback sinh lịch trình theo luật** (không tốn token). Badge "Bản nháp".
- **Có key** → dùng Claude (`claude-opus-4-8` mặc định) sinh lịch trình tiếng Việt, badge "Tạo bằng AI". Đổi `TOUR_AI_MODEL=claude-haiku-4-5` để rẻ hơn cho volume lớn.

## Kiến trúc (theo đúng khuyến nghị nghiên cứu)

```
Yêu cầu khách (tiếng Việt)
        │
        ▼
 itinerary.ts ── Claude (structured JSON output, prompt-cached catalog, adaptive thinking)
        │         • AI chỉ CHỌN serviceId có thật, KHÔNG bịa giá  ← "hard data" từ kho, không từ LLM
        │         • fallback theo luật khi không có API key
        ▼
 quote.ts ────── Chiết tính: net → markup → VAT → giá bán → margin → giá/khách (đa tiền tệ)
        │         • phần nghiệp vụ cốt lõi, có test (src/quote.test.ts)
        ▼
 proposal.ts ─── HTML có brand, tự chứa, in PDF được (Ctrl/Cmd+P)
```

- `data/suppliers.json` — **kho giá nhà cung cấp (net rates)**, chính là tài sản/moat của agency. Thay bằng giá đã đàm phán thật của bạn.
- Nguyên tắc khóa: **giá đến từ kho, không đến từ AI**. AI chỉ chọn dịch vụ + viết mô tả; mọi con số do `quote.ts` tính.

## Cấu trúc

| File | Vai trò |
|---|---|
| `data/suppliers.json` | Kho giá NCC (net, VND), nhiều điểm đến nội địa + outbound |
| `src/catalog.ts` | Đọc & lọc kho giá |
| `src/quote.ts` | Chiết tính giá (net→markup→VAT→margin) — **có test** |
| `src/itinerary.ts` | Sinh lịch trình: Claude (structured output) + fallback theo luật |
| `src/proposal.ts` | Render proposal HTML có brand |
| `src/server.ts` | Express API + phục vụ proposal |
| `public/index.html` | Giao diện nhập yêu cầu |

## Còn thiếu (roadmap, theo nghiên cứu — làm sau)

1. **Lưu trữ thật** (Postgres + pgvector) thay cho `Map` trong RAM; RAG khi kho NCC lớn.
2. **Tích hợp Zalo OA** — nhận yêu cầu & gửi proposal qua Zalo (kênh giao dịch chính ở VN).
3. **Giá vé/khách sạn live** — Duffel (có Vietnam Airlines), RateHawk/TBO; Travelfusion cho Vietjet.
4. **Quản lý kho giá theo mùa** (rate theo thời điểm/loại phòng) — chuẩn của TravelMaster cần làm bằng.
5. **Xuất PDF server-side** (Puppeteer/WeasyPrint) nếu cần file thay vì in từ trình duyệt.

> Trước khi mở rộng: nên dùng thử ToursMS (14 ngày free) + TravelMaster (trial) để benchmark — xem build tiếp hay mua.
