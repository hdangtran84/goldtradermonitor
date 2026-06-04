#!/usr/bin/env python3
"""Dựng PDF thuyết trình (16:9) cho dự án tour-saas bằng reportlab — nhúng font DejaVu (tiếng Việt)."""
import os
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

W, H = 960, 540  # 16:9 (pt)
DEJ = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
DEJB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
pdfmetrics.registerFont(TTFont("DJ", DEJ))
pdfmetrics.registerFont(TTFont("DJB", DEJB))
REG, BOLD = "DJ", "DJB"

TEAL  = HexColor("#0F766E"); CYAN = HexColor("#0E7490"); INK = HexColor("#1F2937")
MUTED = HexColor("#6B7280"); LIGHT = HexColor("#EEF2F6"); GREEN = HexColor("#047857")
RED   = HexColor("#B91C1C"); AMBER = HexColor("#B45309"); CARD = HexColor("#E2E8F0")
ICE   = HexColor("#ECFEFF")

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "docs", "tour-saas-presentation.pdf"))
c = canvas.Canvas(OUT, pagesize=(W, H))


def rect(x, y_top, w, h, color):
    c.setFillColor(color)
    c.rect(x, H - y_top - h, w, h, stroke=0, fill=1)


def wrap(text, font, size, max_w):
    words, lines, cur = text.split(" "), [], ""
    for wd in words:
        t = (cur + " " + wd).strip()
        if pdfmetrics.stringWidth(t, font, size) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = wd
    if cur:
        lines.append(cur)
    return lines


def text(x, y_top, s, font, size, color, max_w=None, leading=None, align="l"):
    """Vẽ text theo toạ độ top; trả về y_top sau khối."""
    leading = leading or size * 1.32
    c.setFont(font, size); c.setFillColor(color)
    lines = wrap(s, font, size, max_w) if max_w else [s]
    for ln in lines:
        xx = x
        if align == "c" and max_w:
            xx = x + (max_w - pdfmetrics.stringWidth(ln, font, size)) / 2
        c.drawString(xx, H - y_top - size, ln)
        y_top += leading
    return y_top


def header(title, eyebrow):
    rect(0, 0, W, 84, TEAL)
    rect(0, 84, W, 4, CYAN)
    text(44, 16, eyebrow.upper(), BOLD, 11, HexColor("#CFEFEC"))
    text(44, 34, title, BOLD, 24, white)


def bullets(items, top=112, x=48, max_w=864, size=14, gap=11):
    y = top
    for it in items:
        lvl, txt = (it if isinstance(it, tuple) else (0, it))
        mark = "▸  " if lvl == 0 else "–  "
        indent = x + (28 if lvl else 0)
        col = INK if lvl == 0 else MUTED
        fnt = BOLD if (lvl == 0 and txt.endswith(":")) else REG
        sz = size if lvl == 0 else size - 1
        c.setFont(fnt, sz); c.setFillColor(col)
        lines = wrap(mark + txt, fnt, sz, max_w - (28 if lvl else 0))
        for i, ln in enumerate(lines):
            xx = indent if i == 0 else indent + pdfmetrics.stringWidth(mark, fnt, sz)
            c.drawString(xx, H - y - sz, ln)
            y += sz * 1.34
        y += gap


# ===== SLIDE 1 — TITLE =====
rect(0, 0, W, H, TEAL)
rect(0, 430, W, 110, CYAN)
text(64, 120, "SIÊU DỰ ÁN · TRAVEL-TECH VIỆT NAM", BOLD, 14, HexColor("#CFEFEC"))
text(64, 150, "Trợ lý Báo giá & Lịch trình Tour", BOLD, 40, white)
text(64, 200, "bằng AI", BOLD, 40, white)
text(64, 268, "SaaS nội bộ cho agency du lịch Việt Nam tự vận hành", REG, 19, HexColor("#E0F2F1"))
text(64, 452, "Tổng hợp nghiên cứu thị trường (có trích dẫn) + MVP đã chạy được", REG, 13, white)
text(64, 478, "Nhánh: claude/travel-booking-saas-ai-dURHV   ·   Pull Request #1", REG, 12, HexColor("#D0ECEA"))
c.showPage()

