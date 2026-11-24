import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_KEY, SUPABASE_URL } from "./env";

const url = SUPABASE_URL;
const anon = SUPABASE_KEY;

/** True when no Supabase project is configured — screens fall back to demo data. */
export const DEMO_MODE = !url || !anon;

let client: ReturnType<typeof createBrowserClient> | null = null;
/** Browser client: user session + anon key; RLS enforces tenancy. Never use the service-role key here. */
export function supabaseBrowser() {
  if (DEMO_MODE) return null;
  client ??= createBrowserClient(url!, anon!);
  return client;
}
