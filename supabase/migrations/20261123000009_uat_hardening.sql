-- UAT hardening (end-to-end QA round before the Chennai pilot).
-- 1. Security: master-data writes limited to the right roles, pharmacist PIN hashes hidden, functions not callable by anon,
--    audit trail for regulated product fields.                       (security-privacy findings SEC-01..07)
-- 2. GST returns per GSTIN: branches registered under one GSTIN file one combined return.  (accounting-sme ACC-01)
-- 3. Error messages show rupees, not paise.                             (ux UX-03)
-- 4. Opening balances for customers (udhaar) and suppliers at go-live.   (product PM-02)
-- Existing functions are patched in place from their live definition with asserted text replacements, so this migration
-- fails loudly instead of silently if a definition is not what we expect.

-- ───────────────────────── helpers ─────────────────────────
create or replace function inr(p_paise bigint) returns text language sql immutable as $$
  select case when p_paise < 0 then '-₹' else '₹' end || to_char(abs(p_paise) / 100.0, 'FM99,99,99,99,990.00')
$$;

create or replace function _patch_function(p_fn regprocedure, p_from text, p_to text, p_regex boolean default false, p_expect int default 1)
returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_fn); n int;
begin
  if p_regex then
    n := (select count(*) from regexp_matches(d, p_from, 'g'));
    d := regexp_replace(d, p_from, p_to, 'g');
  else
    n := (length(d) - length(replace(d, p_from, ''))) / greatest(length(p_from), 1);
    d := replace(d, p_from, p_to);
  end if;
  if n <> p_expect then raise exception 'patch of % expected % match(es) of [%], found %', p_fn, p_expect, p_from, n; end if;
  execute d;
end $$;

-- ───────────────────────── 1. security ─────────────────────────
-- SEC-01 store settings (GST scheme, pharmacist-presence rule, online flag) — owner/admin only; new stores via add_store()
drop policy if exists stores_ins on stores;
drop policy if exists stores_upd on stores;
create policy stores_upd on stores for update to authenticated using (has_role(org_id, array['owner','admin']::member_role[]))
  with check (has_role(org_id, array['owner','admin']::member_role[]));

-- SEC-02 pharmacists only through add_pharmacist() / set_pharmacist_pin(); SEC-03 PIN hashes are never readable by the app
-- (a 4–6 digit PIN hash can be brute-forced offline in minutes, bypassing the 5-attempt lockout)
drop policy if exists pharmacists_ins on pharmacists;
drop policy if exists pharmacists_upd on pharmacists;
revoke insert, update, delete on pharmacists from authenticated, anon;
revoke select on pharmacists from authenticated, anon;
grant select (id, org_id, user_id, name, council, reg_no, reg_valid_to) on pharmacists to authenticated;

-- SEC-04 "pharmacist on duty" only through start/end_pharmacist_shift() (PIN-checked)
drop policy if exists pharmacist_shifts_ins on pharmacist_shifts;
drop policy if exists pharmacist_shifts_upd on pharmacist_shifts;
revoke insert, update, delete on pharmacist_shifts from authenticated, anon;

-- SEC-05 drug licences — owner/admin
drop policy if exists licences_ins on licences;
drop policy if exists licences_upd on licences;
create policy licences_ins on licences for insert to authenticated with check (has_role(org_id, array['owner','admin']::member_role[]));
create policy licences_upd on licences for update to authenticated using (has_role(org_id, array['owner','admin']::member_role[]));

-- SEC-06 prescriptions can be corrected only by pharmacists / owner / admin
drop policy if exists prescriptions_upd on prescriptions;
create policy prescriptions_upd on prescriptions for update to authenticated using (has_role(org_id, array['owner','admin','pharmacist']::member_role[]));

-- SEC-07 every change to a regulated product field is audit-logged (schedule, Rx flag, habit-forming, HSN, GST override, block)
create or replace function audit_product_change() returns trigger language plpgsql security definer set search_path = public as $$
declare ch jsonb := '{}';
begin
  if new.schedule is distinct from old.schedule then ch := ch || jsonb_build_object('schedule', jsonb_build_array(old.schedule, new.schedule)); end if;
  if new.rx_required is distinct from old.rx_required then ch := ch || jsonb_build_object('rx_required', jsonb_build_array(old.rx_required, new.rx_required)); end if;
  if new.habit_forming is distinct from old.habit_forming then ch := ch || jsonb_build_object('habit_forming', jsonb_build_array(old.habit_forming, new.habit_forming)); end if;
  if new.hsn is distinct from old.hsn then ch := ch || jsonb_build_object('hsn', jsonb_build_array(old.hsn, new.hsn)); end if;
  if new.gst_rate_override is distinct from old.gst_rate_override then ch := ch || jsonb_build_object('gst_rate_override', jsonb_build_array(old.gst_rate_override, new.gst_rate_override)); end if;
  if new.blocked_reason is distinct from old.blocked_reason then ch := ch || jsonb_build_object('blocked_reason', jsonb_build_array(old.blocked_reason, new.blocked_reason)); end if;
  if ch <> '{}' then
    insert into audit_log (org_id, user_id, action, entity, entity_id, details) values (new.org_id, auth.uid(), 'product_regulated_change', 'products', new.id::text, ch || jsonb_build_object('name', new.name));
  end if;
  return new;
