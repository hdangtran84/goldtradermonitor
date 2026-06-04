import type { Proposal } from "./types.js";

const vnd = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫";
const usd = (n: number) => "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/**
 * Sinh proposal HTML có brand, tự chứa (in ra PDF được bằng Ctrl/Cmd+P).
 * Đây là bản "link đẹp" gửi khách — đúng deliverable mà nghiên cứu chỉ ra.
 */
export function renderProposalHtml(p: Proposal): string {
  const { plan, quote } = p;

  const days = plan.days
    .map(
      (d) => `
      <div class="day">
        <div class="day-no">Ngày ${d.dayNumber}</div>
        <div class="day-body">
          <h3>${esc(d.title)}</h3>
          <p>${esc(d.description)}</p>
        </div>
      </div>`,
    )
    .join("");

  const lines = quote.lineItems
    .map(
      (li) => `
      <tr>
        <td>${esc(li.name)}<div class="muted">${esc(li.supplier)} · ${esc(li.category)}</div></td>
        <td class="num">${vnd(li.netPrice)}</td>
        <td class="num">${li.unit === "per_person" ? `${li.paxApplied} khách × ${li.quantity}` : `×${li.quantity}`}</td>
        <td class="num">${vnd(li.lineNet)}</td>
      </tr>`,
    )
    .join("");

  const sourceBadge =
    p.source === "ai"
      ? `<span class="badge badge-ai">Tạo bằng AI</span>`
      : `<span class="badge badge-fb">Bản nháp (chưa dùng AI)</span>`;

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(plan.tourTitle)} — ${esc(p.agencyName)}</title>
<style>
  :root { --brand:#0f766e; --ink:#1f2937; --muted:#6b7280; --line:#e5e7eb; --bg:#f8fafc; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         color:var(--ink); background:var(--bg); line-height:1.55; }
  .sheet { max-width: 880px; margin: 24px auto; background:#fff; border:1px solid var(--line);
           border-radius:14px; overflow:hidden; }
  header { background:linear-gradient(135deg,var(--brand),#0e7490); color:#fff; padding:28px 32px; }
  header .agency { font-size:13px; opacity:.9; letter-spacing:.5px; text-transform:uppercase; }
  header h1 { margin:6px 0 4px; font-size:26px; }
  header .sub { opacity:.95; font-size:14px; }
  .badge { display:inline-block; font-size:11px; padding:2px 8px; border-radius:999px; margin-left:8px; vertical-align:middle; }
  .badge-ai { background:#ecfeff; color:#0e7490; }
  .badge-fb { background:#fef9c3; color:#854d0e; }
  section { padding:22px 32px; border-top:1px solid var(--line); }
  h2 { font-size:16px; margin:0 0 14px; color:var(--brand); }
  .summary { font-size:15px; color:#374151; }
  .day { display:flex; gap:16px; padding:12px 0; border-bottom:1px dashed var(--line); }
  .day:last-child { border-bottom:0; }
  .day-no { flex:0 0 72px; font-weight:700; color:var(--brand); }
  .day-body h3 { margin:0 0 4px; font-size:15px; }
  .day-body p { margin:0; color:#374151; font-size:14px; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th, td { text-align:left; padding:9px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; }
  td.num, th.num { text-align:right; white-space:nowrap; }
  .muted { color:var(--muted); font-size:12px; }
  .totals { margin-top:14px; margin-left:auto; width:340px; }
  .totals .row { display:flex; justify-content:space-between; padding:6px 0; font-size:14px; }
  .totals .row.grand { border-top:2px solid var(--brand); margin-top:6px; padding-top:10px;
                       font-size:18px; font-weight:800; color:var(--brand); }
  .totals .row.margin { color:#047857; }
  .perpax { background:var(--bg); border-radius:10px; padding:12px 14px; margin-top:14px;
            display:flex; justify-content:space-between; font-weight:700; }
  footer { padding:18px 32px; color:var(--muted); font-size:12px; }
  .internal { background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; }
  @media print { body{background:#fff;} .sheet{border:0; margin:0; max-width:100%;} .noprint{display:none;} }
</style>
</head>
<body>
  <div class="sheet">
    <header>
      <div class="agency">${esc(p.agencyName)}</div>
      <h1>${esc(plan.tourTitle)} ${sourceBadge}</h1>
      <div class="sub">Báo giá cho ${quote.pax} khách · Mã: ${esc(p.id)} · ${new Date(p.createdAt).toLocaleDateString("vi-VN")}</div>
    </header>

    <section>
      <h2>Giới thiệu chương trình</h2>
      <p class="summary">${esc(plan.summary)}</p>
    </section>

    <section>
      <h2>Lịch trình chi tiết</h2>
      ${days}
    </section>

    <section>
      <h2>Bảng chiết tính dịch vụ (giá net)</h2>
      <table>
        <thead><tr><th>Dịch vụ</th><th class="num">Đơn giá net</th><th class="num">Số lượng</th><th class="num">Thành tiền</th></tr></thead>
        <tbody>${lines}</tbody>
      </table>

      <div class="totals">
        <div class="row"><span>Tổng chi phí net</span><span>${vnd(quote.netTotal)}</span></div>
        <div class="row"><span>Markup (${quote.markupPercent}%)</span><span>${vnd(quote.grossMargin)}</span></div>
        <div class="row"><span>Giá bán trước VAT</span><span>${vnd(quote.sellingBeforeVat)}</span></div>
        <div class="row"><span>VAT (${quote.vatPercent}%)</span><span>${vnd(quote.vatAmount)}</span></div>
        <div class="row grand"><span>TỔNG GIÁ TOUR</span><span>${vnd(quote.totalPrice)}</span></div>
        <div class="row"><span>Tham khảo (USD)</span><span>${usd(quote.totalPriceUsd)}</span></div>
      </div>

      <div class="perpax">
        <span>Giá mỗi khách</span>
        <span>${vnd(quote.pricePerPax)}</span>
      </div>
    </section>

    <section class="internal noprint">
      <h2>Thông tin nội bộ (không hiển thị cho khách khi in)</h2>
      <div class="totals" style="width:100%">
        <div class="row margin"><span>Lợi nhuận gộp dự kiến</span><span>${vnd(quote.grossMargin)} (${quote.marginPercent}%)</span></div>
      </div>
    </section>

    <footer>
      Báo giá có giá trị tham khảo trong 7 ngày. Giá có thể thay đổi theo thời điểm đặt dịch vụ thực tế.
      © ${new Date().getFullYear()} ${esc(p.agencyName)}.
    </footer>
  </div>
</body>
</html>`;
}
