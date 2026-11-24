"use client";
import { formatDateIN, formatINR } from "@medstar/core";
import { escapeHtml as e, printHtml } from "@/lib/print";
import type { ReceiptData } from "./Receipt";

const IST = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** WhatsApp text of a bill — opens in WhatsApp for the staff member to send (no API, no cost). */
export function billWhatsAppLink(r: ReceiptData, phone: string) {
  const digits = phone.replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits;
  const text = [
    `*${r.orgName}* — ${r.store.name}`,
    `${r.bill.documentType === "BILL_OF_SUPPLY" ? "Bill of supply" : "Tax invoice"} ${r.number} · ${IST(r.at)}`,
    ...r.lines.map((l) => `• ${l.name} × ${l.qtyLabel} — ${formatINR(l.amountPaise)}`),
    `*Total ${formatINR(r.bill.totalPaise)}* (${r.paymentMode})`,
    r.store.gstin ? `GSTIN ${r.store.gstin}` : "",
    "Thank you! Please keep medicines out of reach of children.",
  ].filter(Boolean).join("\n");
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/** A4 tax invoice — for clinics, hospitals and other businesses that need a full-page bill with their GSTIN. */
export function printA4Invoice(r: ReceiptData, buyer?: { name?: string | null; gstin?: string | null; address?: string | null; phone?: string | null }, duplicate = false) {
  const title = r.bill.documentType === "BILL_OF_SUPPLY" ? "BILL OF SUPPLY" : "TAX INVOICE";
  const tax = r.bill.documentType !== "BILL_OF_SUPPLY";
  printHtml(`${title} ${r.number}`, `
    <div class="head"><div><h1>${title}${duplicate ? " — DUPLICATE" : ""}</h1><div><b>${e(r.orgName)}</b></div><div>${e(r.store.name)}</div><div class="muted">${e(r.store.address ?? "")}</div>
      <div class="muted">${r.store.gstin ? `GSTIN ${e(r.store.gstin)}` : ""}${r.store.drugLicences?.length ? ` · DL ${e(r.store.drugLicences.join(", "))}` : ""}${r.store.phone ? ` · Ph ${e(r.store.phone)}` : ""}</div></div>
      <div>Invoice <b>${e(r.number)}</b><br>${e(IST(r.at))}<br>Place of supply: ${e(r.store.stateCode)}</div></div>
    <table><tr><th>Billed to</th><th>Prescription</th></tr><tr>
      <td>${e(buyer?.name ?? r.customer ?? "Walk-in customer")}${buyer?.gstin ? `<br>GSTIN <b>${e(buyer.gstin)}</b>` : ""}${buyer?.address ? `<br>${e(buyer.address)}` : ""}${buyer?.phone ? `<br>Ph ${e(buyer.phone)}` : ""}</td>
      <td>${r.prescriber ? `Dr ${e(r.prescriber)}` : "—"}${r.patient ? `<br>Patient: ${e(r.patient)}` : ""}${r.pharmacist ? `<br>Pharmacist: ${e(r.pharmacist.name)} (${e(r.pharmacist.regNo)})` : ""}</td></tr></table><br>
    <table><tr><th>#</th><th>Item</th><th>HSN</th><th>Batch</th><th>Exp</th><th class="r">Qty</th><th class="r">MRP</th><th class="r">Disc %</th><th class="r">Amount</th></tr>
      ${r.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${e(l.name)}${["H", "H1", "X", "NDPS"].includes(l.schedule) ? ` <small>(Sch ${e(l.schedule)})</small>` : ""}</td><td>${e(l.hsn)}</td>
        <td>${e(l.batchNo)}</td><td>${e(formatDateIN(l.expiry))}</td><td class="r">${e(l.qtyLabel)}</td><td class="r">${e(formatINR(l.packMrpPaise))}</td>
        <td class="r">${l.discountPct || ""}</td><td class="r">${e(formatINR(l.amountPaise))}</td></tr>`).join("")}</table><br>
    ${tax ? `<table><tr><th>HSN</th><th class="r">GST %</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th></tr>
      ${r.bill.hsnSummary.map((h) => `<tr><td>${e(h.hsn)}</td><td class="r">${h.gstRate}</td><td class="r">${e(formatINR(h.taxablePaise))}</td>
        <td class="r">${e(formatINR(Math.floor(h.taxPaise / 2)))}</td><td class="r">${e(formatINR(h.taxPaise - Math.floor(h.taxPaise / 2)))}</td></tr>`).join("")}</table>` : "<p>Composition taxable person, not eligible to collect tax on supplies.</p>"}
    <p style="text-align:right">Taxable ${e(formatINR(r.bill.taxablePaise))}${tax ? ` · CGST ${e(formatINR(r.bill.cgstPaise))} · SGST ${e(formatINR(r.bill.sgstPaise))}` : ""} · Round-off ${e(formatINR(r.bill.roundOffPaise))}<br>
      <b style="font-size:13px">Total ${e(formatINR(r.bill.totalPaise))}</b> · Paid by ${e(r.paymentMode)}</p>
    <div class="sign"><div class="muted">Goods once sold can be returned only as per store policy. Subject to local jurisdiction.</div><div>For ${e(r.orgName)}<br><br>Authorised signatory</div></div>`, "a4-portrait");
}
