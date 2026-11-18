import type { DrugSchedule } from "@medstar/core";

const STYLE: Record<DrugSchedule, { cls: string; label: string; title: string }> = {
  OTC: { cls: "border-sch-otc text-sch-otc", label: "OTC", title: "Over the counter" },
  G: { cls: "border-sch-otc text-sch-otc", label: "G", title: "Schedule G" },
  C: { cls: "border-sch-otc text-sch-otc", label: "C", title: "Schedule C" },
  C1: { cls: "border-sch-otc text-sch-otc", label: "C1", title: "Schedule C1" },
  H: { cls: "border-sch-h text-sch-h", label: "Rx", title: "Schedule H — prescription only" },
  H1: { cls: "border-sch-h1 bg-sch-h1 text-white", label: "H1", title: "Schedule H1 — Rx + register" },
  X: { cls: "border-sch-x bg-sch-x text-white", label: "X", title: "Schedule X — Rx copy retained, register" },
  NDPS: { cls: "border-sch-ndps bg-sch-ndps text-white", label: "NDPS", title: "Narcotic / psychotropic — register" },
};

export function ScheduleBadge({ schedule, coldChain }: { schedule: DrugSchedule; coldChain?: boolean }) {
  const s = STYLE[schedule];
  return (
    <span className="inline-flex items-center gap-1">
      {schedule !== "OTC" && (
        <span title={s.title} aria-label={s.title} className={`rounded border px-1 text-[10px] font-bold leading-4 ${s.cls}`}>{s.label}</span>
      )}
      {coldChain && <span title="Cold chain — store 2–8 °C" aria-label="Cold chain" className="text-cold text-xs">❄</span>}
    </span>
  );
}