end $$;
drop trigger if exists products_audit on products;
create trigger products_audit after update on products for each row execute function audit_product_change();

-- SEC-08 nothing is callable without signing in; internal helpers are not callable at all
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' loop
    -- _gst_sales_lines is called by the security-invoker GST reports, so the signed-in user needs it
    if (f.proname like '\_%' and f.proname <> '_gst_sales_lines') or f.proname in ('seed_chart_of_accounts') then
      execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
      execute format('revoke execute on function %s from public, anon', f.sig);
    end if;
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- ───────────────────────── 2. GST per GSTIN (branches under one registration) ─────────────────────────
-- All stores of the organisation that share the store's GSTIN (or just the store when it has none).
create or replace function gst_stores(p_store uuid) returns setof uuid language sql stable as $$
  select s2.id from stores s join stores s2 on s2.org_id = s.org_id and (s2.id = s.id or (s.gstin is not null and s2.gstin = s.gstin))
  where s.id = p_store
$$;
grant execute on function gst_stores(uuid) to authenticated;
revoke execute on function gst_stores(uuid) from public, anon;

select _patch_function('_gst_sales_lines(uuid, date, date)'::regprocedure, '\m(b|r)\.store_id = p_store\M', '\1.store_id in (select gst_stores(p_store))', true, 2);
select _patch_function('gstr1(uuid, date, date)'::regprocedure, 'where store_id = p_store and', 'where store_id in (select gst_stores(p_store)) and', false, 2);
select _patch_function('gstr3b(uuid, date, date)'::regprocedure, '\m(je|pi)\.store_id = p_store\M', '\1.store_id in (select gst_stores(p_store))', true, 3);
select _patch_function('composition_summary(uuid, date, date, numeric)'::regprocedure, '\m(b|r|pi)\.store_id = p_store\M', '\1.store_id in (select gst_stores(p_store))', true, 3);
-- report which stores a return covers
select _patch_function('gstr1(uuid, date, date)'::regprocedure, '''gstin'', s.gstin, ''stateCode'', s.state_code,',
  '''gstin'', s.gstin, ''stateCode'', s.state_code, ''stores'', (select jsonb_agg(code order by code) from stores where id in (select gst_stores(p_store))),');

-- ───────────────────────── 3. rupees in error messages ─────────────────────────
select _patch_function('post_sale(jsonb)'::regprocedure, '''Payments (%) must equal bill total (%)'', v_paid, v_total', '''Payments (%) must equal bill total (%)'', inr(v_paid), inr(v_total)');
select _patch_function('post_sale(jsonb)'::regprocedure, 'v_outstanding, v_credit, v_cust.credit_limit_paise using', 'inr(v_outstanding), inr(v_credit), inr(v_cust.credit_limit_paise) using');
select _patch_function('post_customer_receipt(jsonb)'::regprocedure, 'v_amt, v_bal using', 'inr(v_amt), inr(v_bal) using');
select _patch_function('post_supplier_payment(jsonb)'::regprocedure, 'v_amt, d.name, v_due using', 'inr(v_amt), d.name, inr(v_due) using');
select _patch_function('update_account(uuid, text, boolean)'::regprocedure, ', v_bal using', ', inr(v_bal) using');
select _patch_function('post_voucher(jsonb)'::regprocedure, 't_dr, t_cr using', 'inr(t_dr), inr(t_cr) using');

-- ───────────────────────── 4. opening balances (go-live migration) ─────────────────────────
-- p: { idempotencyKey, storeId, asOf, dryRun, rows: [{ type: 'customer'|'supplier', phone?, name, amountPaise }] }
-- customer: amount they owe you (udhaar); supplier: amount you owe them. Customers are matched by mobile (created if new),
-- suppliers by name (must already exist — they need a drug licence number).
create or replace function post_opening_balances(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s stores%rowtype; v_as_of date := coalesce((p->>'asOf')::date, ist_today()); v_dry boolean := coalesce((p->>'dryRun')::boolean, true);
  r jsonb; i int := 0; errs jsonb := '[]'; warns jsonb := '[]'; v_amt bigint; v_party uuid; v_name text; v_phone text;
  v_je uuid; t_cust bigint := 0; t_sup bigint := 0; n_cust int := 0; n_sup int := 0; v_new int := 0;
begin
  if exists (select 1 from journal_entries where source_type = 'opening_balance' and source_id = (p->>'idempotencyKey')::uuid) then
    return jsonb_build_object('duplicate', true);
  end if;
  select * into s from stores where id = (p->>'storeId')::uuid;
  if not found or not has_store_access(s.id) or not has_role(s.org_id, array['owner','admin','accountant']::member_role[]) then
    raise exception 'Only the owner, admin or accountant can load opening balances' using errcode = 'insufficient_privilege';
  end if;
  if v_as_of > ist_today() then raise exception 'Opening date cannot be in the future' using errcode = 'check_violation'; end if;
  if jsonb_typeof(p->'rows') <> 'array' or jsonb_array_length(p->'rows') = 0 then raise exception 'No rows' using errcode = 'check_violation'; end if;

  if not v_dry then
    insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
    values (s.org_id, s.id, v_as_of, 'opening_balance', (p->>'idempotencyKey')::uuid, 'Opening party balances ' || s.code, auth.uid()) returning id into v_je;
  end if;

  for r in select * from jsonb_array_elements(p->'rows') loop
    i := i + 1;
    v_amt := (r->>'amountPaise')::bigint; v_name := nullif(trim(r->>'name'), ''); v_phone := regexp_replace(coalesce(r->>'phone', ''), '\D', '', 'g');
    if v_amt is null or v_amt = 0 then errs := errs || jsonb_build_object('row', i, 'message', 'amount is missing or zero'); continue; end if;
    if r->>'type' = 'customer' then
      if v_phone !~ '^[0-9]{10}$' then errs := errs || jsonb_build_object('row', i, 'message', 'customer mobile must be 10 digits'); continue; end if;
      select id into v_party from customers where org_id = s.org_id and phone = v_phone;
      if v_party is null then
        v_new := v_new + 1;
        if not v_dry then insert into customers (org_id, name, phone) values (s.org_id, v_name, v_phone) returning id into v_party; end if;
      end if;
      if v_party is not null and exists (select 1 from journal_lines jl join journal_entries je on je.id = jl.entry_id
                 where je.source_type = 'opening_balance' and jl.party_id = v_party) then
        errs := errs || jsonb_build_object('row', i, 'message', 'opening balance already loaded for ' || v_phone); continue;
      end if;
      if v_amt < 0 then warns := warns || jsonb_build_object('row', i, 'message', 'negative = advance received from the customer'); end if;
      n_cust := n_cust + 1; t_cust := t_cust + v_amt;
      if not v_dry then
        insert into journal_lines (entry_id, org_id, account_id, debit_paise, credit_paise, party_id)
        values (v_je, s.org_id, acct(s.org_id, 'DEBTORS'), greatest(v_amt, 0), greatest(-v_amt, 0), v_party);
      end if;
    elsif r->>'type' = 'supplier' then
      select id into v_party from distributors where org_id = s.org_id and lower(name) = lower(v_name);
      if v_party is null then errs := errs || jsonb_build_object('row', i, 'message', 'no supplier named "' || coalesce(v_name, '') || '" — add it under Purchase first'); continue; end if;
      if exists (select 1 from journal_lines jl join journal_entries je on je.id = jl.entry_id where je.source_type = 'opening_balance' and jl.party_id = v_party) then
        errs := errs || jsonb_build_object('row', i, 'message', 'opening balance already loaded for ' || v_name); continue;
      end if;
      n_sup := n_sup + 1; t_sup := t_sup + v_amt;
      if not v_dry then
        insert into journal_lines (entry_id, org_id, account_id, debit_paise, credit_paise, party_id)
        values (v_je, s.org_id, acct(s.org_id, 'CREDITORS'), greatest(-v_amt, 0), greatest(v_amt, 0), v_party);
      end if;
    else
      errs := errs || jsonb_build_object('row', i, 'message', 'type must be customer or supplier');
    end if;
    v_party := null;
  end loop;

  if jsonb_array_length(errs) > 0 then
    if not v_dry then raise exception 'Fix the rows with errors and try again (%)', errs::text using errcode = 'check_violation'; end if;
    return jsonb_build_object('dryRun', true, 'errors', errs, 'warnings', warns);
  end if;
  if not v_dry then
    -- balancing line to Opening balances (equity)
    if t_cust - t_sup <> 0 then
      insert into journal_lines (entry_id, org_id, account_id, debit_paise, credit_paise)
      values (v_je, s.org_id, acct(s.org_id, 'OPENING_BAL'), greatest(t_sup - t_cust, 0), greatest(t_cust - t_sup, 0));
    end if;
    insert into audit_log (org_id, user_id, action, entity, entity_id, details)
    values (s.org_id, auth.uid(), 'opening_balances', 'journal_entries', v_je::text, jsonb_build_object('customers', n_cust, 'suppliers', n_sup, 'receivable', t_cust, 'payable', t_sup));
  end if;
  return jsonb_build_object('dryRun', v_dry, 'errors', '[]'::jsonb, 'warnings', warns, 'customers', n_cust, 'suppliers', n_sup,
    'newCustomers', v_new, 'receivablePaise', t_cust, 'payablePaise', t_sup);
end $$;
grant execute on function post_opening_balances(jsonb), inr(bigint) to authenticated;
revoke execute on function post_opening_balances(jsonb) from public, anon;

drop function _patch_function(regprocedure, text, text, boolean, int);
