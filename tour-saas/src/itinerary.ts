import Anthropic from "@anthropic-ai/sdk";
import { loadCatalog, listDestinations, servicesForDestination } from "./catalog.js";
import type { ItineraryDay, ItineraryPlan, SelectedService, Service } from "./types.js";

const MODEL = process.env.TOUR_AI_MODEL || "claude-opus-4-8";

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ---- Prompt + schema --------------------------------------------------------

// Liệt kê kho giá thành các dòng gọn để Claude CHỌN serviceId có thật.
function catalogLines(): string {
  return loadCatalog()
    .services.map(
      (s) =>
        `${s.id} | ${s.destination} | ${s.category} | ${s.unit} | net=${s.netPrice} VND | ${s.name}`,
    )
    .join("\n");
}

function systemPrompt(): string {
  return [
    "Bạn là trợ lý điều hành tour cho một công ty du lịch Việt Nam.",
    "Nhiệm vụ: từ yêu cầu của khách (tiếng Việt), dựng LỊCH TRÌNH theo ngày và CHỌN các dịch vụ từ KHO GIÁ NHÀ CUNG CẤP dưới đây.",
    "",
    "QUY TẮC BẮT BUỘC:",
    '- Chỉ được dùng "serviceId" có thật trong kho. Tuyệt đối KHÔNG bịa dịch vụ hay giá.',
    "- KHÔNG ghi bất kỳ con số tiền nào trong lịch trình — phần tính tiền do hệ thống lo.",
    "- Tính quantity đúng đơn vị:",
    "    + per_person: quantity thường = 1 (hệ thống tự nhân số khách).",
    "    + per_night_room (khách sạn): quantity = số_phòng × số_đêm; số_phòng = trần(số_khách / 2).",
    "    + per_unit (xe, HDV...): quantity = số ngày sử dụng.",
    "- Ưu tiên dịch vụ đúng điểm đến khách yêu cầu.",
    "- Lịch trình viết tiếng Việt, súc tích, mỗi ngày 2-4 câu, có điểm nhấn trải nghiệm.",
    "- suggestedMarkupPercent: gợi ý markup hợp lý (tour nội địa ~15-20%, outbound ~18-25%).",
    "",
    `Các điểm đến đang có giá: ${listDestinations().join(", ")}.`,
    "",
    "KHO GIÁ NHÀ CUNG CẤP (id | điểm đến | nhóm | đơn vị | giá net | tên):",
    catalogLines(),
  ].join("\n");
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tourTitle: { type: "string" },
    summary: { type: "string" },
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          dayNumber: { type: "integer" },
          title: { type: "string" },
          description: { type: "string" },
        },
        required: ["dayNumber", "title", "description"],
      },
    },
    selectedServices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          serviceId: { type: "string" },
          quantity: { type: "integer" },
          note: { type: "string" },
        },
        required: ["serviceId", "quantity", "note"],
      },
    },
    suggestedMarkupPercent: { type: "number" },
  },
  required: ["tourTitle", "summary", "days", "selectedServices", "suggestedMarkupPercent"],
} as const;

// ---- AI generation ----------------------------------------------------------

