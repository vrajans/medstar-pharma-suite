"use client";
import { parseProductRow, type ProductImportRow } from "@medstar/core";
import { CsvImport, type ServerCheck } from "@/components/CsvImport";
import { supabaseBrowser } from "@/lib/supabase";

const TEMPLATE = [
  ["name", "manufacturer", "composition", "dosage_form", "category", "hsn", "schedule", "rx_required", "habit_forming", "cold_chain", "pack_label", "base_unit", "units_per_pack", "barcode", "reorder_level", "rack", "gst_override", "online"],
  ["Dolo 650 Tablet", "Micro Labs", "Paracetamol 650mg", "Tablet", "OTC", "30049099", "OTC", "N", "N", "N", "Strip", "Tab", "15", "8901234500011", "20", "A1", "", "Y"],
  ["Alprax 0.25 Tablet", "Torrent", "Alprazolam 0.25mg", "Tablet", "Rx", "30049099", "H1", "Y", "Y", "N", "Strip", "Tab", "10", "", "5", "LOCK-1", "", "N"],
  ["Huminsulin R 40IU/ml", "Lilly", "Human insulin", "Injection", "Rx", "30043110", "H", "Y", "N", "Y", "Vial", "Vial", "1", "", "4", "FRIDGE", "", "Y"],
];

export function ProductImport({ orgId }: { orgId: string }) {
  const call = async (rows: ProductImportRow[], dry: boolean): Promise<ServerCheck> => {
    const { data, error } = await supabaseBrowser()!.rpc("import_products", { p_org: orgId, p_rows: rows, p_dry_run: dry });
    if (error) throw error;
    const verb = dry ? "Will" : "Done:";
    return { ...data, summary: `${verb} create ${data.created} and update ${data.updated} product(s)${data.errors.length ? ` — fix ${data.errors.length} error(s) first` : ""}` };
  };
  return (
    <CsvImport<ProductImportRow>
      templateName="medstar-products-template.csv" templateRows={TEMPLATE} parseRow={parseProductRow}
      check={(r) => call(r, true)} commit={(r) => call(r, false)}
      describe={(p) => `${p.name} · ${p.schedule} · HSN ${p.hsn} · ${p.unitsPerPack} ${p.baseUnitLabel}/${p.packLabel}${p.barcode ? ` · ${p.barcode}` : ""}`} />
  );
}
