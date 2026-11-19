import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { LiveOnly, PageHeader } from "@/components/ui";
import { GrnForm } from "./GrnForm";

export const metadata = { title: "New GRN · MedStar" };

export default async function NewGrnPage() {
  const ctx = await requireArea("/purchase");
  if (ctx.mode === "demo") return <div className="mx-auto max-w-6xl p-6"><PageHeader title="New goods receipt" /><LiveOnly what="Goods receipt" /></div>;
  const sb = await supabaseServer();
  const { data } = await sb.from("distributors").select("id, name, state_code, drug_licence_valid_to, credit_days").eq("org_id", ctx.org.orgId).eq("is_active", true).order("name");
  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader title="New goods receipt (GRN)" sub={`${ctx.store.code} · ${ctx.store.gstScheme === "composition" ? "composition — GST becomes part of cost" : "regular — GST goes to input tax credit"}`} />
      <GrnForm storeId={ctx.store.id} storeState={ctx.store.stateCode} scheme={ctx.store.gstScheme} distributors={data ?? []} />
    </div>
  );
}
