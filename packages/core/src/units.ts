/** Pack hierarchy, e.g. Box(10 strips) → Strip(15 tablets) → Tablet (base). */
export interface UnitLevel { code: string; label: string; baseUnits: number }

export function toBase(qty: number, unitCode: string, levels: UnitLevel[]): number {
  const l = levels.find((x) => x.code === unitCode);
  if (!l) throw new Error(`Unknown unit ${unitCode}`);
  const base = qty * l.baseUnits;
  if (!Number.isInteger(base)) throw new Error("Quantity must resolve to whole base units");
  return base;
}

/** Human readable: 37 tablets with strip=15 → "2 Strip + 7 Tab" */
export function describeBase(qtyBase: number, levels: UnitLevel[]): string {
  const sorted = [...levels].sort((a, b) => b.baseUnits - a.baseUnits);
  let rem = qtyBase;
  const parts: string[] = [];
  for (const l of sorted) {
    const n = Math.floor(rem / l.baseUnits);
    if (n > 0) { parts.push(`${n} ${l.label}`); rem -= n * l.baseUnits; }
  }
  return parts.join(" + ") || `0 ${sorted.at(-1)?.label ?? ""}`.trim();
}
