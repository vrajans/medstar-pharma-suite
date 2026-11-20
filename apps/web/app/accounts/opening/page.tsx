import { redirect } from "next/navigation";
import { requireArea } from "@/lib/context";
import { LiveOnly, PageHeader } from "@/components/ui";
import { AccountsNav, istToday } from "@/components/books";
import { OpeningBalancesImport } from "./OpeningBalancesImport";

export const metadata = { title: "Opening balances · MedStar" };

export default async function OpeningBalancesPage() {
  const ctx = await requireArea("/accounts");
  if (!["owner", "admin", "accountant"].includes(ctx.org.role)) redirect("/accounts");
  const d = new Date(`${istToday()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader title="Opening balances" sub="Bring over udhaar and supplier dues from your old software on the day you go live" />
      <AccountsNav active="/accounts/opening" />
      {ctx.mode === "demo" ? <LiveOnly what="Opening balances" /> : (
        <>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
            <li>Load your product master and <a className="text-brand-700 underline" href="/inventory/opening">opening stock</a> first, and add your suppliers under Purchase.</li>
            <li>From your old software, export customer outstanding (mobile, name, amount they owe) and supplier outstanding (name, amount you owe). Use a minus sign for advances.</li>
            <li>Fill the template, check it (nothing is saved), then load it. Each customer or supplier can be loaded once; the balancing figure goes to <i>Opening balances</i> (capital).</li>
            <li>Cash and bank balances: post a <a className="text-brand-700 underline" href="/accounts/vouchers/new?kind=journal">journal voucher</a> — Dr Cash / Bank, Cr Opening balances.</li>
          </ol>
          <div className="rounded-lg border border-line bg-surface p-4"><OpeningBalancesImport storeId={ctx.store.id} defaultDate={d.toISOString().slice(0, 10)} /></div>
        </>
      )}
    </div>
  );
}
