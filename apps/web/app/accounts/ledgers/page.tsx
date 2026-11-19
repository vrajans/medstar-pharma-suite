import Link from "next/link";
import { GROUP_LABEL, type LedgerGroup } from "@medstar/core";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader, thCls } from "@/components/ui";
import { AccountsNav } from "@/components/books";
import { AddLedger, EditLedger } from "./forms";

export const metadata = { title: "Chart of accounts · MedStar" };

const ORDER: LedgerGroup[] = ["cash", "bank", "debtors", "stock", "tax_input", "current_asset", "fixed_asset", "creditors", "tax_output", "loan",
  "current_liability", "capital", "sales", "indirect_inc", "direct_exp", "indirect_exp"];

export default async function LedgersPage() {
  const ctx = await requireArea("/accounts");
  const canEdit = ["owner", "admin", "accountant"].includes(ctx.org.role);
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="Chart of accounts" /><AccountsNav active="/accounts/ledgers" /><LiveOnly what="Chart of accounts" /></div>;
  const sb = await supabaseServer();
  const { data, error } = await sb.from("accounts").select("id, code, name, type, grp, is_system, active").eq("org_id", ctx.org.orgId).order("name");
  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title="Chart of accounts" sub="System ledgers are used by billing and purchase posting and can't be renamed. Add your own bank accounts and expense heads." />
      <AccountsNav active="/accounts/ledgers" />
      {canEdit && <div className="mb-4 rounded-lg border border-line bg-surface p-3"><AddLedger orgId={ctx.org.orgId} /></div>}
      {error && <p className="text-danger">{error.message}</p>}
      <p className="mb-2 text-sm text-muted">Customer and supplier balances are kept as sub-ledgers of Sundry debtors / creditors — add parties from the Customers and Purchase screens.</p>
      <div className="grid grid-cols-2 gap-4">
        {ORDER.map((g) => {
          const items = rows.filter((r) => r.grp === g);
          if (!items.length) return null;
          return (
            <section key={g} className="rounded-lg border border-line bg-surface">
              <h2 className="border-b border-line px-3 py-1.5 text-sm font-semibold">{GROUP_LABEL[g]}</h2>
              <table className="w-full text-sm"><thead><tr><th className={`${thCls} px-3`}>Ledger</th><th className={`${thCls} px-3 text-right`}>Type</th></tr></thead>
                <tbody>{items.map((a) => (
                  <tr key={a.id} className={`border-t border-line ${a.active ? "" : "text-muted"}`}>
                    <td className="px-3 py-1">{!a.is_system && canEdit ? <EditLedger id={a.id} name={a.name} active={a.active} />
                      : <Link className="hover:underline" href={`/accounts/ledger?account=${a.id}`}>{a.name}</Link>}{!a.active && " (inactive)"}</td>
                    <td className="px-3 text-right text-xs text-muted">{a.is_system ? "system" : "custom"}</td>
                  </tr>))}</tbody></table>
            </section>);
        })}
      </div>
    </div>
  );
}
