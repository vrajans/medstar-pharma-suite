"use client";
import { useState } from "react";
import { Receipt, type ReceiptData } from "@/components/pos/Receipt";

/** Reprint a bill marked DUPLICATE (insurance claims, lost bills). Same layout as the counter receipt. */
export function DuplicateBill({ data }: { data: Omit<ReceiptData, "at"> & { at: string } }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <button className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm" onClick={() => { setShow(true); setTimeout(() => window.print(), 100); }}>
        Print duplicate bill</button>
      {show && <Receipt r={{ ...data, at: new Date(data.at) }} duplicate />}
    </>
  );
}
