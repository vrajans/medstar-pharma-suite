/** All money in packages/core is integer paise. Never use floats for money. */
export type Paise = number;

/** Round half away from zero to an integer. */
export function roundHalfUp(n: number): number {
  const s = Math.sign(n);
  return s * Math.round(Math.abs(n) + Number.EPSILON * 10);
}

export function rupeesToPaise(rupees: number | string): Paise {
  const n = typeof rupees === "string" ? Number(rupees) : rupees;
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${rupees}`);
  return roundHalfUp(n * 100);
}

export function paiseToRupees(p: Paise): number {
  return p / 100;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,23,456.78 */
export function formatINR(p: Paise): string {
  return inr.format(p / 100);
}

/** DD-MM-YYYY */
export function formatDateIN(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  const dd = String(x.getUTCDate()).padStart(2, "0");
  const mm = String(x.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${x.getUTCFullYear()}`;
}
