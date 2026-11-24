"use client";
import { useState } from "react";
import { Receipt, type ReceiptData } from "@/components/pos/Receipt";
import { billWhatsAppLink, printA4Invoice } from "@/components/pos/share";

/** Reprint a bill marked DUPLICATE (insurance claims, lost bills). Same layout as the counter receipt. */
export function DuplicateBill({ data, buyer }: { data: Omit<ReceiptData, "at"> & { at: string }; buyer?: { name?: string | null; gstin?: string | null; address?: string | null; phone?: string | null } }) {
  const [show, setShow] = useState(false);
  const r = { ...data, at: new Date(data.at) };
  return (
    <>
      <button className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm" onClick={() => { setShow(true); setTimeout(() => window.print(), 100); }}>
        Print duplicate bill</button>
      <button className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm" onClick={() => printA4Invoice(r, buyer, true)}>A4 invoice</button>
      {data.customerPhone && <a className="rounded-md bg-[#25D366] px-3 py-1.5 text-sm text-white" href={billWhatsAppLink(r, data.customerPhone)} target="_blank" rel="noopener">WhatsApp</a>}
      {show && <Receipt r={r} duplicate />}
    </>
  );
}
