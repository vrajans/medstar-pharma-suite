# Security & DPDP Privacy Design

Owner: `security-privacy`

## Threat model highlights (STRIDE)
| Threat | Control |
|---|---|
| Tenant data leak | RLS on all tables, pgTAP isolation tests, no service key in clients |
| Staff fraud (cancel after cash, discount abuse) | Role limits, reasons, audit log, shift reconciliation, owner alerts |
| Rx image exposure | Private bucket, 5-min signed URLs, access logged, no CDN caching |
| Fake prescriptions online | Pharmacist verification, doctor reg. no. check, Rx reuse counter, pattern alerts |
| Account takeover | MFA for Owner/Admin, OTP rate limits, device binding for POS |
| Webhook spoofing | HMAC signature verification, idempotency |

## DPDP Act 2023 / Rules 2025 checklist
- [x] Notice in plain English/Hindi at sign-up & counter (QR to notice), itemised purposes
- [x] Separate consent: service (required), refill reminders, marketing
- [x] Consent log (purpose, version, timestamp, channel) and one-tap withdrawal
- [x] Data-principal rights: access, correction, erasure, grievance — SLA tracked
- [x] Retention schedule: statutory registers 2–3 yrs, GST books ~8 yrs, marketing data until withdrawal; documented conflict handling
- [x] Breach response runbook (Board + affected users, 72 h)
- [x] Security safeguards: encryption at rest/in transit, access control, logging retained ≥ 1 year, backups
- [x] Processor contracts (Supabase, Vercel, WhatsApp BSP, payment gateway)
- [x] Data residency: India region
- Full obligations apply by 13 May 2027; target compliance at MVP launch.
