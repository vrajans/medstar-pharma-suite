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

## What works today
- **packages/core** — MRP-inclusive GST back-calculation (Nil/5/18 %, CGST/SGST/IGST, composition Bill of Supply), bill round-off, HSN summary, effective-dated rate resolution, GSTIN checksum, FEFO batch allocation with expiry/recall blocking, loose-unit conversion, Schedule H/H1/X/NDPS rules for counter & online, order lifecycle guards, GST-compliant invoice numbering, Zod contracts.
- **Database** — multi-tenant schema with RLS; `post_sale` (idempotent, FEFO with row locks, compliance checks, H1/X/NDPS register, payments, balanced journal incl. COGS, gap-free invoice no.), `post_purchase` (GRN with free qty, landed cost, distributor licence check, ITC journal), `place_online_order`, `verify_online_rx`, `apply_recall`; triggers that block Rx orders skipping verification and Schedule X/NDPS/habit-forming items on delivery; append-only ledgers; trial balance & GSTR-1 HSN views. All covered by supabase/tests.
- **POS screen** — keyboard-first billing with FEFO batches, near-expiry warnings, loose sale, discounts, schedule badges, Rx capture & pharmacist PIN, payment modes, offline outbox with provisional numbers and idempotent sync.
- **Back-office** — dashboard, online order board (state machine), pharmacist Rx verification queue, compliance hub with H1 register.
- **Storefront** — catalogue with Rx / store-only flags, cart compliance checks, pincode serviceability, DPDP consent, prescription upload.

## Next (see docs/05-engineering-plan.md)
Wire screens to Supabase queries/RPCs, auth & roles UI, product/customer/distributor CRUD, GRN screen, returns & credit notes, shifts, GST return exports, payment gateway + WhatsApp Edge Functions, rider PWA, Playwright suite.
