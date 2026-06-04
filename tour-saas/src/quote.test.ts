import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuote, lineNetCost } from "./quote.js";
import type { Service } from "./types.js";

const flight: Service = {
  id: "F",
  destination: "X",
  category: "flight",
  name: "Vé",
  supplier: "S",
  unit: "per_person",
  netPrice: 2_000_000,
};
const hotel: Service = {
  id: "H",
  destination: "X",
  category: "hotel",
  name: "KS",
  supplier: "S",
  unit: "per_night_room",
  netPrice: 1_000_000,
};
const car: Service = {
  id: "C",
  destination: "X",
  category: "transport",
  name: "Xe",
  supplier: "S",
  unit: "per_unit",
  netPrice: 1_500_000,
};

const map = new Map<string, Service>([
  ["F", flight],
  ["H", hotel],
  ["C", car],
]);

test("lineNetCost: per_person nhân pax × quantity", () => {
  assert.equal(lineNetCost(flight, 1, 4), 8_000_000); // 2tr × 4 khách × 1
});

test("lineNetCost: per_night_room chỉ nhân quantity, không nhân pax", () => {
  assert.equal(lineNetCost(hotel, 6, 4), 6_000_000); // 1tr × 6 (2 phòng×3 đêm)
});

test("lineNetCost: per_unit chỉ nhân quantity", () => {
  assert.equal(lineNetCost(car, 3, 4), 4_500_000);
});

test("buildQuote: net → markup → VAT → tổng giá đúng", () => {
  // 4 khách: vé 4×2tr=8tr, KS 2 phòng×3 đêm×1tr=6tr, xe 3 ngày×1.5tr=4.5tr → net 18.5tr
  const q = buildQuote({
    selected: [
      { serviceId: "F", quantity: 1 },
      { serviceId: "H", quantity: 6 },
      { serviceId: "C", quantity: 3 },
    ],
    serviceMap: map,
    pax: 4,
    markupPercent: 20,
    vatPercent: 10,
    usdRate: 25_000,
  });

  assert.equal(q.netTotal, 18_500_000);
  assert.equal(q.sellingBeforeVat, 22_200_000); // ×1.2
  assert.equal(q.vatAmount, 2_220_000); // 10%
  assert.equal(q.totalPrice, 24_420_000);
  assert.equal(q.grossMargin, 3_700_000); // 22.2tr - 18.5tr
  assert.equal(q.marginPercent, round2((3_700_000 / 22_200_000) * 100));
  assert.equal(q.pricePerPax, 6_105_000); // 24.42tr / 4
  assert.equal(q.totalPriceUsd, round2(24_420_000 / 25_000));
});

test("buildQuote: bỏ qua serviceId không tồn tại (AI không được bịa)", () => {
  const q = buildQuote({
    selected: [
      { serviceId: "F", quantity: 1 },
      { serviceId: "GHOST", quantity: 99 },
    ],
    serviceMap: map,
    pax: 2,
    markupPercent: 0,
    vatPercent: 0,
    usdRate: 25_000,
  });
  assert.equal(q.lineItems.length, 1);
  assert.equal(q.netTotal, 4_000_000); // chỉ tính vé 2×2tr
  assert.equal(q.totalPrice, 4_000_000); // markup 0, vat 0
});

test("buildQuote: markup 0 và vat 0 → giá bán = net", () => {
  const q = buildQuote({
    selected: [{ serviceId: "C", quantity: 1 }],
    serviceMap: map,
    pax: 1,
    markupPercent: 0,
    vatPercent: 0,
    usdRate: 25_000,
  });
  assert.equal(q.totalPrice, q.netTotal);
  assert.equal(q.grossMargin, 0);
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
