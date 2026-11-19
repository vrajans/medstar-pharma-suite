import { requireArea } from "@/lib/context";
import { LiveOnly, PageHeader } from "@/components/ui";
import { ProductImport } from "./ProductImport";

export const metadata = { title: "Import products · MedStar" };

export default async function ImportProductsPage() {
  const ctx = await requireArea("/products");
  return (
    <div className="mx-auto max-w-4xl p-6">
      <PageHeader title="Import product master" sub="Rows are matched by barcode, then by name + manufacturer + pack size. Matches are updated; the rest are created. Nothing is saved unless every row is valid." />
      {ctx.mode === "demo" ? <LiveOnly what="Importing products" /> : <ProductImport orgId={ctx.org.orgId} />}
    </div>
  );
}