export async function generateItineraryAI(request: string, pax: number): Promise<ItineraryPlan> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    // Cache khối system (hướng dẫn + toàn bộ kho giá) — phần ổn định, lặp lại mỗi request.
    system: [
      { type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } },
    ],
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `Số khách: ${pax}.\nYêu cầu của khách: ${request}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Không nhận được nội dung JSON từ model.");
  }
  const raw = JSON.parse(text.text) as ItineraryPlan;
  return sanitizePlan(raw);
}

/** Bỏ các serviceId không tồn tại trong kho (an toàn dù model có sai sót). */
function sanitizePlan(plan: ItineraryPlan): ItineraryPlan {
  const catalog = loadCatalog();
  const valid = new Set(catalog.services.map((s) => s.id));
  const selected = (plan.selectedServices || [])
    .filter((s) => valid.has(s.serviceId))
    .map((s) => ({ ...s, quantity: Math.max(1, Math.floor(s.quantity || 1)) }));
  return {
    tourTitle: plan.tourTitle || "Chương trình tour",
    summary: plan.summary || "",
    days: (plan.days || []).sort((a, b) => a.dayNumber - b.dayNumber),
    selectedServices: selected,
    suggestedMarkupPercent: clampMarkup(plan.suggestedMarkupPercent),
  };
}

function clampMarkup(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 18;
  return Math.min(60, Math.max(5, Math.round(n)));
}

// ---- Deterministic fallback (không cần API key) -----------------------------

export function generateItineraryFallback(request: string, pax: number): ItineraryPlan {
  const destination = detectDestination(request);
  const days = detectDays(request);
  const nights = Math.max(1, days - 1);
  const rooms = Math.max(1, Math.ceil(pax / 2));
  const services = servicesForDestination(destination);

  const selected: SelectedService[] = [];
  const pick = (cat: string): Service | undefined => services.find((s) => s.category === cat);

  const flight = pick("flight");
  if (flight) selected.push({ serviceId: flight.id, quantity: 1, note: "Vé khứ hồi" });

  const hotel = pick("hotel");
  if (hotel)
    selected.push({
      serviceId: hotel.id,
      quantity: rooms * nights,
      note: `${rooms} phòng × ${nights} đêm`,
    });

  const cruise = services.find((s) => s.category === "activity" && /thuyền|cruise/i.test(s.name));
  if (cruise) selected.push({ serviceId: cruise.id, quantity: 1, note: "Trải nghiệm nổi bật" });

  const transport = pick("transport");
  if (transport) selected.push({ serviceId: transport.id, quantity: days, note: `${days} ngày xe` });

  const guide = pick("guide");
  if (guide) selected.push({ serviceId: guide.id, quantity: days, note: `${days} ngày HDV` });

  for (const act of services.filter((s) => s.category === "activity").slice(0, 2)) {
    if (!selected.some((s) => s.serviceId === act.id))
      selected.push({ serviceId: act.id, quantity: 1, note: "Hoạt động tham quan" });
  }
  const visa = pick("visa");
  if (visa) selected.push({ serviceId: visa.id, quantity: 1, note: "Hỗ trợ visa" });

  const dayPlans: ItineraryDay[] = [];
  for (let d = 1; d <= days; d++) {
    if (d === 1)
      dayPlans.push({
        dayNumber: 1,
        title: `Khởi hành đến ${destination}`,
        description: `Đón khách, di chuyển đến ${destination}, nhận phòng khách sạn và nghỉ ngơi. Buổi tối tự do khám phá khu trung tâm.`,
      });
    else if (d === days)
      dayPlans.push({
        dayNumber: d,
        title: "Tự do mua sắm & tiễn sân bay",
        description: `Ăn sáng, tự do mua sắm đặc sản, làm thủ tục trả phòng và ra sân bay kết thúc chương trình ${destination}.`,
      });
    else
      dayPlans.push({
        dayNumber: d,
        title: `Tham quan ${destination}`,
        description: `Khám phá các điểm nổi bật của ${destination} theo chương trình, trải nghiệm ẩm thực và hoạt động đặc trưng địa phương.`,
      });
  }

  return {
    tourTitle: `Tour ${destination} ${days} ngày ${nights} đêm`,
    summary: `Chương trình ${days} ngày ${nights} đêm tại ${destination} cho ${pax} khách (bản nháp tạo tự động — chưa dùng AI).`,
    days: dayPlans,
    selectedServices: selected,
    suggestedMarkupPercent: /tokyo|nhật|bangkok|thái|quốc tế|nước ngoài/i.test(request) ? 22 : 18,
  };
}

function detectDestination(request: string): string {
  const r = request.toLowerCase();
  for (const d of listDestinations()) {
    if (r.includes(d.toLowerCase())) return d;
  }
  // vài alias phổ biến
  if (/hạ long|halong/.test(r)) return "Hạ Long";
  if (/hà nội|hanoi/.test(r)) return "Hà Nội";
  if (/nhật|japan/.test(r)) return "Tokyo";
  if (/thái|thailand/.test(r)) return "Bangkok";
  return listDestinations()[0];
}

function detectDays(request: string): number {
  const m = request.match(/(\d+)\s*ng[àa]y/i);
  if (m) return Math.min(14, Math.max(2, parseInt(m[1], 10)));
  return 3;
}
