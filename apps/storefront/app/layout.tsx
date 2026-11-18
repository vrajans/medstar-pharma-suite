import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedStar Pharmacy — order medicines from your neighbourhood chemist",
  description: "Order medicines with a valid prescription from a licensed pharmacy near you. Delivery or store pickup.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f766e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen font-sans antialiased">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between bg-brand-700 px-4 text-white">
          <Link href="/" className="font-semibold">MedStar Pharmacy</Link>
          <nav className="flex gap-4 text-sm"><Link href="/upload-rx">Upload Rx</Link><Link href="/#cart">Cart</Link></nav>
        </header>
        <main className="mx-auto max-w-3xl p-4">{children}</main>
        <footer className="mx-auto max-w-3xl p-4 text-xs text-muted">
          MedStar Indiranagar · Retail drug licence 20/21 KA-BLR-XXXX · Registered pharmacist: Dr. A. Rao (KSPC-4455).
          Prescription medicines are dispensed only against a valid prescription verified by our pharmacist.
          Schedule X / narcotic medicines are not sold online. <Link href="/privacy" className="underline">Privacy notice</Link>
        </footer>
      </body>
    </html>
  );
}
