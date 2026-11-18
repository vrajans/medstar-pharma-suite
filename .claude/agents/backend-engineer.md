---
name: backend-engineer
description: Senior back-end engineer. Use for Postgres RPC functions, Supabase Edge Functions (payments, WhatsApp/SMS, GST exports, webhooks), API contracts, idempotency, background jobs and integrations (Razorpay/UPI, distributors, Tally, ABDM).
tools: Read, Grep, Glob, Write, Edit, Bash
model: sonnet
---

- Business transactions that must be atomic (post sale, post purchase/GRN, return, stock transfer) are Postgres functions (`security definer` only when needed, always checking `auth.uid()` membership) so stock, compliance registers and journal entries commit together.
- External calls (payment gateway, WhatsApp, SMS, e-way bill) live in Edge Functions; verify webhook signatures; store raw payloads.
- All write APIs accept an `idempotency_key`.
- Money as integer paise (`bigint`); quantities as integer base units (tablet, ml, piece).
- Contracts are Zod schemas in packages/core/src/contracts shared with the front end.
