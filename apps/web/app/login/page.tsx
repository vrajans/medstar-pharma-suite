"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DEMO_MODE, supabaseBrowser } from "@/lib/supabase";

type Mode = "signin" | "signup" | "magic";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  if (DEMO_MODE) {
    return <p className="text-sm">Demo mode — no Supabase project configured. <a className="underline" href="/pos">Open the POS</a>.</p>;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = supabaseBrowser()!;
    setBusy(true); setMsg(null);
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next); router.refresh();
      } else if (mode === "signup") {
        if (password.length < 10) throw new Error("Use at least 10 characters for your password");
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        if (data.session) { router.replace(next === "/" ? "/onboarding" : next); router.refresh(); }
        else setMsg({ kind: "ok", text: "Check your email to confirm your account." });
      } else {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: false } });
        if (error) throw error;
        setMsg({ kind: "ok", text: "We sent a sign-in link to your email." });
      }
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div role="tablist" className="flex gap-1 rounded-md bg-canvas p-1 text-sm">
        {(["signin", "signup", "magic"] as Mode[]).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setMsg(null); }}
            className={`flex-1 rounded px-2 py-1 ${mode === m ? "bg-surface shadow-sm" : "text-muted"}`}>
            {m === "signin" ? "Sign in" : m === "signup" ? "Create account" : "Email link"}
          </button>
        ))}
      </div>
      <label className="block text-sm">Email
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded border border-line px-3 py-2" />
      </label>
      {mode !== "magic" && (
        <label className="block text-sm">Password
          <input type="password" required autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password}
            onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded border border-line px-3 py-2" />
        </label>
      )}
      {msg && <p role="alert" className={`text-sm ${msg.kind === "ok" ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      <button disabled={busy} className="w-full rounded-md bg-brand-700 py-2 font-medium text-white disabled:opacity-50">
        {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send link"}
      </button>
      {mode === "signup" && <p className="text-xs text-muted">Staff joining an existing pharmacy: create your account with the email your owner invited, then open the invite link.</p>}
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-[calc(100vh-3rem)] items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold">MedStar Pharma Suite</h1>
        <p className="mb-4 text-sm text-muted">Sign in to your pharmacy</p>
        <Suspense><LoginForm /></Suspense>
      </div>
    </div>
  );
}
