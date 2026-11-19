"use client";
import { toCsv } from "@medstar/core";
import { escapeHtml, printHtml } from "@/lib/print";

/** CSV download + A4 landscape print for any report table. Keys of the first row become the headers. */
export function ExportButtons({ title, rows, footer = "Registered pharmacist signature: ____________________" }:
  { title: string; rows: Array<Record<string, string | number | null>>; footer?: string }) {
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const label = (h: string) => h.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return (
    <>
      <button disabled={!rows.length} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm disabled:opacity-40" onClick={() => {
        const csv = toCsv([[title], headers.map(label), ...rows.map((r) => headers.map((h) => r[h]))]);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
        a.download = `${title.replace(/[^\w-]+/g, "_").slice(0, 80)}.csv`;
        a.click(); URL.revokeObjectURL(a.href);
      }}>Export CSV</button>
      <button disabled={!rows.length} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm text-white disabled:opacity-40" onClick={() => printHtml(title,
        `<h1>${escapeHtml(title)}</h1><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(label(h))}</th>`).join("")}</tr></thead><tbody>${
          rows.map((r) => `<tr>${headers.map((h) => `<td${typeof r[h] === "number" ? ' class="r"' : ""}>${escapeHtml(r[h])}</td>`).join("")}</tr>`).join("")}</tbody></table>
         <p style="margin-top:16px">Printed ${escapeHtml(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}${footer ? ` · ${escapeHtml(footer)}` : ""}</p>`, "a4")}>
        Print / PDF</button>
    </>
  );
}
