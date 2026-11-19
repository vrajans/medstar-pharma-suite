#!/usr/bin/env python3
"""Builds supabase/migrations/20261119000005_sprint2_masters_purchase_credit.sql.

Applied migrations are never edited. Functions that change in Sprint 2 are re-declared in the new migration,
generated from their previous definitions plus explicit, asserted substitutions, so the diff stays reviewable.
Run: python3 scripts/build-migration-0005.py
"""
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIG = ROOT / "supabase" / "migrations"
SRC = ROOT / "supabase" / "sql-src"


def extract(text: str, name: str) -> str:
    m = re.search(rf"create or replace function {name}\(.*?\nend \$\$;\n", text, re.S)
    assert m, f"function {name} not found"
    return m.group(0)


def sub(body: str, old: str, new: str, name: str) -> str:
    assert body.count(old) == 1, f"{name}: expected exactly one match for {old[:60]!r}, found {body.count(old)}"
    return body.replace(old, new)


m2 = (MIG / "20261117000002_posting_functions.sql").read_text()
m4 = (MIG / "20261118000004_sprint1_auth_onboarding_pos.sql").read_text()

# ── post_sale: product-level GST override, customer must belong to the org, credit limit ──
ps = extract(m2, "post_sale")
ps = sub(ps, "v_invoice text; v_je uuid; v_pay jsonb; v_cost bigint; v_line_count int := 0;",
         "v_invoice text; v_je uuid; v_pay jsonb; v_cost bigint; v_line_count int := 0;\n"
         "  v_credit bigint := 0; v_cust customers%rowtype; v_outstanding bigint;", "post_sale")
ps = sub(ps, "  -- pre-scan compliance\n",
         "  if nullif(p->>'customerId', '') is not null then\n"
         "    select * into v_cust from customers where id = (p->>'customerId')::uuid and org_id = v_store.org_id;\n"
         "    if not found then raise exception 'Unknown customer for this pharmacy' using errcode = 'check_violation'; end if;\n"
         "  end if;\n\n  -- pre-scan compliance\n", "post_sale")
ps = sub(ps, "v_rate := resolve_gst_rate(v_prod.hsn, v_date);", "v_rate := product_gst_rate(v_prod.id, v_date);", "post_sale")
ps = sub(ps,
         "  if exists (select 1 from jsonb_array_elements(p->'payments') x where x->>'mode' = 'credit') and p->>'customerId' is null then\n"
         "    raise exception 'Credit sale requires a customer';\n  end if;\n",
         "  -- credit (udhaar) sales: customer required, limit enforced (offline sales already happened → flagged)\n"
         "  select coalesce(sum((x->>'amountPaise')::bigint), 0) into v_credit from jsonb_array_elements(p->'payments') x where x->>'mode' = 'credit';\n"
         "  if v_credit > 0 then\n"
         "    if v_cust.id is null then raise exception 'Credit sale requires a customer' using errcode = 'check_violation'; end if;\n"
         "    if v_cust.credit_limit_paise <= 0 then raise exception 'Credit is not enabled for %', coalesce(v_cust.name, v_cust.phone) using errcode = 'check_violation'; end if;\n"
         "    v_outstanding := party_balance(v_store.org_id, 'DEBTORS', v_cust.id);\n"
         "    if v_outstanding + v_credit > v_cust.credit_limit_paise then\n"
         "      if not v_offline then\n"
         "        raise exception 'Credit limit exceeded: outstanding %, this bill %, limit %', v_outstanding, v_credit, v_cust.credit_limit_paise using errcode = 'check_violation';\n"
         "      end if;\n"
         "      update sales_bills set needs_review = true, review_note = coalesce(review_note || '; ', '') || 'Credit limit exceeded offline' where id = v_bill_id;\n"
         "    end if;\n"
         "  end if;\n", "post_sale")

# ── post_purchase: product-level GST, missing-rate guard, MRP/expiry warnings, due date ──
pp = extract(m2, "post_purchase")
pp = sub(pp, "v_rate := resolve_gst_rate(pr.hsn, v_date);",
         "v_rate := product_gst_rate(pr.id, v_date);\n"
         "    if v_rate is null then raise exception 'No GST rate configured for HSN % (%)', pr.hsn, pr.name; end if;\n"
         "    if exists (select 1 from batches b where b.store_id = v_store.id and b.product_id = pr.id\n"
         "               and b.pack_mrp_paise <> (v_line->>'packMrpPaise')::bigint and b.received_at > now() - interval '180 days') then\n"
         "      v_warn := v_warn || (pr.name || ': MRP differs from a recent batch — check the printed MRP');\n"
         "    end if;\n"
         "    if exists (select 1 from batches b where b.store_id = v_store.id and b.product_id = pr.id and b.batch_no = v_line->>'batchNo'\n"
         "               and b.expiry <> (v_line->>'expiry')::date) then\n"
         "      v_warn := v_warn || (pr.name || ' batch ' || (v_line->>'batchNo') || ' already exists with a different expiry');\n"
         "    end if;", "post_purchase")
pp = sub(pp, "    round_off_paise = v_round, total_paise = v_total\n  where id = v_id;",
         "    round_off_paise = v_round, total_paise = v_total, due_date = v_date + d.credit_days\n  where id = v_id;", "post_purchase")

# ── pos_catalogue: product-level GST, hide inactive products ──
pc = extract(m4, "pos_catalogue")
pc = sub(pc, "coalesce(resolve_gst_rate(p.hsn, current_date), -1)", "coalesce(p.gst_rate_override, resolve_gst_rate(p.hsn, current_date), -1)", "pos_catalogue")
pc = sub(pc, "    where p.org_id = (select org_id from stores where id = p_store)\n",
         "    where p.org_id = (select org_id from stores where id = p_store) and p.is_active\n", "pos_catalogue")

out = "\n".join([
    (SRC / "sprint2_head.sql").read_text(),
    "-- ───────────────────────── redefined: post_sale ─────────────────────────",
    ps,
    "-- ───────────────────────── redefined: post_purchase ─────────────────────────",
    pp,
    "-- ───────────────────────── redefined: pos_catalogue ─────────────────────────",
    pc,
    (SRC / "sprint2_tail.sql").read_text(),
])
target = MIG / "20261119000005_sprint2_masters_purchase_credit.sql"
target.write_text(out)
print(f"wrote {target.relative_to(ROOT)} ({len(out.splitlines())} lines)")
