# Team Charter — MedStar Pharma Suite

| Team | Agent(s) | Owns | Signs off |
|---|---|---|---|
| Leadership | `cto` | Architecture, ADRs, tech risk | Irreversible technical decisions |
| Product | `product-manager`, `business-analyst` | Use cases, priorities, roadmap, process flows, report specs | Story "Ready" |
| Domain SMEs | `pharmacy-sme`, `accounting-sme` | Drug-law & GST/accounting correctness, missing-feature review | Regulated stories |
| UI/UX | `ux-manager`, `ui-designer` | IA, journeys, wireframes, design system, usability tests | Screen "Ready" |
| Engineering | `engineering-manager`, `frontend-engineer`, `backend-engineer`, `database-engineer` | Delivery plan, code, schema, RLS | PR merge |
| Platform | `devops-engineer` | CI/CD, environments, backups, monitoring | Release deploy |
| Quality | `qa-lead` | Test strategy, test packs, UAT | Release |
| Security & privacy | `security-privacy` | Threat model, DPDP compliance, audit | Security gate |
| Customer success | `customer-success` | Onboarding, migration, training, pilot feedback | Pilot go-live |

**Teams added beyond the original brief:** Business Analyst, a separate Accounting/GST SME (CA), Security & Privacy (DPDP), DevOps/SRE and Customer Success/Onboarding. A pharmacy product can't ship safely without them.

## Ways of working
1. PM writes/updates the UC → BA details it → SMEs validate → UX designs → EM plans → engineers build → QA verifies → SME re-checks regulated flows → release.
2. Every artifact references UC IDs; every regulated rule references the SME verdict row.
3. Disagreements: CTO decides on technology, PM on scope, SMEs have a veto on compliance.

## How to use the agents (Claude Code)
```
> Use the pharmacy-sme agent to review UC-OMS-04 for Maharashtra.
> Ask the accounting-sme to validate the credit note journal in post_return.
> Have the qa-lead write Playwright tests for UC-POS-12 offline billing.
```
