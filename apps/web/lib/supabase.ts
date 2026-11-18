import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when no Supabase project is configured — screens fall back to demo data. */
export const DEMO_MODE = !url || !anon;

let client: ReturnType<typeof createBrowserClient> | null = null;
/** Browser client: user session + anon key; RLS enforces tenancy. Never use the service-role key here. */
export function supabaseBrowser() {
  if (DEMO_MODE) return null;
  client ??= createBrowserClient(url!, anon!);
  return client;
}
