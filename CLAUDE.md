# MedStar Pharma Suite — instructions for Claude & the agent team

India retail pharmacy SaaS: POS (counter + online), purchase, batch inventory, double-entry accounting, GST, drug-law compliance (Schedule H/H1/X/NDPS), online order portal.

## Team (.claude/agents)
cto · product-manager · business-analyst · pharmacy-sme · accounting-sme · ux-manager · ui-designer · engineering-manager · frontend-engineer · backend-engineer · database-engineer · devops-engineer · qa-lead · security-privacy · customer-success

Route work: product questions → product-manager; anything touching drug law → pharmacy-sme; tax/ledgers → accounting-sme; schema/RLS → database-engineer; screens → ux-manager/ui-designer; tests → qa-lead.

## Source of truth
- Use cases: docs/02-prd-use-cases.md (IDs UC-<MOD>-<nn>) — every PR references one.
- SME rulings: docs/03-sme-validation.md — do not contradict without an SME update.
- Architecture & ADRs: docs/01-cto-architecture.md

## Hard rules
1. Money = integer paise everywhere (bigint in DB). No floats.
2. Tax/FEFO/schedule/numbering logic lives in packages/core and is mirrored in SQL posting functions; change both + tests together.
3. Ledgers (stock_ledger, journal_*, schedule_register, sales_bill_lines, payments, audit_log) are append-only. Corrections = reversals.
4. Every new table: org_id + RLS policy + isolation test in supabase/tests.
5. Never put the Supabase service-role key in apps/.
6. GST rates are data (tax_rates), never constants in code.

## Commands
pnpm install · pnpm --filter @medstar/core test · pnpm --filter @medstar/web dev · pnpm --filter @medstar/storefront dev · scripts/test-db.sh (needs PGHOST/PGPORT/PGUSER) · supabase start && supabase db reset
