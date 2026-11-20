import { notFound } from "next/navigation";
import { formatINR } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { formatBillTime } from "@/components/pos/Receipt";
import { ScheduleBadge } from "@/components/ScheduleBadge";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { CancelBill, ReturnForm, type ReturnableLine } from "./actions";
import { DuplicateBill } from "./DuplicateBill";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireArea("/sales");
  if (ctx.mode === "demo") return <div className="mx-auto max-w-5xl p-6"><LiveOnly what="Bill details" /></div>;
  const sb = await supabaseServer();
  const [{ data: bill }, { data: lines }, { data: pays }, { data: rets }, { data: tax }, { data: lic }] = await Promise.all([
    sb.from("sales_bills").select("*, customers(name, phone), pharmacists(name, reg_no), prescriptions(patient_name, prescriber_name, prescriber_reg_no)").eq("id", id).eq("store_id", ctx.store.id).maybeSingle(),
    sb.from("v_bill_lines").select("*").eq("bill_id", id).order("id"),
    sb.from("payments").select("mode, amount_paise, reference, created_at").eq("bill_id", id).order("id"),
    sb.from("sales_returns").select("id, credit_note_no, returned_at, reason, refund_mode, total_paise").eq("bill_id", id).order("returned_at"),
    sb.from("sales_bill_lines").select("id, hsn, gst_rate, taxable_paise, cgst_paise, sgst_paise, igst_paise").eq("bill_id", id),
    sb.from("licences").select("number, valid_to").eq("store_id", ctx.store.id).ilike("kind", "Form 2%"),
  ]);
  if (!bill) notFound();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const billDay = new Date(new Date(bill.billed_at).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const isOwner = ["owner", "admin"].includes(ctx.org.role);
  const mine = bill.created_by === ctx.userId && Date.now() - Date.parse(bill.billed_at) < 30 * 60_000;
  const canCancel = bill.status === "posted" && billDay === today && !rets?.length && (isOwner || mine);
  const canReturn = bill.status === "posted" && ["owner", "admin", "pharmacist", "billing"].includes(ctx.org.role);
  const returnable: ReturnableLine[] = (lines ?? []).map((l) => ({
    id: l.id, name: l.product_name, schedule: l.schedule, coldChain: l.cold_chain, batchNo: l.batch_no, qtyBase: l.qty_base, returnedQty: l.returned_qty,
    amountPaise: Number(l.amount_paise), baseLabel: l.base_unit_label,
  }));

  const hsn = new Map<string, { hsn: string; gstRate: number; taxablePaise: number; taxPaise: number }>();
  for (const t of tax ?? []) {
    const k = `${t.hsn}|${t.gst_rate}`;
    const x = hsn.get(k) ?? { hsn: t.hsn, gstRate: Number(t.gst_rate), taxablePaise: 0, taxPaise: 0 };
    x.taxablePaise += Number(t.taxable_paise); x.taxPaise += Number(t.cgst_paise) + Number(t.sgst_paise) + Number(t.igst_paise);
    hsn.set(k, x);
  }
  const rx = bill.prescriptions as { patient_name: string | null; prescriber_name: string | null; prescriber_reg_no: string | null } | null;
  const dup = {
    number: bill.invoice_no, provisional: false, at: bill.billed_at, orgName: ctx.org.orgName,
    store: { ...ctx.store, drugLicences: (lic ?? []).filter((l) => !l.valid_to || l.valid_to >= billDay).map((l) => l.number) },
    lines: (lines ?? []).map((l) => {
      const hsnOf = (tax ?? []).find((t) => t.id === l.id)?.hsn ?? "";
      const packs = l.qty_base % l.units_per_pack === 0;
      return { name: l.product_name, hsn: hsnOf, batchNo: l.batch_no, expiry: l.expiry, schedule: l.schedule, discountPct: Number(l.discount_pct),
        qtyLabel: packs ? `${l.qty_base / l.units_per_pack} ${l.pack_label}` : `${l.qty_base} ${l.base_unit_label}`, packMrpPaise: Number(l.pack_mrp_paise), amountPaise: Number(l.amount_paise) };
    }),
    bill: { lines: [], grossPaise: Number(bill.gross_paise), discountPaise: Number(bill.discount_paise), taxablePaise: Number(bill.taxable_paise),
      cgstPaise: Number(bill.cgst_paise), sgstPaise: Number(bill.sgst_paise), igstPaise: Number(bill.igst_paise), subtotalPaise: Number(bill.total_paise) - Number(bill.round_off_paise),
      roundOffPaise: Number(bill.round_off_paise), totalPaise: Number(bill.total_paise), hsnSummary: [...hsn.values()], documentType: bill.document_type as "TAX_INVOICE" | "BILL_OF_SUPPLY" },
    paymentMode: (pays ?? []).map((p) => p.mode).join(" + ") || "—",
    customer: bill.customers ? `${bill.customers.name ?? ""} ${bill.customers.phone}`.trim() : undefined,
    pharmacist: bill.pharmacists ? { name: bill.pharmacists.name, regNo: bill.pharmacists.reg_no } : null,
    patient: rx?.patient_name ?? undefined,
    prescriber: rx?.prescriber_name ? `${rx.prescriber_name}${rx.prescriber_reg_no ? ` (${rx.prescriber_reg_no})` : ""}` : undefined,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <PageHeader title={`${bill.document_type === "BILL_OF_SUPPLY" ? "Bill of supply" : "Tax invoice"} ${bill.invoice_no}`}
        sub={`${formatBillTime(new Date(bill.billed_at))} · ${bill.customers ? `${bill.customers.name ?? ""} ${bill.customers.phone}` : "Walk-in"}${bill.pharmacists ? ` · Rx approved by ${bill.pharmacists.name}` : ""}`}>
        {bill.status === "posted" && <DuplicateBill data={dup} />}
        {canCancel && <CancelBill billId={bill.id} />}
      </PageHeader>
      {bill.status === "cancelled" && <p className="rounded border border-danger bg-danger/5 p-2 text-sm text-danger">Cancelled. {bill.review_note}</p>}
      {bill.needs_review && bill.status !== "cancelled" && <p className="rounded border border-warn bg-warn/10 p-2 text-sm text-warn">Flagged for review: {bill.review_note}</p>}

      <section className="rounded-lg border border-line bg-surface p-4">
        <table className="w-full text-sm">
          <thead><tr><th className={thCls}>Item</th><th className={thCls}>Batch</th><th className={`${thCls} text-right`}>Qty</th><th className={`${thCls} text-right`}>GST</th><th className={`${thCls} text-right`}>Amount</th><th className={`${thCls} text-right`}>Returned</th></tr></thead>
          <tbody>{(lines ?? []).map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="py-1"><span className="flex items-center gap-2"><ScheduleBadge schedule={l.schedule} coldChain={l.cold_chain} />{l.product_name}</span></td>
              <td className="font-mono">{l.batch_no}</td>
              <td className="num text-right">{l.qty_base} {l.base_unit_label}</td>
              <td className="num text-right">{Number(l.gst_rate)}%</td>
              <td className="num text-right">{formatINR(Number(l.amount_paise))}</td>
              <td className="num text-right">{l.returned_qty ? `${l.returned_qty} · ${formatINR(Number(l.returned_paise))}` : "—"}</td>
            </tr>))}</tbody>
        </table>
        <div className="num mt-2 flex flex-wrap justify-end gap-4 text-sm text-muted">
          <span>Taxable {formatINR(Number(bill.taxable_paise))}</span><span>CGST {formatINR(Number(bill.cgst_paise))}</span><span>SGST {formatINR(Number(bill.sgst_paise))}</span>
          <span>Round-off {formatINR(Number(bill.round_off_paise))}</span><span className="font-semibold text-ink">Total {formatINR(Number(bill.total_paise))}</span>
        </div>
        <p className="mt-1 text-right text-xs text-muted">Payments: {(pays ?? []).map((p) => `${p.mode} ${formatINR(Number(p.amount_paise))}${p.reference ? ` (${p.reference})` : ""}`).join(" · ")}</p>
      </section>

      {!!rets?.length && (
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-2 font-semibold">Credit notes</h2>
          <ul className="space-y-1 text-sm">{rets.map((r) => (
            <li key={r.id}><span className="font-mono">{r.credit_note_no}</span> · {formatBillTime(new Date(r.returned_at))} · {formatINR(Number(r.total_paise))} refunded by {r.refund_mode} · {r.reason}</li>))}</ul>
        </section>
      )}

      {canReturn && returnable.some((l) => l.qtyBase > l.returnedQty) && (
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-2 font-semibold">Return items (credit note)</h2>
          <ReturnForm billId={bill.id} lines={returnable} hasCustomer={!!bill.customer_id} composition={bill.document_type === "BILL_OF_SUPPLY"}
            store={ctx.store} orgName={ctx.org.orgName} invoiceNo={bill.invoice_no} />
        </section>
      )}
    </div>
  );
}
