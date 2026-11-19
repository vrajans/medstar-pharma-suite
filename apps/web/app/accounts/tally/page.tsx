import { requireArea } from "@/lib/context";
import { LiveOnly, PageHeader } from "@/components/ui";
import { AccountsNav, istToday } from "@/components/books";
import { TallyExport } from "./TallyExport";

export const metadata = { title: "Tally export · MedStar" };

export default async function TallyPage() {
  const ctx = await requireArea("/accounts");
  const to = istToday();
  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader title="Tally export" sub="Send your books to your CA in Tally Prime / ERP 9 format" />
      <AccountsNav active="/accounts/tally" />
      {ctx.mode === "demo" ? <LiveOnly what="Tally export" /> : (
        <div className="rounded-lg border border-line bg-surface p-4">
          <TallyExport orgId={ctx.org.orgId} storeId={ctx.store.id} defaultCompany={ctx.org.orgName} from={to.slice(0, 8) + "01"} to={to} />
        </div>
      )}
      <section className="mt-6 space-y-2 text-sm">
        <h2 className="font-semibold">How to import in Tally Prime</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open (or create) the company with the same name. In <b>F11 Features</b>, keep <b>Maintain inventory = No</b> for an accounts-only company — item-wise stock stays in MedStar.</li>
          <li><b>Import → Masters</b> and pick the <code>medstar-tally-masters-…xml</code> file first (ledgers for customers, suppliers, taxes and expenses).</li>
          <li><b>Import → Transactions</b> and pick <code>medstar-tally-vouchers-…xml</code>. Choose <i>Ignore duplicates</i> if you re-import an overlapping period — every voucher carries a fixed GUID.</li>
          <li>Check that Tally&apos;s trial balance matches MedStar&apos;s trial balance for the same dates.</li>
        </ol>
        <p className="text-muted">Sales post one line per GST head (not item-wise), purchases post to “Stock in trade” at cost and cost of goods sold is posted with every bill.
          Tell your CA so they don&apos;t also post a closing-stock entry.</p>
      </section>
    </div>
  );
}
