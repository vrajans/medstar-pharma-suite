import type { Batch } from "@medstar/core";
import type { PosProduct } from "./catalogue";
export type { PosProduct } from "./catalogue";


const b = (id: string, batchNo: string, expiry: string, qtyBase: number, packMrpPaise: number, status: Batch["status"] = "active"): Batch =>
  ({ id, batchNo, expiry, qtyBase, packMrpPaise, status, receivedAt: "2026-06-01" });

export const DEMO_STORE = { id: "00000000-0000-0000-0000-0000000000a1", code: "BLR1", name: "MedStar Indiranagar", scheme: "regular" as const };
export const DEMO_PHARMACIST = { id: "00000000-0000-0000-0000-0000000000f1", name: "Dr. A. Rao", regNo: "KSPC-4455", pin: "1234" };

export const DEMO_PRODUCTS: PosProduct[] = [
  { id: "00000000-0000-0000-0000-00000000b001", name: "Dolo 650 Tablet", composition: "Paracetamol 650mg", manufacturer: "Micro Labs", hsn: "30049099", gstRate: 5, schedule: "OTC", unitsPerPack: 15, packLabel: "Strip", baseLabel: "Tab", barcode: "8901234500011", rack: "A1",
    batches: [b("10000000-0000-0000-0000-000000000001", "DL2405", "2026-12-31", 30, 3091), b("10000000-0000-0000-0000-000000000002", "DL2611", "2028-08-31", 600, 3091)] },
  { id: "00000000-0000-0000-0000-00000000b003", name: "Azithral 500 Tablet", composition: "Azithromycin 500mg", manufacturer: "Alembic", hsn: "30042019", gstRate: 5, schedule: "H", unitsPerPack: 3, packLabel: "Strip", baseLabel: "Tab", barcode: "8901234500028", rack: "B3",
    batches: [b("10000000-0000-0000-0000-000000000003", "AZ1123", "2027-03-31", 60, 11950)] },
  { id: "00000000-0000-0000-0000-00000000b002", name: "Alprax 0.25 Tablet", composition: "Alprazolam 0.25mg", manufacturer: "Torrent", hsn: "30049099", gstRate: 5, schedule: "H1", habitForming: true, unitsPerPack: 10, packLabel: "Strip", baseLabel: "Tab", barcode: "8901234500035", rack: "LOCK-1",
    batches: [b("10000000-0000-0000-0000-000000000004", "AX0912", "2027-09-30", 100, 2200), b("10000000-0000-0000-0000-000000000005", "AX0401", "2026-10-31", 20, 2200)] },
  { id: "00000000-0000-0000-0000-00000000b004", name: "Huminsulin R 40IU/ml Vial", composition: "Human insulin 40IU/ml", manufacturer: "Lilly", hsn: "30043110", gstRate: 5, schedule: "H", coldChain: true, unitsPerPack: 1, packLabel: "Vial", baseLabel: "Vial", barcode: "8901234500042", rack: "FRIDGE",
    batches: [b("10000000-0000-0000-0000-000000000006", "HI7781", "2027-05-31", 12, 17500)] },
  { id: "00000000-0000-0000-0000-00000000b005", name: "Pan 40 Tablet", composition: "Pantoprazole 40mg", manufacturer: "Alkem", hsn: "30049099", gstRate: 5, schedule: "H", unitsPerPack: 15, packLabel: "Strip", baseLabel: "Tab", barcode: "8901234500059", rack: "B1",
    batches: [b("10000000-0000-0000-0000-000000000007", "PN5521", "2027-11-30", 300, 15600), b("10000000-0000-0000-0000-000000000008", "PN4410", "2027-01-31", 45, 15600, "recalled")] },
  { id: "00000000-0000-0000-0000-00000000b006", name: "Cetaphil Gentle Cleanser 125ml", composition: "—", manufacturer: "Galderma", hsn: "33049990", gstRate: 18, schedule: "OTC", unitsPerPack: 1, packLabel: "Bottle", baseLabel: "Bottle", barcode: "8901234500066", rack: "C2",
    batches: [b("10000000-0000-0000-0000-000000000009", "CT0925", "2028-09-30", 24, 46500)] },
  { id: "00000000-0000-0000-0000-00000000b007", name: "Corex-type Codeine Syrup 100ml", composition: "Codeine phosphate + Chlorpheniramine", manufacturer: "Demo", hsn: "30049099", gstRate: 5, schedule: "NDPS", habitForming: true, unitsPerPack: 1, packLabel: "Bottle", baseLabel: "Bottle", barcode: "8901234500073", rack: "LOCK-2",
    batches: [b("10000000-0000-0000-0000-000000000010", "CX1102", "2027-06-30", 10, 12800)] },
];

export function searchProducts(q: string): PosProduct[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return DEMO_PRODUCTS.filter((p) => p.barcode === s || p.name.toLowerCase().includes(s) || p.composition.toLowerCase().includes(s)).slice(0, 8);
}
