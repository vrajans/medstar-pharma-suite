
-- ───────────────────────── product import (dry run, all-or-nothing) ─────────────────────────
-- p_rows: [{name, manufacturer?, composition?, dosageForm?, category, hsn, schedule, rxRequired, habitForming, coldChain,
--           packLabel, baseUnitLabel, unitsPerPack, barcode?, reorderLevel, rack?, gstRateOverride?, listedOnline}]
-- Match order: barcode → (name, manufacturer, units per pack). Matches are updated, others created.
create or replace function import_products(p_org uuid, p_rows jsonb, p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; i int; v_by_code uuid; v_by_name uuid; v_target uuid; v_errors jsonb := '[]'; v_plan jsonb := '[]';
        v_created int := 0; v_updated int := 0; v_seen_codes text[] := '{}'; e jsonb; v_id uuid; v_warnings jsonb := '[]'; v_old_name text;
begin
  if not has_role(p_org, array['owner','admin','purchase']::member_role[]) then
    raise exception 'Only owners, admins and purchase staff can import products' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'Import at most 20,000 rows at a time'; end if;

  for r, i in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    if coalesce(trim(r->>'name'), '') = '' then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'name is required'); continue; end if;
    if coalesce(r->>'hsn', '') !~ '^[0-9]{4,8}$' then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'HSN must be 4–8 digits'); continue; end if;
    if coalesce(r->>'schedule', '') not in ('OTC','G','H','H1','X','C','C1','NDPS') then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'invalid schedule'); continue; end if;
    if coalesce((r->>'unitsPerPack')::int, 0) <= 0 then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'units per pack must be > 0'); continue; end if;
    if nullif(r->>'barcode', '') is not null then
      if r->>'barcode' = any(v_seen_codes) then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'barcode repeated in this file'); continue; end if;
      v_seen_codes := v_seen_codes || (r->>'barcode');
    end if;

    select product_id into v_by_code from product_barcodes where org_id = p_org and barcode = nullif(r->>'barcode', '');
    select id into v_by_name from products
      where org_id = p_org and lower(name) = lower(trim(r->>'name')) and coalesce(lower(manufacturer), '') = coalesce(lower(trim(r->>'manufacturer')), '')
        and units_per_pack = (r->>'unitsPerPack')::int
      limit 1;
    if v_by_code is not null and v_by_name is not null and v_by_code <> v_by_name then
      v_errors := v_errors || jsonb_build_object('row', i, 'message', 'barcode belongs to a different existing product'); continue;
    end if;
    v_target := coalesce(v_by_code, v_by_name);
    if v_by_code is not null and v_by_name is null then
      select name into v_old_name from products where id = v_by_code;
      v_warnings := v_warnings || jsonb_build_object('row', i, 'message', format('will rename "%s" to "%s" (matched by barcode)', v_old_name, trim(r->>'name')));
    end if;
    if v_target is null then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
    v_plan := v_plan || jsonb_build_object('row', r, 'target', v_target);
  end loop;

  if p_dry_run or jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('dryRun', true, 'created', v_created, 'updated', v_updated, 'errors', v_errors, 'warnings', v_warnings);
  end if;

  for e in select * from jsonb_array_elements(v_plan) loop
    r := e->'row';
    if e->>'target' is null then
      insert into products (org_id, name, manufacturer, composition, dosage_form, category, hsn, schedule, rx_required, habit_forming,
        cold_chain, pack_label, base_unit_label, units_per_pack, reorder_level, rack, gst_rate_override, listed_online)
      values (p_org, trim(r->>'name'), nullif(trim(r->>'manufacturer'), ''), nullif(trim(r->>'composition'), ''), nullif(r->>'dosageForm', ''),
        coalesce(nullif(r->>'category', ''), 'Rx'), r->>'hsn', (r->>'schedule')::drug_schedule, coalesce((r->>'rxRequired')::boolean, false),
        coalesce((r->>'habitForming')::boolean, false), coalesce((r->>'coldChain')::boolean, false), coalesce(nullif(r->>'packLabel', ''), 'Strip'),
        coalesce(nullif(r->>'baseUnitLabel', ''), 'Tab'), (r->>'unitsPerPack')::int, coalesce((r->>'reorderLevel')::int, 0), nullif(r->>'rack', ''),
        (r->>'gstRateOverride')::numeric, coalesce((r->>'listedOnline')::boolean, false))
      returning id into v_id;
    else
      v_id := (e->>'target')::uuid;
      update products set name = trim(r->>'name'), manufacturer = nullif(trim(r->>'manufacturer'), ''), composition = nullif(trim(r->>'composition'), ''),
        dosage_form = nullif(r->>'dosageForm', ''), category = coalesce(nullif(r->>'category', ''), category), hsn = r->>'hsn',
        schedule = (r->>'schedule')::drug_schedule, rx_required = coalesce((r->>'rxRequired')::boolean, false),
        habit_forming = coalesce((r->>'habitForming')::boolean, false), cold_chain = coalesce((r->>'coldChain')::boolean, false),
        pack_label = coalesce(nullif(r->>'packLabel', ''), pack_label), base_unit_label = coalesce(nullif(r->>'baseUnitLabel', ''), base_unit_label),
        units_per_pack = (r->>'unitsPerPack')::int, reorder_level = coalesce((r->>'reorderLevel')::int, 0), rack = nullif(r->>'rack', ''),
        gst_rate_override = (r->>'gstRateOverride')::numeric, listed_online = coalesce((r->>'listedOnline')::boolean, listed_online),
        is_active = true, updated_at = now()
      where id = v_id;
    end if;
    if nullif(r->>'barcode', '') is not null then
      insert into product_barcodes (org_id, product_id, barcode) values (p_org, v_id, r->>'barcode') on conflict do nothing;
    end if;
  end loop;
  insert into audit_log (org_id, user_id, action, entity, details)
  values (p_org, auth.uid(), 'import_products', 'products', jsonb_build_object('created', v_created, 'updated', v_updated));
  return jsonb_build_object('dryRun', false, 'created', v_created, 'updated', v_updated, 'errors', '[]'::jsonb, 'warnings', v_warnings);
