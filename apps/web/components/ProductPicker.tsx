"use client";
import { useEffect, useRef, useState } from "react";
import { searchRemote, type PosProduct } from "@/lib/catalogue";
import { ScheduleBadge } from "./ScheduleBadge";

/** Server-backed product search (includes out-of-stock items) for GRN and other back-office forms. */
export function ProductPicker({ storeId, onPick, placeholder = "Search product by name, salt or barcode", autoFocus }: {
  storeId: string; onPick: (p: PosProduct) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PosProduct[]>([]);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setResults([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => { const r = await searchRemote(storeId, s); if (!cancelled) { setResults(r); setHi(0); } }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, storeId]);

  const pick = (p: PosProduct) => { onPick(p); setQ(""); setResults([]); ref.current?.focus(); };

  return (
    <div className="relative">
      <input ref={ref} autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Product search"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === "Enter" && results[hi]) { e.preventDefault(); pick(results[hi]!); }
        }}
        className="w-full rounded border border-line bg-surface px-3 py-2" />
      {results.length > 0 && (
        <ul role="listbox" className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line bg-surface shadow-lg">
          {results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === hi} onMouseDown={() => pick(p)}
              className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${i === hi ? "bg-brand-50" : ""}`}>
              <span className="flex items-center gap-2"><ScheduleBadge schedule={p.schedule} coldChain={p.coldChain} />{p.name}
                <span className="text-muted">· {p.composition} · {p.unitsPerPack} {p.baseLabel}/{p.packLabel}</span></span>
              <span className="text-muted">GST {p.gstRate < 0 ? "?" : `${p.gstRate}%`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
