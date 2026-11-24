# MedStar Pharma Suite

Pharmacy POS, inventory, accounting, GST & drug-law compliance with an online order portal — built for Indian retail chemists.

```
apps/web          Back-office + POS (Next.js 16, offline-first outbox)      :3000
apps/storefront   Customer ordering portal + Rx upload (Next.js 16, PWA)   :3001
packages/core     Domain logic: GST, FEFO, schedules, invoice nos, order state machine, Zod contracts
supabase/         Migrations (schema, posting functions, RLS), seed, DB test pack
docs/             PRD & use cases, SME validation, architecture, UX, plan, QA, security, roadmap
.claude/agents/   The product team as Claude Code agents
```

## Quick start
```bash
corepack enable && pnpm install
pnpm --filter @medstar/core test          # 37 domain tests
pnpm --filter @medstar/web dev            # http://localhost:3000/pos  (demo data if no Supabase env)
pnpm --filter @medstar/storefront dev     # http://localhost:3001

# Database (Supabase CLI)
supabase init && supabase start
supabase db reset                         # applies migrations + seed.sql
cp .env.example apps/web/.env.local       # fill URL + anon key from `supabase status`

# Or test the SQL on any Postgres 15+:
PGHOST=localhost PGPORT=5432 PGUSER=postgres scripts/test-db.sh
```

## Run locally (live mode)
```bash
npx supabase start                  # needs Docker Desktop running; applies migrations + seed
npx supabase status                 # copy API URL + anon key
cp .env.example apps/web/.env.local # paste them in
pnpm --filter @medstar/web dev
```
1. Open http://localhost:3000 → **Create account** → you land on **Set up your pharmacy** (legal name, PAN, store code, state, GST scheme, GSTIN, address).
2. **Settings** → add drug licences, register a pharmacist with a 4–6 digit PIN, invite staff (copy the invite link; emails show in Inbucket at http://localhost:54324).
3. **Products → Import CSV** (download the template), add distributors under **Purchase**, then load stock with **Inventory → Load opening stock** or **Purchase → New GRN**.
4. **POS** → *Start duty* (pharmacist PIN) → bill. Online bills post immediately and print the final invoice number; offline bills print a provisional number and sync automatically.

Without `.env.local` the apps run in **demo mode** with sample data.

## What works today
- **packages/core** — MRP-inclusive GST back-calculation (Nil/5/18 %, CGST/SGST/IGST, composition Bill of Supply), bill round-off, HSN summary, effective-dated rate resolution, GSTIN checksum, FEFO batch allocation with expiry/recall blocking, loose-unit conversion, Schedule H/H1/X/NDPS rules for counter & online, order lifecycle guards, GST-compliant invoice numbering, Zod contracts.
- **Database** — multi-tenant schema with RLS; `post_sale` (idempotent, FEFO with row locks, compliance checks, H1/X/NDPS register, payments, balanced journal incl. COGS, gap-free invoice no.), `post_purchase` (GRN with free qty, landed cost, distributor licence check, ITC journal), `place_online_order`, `verify_online_rx`, `apply_recall`; triggers that block Rx orders skipping verification and Schedule X/NDPS/habit-forming items on delivery; append-only ledgers; trial balance & GSTR-1 HSN views. All covered by supabase/tests.
- **Sprint 1** — email/password & magic-link sign-in (Next 16 `proxy.ts` session refresh), pharmacy onboarding, store switcher, role-based navigation, invitations with store scope & discount limits, pharmacist registry with hashed PINs, duty shifts, one-time PIN approvals for Rx bills (5-try lockout), licence/registration expiry alerts, private prescription storage bucket.
- **Sprint 2** — product master (add/edit, barcodes, Nil-rate GST override, block reason, reorder levels) with CSV import (dry run, all-or-nothing, rename warnings); distributors with GSTIN/licence checks and payables; GRN entry with PTR/free/discount, margin, MRP-change and short-expiry warnings and paper-total cross-check; batch-wise inventory with expiry views; opening-stock CSV import (Dr Inventory / Cr Opening balances); customers with DPDP consent, credit limits (owner/admin only), outstanding and receipts; doctor master; POS customer picker (F4), credit (udhaar) sales with limit checks, doctor lookup in the Rx dialog.
- **Sprint 3** — Sales list & bill view; returns with credit notes (partial/final, restock or damaged, cold-chain never restocked, refund by cash/UPI/card or to the customer's account, H1/X/NDPS register return rows); same-day bill cancellation (owner/admin, or own bill within 30 min); returns to distributors with debit notes at landed cost and input-GST reversal; stock adjustments with owner/admin approval (X/NDPS need a note); recalls that quarantine matching batches and list the customers who bought them.
- **Sprint 4** — cashier shifts on the POS (open with float, cash in/out, blind close by denomination, X/Z reports, shortage/excess posted to the books); offline app shell (service worker + installable app: the billing screen opens with no internet, even after a restart); silent-printing desktop shortcut (`scripts/windows/create-pos-shortcut.ps1`, see docs/10-counter-setup.md); H1/X/NDPS registers with CSV & print export; controlled-drug stock reconciliation; prescription archive with logged 5-minute image links; audit-log viewer (owner/admin/auditor only).
- **Sprint 5** — accounting & GST: chart of accounts with groups and your own ledgers; payment / receipt / contra / journal / expense vouchers (expense bills with input GST and a photo/PDF attachment, reversal instead of edits); period lock enforced on every posting path; day book, cash/bank book, party ledgers, trial balance, P&L with gross margin by product/category/manufacturer, balance sheet; GSTR-1 (B2B, B2CS, CDNR, Nil, HSN B2B/B2C, documents) with portal JSON, GSTR-3B with books check and ITC set-off, CMP-08 / GSTR-4 summary for composition stores; Tally XML export (masters + vouchers).
- **Sprint 6** — two-branch pilot: branch stock transfers (delivery challan, in transit, short receipt, cancel), short list → purchase orders (print / WhatsApp), Reports (sales by day / mode / staff / hour, item-wise, doctor-wise, purchase register, udhaar with WhatsApp reminder, supplier dues, stock valuation, non-moving), WhatsApp bill and A4 tax invoice; hosting on Supabase + Vercel (Mumbai) — see docs/13-hosting-runbook.md, docs/14-product-guide.md, docs/15-go-live-parallel-run.md.
- **POS screen** — live catalogue (server search + IndexedDB cache for offline), keyboard-first billing with FEFO batches, near-expiry warnings, loose sale, discounts, schedule badges, Rx capture & pharmacist PIN, payment modes, offline outbox with provisional numbers and idempotent sync.
- **Back-office** — dashboard, online order board (state machine), pharmacist Rx verification queue, compliance hub with H1 register.
- **Storefront** — catalogue with Rx / store-only flags, cart compliance checks, pincode serviceability, DPDP consent, prescription upload.

## Next (see docs/05-engineering-plan.md)
Next: Sprint 7 — online orders on live data (storefront, Rx upload, verification queue, delivery). Then payment gateway + WhatsApp Edge Functions, rider PWA, distributor invoice import, year-end close.
