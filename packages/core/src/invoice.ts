/** Indian financial year (April–March) label, e.g. 2026-11-17 → "26-27". */
export function financialYear(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * GST Rule 46: invoice number ≤ 16 chars, unique per FY, only A–Z, 0–9, "-" and "/".
 * Format: <SERIES>/<FY>/<SEQ>, sequence zero-padded to fill available length (min 4).
 */
export function formatInvoiceNo(series: string, isoDate: string, seq: number): string {
  if (!/^[A-Z0-9]{1,5}$/.test(series)) throw new Error("Series must be 1–5 uppercase alphanumerics");
  if (!Number.isInteger(seq) || seq <= 0) throw new Error("Sequence must be a positive integer");
  const prefix = `${series}/${financialYear(isoDate)}/`;
  const width = Math.max(4, 16 - prefix.length);
  const s = String(seq).padStart(width, "0");
  const out = prefix + s;
  if (out.length > 16) throw new Error(`Invoice number ${out} exceeds 16 characters`);
  return out;
}

/** Provisional number used by an offline POS device until the server assigns the final one. */
export function provisionalNo(deviceCode: string, localSeq: number): string {
  return `OFF-${deviceCode}-${localSeq}`;
}