end $$;

-- ───────────────────────── opening stock (UC-INV-09) ─────────────────────────
create table opening_stock_imports (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  org_id uuid not null,
  store_id uuid not null references stores(id),
  as_of date not null,
  rows int not null,
  value_paise bigint not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table opening_stock_imports enable row level security;
create policy opening_stock_imports_read on opening_stock_imports for select to authenticated using (is_member(org_id));
revoke insert, update, delete on opening_stock_imports from authenticated, anon;

-- p: { idempotencyKey, storeId, asOf, dryRun, rows:[{productId, batchNo, expiry, packMrpPaise, packCostPaise, qtyBase}] }
-- Journal: Dr Inventory (at cost) / Cr Opening balances.
create or replace function post_opening_stock(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_store stores%rowtype; r jsonb; i int; pr products%rowtype; v_errors jsonb := '[]'; v_warn jsonb := '[]';
        v_value bigint := 0; v_cost numeric; v_batch uuid; v_id uuid := gen_random_uuid(); v_je uuid; v_existing uuid;
        v_as_of date := coalesce((p->>'asOf')::date, current_date); v_dry boolean := coalesce((p->>'dryRun')::boolean, true); v_n int := 0;
begin
  select id into v_existing from opening_stock_imports where idempotency_key = (p->>'idempotencyKey')::uuid;
  if found then return jsonb_build_object('importId', v_existing, 'duplicate', true); end if;
  select * into v_store from stores where id = (p->>'storeId')::uuid;
  if not found or not has_store_access(v_store.id) or not has_role(v_store.org_id, array['owner','admin','purchase']::member_role[]) then
    raise exception 'Only owners, admins and purchase staff can load opening stock' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from period_locks where org_id = v_store.org_id and locked_until >= v_as_of) then raise exception 'Period locked'; end if;

  for r, i in select value, ordinality from jsonb_array_elements(p->'rows') with ordinality loop
    select * into pr from products where id = (r->>'productId')::uuid and org_id = v_store.org_id;
    if not found then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'unknown product'); continue; end if;
    if coalesce(trim(r->>'batchNo'), '') = '' then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'batch is required'); continue; end if;
    if coalesce((r->>'qtyBase')::int, 0) <= 0 then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'quantity must be > 0'); continue; end if;
    if coalesce((r->>'packMrpPaise')::bigint, 0) <= 0 then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'MRP must be > 0'); continue; end if;
    if (r->>'packCostPaise')::bigint > (r->>'packMrpPaise')::bigint then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'cost above MRP'); continue; end if;
    if (r->>'expiry')::date < v_as_of then
      v_warn := v_warn || jsonb_build_object('row', i, 'message', pr.name || ' batch ' || (r->>'batchNo') || ' is already expired — it will be loaded but cannot be sold');
    end if;
    v_n := v_n + 1;
    v_value := v_value + round((r->>'packCostPaise')::numeric * (r->>'qtyBase')::int / pr.units_per_pack);
  end loop;

  if v_dry or jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('dryRun', true, 'rows', v_n, 'valuePaise', v_value, 'errors', v_errors, 'warnings', v_warn);
  end if;

  insert into opening_stock_imports (id, idempotency_key, org_id, store_id, as_of, rows, value_paise, created_by)
  values (v_id, (p->>'idempotencyKey')::uuid, v_store.org_id, v_store.id, v_as_of, v_n, v_value, auth.uid());

  for r in select * from jsonb_array_elements(p->'rows') loop
    select * into pr from products where id = (r->>'productId')::uuid;
    v_cost := (r->>'packCostPaise')::numeric / pr.units_per_pack;
    insert into batches (org_id, store_id, product_id, batch_no, expiry, pack_mrp_paise, cost_per_unit_paise, qty_on_hand, received_at)
    values (v_store.org_id, v_store.id, pr.id, upper(trim(r->>'batchNo')), (r->>'expiry')::date, (r->>'packMrpPaise')::bigint, v_cost, (r->>'qtyBase')::int, v_as_of)
    on conflict (store_id, product_id, batch_no, pack_mrp_paise) do update
      set cost_per_unit_paise = (batches.cost_per_unit_paise * batches.qty_on_hand + excluded.cost_per_unit_paise * excluded.qty_on_hand)
                                / nullif(batches.qty_on_hand + excluded.qty_on_hand, 0),
          qty_on_hand = batches.qty_on_hand + excluded.qty_on_hand
    returning id into v_batch;
    insert into stock_ledger (org_id, store_id, batch_id, product_id, doc_type, doc_id, qty_delta, created_by)
    values (v_store.org_id, v_store.id, v_batch, pr.id, 'opening', v_id, (r->>'qtyBase')::int, auth.uid());
  end loop;

  if v_value > 0 then
    insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
    values (v_store.org_id, v_store.id, v_as_of, 'opening_stock', v_id, 'Opening stock ' || v_store.code, auth.uid()) returning id into v_je;
    insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, v_store.org_id, acct(v_store.org_id, 'INVENTORY'), v_value);
    insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, v_store.org_id, acct(v_store.org_id, 'OPENING_BAL'), v_value);
  end if;
  return jsonb_build_object('dryRun', false, 'importId', v_id, 'rows', v_n, 'valuePaise', v_value, 'errors', '[]'::jsonb, 'warnings', v_warn);
