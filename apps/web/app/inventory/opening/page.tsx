import { requireArea } from "@/lib/context";
import { LiveOnly, PageHeader } from "@/components/ui";
import { OpeningStockImport } from "./OpeningStockImport";

export const metadata = { title: "Opening stock · MedStar" };

export default async function OpeningStockPage() {
  const ctx = await requireArea("/purchase");
  return (
    <div className="mx-auto max-w-4xl p-6">
      <PageHeader title={`Load opening stock · ${ctx.store.code}`}
        sub="One row per batch: barcode or exact product name, batch, expiry (MM/YY), MRP and cost per pack, quantity in packs and/or loose units. Value at cost is posted to Inventory against Opening balances." />
      {ctx.mode === "demo" ? <LiveOnly what="Opening stock import" /> : <OpeningStockImport orgId={ctx.org.orgId} storeId={ctx.store.id} />}
    </div>
  );
}
