-- UAT hardening tests: role limits on master data, hidden PIN hashes, anon lock-out, product audit trail,
-- rupee error messages, combined GST return for branches under one GSTIN, opening party balances.
-- Runs after 10–60 (billing user 8888…, accountant 7777… exist from test 60).
\set ON_ERROR_STOP on
set client_min_messages = warning;
set timezone = 'Asia/Kolkata';

-- second branch under the SAME GSTIN as BLR1 (additional place of business), with stock
insert into stores (id, org_id, code, name, gstin, state_code, address, pincode) values
 ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001', 'BLR2', 'MedStar Koramangala', '29AAAFM1234C1Z5', '29', 'Koramangala, Bengaluru', '560034');
insert into batches (org_id, store_id, product_id, batch_no, expiry, pack_mrp_paise, cost_per_unit_paise, qty_on_hand) values
 ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000b001', 'K2201', current_date + 400, 3100, 140, 150);

set role authenticated;

-- billing staff: can't change store rules, add pharmacists, put a pharmacist on duty, add licences, or read PIN hashes
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
do $$ declare n int; begin
  update stores set pharmacist_presence = 'soft', gst_scheme = 'composition' where id = '00000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  assert n = 0, 'billing changed store settings';
  begin
    insert into pharmacists (org_id, name, council, reg_no, pin_hash) values ('00000000-0000-0000-0000-000000000001', 'Fake', 'X', 'FAKE-1', 'x');
    raise exception 'expected pharmacist insert denied';
  exception when insufficient_privilege then null; end;
  begin
    insert into pharmacist_shifts (org_id, store_id, pharmacist_id) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1');
    raise exception 'expected shift insert denied';
  exception when insufficient_privilege then null; end;
  begin
    insert into licences (org_id, store_id, kind, number) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Form 20', 'X');
    raise exception 'expected licence insert denied';
  exception when insufficient_privilege then null; end;
  begin
    perform pin_hash from pharmacists limit 1;
    raise exception 'expected pin_hash hidden';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from pharmacists where name = 'Dr. A. Rao') = 1, 'pharmacist names still readable';
  begin perform seed_chart_of_accounts('00000000-0000-0000-0000-000000000002'); raise exception 'expected seed denied';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert (select pharmacist_presence from stores where id = '00000000-0000-0000-0000-0000000000a1') = 'hard', 'presence rule changed';
end $$;

-- anon can't call posting functions at all
set role anon;
do $$ begin
  perform post_sale('{}'::jsonb); raise exception 'expected anon denied';
exception when insufficient_privilege then null; end $$;
reset role;

-- owner: regulated product change is audit-logged; rupee error message
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  update products set schedule = 'H' where id = '00000000-0000-0000-0000-00000000b001';
  update products set schedule = 'OTC' where id = '00000000-0000-0000-0000-00000000b001';
  assert (select count(*) from audit_log where action = 'product_regulated_change' and entity_id = '00000000-0000-0000-0000-00000000b001') = 2, 'schedule change not audited';
  begin
    perform post_customer_receipt(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', '00000000-0000-0000-0000-0000000000a1',
      'customerId', '00000000-0000-0000-0000-0000000000c1', 'amountPaise', 99999999, 'mode', 'cash'));
    raise exception 'expected overpayment refusal';
  exception when check_violation then
    assert sqlerrm like 'Amount (₹9,99,999.99) is more than the outstanding balance (₹%', 'message: ' || sqlerrm;
  end;
  assert inr(-150050) = '-₹1,500.50' and inr(0) = '₹0.00', 'inr()';
end $$;

