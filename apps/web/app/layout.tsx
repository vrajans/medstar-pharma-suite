import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedStar Pharma Suite",
  description: "Pharmacy POS, inventory, accounting & compliance",
};

const nav = [
  ["/", "Dashboard"], ["/pos", "POS"], ["/orders", "Online orders"], ["/rx-verify", "Rx verification"],
  ["/inventory", "Inventory"], ["/purchase", "Purchase"], ["/accounts", "Accounts"], ["/gst", "GST"], ["/compliance", "Compliance"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen font-sans antialiased">
        <header className="flex h-12 items-center gap-6 border-b border-line bg-brand-900 px-4 text-white">
          <span className="font-semibold tracking-tight">MedStar</span>
          <nav className="flex gap-1 text-sm">
            {nav.map(([href, label]) => (
              <Link key={href} href={href} className="rounded px-2 py-1 text-brand-100 hover:bg-brand-700 hover:text-white">{label}</Link>
            ))}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
