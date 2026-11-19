import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { OnboardingForm } from "./OnboardingForm";

export const metadata = { title: "Set up your pharmacy · MedStar" };

export default async function OnboardingPage() {
  const ctx = await getAppContext();
  if (ctx.mode === "live" && !ctx.userId) redirect("/login?next=/onboarding");
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-xl font-semibold">Set up your pharmacy</h1>
      <p className="mb-4 text-sm text-muted">
        {ctx.orgs.length ? "Add another pharmacy business to your account." : "Joining someone else's pharmacy? Open the invite link they sent you instead."}
      </p>
      <div className="rounded-lg border border-line bg-surface p-4">
        {ctx.mode === "demo" ? <p className="text-sm">Demo mode — configure Supabase to create a real pharmacy.</p> : <OnboardingForm />}
      </div>
    </div>
  );
}
