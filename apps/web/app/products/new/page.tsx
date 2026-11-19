import { requireArea } from "@/lib/context";
import { LiveOnly, PageHeader } from "@/components/ui";
import { EMPTY_PRODUCT, ProductForm } from "../ProductForm";

export const metadata = { title: "Add product · MedStar" };

export default async function NewProductPage() {
  const ctx = await requireArea("/products");
  return (
    <div className="mx-auto max-w-4xl p-6">
      <PageHeader title="Add product" />
      {ctx.mode === "demo" ? <LiveOnly what="Adding products" /> :
        <div className="rounded-lg border border-line bg-surface p-4"><ProductForm orgId={ctx.org.orgId} initial={EMPTY_PRODUCT} canEdit /></div>}
    </div>
  );
}