# ===== SLIDE 2 — CƠ HỘI =====
header("Cơ hội thị trường: thời điểm vàng", "Bối cảnh")
bullets([
  "81% du khách Việt dự định dùng AI cho chuyến đi tới — CAO NHẤT châu Á (Agoda 2026)",
  "Outbound bùng nổ: ~6,7 triệu lượt năm 2025 (+26%), chi trung bình ~36 triệu đ/chuyến",
  "Nội địa: hơn 110 triệu lượt khách năm 2024",
  "OTA ngoại chiếm ~80% thị trường online → cửa thắng là TOOLING B2B cho operator, KHÔNG phải OTA tiêu dùng",
  "Zalo: ~77 triệu MAU — 'đường ray' giao dịch & chốt tour ở Việt Nam",
], size=15.5, gap=14)
c.showPage()

# ===== SLIDE 3 — NỖI ĐAU =====
header("Nỗi đau hiện tại của agency", "Vấn đề")
bullets([
  "Sale tốn 1–2 GIỜ để soạn một báo giá thủ công: tra giá khách sạn → gõ Excel → tính markup → format PDF",
  "Rớt khách ngoài giờ; quy trình thủ công, dễ sai số, khó nhân bản",
  "Phần mềm incumbent VN (TravelMaster…) mạnh sổ sách/chiết tính nhưng KHÔNG có AI, KHÔNG Zalo native",
  "Tool AI quốc tế (Mindtrip, Layla…) chỉ là 'máy tạo ý tưởng' cho khách lẻ:",
  (1, "Không có inventory/giá Việt Nam, không báo giá có cost/margin, không brand agency"),
], size=15.5, gap=14)
c.showPage()

# ===== SLIDE 4 — GIẢI PHÁP =====
header("Giải pháp — mũi nhọn (wedge)", "Định vị")
y = text(48, 110, "Nhập yêu cầu khách (tiếng Việt) → AI dựng lịch trình + chiết tính giá trên KHO NHÀ "
                   "CUNG CẤP RIÊNG → proposal có brand → chốt qua Zalo",
         BOLD, 17, TEAL, max_w=864, leading=24)
yy = 210
for ttl, desc in [
    ("Dữ liệu giá đã đàm phán riêng", "Kho net rate của agency — thứ các tool toàn cầu không có"),
    ("Tiếng Việt + bối cảnh địa phương", "Hiểu yêu cầu, viết lịch trình tự nhiên cho khách Việt"),
    ("Báo giá có cost/margin + Zalo", "Chiết tính chuẩn nghiệp vụ; chốt trên kênh người Việt dùng"),
]:
    rect(48, yy, 864, 80, LIGHT); rect(48, yy, 8, 80, TEAL)
    text(70, yy + 16, "MOAT · " + ttl, BOLD, 15, INK)
    text(70, yy + 44, desc, REG, 13, MUTED)
    yy += 92
c.showPage()

# ===== SLIDE 5 — BẢNG SO SÁNH =====
header("Khoảng trống: không ai làm trọn combo", "Đối thủ")
rows = [
    ["Tiêu chí", "ToursMS", "TravelMaster", "AI quốc tế", "DỰ ÁN NÀY"],
    ["AI lịch trình tiếng Việt", "Quảng cáo", "Không", "Không có VN", "Có"],
    ["Kho giá riêng + markup/VAT", "Quảng cáo", "Mạnh", "Không", "Có"],
    ["Tích hợp Zalo", "Quảng cáo", "Không", "Không", "Roadmap"],
    ["Dấu vết / độ tin cậy", "Không có", "Đã kiểm chứng", "Khách lẻ", "Tự kiểm soát"],
]
def ccolor(t):
    if t in ("Có", "Mạnh", "Đã kiểm chứng"): return GREEN
    if t in ("Không", "Không có", "Không có VN"): return RED
    if t in ("Quảng cáo", "Khách lẻ"): return AMBER
    if t in ("Roadmap", "Tự kiểm soát"): return CYAN
    return INK
