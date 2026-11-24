import { formatINR, type BillTotals } from "@medstar/core";

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
/** Bills always show Indian Standard Time, whatever the counter PC's clock zone is. */
export const formatBillTime = (d: Date) => IST.format(d).replace(/\//g, "-").replace(",", "");
import type { StoreCtx } from "@/lib/types";

export interface ReceiptLine { name: string; hsn: string; batchNo: string; expiry: string; qtyLabel: string; packMrpPaise: number; discountPct: number; amountPaise: number; schedule: string }
export interface ReceiptData {
  number: string;
  provisional: boolean;
  at: Date;
  store: StoreCtx;
  orgName: string;
  lines: ReceiptLine[];
  bill: BillTotals;
  paymentMode: string;
  customer?: string;
  /** mobile for WhatsApp sharing */
  customerPhone?: string;
  pharmacist?: { name: string; regNo: string } | null;
  patient?: string;
  prescriber?: string;
}

/** 80 mm thermal / A5 bill (UC-POS-01, GST Rule 46 fields). Printed via @media print in globals.css. */
export function Receipt({ r, duplicate }: { r: ReceiptData; duplicate?: boolean }) {
  const title = r.bill.documentType === "BILL_OF_SUPPLY" ? "BILL OF SUPPLY" : "TAX INVOICE";
  return (
    <div id="print-receipt" className="hidden print:block font-mono text-[10px] leading-tight text-black">
      <div className="text-center">
        <div className="text-[12px] font-bold">{r.orgName}</div>
        <div>{r.store.name}</div>
        <div>{r.store.address}</div>
        {r.store.phone && <div>Ph: {r.store.phone}</div>}
        {r.store.gstin && <div>GSTIN: {r.store.gstin}</div>}
        {!!r.store.drugLicences?.length && <div>DL No: {r.store.drugLicences.join(", ")}</div>}
        <div className="mt-1 font-bold">{title}{r.provisional && " (PROVISIONAL)"}{duplicate && " — DUPLICATE"}</div>
        {r.bill.documentType === "BILL_OF_SUPPLY" && <div>Composition taxable person, not eligible to collect tax on supplies</div>}
      </div>
      <div className="mt-1 flex justify-between"><span>No: {r.number}</span><span>{formatBillTime(r.at)}</span></div>
      {r.customer && <div>Customer: {r.customer}</div>}
      {r.patient && <div>Patient: {r.patient}</div>}
      {r.prescriber && <div>Dr: {r.prescriber}</div>}
      <hr className="my-1 border-black" />
      {r.lines.map((l, i) => (
        <div key={i} className="mb-0.5">
          <div>{l.name}{l.schedule !== "OTC" && ` [${l.schedule}]`}</div>
          <div className="flex justify-between"><span>HSN {l.hsn} B:{l.batchNo} E:{l.expiry.slice(5, 7)}/{l.expiry.slice(2, 4)}</span></div>
          <div className="flex justify-between"><span>{l.qtyLabel} × MRP {formatINR(l.packMrpPaise)}{l.discountPct ? ` -${l.discountPct}%` : ""}</span><span>{formatINR(l.amountPaise)}</span></div>
        </div>
      ))}
      <hr className="my-1 border-black" />
      {r.bill.documentType === "TAX_INVOICE" && (
        <table className="w-full">
          <thead><tr><th className="text-left">HSN</th><th>GST%</th><th className="text-right">Taxable</th><th className="text-right">Tax</th></tr></thead>
          <tbody>{r.bill.hsnSummary.map((h) => (
            <tr key={h.hsn + h.gstRate}><td>{h.hsn}</td><td className="text-center">{h.gstRate}</td><td className="text-right">{formatINR(h.taxablePaise)}</td><td className="text-right">{formatINR(h.taxPaise)}</td></tr>))}
          </tbody>
        </table>
      )}
      {r.bill.documentType === "TAX_INVOICE" && <div className="flex justify-between"><span>CGST {formatINR(r.bill.cgstPaise)}</span><span>SGST {formatINR(r.bill.sgstPaise)}</span></div>}
      {r.bill.discountPaise > 0 && <div className="flex justify-between"><span>You saved</span><span>{formatINR(r.bill.discountPaise)}</span></div>}
      <div className="flex justify-between"><span>Round off</span><span>{formatINR(r.bill.roundOffPaise)}</span></div>
      <div className="flex justify-between text-[12px] font-bold"><span>TOTAL</span><span>{formatINR(r.bill.totalPaise)}</span></div>
      <div>Paid by {r.paymentMode.toUpperCase()}</div>
      {r.pharmacist && <div className="mt-1">Dispensed by Reg. Pharmacist {r.pharmacist.name} ({r.pharmacist.regNo})</div>}
      <div className="mt-1 text-center">Get well soon · Check expiry before use</div>
    </div>
  );
}
