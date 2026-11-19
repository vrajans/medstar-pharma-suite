import Link from "next/link";

/** Shown on screens that need the real database when the app runs in demo mode. */
export function LiveOnly({ what }: { what: string }) {
  return (
    <div className="rounded-lg border border-warn bg-warn/10 p-4 text-sm">
      <p className="font-medium text-warn">{what} needs the live database.</p>
      <p className="mt-1">You&apos;re in demo mode. Start Supabase (<code>supabase start</code>), copy the URL and anon key from <code>supabase status</code> into
        <code> apps/web/.env.local</code>, restart <code>pnpm --filter @medstar/web dev</code> and sign up. See the README section &quot;Run Sprint 1 locally&quot;.</p>
    </div>
  );
}

export function PageHeader({ title, children, sub }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {sub && <p className="text-sm text-muted">{sub}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function ButtonLink({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <Link href={href} className={`rounded-md px-3 py-1.5 text-sm ${primary ? "bg-brand-700 text-white" : "border border-line bg-surface"}`}>{children}</Link>
  );
}

export const inputCls = "mt-1 w-full rounded border border-line bg-surface px-2 py-1.5";
export const thCls = "py-2 text-left text-xs font-medium uppercase text-muted";