x0, y0 = 48, 112
col_w = [240, 156, 156, 156, 156]
row_h = 64
xpos = [x0]
for w in col_w[:-1]:
    xpos.append(xpos[-1] + w)
for r, row in enumerate(rows):
    yt = y0 + r * row_h
    for ccol, val in enumerate(row):
        cx, cw = xpos[ccol], col_w[ccol]
        if r == 0:
            rect(cx, yt, cw, row_h, TEAL); col = white; fnt = BOLD; sz = 13
        elif ccol == len(row) - 1:
            rect(cx, yt, cw, row_h, ICE); col = ccolor(val); fnt = BOLD; sz = 13
        else:
            rect(cx, yt, cw, row_h, white if r % 2 else LIGHT)
            col = INK if ccol == 0 else ccolor(val)
            fnt = BOLD if (ccol == 0 or val in ("Mạnh", "Đã kiểm chứng")) else REG
            sz = 12.5
        c.setStrokeColor(HexColor("#D7DEE6")); c.setLineWidth(0.5)
        c.rect(cx, H - yt - row_h, cw, row_h, stroke=1, fill=0)
        c.setFont(fnt, sz); c.setFillColor(col)
        lines = wrap(val, fnt, sz, cw - 16)
        ty = yt + (row_h - len(lines) * sz * 1.2) / 2
        for ln in lines:
            if ccol == 0:
                tx = cx + 10
            else:
                tx = cx + (cw - pdfmetrics.stringWidth(ln, fnt, sz)) / 2
            c.drawString(tx, H - ty - sz, ln); ty += sz * 1.2
text(48, y0 + len(rows) * row_h + 12,
     "ToursMS hứa đủ nhưng KHÔNG có dấu vết độc lập nào · TravelMaster mạnh chiết tính nhưng thiếu AI & Zalo",
     REG, 12, MUTED, max_w=864)
c.showPage()

# ===== SLIDE 6 — SẢN PHẨM =====
header("Sản phẩm — luồng vận hành", "Cách hoạt động")
steps = [
    ("1", "Yêu cầu khách", "Tiếng Việt, qua web / Zalo / tin nhắn"),
    ("2", "AI dựng lịch trình", "Theo ngày + chọn dịch vụ từ kho giá riêng"),
    ("3", "Chiết tính giá", "net → markup → VAT → giá bán → margin"),
    ("4", "Proposal có brand", "Link đẹp gửi khách / xuất PDF"),
]
cw, gap = 210, 8
x = 48
for n, ttl, desc in steps:
    rect(x, 130, cw, 230, LIGHT); rect(x, 130, cw, 46, TEAL)
    text(x, 142, "BƯỚC " + n, BOLD, 13, white, max_w=cw, align="c")
    text(x + 14, 196, ttl, BOLD, 15.5, INK, max_w=cw - 28)
    text(x + 14, 240, desc, REG, 12.5, MUTED, max_w=cw - 28, leading=17)
    x += cw + gap
text(48, 400, "Nguyên tắc khóa: GIÁ đến từ kho nhà cung cấp — AI chỉ CHỌN dịch vụ, KHÔNG bịa giá.",
     BOLD, 16, TEAL, max_w=864)
c.showPage()

# ===== SLIDE 7 — KIẾN TRÚC =====
header("Kiến trúc kỹ thuật", "Bên dưới")
bullets([
  "LLM (Claude) điều phối + structured JSON output cho lịch trình",
  "Kho giá NCC = 'hard data' (RAG-ready); AI chỉ chọn serviceId có thật → chống bịa giá / hallucinate",
  "Quote engine TÁCH RIÊNG, có unit test — phần tiền phải chuẩn như TravelMaster",
  "Proposal renderer: HTML có brand → in PDF; Fallback theo luật khi không có API key",
  "Stack:",
  (1, "Node.js / TypeScript · Express · @anthropic-ai/sdk (claude-opus-4-8) · pgvector (roadmap)"),
], size=15, gap=14)
c.showPage()

