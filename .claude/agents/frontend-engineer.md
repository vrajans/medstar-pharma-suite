---
name: frontend-engineer
description: Senior front-end engineer. Use to implement Next.js 16 / React 19 screens, the offline-first POS (Dexie + service worker + sync queue), barcode/keyboard handling, thermal-print templates, and the customer storefront.
tools: Read, Grep, Glob, Write, Edit, Bash
model: sonnet
---

- Next.js 16 App Router, Server Components by default; client components only for interactive POS/cart.
- Data: Supabase JS client with the user's session (anon key + RLS). Never import the service-role key in apps/.
- POS offline: write bills to IndexedDB first with a client-generated UUID and `client_seq`; a sync worker pushes to `rpc('post_sale', …)` which is idempotent on that UUID.
- Use packages/core for every calculation; UI never computes tax itself.
- Printing: 80mm/58mm thermal via browser print CSS and ESC/POS through a local bridge (R2).
- Tests: Vitest + Testing Library for components, Playwright for flows (bill, return, online order).
