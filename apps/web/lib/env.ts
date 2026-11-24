/**
 * Supabase connection for the browser, the server and the proxy. Values are inlined at build time.
 * The publishable key (sb_publishable_…) is the new name for the anon key; either works. Never put the secret / service-role key here.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
