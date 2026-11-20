"use client";
import { useState } from "react";
import { formatINR, rupeesToPaise } from "@medstar/core";
import { CsvImport, type ServerCheck } from "@/components/CsvImport";
import { supabaseBrowser } from "@/lib/supabase";
import { inputCls } from "@/components/ui";

interface Row { type: "customer" | "supplier"; phone: string; name: string; amountPaise: number }

const TEMPLATE = [
  ["type", "mobile", "name", "amount"],
  ["customer", "9840011111", "Lakshmi R", "1250.00"],
  ["customer", "9840022222", "Ramesh K", "-200.00"],
  ["supplier", "", "Sri Balaji Pharma", "45000.00"],
];

const parseRow = (r: Record<string, string>): { ok: true; value: Row } | { ok: false; errors: string[] } => {
  const type = (r.type ?? "").trim().toLowerCase();
  const errors: string[] = [];
  if (type !== "customer" && type !== "supplier") errors.push("type must be customer or supplier");
  const phone = (r.mobile ?? r.phone ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (type === "customer" && !/^\d{10}$/.test(phone)) errors.push("customer mobile must be 10 digits");
  const name = (r.name ?? "").trim();
  if (type === "supplier" && !name) errors.push("supplier name is required");
  let amountPaise = 0;
  try { amountPaise = rupeesToPaise((r.amount ?? "").replace(/[₹,\s]/g, "")); } catch { errors.push("amount is not a number"); }
  if (!amountPaise) errors.push("amount is missing or zero");
  return errors.length ? { ok: false, errors } : { ok: true, value: { type: type as Row["type"], phone, name, amountPaise } };
};

export function OpeningBalancesImport({ storeId, defaultDate }: { storeId: string; defaultDate: string }) {
  const [asOf, setAsOf] = useState(defaultDate);
  const [key] = useState(() => crypto.randomUUID());
  const call = async (rows: Row[], dry: boolean): Promise<ServerCheck> => {
    const { data, error } = await supabaseBrowser()!.rpc("post_opening_balances", { p: { idempotencyKey: key, storeId, asOf, dryRun: dry, rows } });
    if (error) throw error;
    if (data.duplicate) return { errors: [], summary: "This file was already loaded." };
    return {
      dryRun: data.dryRun, errors: data.errors ?? [], warnings: data.warnings ?? [],
      summary: `${dry ? "Will load" : "Loaded"} ${data.customers ?? 0} customer balance(s) totalling ${formatINR(Number(data.receivablePaise ?? 0))}`
        + `${data.newCustomers ? ` (${data.newCustomers} new customer(s))` : ""} and ${data.suppliers ?? 0} supplier balance(s) totalling ${formatINR(Number(data.payablePaise ?? 0))}.`,
    };
  };
  return (
    <div className="space-y-3">
      <label className="block w-60 text-sm">Balances as on (day before go-live)<input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={inputCls} /></label>
      <CsvImport<Row> templateName="opening-balances-template.csv" templateRows={TEMPLATE} parseRow={parseRow}
        check={(rows) => call(rows, true)} commit={(rows) => call(rows, false)}
        describe={(r) => `${r.type === "customer" ? `Customer ${r.phone}${r.name ? ` ${r.name}` : ""} owes` : `We owe ${r.name}`} ${formatINR(r.amountPaise)}`} />
    </div>
  );
}
