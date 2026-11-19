import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { AcceptInvite } from "./AcceptInvite";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await getAppContext();
  if (ctx.mode === "live" && !ctx.userId) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  return (
    <div className="mx-auto max-w-md p-6">
      <div className="rounded-lg border border-line bg-surface p-6">
        <h1 className="mb-2 text-lg font-semibold">Join a pharmacy on MedStar</h1>
        <p className="mb-4 text-sm text-muted">Signed in as {ctx.email}. The invitation must have been sent to this email.</p>
        <AcceptInvite token={token} />
      </div>
    </div>
  );
}
