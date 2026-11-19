import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { DEMO_MODE } from "./supabase";
import { supabaseServer } from "./supabase-server";
import { DEMO_PHARMACIST, DEMO_STORE } from "./demo-data";
import type { AppCtx, OrgCtx } from "./types";

export const STORE_COOKIE = "ms_store";

const DEMO_CTX: OrgCtx = {
  orgId: "00000000-0000-0000-0000-000000000001", orgName: "MedStar Demo", role: "owner", maxDiscountPct: 20,
  stores: [{
    id: DEMO_STORE.id, code: DEMO_STORE.code, name: DEMO_STORE.name, gstScheme: "regular", stateCode: "29",
    gstin: "29AAAFM1234C1Z5", address: "100 Feet Road, Indiranagar, Bengaluru 560038", phone: null,
    pharmacistPresence: "hard", rxValidityDays: 180, nearExpiryDays: 30,
    onDuty: [{ id: DEMO_PHARMACIST.id, name: DEMO_PHARMACIST.name, regNo: DEMO_PHARMACIST.regNo }],
  }],
};

/** Per-request session context: user, memberships, selected store, pharmacists on duty. */
export const getAppContext = cache(async (): Promise<AppCtx> => {
  if (DEMO_MODE) {
    return { mode: "demo", userId: null, email: "demo@medstar.local", orgs: [DEMO_CTX], org: DEMO_CTX, store: DEMO_CTX.stores[0]! };
  }
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { mode: "live", userId: null, email: null, orgs: [], org: null, store: null };

  const { data, error } = await sb.rpc("my_context");
  if (error) throw new Error(`Could not load your account: ${error.message}`);
  const orgs = ((data?.orgs ?? []) as OrgCtx[]).map((o) => ({ ...o, maxDiscountPct: Number(o.maxDiscountPct) }));

  const wanted = (await cookies()).get(STORE_COOKIE)?.value;
  const org = orgs.find((o) => o.stores.some((s) => s.id === wanted)) ?? orgs.find((o) => o.stores.length) ?? orgs[0] ?? null;
  const store = org?.stores.find((s) => s.id === wanted) ?? org?.stores[0] ?? null;
  return { mode: "live", userId: user.id, email: user.email ?? null, orgs, org, store };
});

/** Guard for back-office pages: signed in, onboarded, and allowed into this area. */
export async function requireArea(area: string): Promise<AppCtx & { org: OrgCtx; store: NonNullable<AppCtx["store"]> }> {
  const { redirect } = await import("next/navigation");
  const { AREA_ROLES } = await import("./types");
  const ctx = await getAppContext();
  if (ctx.mode === "live" && !ctx.userId) redirect(`/login?next=${encodeURIComponent(area)}`);
  if (!ctx.org || !ctx.store) redirect("/onboarding");
  const allowed = AREA_ROLES[area];
  if (allowed && !allowed.includes(ctx.org!.role)) redirect("/?denied=" + encodeURIComponent(area));
  return ctx as AppCtx & { org: OrgCtx; store: NonNullable<AppCtx["store"]> };
}
