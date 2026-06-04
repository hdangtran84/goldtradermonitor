import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Service, SupplierCatalog } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let cached: SupplierCatalog | null = null;

/** Đọc kho giá nhà cung cấp (giá net) từ data/suppliers.json. */
export function loadCatalog(): SupplierCatalog {
  if (cached) return cached;
  const path = join(__dirname, "..", "data", "suppliers.json");
  cached = JSON.parse(readFileSync(path, "utf8")) as SupplierCatalog;
  return cached;
}

export function getServiceMap(): Map<string, Service> {
  const m = new Map<string, Service>();
  for (const s of loadCatalog().services) m.set(s.id, s);
  return m;
}

export function listDestinations(): string[] {
  return [...new Set(loadCatalog().services.map((s) => s.destination))];
}

/** Lọc dịch vụ theo điểm đến (khớp gần đúng, không phân biệt hoa thường). */
export function servicesForDestination(destination: string): Service[] {
  const d = destination.trim().toLowerCase();
  return loadCatalog().services.filter((s) =>
    s.destination.toLowerCase().includes(d) || d.includes(s.destination.toLowerCase()),
  );
}
