/** Month picker (GET) with an optional custom range for quarterly (QRMP) filers. */
export function PeriodForm({ month, from, to, custom }: { month: string; from: string; to: string; custom: boolean }) {
  return (
    <form className="mb-3 flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col">Return period<input type="month" name="month" defaultValue={month} className="rounded border border-line bg-surface px-2 py-1" /></label>
      <details open={custom} className="self-center">
        <summary className="cursor-pointer text-muted">custom dates (quarterly filers)</summary>
        <span className="ml-2 inline-flex gap-2">
          <input type="date" name="from" defaultValue={custom ? from : ""} aria-label="From" className="rounded border border-line bg-surface px-2 py-1" />
          <input type="date" name="to" defaultValue={custom ? to : ""} aria-label="To" className="rounded border border-line bg-surface px-2 py-1" />
        </span>
      </details>
      <button className="rounded border border-line bg-surface px-3 py-1.5">Show</button>
    </form>
  );
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function readPeriod(sp: { month?: string; from?: string; to?: string }, defaultMonth: string) {
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : defaultMonth;
  const custom = ISO.test(sp.from ?? "") && ISO.test(sp.to ?? "") && sp.from! <= sp.to!;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = custom ? sp.from! : `${month}-01`;
  const to = custom ? sp.to! : `${month}-${String(last).padStart(2, "0")}`;
  // fp (MMYYYY) = month of the period end
  const fp = `${to.slice(5, 7)}${to.slice(0, 4)}`;
  return { month, from, to, custom, fp };
}

export const previousMonth = () => {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
};
