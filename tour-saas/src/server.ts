import express from "express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getServiceMap, listDestinations } from "./catalog.js";
import { buildQuote } from "./quote.js";
import {
  aiEnabled,
  generateItineraryAI,
  generateItineraryFallback,
} from "./itinerary.js";
import { renderProposalHtml } from "./proposal.js";
import type { Proposal, QuoteRequest } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const AGENCY_NAME = process.env.TOUR_AGENCY_NAME || "Công ty Du lịch ABC Travel";
const VAT_DEFAULT = Number(process.env.TOUR_VAT_PERCENT || 10);
const USD_RATE = Number(process.env.TOUR_USD_VND_RATE || 25400);
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "..", "public")));

// Lưu proposal trong bộ nhớ (MVP). Production: thay bằng Postgres.
const proposals = new Map<string, Proposal>();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, aiEnabled: aiEnabled(), destinations: listDestinations() });
});

// Sinh lịch trình + chiết tính giá + tạo proposal.
app.post("/api/quote", async (req, res) => {
  try {
    const body = req.body as QuoteRequest;
    const request = (body.request || "").trim();
    const pax = Math.max(1, Math.floor(Number(body.pax) || 1));
    if (!request) return res.status(400).json({ error: "Thiếu yêu cầu của khách." });

    let source: "ai" | "fallback" = "fallback";
    let plan;
    if (aiEnabled()) {
      try {
        plan = await generateItineraryAI(request, pax);
        source = "ai";
      } catch (e) {
        console.error("AI lỗi, dùng fallback:", e);
        plan = generateItineraryFallback(request, pax);
      }
    } else {
      plan = generateItineraryFallback(request, pax);
    }

    const markupPercent =
      body.markupPercent != null && Number.isFinite(Number(body.markupPercent))
        ? Number(body.markupPercent)
        : plan.suggestedMarkupPercent;
    const vatPercent =
      body.vatPercent != null && Number.isFinite(Number(body.vatPercent))
        ? Number(body.vatPercent)
        : VAT_DEFAULT;

    const quote = buildQuote({
      selected: plan.selectedServices,
      serviceMap: getServiceMap(),
      pax,
      markupPercent,
      vatPercent,
      usdRate: USD_RATE,
    });

    const proposal: Proposal = {
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      agencyName: AGENCY_NAME,
      request,
      plan,
      quote,
      source,
    };
    proposals.set(proposal.id, proposal);

    res.json({ proposal, proposalUrl: `/p/${proposal.id}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Lỗi máy chủ khi tạo báo giá." });
  }
});

// Trang proposal có brand (link gửi khách).
app.get("/p/:id", (req, res) => {
  const p = proposals.get(req.params.id);
  if (!p) return res.status(404).send("Không tìm thấy báo giá.");
  res.set("Content-Type", "text/html; charset=utf-8").send(renderProposalHtml(p));
});

app.listen(PORT, () => {
  console.log(`tour-saas chạy tại http://localhost:${PORT}`);
  console.log(`AI ${aiEnabled() ? "BẬT (" + (process.env.TOUR_AI_MODEL || "claude-opus-4-8") + ")" : "TẮT — chế độ fallback (đặt ANTHROPIC_API_KEY để bật)"}`);
});