end $$;

-- ───────────────────────── receipts & payments ─────────────────────────
create or replace function _pay_account(p_org uuid, p_mode text) returns uuid language sql stable as $$
  select acct(p_org, case p_mode when 'cash' then 'CASH' when 'upi' then 'UPI_CLR' when 'card' then 'CARD_CLR' when 'bank' then 'BANK' else null end)
$$;

-- p: { idempotencyKey, storeId, customerId, amountPaise, mode: cash|upi|card|bank, reference?, date? }
create or replace function post_customer_receipt(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_store stores%rowtype; c customers%rowtype; v_amt bigint := (p->>'amountPaise')::bigint; v_bal bigint; v_je uuid; v_acct uuid;
        v_date date := coalesce((p->>'date')::date, (now() at time zone 'Asia/Kolkata')::date);
begin
  if exists (select 1 from journal_entries where source_type = 'receipt' and source_id = (p->>'idempotencyKey')::uuid) then
    return jsonb_build_object('duplicate', true);
  end if;
  select * into v_store from stores where id = (p->>'storeId')::uuid;
  if not found or not has_store_access(v_store.id) or not has_role(v_store.org_id, array['owner','admin','pharmacist','billing','accountant']::member_role[]) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into c from customers where id = (p->>'customerId')::uuid and org_id = v_store.org_id;
  if not found then raise exception 'Unknown customer'; end if;
  v_acct := _pay_account(v_store.org_id, p->>'mode');
  if v_acct is null then raise exception 'Payment mode must be cash, upi, card or bank'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Amount must be positive' using errcode = 'check_violation'; end if;
  v_bal := party_balance(v_store.org_id, 'DEBTORS', c.id);
  if v_amt > v_bal then raise exception 'Amount (%) is more than the outstanding balance (%)', v_amt, v_bal using errcode = 'check_violation'; end if;
  insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
  values (v_store.org_id, v_store.id, v_date, 'receipt', (p->>'idempotencyKey')::uuid,
          'Receipt from ' || coalesce(c.name, c.phone) || coalesce(' · ' || nullif(p->>'reference', ''), ''), auth.uid()) returning id into v_je;
  insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, v_store.org_id, v_acct, v_amt);
  insert into journal_lines (entry_id, org_id, account_id, credit_paise, party_id) values (v_je, v_store.org_id, acct(v_store.org_id, 'DEBTORS'), v_amt, c.id);
  return jsonb_build_object('entryId', v_je, 'balancePaise', v_bal - v_amt, 'duplicate', false);
