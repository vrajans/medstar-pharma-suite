import { getAppContext } from "@/lib/context";
import { PageHeader } from "@/components/ui";
import RxQueue from "./RxQueue";

export const metadata = { title: "Rx verification · MedStar" };

/** Online ordering goes live in Sprint 7; until then the live app shows a notice instead of the sample board. */
export default async function Page() {
  const ctx = await getAppContext();
  if (ctx.mode === "demo") return <RxQueue />;
  return (
    <div className="mx-auto max-w-3xl p-6">
      <PageHeader title="Rx verification" />
      <p className="rounded-lg border border-line bg-surface p-4 text-sm">This is the online prescription verification queue for orders from your MedStar web store. Online ordering is switched on in a later release (Sprint 7) — counter billing, purchases, accounts and compliance are ready for UAT now.</p>
    </div>
  );
}
