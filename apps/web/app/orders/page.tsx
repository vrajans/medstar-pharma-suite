import { getAppContext } from "@/lib/context";
import { PageHeader } from "@/components/ui";
import OrdersBoard from "./OrdersBoard";

export const metadata = { title: "Online orders · MedStar" };

/** Online ordering goes live in Sprint 7; until then the live app shows a notice instead of the sample board. */
export default async function Page() {
  const ctx = await getAppContext();
  if (ctx.mode === "demo") return <OrdersBoard />;
  return (
    <div className="mx-auto max-w-3xl p-6">
      <PageHeader title="Online orders" />
      <p className="rounded-lg border border-line bg-surface p-4 text-sm">This is the online order board for orders from your MedStar web store. Online ordering is switched on in a later release (Sprint 7) — counter billing, purchases, accounts and compliance are ready for UAT now.</p>
    </div>
  );
}
