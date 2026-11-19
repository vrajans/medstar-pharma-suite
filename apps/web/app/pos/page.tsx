import { PosScreen, type PosCtx } from "@/components/pos/PosScreen";
import { requireArea } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase-server";
import { DEMO_PHARMACIST } from "@/lib/demo-data";

export const metadata = { title: "POS · MedStar" };

export default async function PosPage() {
  const ctx = await requireArea("/pos");
  let pharmacists: PosCtx["pharmacists"] = [{ id: DEMO_PHARMACIST.id, name: DEMO_PHARMACIST.name, regNo: DEMO_PHARMACIST.regNo }];
  if (ctx.mode === "live") {
    const sb = await supabaseServer();
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await sb.from("pharmacists").select("id, name, reg_no, reg_valid_to").eq("org_id", ctx.org.orgId).order("name");
    pharmacists = (data ?? []).filter((p) => !p.reg_valid_to || p.reg_valid_to >= today).map((p) => ({ id: p.id, name: p.name, regNo: p.reg_no }));
  }
  return (
    <PosScreen
      key={ctx.store.id}
      ctx={{ mode: ctx.mode, orgId: ctx.org.orgId, orgName: ctx.org.orgName, store: ctx.store, maxDiscountPct: ctx.org.maxDiscountPct, pharmacists }}
    />
  );
}
