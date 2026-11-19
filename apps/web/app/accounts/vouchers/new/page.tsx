import { redirect } from "next/navigation";
import type { VoucherKind } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader } from "@/components/ui";
import { AccountsNav } from "@/components/books";
import { VoucherForm, type LedgerOpt } from "../VoucherForm";

export const metadata = { title: "New voucher · MedStar" };

export default async function NewVoucherPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const ctx = await requireArea("/accounts");
  if (!["owner", "admin", "accountant"].includes(ctx.org.role)) redirect("/accounts/vouchers");
  const { kind } = await searchParams;
  const k = (["payment", "receipt", "contra", "journal", "expense"].includes(kind ?? "") ? kind : "expense") as VoucherKind;
  if (ctx.mode === "demo") return <div className="mx-auto max-w-5xl p-6"><PageHeader title="New voucher" /><AccountsNav active="/accounts/vouchers" /><LiveOnly what="Vouchers" /></div>;
  const sb = await supabaseServer();
  const [acc, cust, dist] = await Promise.all([
    sb.from("accounts").select("id, code, name, grp").eq("org_id", ctx.org.orgId).eq("active", true).order("name"),
    sb.from("customers").select("id, name, phone").eq("org_id", ctx.org.orgId).order("name").limit(3000),
    sb.from("distributors").select("id, name").eq("org_id", ctx.org.orgId).order("name"),
  ]);
  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader title="New voucher" sub={`${ctx.store.code} · posts straight to the books; mistakes are corrected by reversal, not edits`} />
      <AccountsNav active="/accounts/vouchers" />
      <VoucherForm orgId={ctx.org.orgId} storeId={ctx.store.id} composition={ctx.store.gstScheme === "composition"} initialKind={k}
        ledgers={(acc.data ?? []) as LedgerOpt[]}
        customers={(cust.data ?? []).map((c) => ({ id: c.id, label: `${c.name ?? "Customer"} · ${c.phone}` }))}
        suppliers={(dist.data ?? []).map((d) => ({ id: d.id, label: d.name }))} />
    </div>
  );
}
