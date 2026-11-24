# Hosting runbook — Supabase (Mumbai) + Vercel (Mumbai)

Owner: `devops-engineer` · Reviewed by: `security-privacy`, `cto` · For the Chennai pilot (2 branches) and every customer after.

**Result:** the back office runs at `https://<your-domain>` on Vercel (functions in Mumbai, `bom1`), with data in a Supabase Pro project in
South Asia (Mumbai), daily backups by Supabase plus a nightly encrypted copy, every database change shipped by GitHub Actions after approval.
About 2–3 hours the first time. Steps that need your login, payment or a secret are yours; everything else is scripted.

## 0. What it costs (per month, as of Nov 2026 — check the pricing pages before you pay)
| Item | Plan | Why |
|---|---|---|
| Supabase | Pro, $25 + compute (Micro included via credits) | Daily backups (7 days), no pausing, email support. Free plan has **no backups** and pauses — not for a live pharmacy |
| Vercel | Pro, $20 per member who deploys | Hobby is for non-commercial use only; Mumbai region pricing on Pro |
| Email (SMTP) | ZeptoMail (Zoho, India), Brevo or Resend — free/low tiers cover a pharmacy | Supabase's built-in mailer is for testing (2 emails/hour, team only) |
| Domain | Any registrar, ~₹1,000/yr | `app.<brand>.in` looks trustworthy to staff and customers |
| Optional | Supabase PITR add-on (~$100) | Restore to the minute instead of the day — consider before 10+ stores |

## 1. Supabase project (you, ~20 min)
1. supabase.com → New organization (your company) → upgrade to **Pro**.
2. New project: name `medstar-prod`, region **South Asia (Mumbai)**, generate a strong DB password → save it in your password manager.
3. Settings → **Data API**: note the Project URL. Settings → **API keys**: note the **Publishable** key (`sb_publishable_…`). Never copy the *Secret* key into the app.
4. Account → **Access tokens** → create `github-deploy` (for GitHub Actions) — keep it in the password manager.
5. Authentication → Sign In / Providers → Email: keep **Confirm email ON**; turn on **Leaked password protection**.
6. Account → enable **MFA** on every Supabase dashboard login.

## 2. Email sender (you, ~20 min)
1. Create an account with ZeptoMail / Brevo / Resend, add your domain and the DNS records they show (SPF, DKIM) — wait until "verified".
2. Note SMTP host, port, username and password/API key. Turn **link tracking off** (it breaks sign-in links).

## 3. GitHub (you, ~10 min)
First copy the two workflow files into place (`copy scripts\deploy\github-workflows\*.yml .github\workflows\`), commit and push. Then repository → Settings:
1. **Environments → New environment `production`** → Required reviewers: you. (Every database change and backup waits for your click.)
2. In `production` add **secrets**: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL` (Supabase → Connect → *Session pooler* URI with the password filled in), `BACKUP_PASSPHRASE` (a long phrase only you know — without it backups can't be opened).
3. **Variables**: `SUPABASE_PROJECT_REF` (the id in the project URL).
4. Branch protection on `main`: require the **CI** check to pass.

## 4. First database deploy (GitHub Actions)
Actions → **Deploy database (Supabase production)** → Run workflow → approve. It links the project and runs `supabase db push`
(all migrations; **seed.sql is never applied to production**). Check Supabase → Database → Migrations shows 10 migrations, and Storage shows the `documents` and `prescriptions` buckets.

## 5. Auth settings (you run one script, ~5 min)
From the repo folder in PowerShell:
```powershell
.\scripts\deploy\configure-supabase-auth.ps1 -ProjectRef <ref> -SiteUrl https://app.<brand>.in `
  -SmtpHost <smtp host> -SmtpPort 587 -SmtpUser <smtp user> -SenderEmail no-reply@<brand>.in -SenderName "<Pharmacy name>"
```
It asks for the access token and SMTP password (not stored) and sets site URL, redirect URLs, 10-character minimum password and SMTP.

## 6. Vercel (you, ~20 min)
1. vercel.com → Pro team → **Add New → Project → import the GitHub repo**.
2. **Root Directory: `apps/web`** (framework Next.js is detected; `apps/web/vercel.json` pins functions to Mumbai `bom1`).
3. Environment variables (Production and Preview):
   `NEXT_PUBLIC_SUPABASE_URL` = project URL · `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = publishable key.
   The build **fails on purpose** if these are missing, so production can never show demo data.
4. Deploy. Then Settings → Domains → add `app.<brand>.in` and the DNS record Vercel shows.
5. Settings → Deployment Protection: keep **Preview** deployments protected (Vercel login) so test builds aren't public.

## 7. Verify (~10 min)
```powershell
.\scripts\deploy\smoke-test.ps1 -Url https://app.<brand>.in
```
Expect `Health: ok=True`, login page 200, security headers present. Then: sign up the owner account with your email → confirm mail arrives →
onboarding creates the organisation and branch 1 → Settings adds branch 2 (same GSTIN if registered as an additional place of business).
Add an uptime monitor (UptimeRobot / Better Stack, free) on `https://app.<brand>.in/api/health` every 5 minutes with alerts to your phone.

## 8. Counters at each branch
Install Chrome, open the app, sign in once, then `scripts\windows\create-pos-shortcut.ps1 -Setup` and the shortcut (silent printing, docs/10).
Open the POS once online so the offline copy is cached.

## Every release after this
1. Work on a branch → pull request → CI must pass (unit + database tests + build).
2. Merge to `main` → Vercel deploys the app; **Deploy database** waits for your approval if migrations changed. Approve **outside shop rush hours**
   (migrations are additive; an approved run takes under a minute).
3. Run the smoke test. If something is wrong: Vercel → Deployments → previous one → **Instant rollback** (app); database changes are rolled
   forward with a fix migration — never edit an applied migration.

## Backups and restore
- Supabase daily backups (7 days): Database → Backups → Restore (whole project, minutes of downtime).
- Nightly encrypted dump (30 days) in GitHub Actions artifacts: download → `gpg -d file.dump.gpg > medstar.dump` → `pg_restore --no-owner -d <db url> medstar.dump` into a **new** project first, check, then switch.
- Practice a restore once before go-live and note the time it took (target: under 2 hours).

## Security & compliance notes
- Data in India (Mumbai) for both database and app functions — DPDP-friendly; patients' data never leaves the region.
- Only the publishable key is in the app; every row is protected by row-level security (tested per role in CI).
- Audit trail (who did what) lives in the database permanently (`audit_log`). Platform logs (Supabase, Vercel) are kept only for days on these plans; for CERT-In's 180-day log retention add a log drain (Vercel Log Drains / Supabase log drains) to a log store before onboarding outside customers.
- People: owner and one backup admin only on Supabase / Vercel / GitHub, all with MFA. Staff never get dashboard access — they use the app with their own login and role.
