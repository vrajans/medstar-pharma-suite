import { NextResponse } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Uptime check for monitors (UptimeRobot / Better Stack): app up + Supabase Auth and REST reachable. No data is returned. */
export async function GET() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return NextResponse.json({ ok: false, mode: "demo" }, { status: 503 });
  const started = Date.now();
  const check = async (path: string) => {
    try {
      const r = await fetch(`${SUPABASE_URL}${path}`, { headers: { apikey: SUPABASE_KEY! }, cache: "no-store", signal: AbortSignal.timeout(5000) });
      return r.status < 500;
    } catch { return false; }
  };
  const [auth, rest] = await Promise.all([check("/auth/v1/health"), check("/rest/v1/")]);
  const ok = auth && rest;
  return NextResponse.json({ ok, auth, rest, ms: Date.now() - started, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local" }, { status: ok ? 200 : 503 });
}
