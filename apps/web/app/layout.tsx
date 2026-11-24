import type { Metadata } from "next";
import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { AREA_ROLES } from "@/lib/types";
import { AccountBar } from "@/components/AccountBar";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedStar Pharma Suite",
  applicationName: "MedStar POS",
  description: "Pharmacy POS, inventory, accounting & compliance",
};

const NAV = [
  ["/", "Dashboard"], ["/pos", "POS"], ["/sales", "Sales"], ["/orders", "Online orders"], ["/rx-verify", "Rx verification"],
  ["/products", "Products"], ["/customers", "Customers"], ["/inventory", "Inventory"], ["/purchase", "Purchase"], ["/reports", "Reports"], ["/accounts", "Accounts"], ["/gst", "GST"],
  ["/compliance", "Compliance"], ["/settings", "Settings"],
] as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAppContext();
  const role = ctx.org?.role;
  // online ordering (Sprint 7) stays out of the live menu until it is switched on
  const LATER = ctx.mode === "live" ? ["/orders", "/rx-verify"] : [];
  const nav = role ? NAV.filter(([href]) => !LATER.includes(href) && (!AREA_ROLES[href] || AREA_ROLES[href]!.includes(role))) : [];

  return (
    <html lang="en-IN">
      <body className="min-h-screen font-sans antialiased">
        <header className="flex h-12 items-center gap-6 border-b border-line bg-brand-900 px-4 text-white">
          <Link href="/" className="font-semibold tracking-tight">MedStar</Link>
          <nav className="flex min-w-0 gap-1 overflow-x-auto whitespace-nowrap text-sm">
            {nav.map(([href, label]) => (
              <Link key={href} href={href} className="rounded px-2 py-1 text-brand-100 hover:bg-brand-700 hover:text-white">{label}</Link>
            ))}
          </nav>
          <AccountBar ctx={ctx} />
        </header>
        <main>{children}</main>
        <ServiceWorker />
      </body>
    </html>
  );
}