-- one GST return for both branches under one GSTIN
do $$ declare g jsonb; before jsonb; r jsonb; begin
  before := gstr1('00000000-0000-0000-0000-0000000000a1', '2000-01-01', current_date);
  r := post_sale(jsonb_build_object('billUuid', 'bbbbbbbb-0000-0000-0000-000000000070', 'storeId', '00000000-0000-0000-0000-0000000000a3', 'deviceCode', 'K1',
       'billedAt', now(), 'lines', jsonb_build_array(jsonb_build_object('productId', '00000000-0000-0000-0000-00000000b001', 'qtyBase', 15)),
       'payments', jsonb_build_array(jsonb_build_object('mode', 'cash', 'amountPaise', 3100))));
  g := gstr1('00000000-0000-0000-0000-0000000000a1', '2000-01-01', current_date);
  assert g->'stores' = '["BLR1", "BLR2"]'::jsonb, 'stores: ' || (g->'stores')::text;
  assert (g->'totals'->>'invoices')::int = (before->'totals'->>'invoices')::int + 1, 'branch bill not in the combined return';
  assert exists (select 1 from jsonb_array_elements(g->'docs') x where x->>'first_no' like 'BLR2/%'), 'branch series missing from documents issued';
  assert gstr1('00000000-0000-0000-0000-0000000000a3', '2000-01-01', current_date)->'totals' = g->'totals', 'either branch gives the same return';
  -- a store with its own GSTIN is still separate
  assert (composition_summary('00000000-0000-0000-0000-0000000000a2', '2000-01-01', current_date)->>'turnover')::bigint = 0, 'CMP1 picked up other GSTIN';
end $$;

-- UC: opening balances at go-live (accountant)
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
do $$ declare r jsonb; k uuid := gen_random_uuid(); v_due0 bigint; begin
  select due_paise into v_due0 from v_supplier_balances where distributor_id = '00000000-0000-0000-0000-0000000000d1';
  r := post_opening_balances(jsonb_build_object('idempotencyKey', k, 'storeId', '00000000-0000-0000-0000-0000000000a1', 'asOf', current_date, 'dryRun', true,
    'rows', jsonb_build_array(
      jsonb_build_object('type', 'customer', 'phone', '98400 11111', 'name', 'Lakshmi', 'amountPaise', 125000),
      jsonb_build_object('type', 'supplier', 'name', 'sri balaji pharma', 'amountPaise', 4500000),
      jsonb_build_object('type', 'supplier', 'name', 'Unknown Agencies', 'amountPaise', 100),
      jsonb_build_object('type', 'customer', 'phone', '12', 'amountPaise', 100))));
  assert jsonb_array_length(r->'errors') = 2, 'dry-run errors: ' || r::text;
  assert not exists (select 1 from customers where phone = '9840011111'), 'dry run wrote data';
  r := post_opening_balances(jsonb_build_object('idempotencyKey', k, 'storeId', '00000000-0000-0000-0000-0000000000a1', 'asOf', current_date, 'dryRun', false,
    'rows', jsonb_build_array(
      jsonb_build_object('type', 'customer', 'phone', '98400 11111', 'name', 'Lakshmi', 'amountPaise', 125000),
      jsonb_build_object('type', 'supplier', 'name', 'sri balaji pharma', 'amountPaise', 4500000))));
  assert (r->>'newCustomers')::int = 1 and (r->>'receivablePaise')::bigint = 125000, 'commit: ' || r::text;
  assert (select outstanding_paise from v_customer_balances c join customers x on x.id = c.customer_id where x.phone = '9840011111') = 125000, 'customer opening';
  assert (select due_paise from v_supplier_balances where distributor_id = '00000000-0000-0000-0000-0000000000d1') = v_due0 + 4500000, 'supplier opening';
  assert (post_opening_balances(jsonb_build_object('idempotencyKey', k, 'storeId', '00000000-0000-0000-0000-0000000000a1', 'rows', '[]'::jsonb))->>'duplicate')::boolean, 'idempotent';
  r := post_opening_balances(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', '00000000-0000-0000-0000-0000000000a1', 'dryRun', true,
    'rows', jsonb_build_array(jsonb_build_object('type', 'customer', 'phone', '9840011111', 'amountPaise', 500))));
  assert (r->'errors'->0->>'message') like 'opening balance already loaded%', 'second load: ' || r::text;
  assert (select sum((x->>'closing')::bigint) from jsonb_array_elements(trial_balance('00000000-0000-0000-0000-000000000001', fy_start(current_date), current_date)) x) = 0, 'TB after openings';
end $$;
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
do $$ begin
  perform post_opening_balances(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', '00000000-0000-0000-0000-0000000000a1', 'rows', '[{"type":"customer"}]'::jsonb));
  raise exception 'expected billing denied';
exception when insufficient_privilege then null; end $$;
reset role;

select 'UAT HARDENING DATABASE TESTS PASSED' as result;
