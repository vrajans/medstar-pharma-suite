import Link from "next/link";
import { formatDateIN, formatINR, VOUCHER_LABEL, type VoucherKind } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { AccountsNav, RangeForm, readRange } from "@/components/books";
import { ExportButtons } from "@/components/ExportButtons";
import { ReverseVoucher, ViewAttachment } from "./actions";

export const metadata = { title: "Vouchers · MedStar" };

export default async function VouchersPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; kind?: string }> }) {
  const ctx = await requireArea("/accounts");
  const sp = await searchParams;
  const { from, to } = readRange(sp);
  const canPost = ["owner", "admin", "accountant"].includes(ctx.org.role);
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Vouchers" /><AccountsNav active="/accounts/vouchers" /><LiveOnly what="Vouchers" /></div>;
  const sb = await supabaseServer();
  let q = sb.from("vouchers").select("id, voucher_no, voucher_date, kind, narration, reference, amount_paise, status, reversal_of, reverse_reason, attachment_path, store_id")
    .eq("org_id", ctx.org.orgId).gte("voucher_date", from).lte("voucher_date", to).order("voucher_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
  if (sp.kind) q = q.eq("kind", sp.kind);
  const { data, error } = await q;
  const rows = data ?? [];
  const exportRows = rows.map((v) => ({ date: formatDateIN(v.voucher_date), voucher_no: v.voucher_no, type: VOUCHER_LABEL[v.kind as VoucherKind], narration: v.narration,
    reference: v.reference, amount: Number(v.amount_paise) / 100, status: v.status }));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="Vouchers" sub="Payments, receipts, contra, journal and expense vouchers">
        <ExportButtons title={`Vouchers ${formatDateIN(from)} to ${formatDateIN(to)}`} rows={exportRows} footer="Prepared by / Approved by: ____________" />
        {canPost && <Link href="/accounts/vouchers/new" className="rounded-md bg-brand-700 px-3 py-1.5 text-sm text-white">New voucher</Link>}
      </PageHeader>
      <AccountsNav active="/accounts/vouchers" />
      <RangeForm from={from} to={to}>
        <label className="flex flex-col">Type
          <select name="kind" defaultValue={sp.kind ?? ""} className="rounded border border-line bg-surface px-2 py-1.5">
            <option value="">All</option>{Object.entries(VOUCHER_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
      </RangeForm>
      {error && <p className="text-danger">{error.message}</p>}
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas"><tr><th className={`${thCls} px-3`}>Date</th><th className={thCls}>Voucher no.</th><th className={thCls}>Type</th><th className={thCls}>Narration</th>
            <th className={`${thCls} text-right`}>Amount</th><th className={`${thCls} px-3`}>Status</th></tr></thead>
          <tbody>{rows.map((v) => (
            <tr key={v.id} className={`border-t border-line align-top ${v.status === "reversed" ? "text-muted line-through decoration-1" : ""}`}>
              <td className="px-3 py-1.5">{formatDateIN(v.voucher_date)}</td>
              <td className="font-mono text-xs">{v.voucher_no}</td>
              <td>{VOUCHER_LABEL[v.kind as VoucherKind]}{v.reversal_of && " (reversal)"}</td>
              <td>{v.narration}{v.reference && <span className="text-muted"> · Ref {v.reference}</span>}{v.attachment_path && <> · <ViewAttachment path={v.attachment_path} /></>}</td>
              <td className="num text-right">{formatINR(Number(v.amount_paise))}</td>
              <td className="px-3 no-underline">{v.status === "reversed" ? <span title={v.reverse_reason ?? ""}>Reversed</span>
                : !v.reversal_of && canPost ? <ReverseVoucher id={v.id} no={v.voucher_no} /> : "Posted"}</td>
            </tr>))}
          {!rows.length && <tr><td colSpan={6} className="p-6 text-center text-muted">No vouchers in this period.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
