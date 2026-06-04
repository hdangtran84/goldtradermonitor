// Đơn vị tính giá của một dịch vụ trong kho nhà cung cấp.
//  - per_person     : nhân theo số khách (pax) × quantity (vd: vé máy bay, vé tham quan)
//  - per_night_room : nhân theo quantity (vd: số phòng × số đêm)
//  - per_group      : nhân theo quantity (tính trọn cho cả đoàn, vd: phí cố định)
//  - per_unit       : nhân theo quantity (vd: xe/ngày, HDV/ngày)
export type PricingUnit = "per_person" | "per_night_room" | "per_group" | "per_unit";

export interface Service {
  id: string;
  destination: string;
  category: string;
  name: string;
  supplier: string;
  unit: PricingUnit;
  /** Giá net (VND), chưa markup, chưa VAT. */
  netPrice: number;
  note?: string;
}

export interface SupplierCatalog {
  currency: string;
  note: string;
  services: Service[];
}

/** Một dòng dịch vụ AI (hoặc fallback) chọn cho chuyến đi. */
export interface SelectedService {
  serviceId: string;
  /** Số lượng đơn vị: số đêm×phòng, số ngày xe/HDV, số lần dùng... Mặc định 1. */
  quantity: number;
  /** Ghi chú ngắn vì sao chọn (hiển thị nội bộ). */
  note?: string;
}

export interface ItineraryDay {
  dayNumber: number;
  title: string;
  description: string;
}

/** Kết quả sinh lịch trình (chưa có tiền — tiền do quote engine tính). */
export interface ItineraryPlan {
  tourTitle: string;
  summary: string;
  days: ItineraryDay[];
  selectedServices: SelectedService[];
  /** Markup AI gợi ý (%). Người dùng luôn có quyền chỉnh lại. */
  suggestedMarkupPercent: number;
}

export interface QuoteLineItem {
  serviceId: string;
  name: string;
  category: string;
  supplier: string;
  unit: PricingUnit;
  netPrice: number;
  quantity: number;
  /** Số khách áp dụng (chỉ với per_person). */
  paxApplied: number;
  lineNet: number;
}

export interface Quote {
  pax: number;
  markupPercent: number;
  vatPercent: number;
  lineItems: QuoteLineItem[];
  netTotal: number;
  /** Giá bán trước VAT = netTotal × (1 + markup/100). */
  sellingBeforeVat: number;
  vatAmount: number;
  /** Tổng giá khách phải trả (đã gồm VAT). */
  totalPrice: number;
  /** Lợi nhuận gộp = sellingBeforeVat - netTotal. */
  grossMargin: number;
  marginPercent: number;
  pricePerPax: number;
  /** Quy đổi USD để tham khảo (theo tỷ giá cấu hình). */
  usdRate: number;
  totalPriceUsd: number;
}

export interface QuoteRequest {
  /** Yêu cầu của khách bằng ngôn ngữ tự nhiên (tiếng Việt). */
  request: string;
  pax: number;
  /** Ghi đè markup; nếu bỏ trống dùng AI gợi ý. */
  markupPercent?: number;
  vatPercent?: number;
}

export interface Proposal {
  id: string;
  createdAt: string;
  agencyName: string;
  request: string;
  plan: ItineraryPlan;
  quote: Quote;
  /** "ai" nếu sinh bằng Claude, "fallback" nếu bằng luật. */
  source: "ai" | "fallback";
}
