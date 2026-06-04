import type {
  Quote,
  QuoteLineItem,
  SelectedService,
  Service,
} from "./types.js";

/**
 * Tính chi phí net của một dòng dịch vụ.
 *  - per_person     : netPrice × pax × quantity
 *  - các đơn vị khác : netPrice × quantity (không nhân pax)
 */
export function lineNetCost(service: Service, quantity: number, pax: number): number {
  const qty = Math.max(0, quantity);
  if (service.unit === "per_person") return service.netPrice * pax * qty;
  return service.netPrice * qty;
}

export interface BuildQuoteParams {
  selected: SelectedService[];
  serviceMap: Map<string, Service>;
  pax: number;
  markupPercent: number;
  vatPercent: number;
  usdRate: number;
}

/**
 * Chiết tính giá tour: net → markup → giá bán → VAT → tổng giá.
 * Đây là phần nghiệp vụ cốt lõi; làm sai là mất tin cậy, nên giữ rõ ràng & test kỹ.
 */
export function buildQuote(params: BuildQuoteParams): Quote {
  const { selected, serviceMap, markupPercent, vatPercent, usdRate } = params;
  const pax = Math.max(1, Math.floor(params.pax));

  const lineItems: QuoteLineItem[] = [];
  for (const sel of selected) {
    const svc = serviceMap.get(sel.serviceId);
    if (!svc) continue; // bỏ qua serviceId không tồn tại (AI không được bịa)
    const quantity = Math.max(0, sel.quantity ?? 1);
    const paxApplied = svc.unit === "per_person" ? pax : 1;
    lineItems.push({
      serviceId: svc.id,
      name: svc.name,
      category: svc.category,
      supplier: svc.supplier,
      unit: svc.unit,
      netPrice: svc.netPrice,
      quantity,
      paxApplied,
      lineNet: lineNetCost(svc, quantity, pax),
    });
  }

  const netTotal = lineItems.reduce((s, li) => s + li.lineNet, 0);
  const markup = Math.max(0, markupPercent);
  const vat = Math.max(0, vatPercent);

  const sellingBeforeVat = round(netTotal * (1 + markup / 100));
  const vatAmount = round(sellingBeforeVat * (vat / 100));
  const totalPrice = sellingBeforeVat + vatAmount;
  const grossMargin = sellingBeforeVat - netTotal;
  const marginPercent = sellingBeforeVat > 0 ? (grossMargin / sellingBeforeVat) * 100 : 0;

  return {
    pax,
    markupPercent: markup,
    vatPercent: vat,
    lineItems,
    netTotal,
    sellingBeforeVat,
    vatAmount,
    totalPrice,
    grossMargin,
    marginPercent: round2(marginPercent),
    pricePerPax: round(totalPrice / pax),
    usdRate,
    totalPriceUsd: usdRate > 0 ? round2(totalPrice / usdRate) : 0,
  };
}

/** Làm tròn về đồng (VND không có phần lẻ). */
function round(n: number): number {
  return Math.round(n);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