end $$;

-- p: { idempotencyKey, storeId, distributorId, amountPaise, mode: cash|upi|bank, reference?, date? }
create or replace function post_supplier_payment(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_store stores%rowtype; d distributors%rowtype; v_amt bigint := (p->>'amountPaise')::bigint; v_due bigint; v_je uuid; v_acct uuid;
        v_date date := coalesce((p->>'date')::date, (now() at time zone 'Asia/Kolkata')::date);
begin
  if exists (select 1 from journal_entries where source_type = 'supplier_payment' and source_id = (p->>'idempotencyKey')::uuid) then
    return jsonb_build_object('duplicate', true);
  end if;
  select * into v_store from stores where id = (p->>'storeId')::uuid;
  if not found or not has_store_access(v_store.id) or not has_role(v_store.org_id, array['owner','admin','accountant','purchase']::member_role[]) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into d from distributors where id = (p->>'distributorId')::uuid and org_id = v_store.org_id;
  if not found then raise exception 'Unknown distributor'; end if;
  v_acct := _pay_account(v_store.org_id, p->>'mode');
  if v_acct is null or p->>'mode' = 'card' then raise exception 'Payment mode must be cash, upi or bank'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Amount must be positive' using errcode = 'check_violation'; end if;
  v_due := -party_balance(v_store.org_id, 'CREDITORS', d.id);
  if v_amt > v_due then raise exception 'Amount (%) is more than what is owed to % (%)', v_amt, d.name, v_due using errcode = 'check_violation'; end if;
  insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
  values (v_store.org_id, v_store.id, v_date, 'supplier_payment', (p->>'idempotencyKey')::uuid,
          'Payment to ' || d.name || coalesce(' · ' || nullif(p->>'reference', ''), ''), auth.uid()) returning id into v_je;
  insert into journal_lines (entry_id, org_id, account_id, debit_paise, party_id) values (v_je, v_store.org_id, acct(v_store.org_id, 'CREDITORS'), v_amt, d.id);
  insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, v_store.org_id, v_acct, v_amt);
  return jsonb_build_object('entryId', v_je, 'duePaise', v_due - v_amt, 'duplicate', false);
end $$;

-- ───────────────────────── balances ─────────────────────────
create or replace view v_customer_balances with (security_invoker = true) as
  select c.org_id, c.id as customer_id, c.name, c.phone, c.credit_limit_paise, c.is_active,
         coalesce(b.balance, 0)::bigint as outstanding_paise, b.last_entry
  from customers c
  left join lateral (
    select sum(jl.debit_paise - jl.credit_paise) as balance, max(je.entry_date) as last_entry
    from journal_lines jl join accounts a on a.id = jl.account_id join journal_entries je on je.id = jl.entry_id
    where a.org_id = c.org_id and a.code = 'DEBTORS' and jl.party_id = c.id
  ) b on true;

create or replace view v_supplier_balances with (security_invoker = true) as
  select d.org_id, d.id as distributor_id, d.name, d.gstin, d.drug_licence_no, d.drug_licence_valid_to, d.credit_days, d.is_active,
         coalesce(b.due, 0)::bigint as due_paise,
         (select min(pi.due_date) from purchase_invoices pi where pi.distributor_id = d.id) as oldest_due_date,
         (select max(pi.supplier_invoice_date) from purchase_invoices pi where pi.distributor_id = d.id) as last_purchase
  from distributors d
  left join lateral (
    select sum(jl.credit_paise - jl.debit_paise) as due
    from journal_lines jl join accounts a on a.id = jl.account_id
    where a.org_id = d.org_id and a.code = 'CREDITORS' and jl.party_id = d.id
  ) b on true;

grant execute on function import_products(uuid, jsonb, boolean), post_opening_stock(jsonb), post_customer_receipt(jsonb),
  post_supplier_payment(jsonb), product_gst_rate(uuid, date) to authenticated;
grant select on v_customer_balances, v_supplier_balances to authenticated;