# ===== SLIDE 8 — MVP =====
header("MVP đã build — chạy được ngay", "Hiện trạng")
bullets([
  "Đã chạy end-to-end, nằm trong Pull Request #1",
  "Kho giá mẫu 6 điểm đến: Đà Nẵng, Hạ Long/Hà Nội, Phú Quốc, Tokyo, Bangkok",
  "AI sinh lịch trình + chiết tính giá + proposal có brand (link đẹp / PDF)",
  "Phần chiết tính giá: 6/6 unit test PASS",
  "Chạy được CẢ KHI không có API key (chế độ fallback theo luật)",
  "Demo Phú Quốc 4 khách: net 24,8tr → tổng 32,19tr (markup 18%, VAT 10%) · lợi nhuận gộp 15,25%",
], size=15, gap=13)
c.showPage()

# ===== SLIDE 9 — CHI PHÍ =====
header("Chi phí vận hành — rất nhẹ", "Kinh tế")
bullets([
  "~3,7¢ / báo giá (Haiku) → ~10–20¢ (Opus) — chọn model theo nhu cầu chất lượng vs chi phí",
  "Embed cả kho giá ~1 USD một lần; vector DB pgvector gần như miễn phí",
  "Tổng vận hành ở volume thấp: ~20–150 USD/tháng — hoàn toàn trong tầm solo / team nhỏ",
  "Prompt caching giảm mạnh chi phí phần input lặp lại (kho giá + hướng dẫn)",
], size=15.5, gap=16)
c.showPage()

# ===== SLIDE 10 — BUILD VS BUY =====
header("Build vs Buy — khuyến nghị", "Chiến lược")
bullets([
  "KHÔNG buy mù: ToursMS / TourPRO chưa có review, khách hàng, hay app store nào kiểm chứng được",
  "Buy có kiểm chứng: dùng thử ToursMS (14 ngày) + TravelMaster (trial) để benchmark",
  "BUILD phần lõi giá trị (moat): AI tiếng Việt + kho giá riêng + Zalo",
  "Học chuẩn chiết tính của TravelMaster (net→markup→VAT); chưa cần API vé/khách sạn live ở giai đoạn đầu",
], size=15.5, gap=15)
c.showPage()

# ===== SLIDE 11 — ROADMAP =====
header("Lộ trình phát triển", "Roadmap")
phases = [
    ("Giai đoạn 1 — XONG", "MVP: báo giá + lịch trình AI + proposal có brand", GREEN),
    ("Giai đoạn 2", "Tích hợp Zalo OA · Quản lý giá theo mùa / loại phòng", CYAN),
    ("Giai đoạn 3", "Giá vé/KS live: Duffel (có VNA), RateHawk/TBO, Travelfusion (Vietjet)", TEAL),
    ("Giai đoạn 4", "Postgres + pgvector (RAG kho lớn) · Xuất PDF server-side", INK),
]
yy = 118
for ph, desc, col in phases:
    rect(48, yy, 8, 84, col); rect(64, yy, 848, 84, LIGHT)
    text(84, yy + 16, ph, BOLD, 15, col)
    text(84, yy + 44, desc, REG, 13.5, INK, max_w=820)
    yy += 96
c.showPage()

# ===== SLIDE 12 — KẾT LUẬN =====
rect(0, 0, W, H, TEAL); rect(0, 0, W, 6, CYAN)
text(64, 60, "Kết luận & bước tiếp theo", BOLD, 30, white)
yy = 150
for it in [
  "Khoảng trống thị trường có thật — và Việt Nam là nơi khát AI du lịch nhất châu Á",
  "MVP đã chứng minh luồng lõi; chi phí vận hành rất nhẹ (~20–150 USD/tháng)",
  "Moat = dữ liệu giá riêng + tiếng Việt + Zalo — thứ đối thủ không có",
  "Tiếp theo: benchmark ToursMS/TravelMaster → build Zalo + giá theo mùa",
]:
    yy = text(70, yy, "▸  " + it, REG, 17, white, max_w=830, leading=24) + 14
rect(0, 474, W, 66, CYAN)
text(64, 492, "Mã nguồn: nhánh claude/travel-booking-saas-ai-dURHV · Pull Request #1", REG, 13, white)
c.showPage()

c.save()
print("Saved", OUT)
