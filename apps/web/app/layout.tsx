import type { Metadata } from "next";
import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { AREA_ROLES } from "@/lib/types";
import { AccountBar } from "@/components/AccountBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedStar Pharma Suite",
  description: "Pharmacy POS, inventory, accounting & compliance",
};

const NAV = [
  ["/", "Dashboard"], ["/pos", "POS"], ["/orders", "Online orders"], ["/rx-verify", "Rx verification"],
  ["/inventory", "Inventory"], ["/purchase", "Purchase"], ["/accounts", "Accounts"], ["/gst", "GST"],
  ["/compliance", "Compliance"], ["/settings", "Settings"],
] as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAppContext();
  const role = ctx.org?.role;
  const nav = role ? NAV.filter(([href]) => !AREA_ROLES[href] || AREA_ROLES[href]!.includes(role)) : [];

  return (
    <html lang="en-IN">
      <body className="min-h-screen font-sans antialiased">
        <header className="flex h-12 items-center gap-6 border-b border-line bg-brand-900 px-4 text-white">
          <Link href="/" className="font-semibold tracking-tight">MedStar</Link>
          <nav className="flex gap-1 text-sm">
            {nav.map(([href, label]) => (
              <Link key={href} href={href} className="rounded px-2 py-1 text-brand-100 hover:bg-brand-700 hover:text-white">{label}</Link>
            ))}
          </nav>
          <AccountBar ctx={ctx} />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
