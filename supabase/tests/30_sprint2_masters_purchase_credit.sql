-- Sprint 2 tests: product import, Nil-rate override, opening stock, GRN warnings, credit sales & receipts, supplier payments.
-- Runs after 10_ and 20_ (shares their data): demo org 1 owner = 1111…, customer Meena (c1, ₹91 outstanding), distributor d1 (₹763 due).
\set ON_ERROR_STOP on
set client_min_messages = warning;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- UC-PRD-03: import — dry run writes nothing; commit creates/updates; re-import matches by barcode
do $$ declare r jsonb; n0 int; rows jsonb := '[
  {"name":"Dolo 650 Tablet","manufacturer":"Micro Labs","composition":"Paracetamol 650mg","category":"OTC","hsn":"30049099","schedule":"OTC","unitsPerPack":15,"barcode":"8901234500011","reorderLevel":20,"rack":"A1","listedOnline":true},
  {"name":"Imatinib 400 Tablet","manufacturer":"Natco","composition":"Imatinib 400mg","category":"Rx","hsn":"30049099","schedule":"H","unitsPerPack":10,"barcode":"8901234599990","gstRateOverride":0},
  {"name":"Glucon-D 500g","manufacturer":"Zydus","category":"Wellness","hsn":"21069099","schedule":"OTC","unitsPerPack":1,"packLabel":"Pack","baseUnitLabel":"Pack","barcode":"8901234588881"}
]'::jsonb; begin
  select count(*) into n0 from products;
  r := import_products('00000000-0000-0000-0000-000000000001', rows, true);
  assert (r->>'created')::int = 2 and (r->>'updated')::int = 1 and jsonb_array_length(r->'errors') = 0, 'dry run: ' || r::text;
  assert (select count(*) from products) = n0, 'dry run wrote rows';
  r := import_products('00000000-0000-0000-0000-000000000001', rows, false);
  assert (r->>'created')::int = 2 and (r->>'updated')::int = 1, 'commit: ' || r::text;
  assert (select reorder_level from products where id = '00000000-0000-0000-0000-00000000b001') = 20, 'Dolo not updated';
  assert (select product_id from product_barcodes where barcode = '8901234500011') = '00000000-0000-0000-0000-00000000b001', 'barcode not attached';
  r := import_products('00000000-0000-0000-0000-000000000001', rows, false);
  assert (r->>'created')::int = 0 and (r->>'updated')::int = 3, 're-import should only update: ' || r::text;
end $$;

-- one bad row blocks the whole file
do $$ declare r jsonb; n0 int; begin
  select count(*) into n0 from products;
  r := import_products('00000000-0000-0000-0000-000000000001', '[
    {"name":"Good Product","hsn":"30049099","schedule":"OTC","unitsPerPack":1,"barcode":"1111111111"},
    {"name":"Bad HSN","hsn":"30","schedule":"OTC","unitsPerPack":1},
    {"name":"Dup","hsn":"30049099","schedule":"OTC","unitsPerPack":1,"barcode":"1111111111"},
    {"name":"Steals Dolo barcode","manufacturer":"Other","hsn":"30049099","schedule":"OTC","unitsPerPack":1,"barcode":"8901234500011"}
  ]'::jsonb, false);
  assert jsonb_array_length(r->'errors') = 2 and (r->>'dryRun')::boolean, 'expected 2 errors: ' || r::text;
  assert r->'warnings'->0->>'message' like 'will rename "Dolo 650 Tablet"%', 'rename warning: ' || r::text;
  assert (select count(*) from products) = n0, 'partial import written';
end $$;
-- a 3rd conflict (barcode owned by another product with a different name) is caught when names differ but barcode matches:
do $$ declare r jsonb; begin
  r := import_products('00000000-0000-0000-0000-000000000001',
    '[{"name":"Dolo 650 Tablet","manufacturer":"Micro Labs","hsn":"30049099","schedule":"OTC","unitsPerPack":15,"barcode":"8901234599990"}]'::jsonb, true);
  assert r->'errors'->0->>'message' = 'barcode belongs to a different existing product', r::text;
end $$;

-- UC-INV-09: opening stock — dry run, commit (Dr Inventory / Cr Opening balances), idempotent, expired warning
do $$ declare r jsonb; v_imatinib uuid; v_gluc uuid; tb0 bigint; payload jsonb; begin
  select id into v_imatinib from products where name = 'Imatinib 400 Tablet';
  select id into v_gluc from products where name = 'Glucon-D 500g';
  payload := jsonb_build_object('idempotencyKey', 'cccccccc-0000-0000-0000-000000000001', 'storeId', '00000000-0000-0000-0000-0000000000a1', 'asOf', '2026-11-01',
    'rows', jsonb_build_array(
      jsonb_build_object('productId', v_imatinib, 'batchNo', 'im101', 'expiry', '2027-12-31', 'packMrpPaise', 350000, 'packCostPaise', 250000, 'qtyBase', 30),
      jsonb_build_object('productId', v_gluc, 'batchNo', 'GD9', 'expiry', '2026-10-31', 'packMrpPaise', 26000, 'packCostPaise', 20000, 'qtyBase', 4)));
  r := post_opening_stock(payload || '{"dryRun":true}');
  assert (r->>'valuePaise')::bigint = 830000 and jsonb_array_length(r->'warnings') = 1, 'dry run: ' || r::text;
  assert not exists (select 1 from batches where batch_no = 'IM101'), 'dry run wrote stock';
  r := post_opening_stock(payload || '{"dryRun":false}');
  assert (r->>'rows')::int = 2, r::text;
  assert (select qty_on_hand from batches where batch_no = 'IM101') = 30;
  assert (select cost_per_unit_paise from batches where batch_no = 'IM101') = 25000, 'cost per tablet';
  assert (select credit_paise from v_trial_balance where code = 'OPENING_BAL') = 830000, 'opening balance journal';
  r := post_opening_stock(payload || '{"dryRun":false}');
  assert (r->>'duplicate')::boolean, 'opening stock not idempotent';
end $$;

-- UC-GST-01: Nil-rated product override wins over the HSN rate (5 %) at sale and in the POS catalogue
do $$ declare r jsonb; v_appr uuid; c jsonb; begin
  c := pos_catalogue('00000000-0000-0000-0000-0000000000a1', 'imatinib');
  assert (c->0->>'gstRate')::numeric = 0, 'catalogue rate: ' || (c->0->>'gstRate');
  v_appr := approve_rx_with_pin('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', '1234');
  r := post_sale(jsonb_build_object('billUuid', 'bbbbbbbb-0000-0000-0000-000000000020', 'storeId', '00000000-0000-0000-0000-0000000000a1', 'deviceCode', 'POS1',
       'billedAt', '2026-11-18T10:00:00+05:30', 'pharmacistId', '00000000-0000-0000-0000-0000000000f1', 'pharmacistApprovalId', v_appr,
       'lines', jsonb_build_array(jsonb_build_object('productId', (select id from products where name = 'Imatinib 400 Tablet'), 'qtyBase', 10)),
       'payments', jsonb_build_array(jsonb_build_object('mode', 'upi', 'amountPaise', 350000))));
  assert (select cgst_paise + sgst_paise from sales_bills where id = (r->>'billId')::uuid) = 0, 'Nil-rated drug was taxed';
  assert (select gst_rate from sales_bill_lines where bill_id = (r->>'billId')::uuid) = 0;
end $$;

-- inactive products disappear from the POS
update products set is_active = false where name = 'Glucon-D 500g';
do $$ begin
  assert jsonb_array_length(pos_catalogue('00000000-0000-0000-0000-0000000000a1', 'glucon')) = 0, 'inactive product still searchable';
end $$;

-- UC-CRM-05: credit sales — limit enforced online, flagged offline; receipts reduce the balance
do $$ declare r jsonb; v_bal bigint; begin
  assert (select outstanding_paise from v_customer_balances where customer_id = '00000000-0000-0000-0000-0000000000c1') = 9100, 'opening credit balance';
  update customers set credit_limit_paise = 10000 where id = '00000000-0000-0000-0000-0000000000c1';
  begin
    perform post_sale(jsonb_build_object('billUuid', 'bbbbbbbb-0000-0000-0000-000000000021', 'storeId', '00000000-0000-0000-0000-0000000000a1', 'deviceCode', 'POS1',
      'billedAt', now(), 'customerId', '00000000-0000-0000-0000-0000000000c1',
      'lines', jsonb_build_array(jsonb_build_object('productId', '00000000-0000-0000-0000-00000000b001', 'qtyBase', 15)),
      'payments', jsonb_build_array(jsonb_build_object('mode', 'credit', 'amountPaise', 3100))));
    raise exception 'expected credit limit block';
  exception when check_violation then
    if sqlerrm not like 'Credit limit exceeded%' then raise exception 'wrong error: %', sqlerrm; end if;
  end;
  r := post_sale(jsonb_build_object('billUuid', 'bbbbbbbb-0000-0000-0000-000000000022', 'storeId', '00000000-0000-0000-0000-0000000000a1', 'deviceCode', 'POS1',
      'billedAt', now(), 'customerId', '00000000-0000-0000-0000-0000000000c1', 'offline', true,
      'lines', jsonb_build_array(jsonb_build_object('productId', '00000000-0000-0000-0000-00000000b001', 'qtyBase', 15)),
      'payments', jsonb_build_array(jsonb_build_object('mode', 'cash', 'amountPaise', 1100), jsonb_build_object('mode', 'credit', 'amountPaise', 2000))));
  assert (select needs_review from sales_bills where id = (r->>'billId')::uuid), 'offline over-limit credit not flagged';
  assert (select outstanding_paise from v_customer_balances where customer_id = '00000000-0000-0000-0000-0000000000c1') = 11100;

  r := post_customer_receipt('{"idempotencyKey":"dddddddd-0000-0000-0000-000000000001","storeId":"00000000-0000-0000-0000-0000000000a1","customerId":"00000000-0000-0000-0000-0000000000c1","amountPaise":5000,"mode":"upi","reference":"UPI 123"}');
  assert (r->>'balancePaise')::bigint = 6100, r::text;
  r := post_customer_receipt('{"idempotencyKey":"dddddddd-0000-0000-0000-000000000001","storeId":"00000000-0000-0000-0000-0000000000a1","customerId":"00000000-0000-0000-0000-0000000000c1","amountPaise":5000,"mode":"upi"}');
  assert (r->>'duplicate')::boolean, 'receipt not idempotent';
  begin
    perform post_customer_receipt('{"idempotencyKey":"dddddddd-0000-0000-0000-000000000002","storeId":"00000000-0000-0000-0000-0000000000a1","customerId":"00000000-0000-0000-0000-0000000000c1","amountPaise":999999,"mode":"cash"}');
    raise exception 'expected overpayment block';
  exception when check_violation then null; end;
end $$;

-- credit needs a customer with a limit; walk-in credit is refused
do $$ begin
  perform post_sale(jsonb_build_object('billUuid', 'bbbbbbbb-0000-0000-0000-000000000023', 'storeId', '00000000-0000-0000-0000-0000000000a1', 'deviceCode', 'POS1',
    'billedAt', now(), 'lines', jsonb_build_array(jsonb_build_object('productId', '00000000-0000-0000-0000-00000000b001', 'qtyBase', 15)),
    'payments', jsonb_build_array(jsonb_build_object('mode', 'credit', 'amountPaise', 3100))));
  raise exception 'expected walk-in credit refused';
exception when check_violation then null; end $$;

-- UC-PUR-06: GRN warnings for changed MRP and a known batch with a different expiry; due date from credit days
do $$ declare r jsonb; begin
  r := post_purchase(jsonb_build_object('idempotencyKey', 'aaaaaaaa-0000-0000-0000-000000000010', 'storeId', '00000000-0000-0000-0000-0000000000a1',
    'distributorId', '00000000-0000-0000-0000-0000000000d1', 'supplierInvoiceNo', 'SBP/1002', 'supplierInvoiceDate', '2026-11-18',
    'lines', jsonb_build_array(
      jsonb_build_object('productId', '00000000-0000-0000-0000-00000000b001', 'batchNo', 'DL2611', 'expiry', '2028-09-30', 'packMrpPaise', 3200, 'packRatePaise', 2200, 'qtyPacks', 2))));
  assert jsonb_array_length(r->'warnings') = 2, 'warnings: ' || (r->'warnings')::text;
  assert (select due_date from purchase_invoices where id = (r->>'purchaseId')::uuid) = '2026-12-18', 'due date';
end $$;

-- UC-PUR-09: supplier payment
do $$ declare r jsonb; v_due bigint; begin
  select due_paise into v_due from v_supplier_balances where distributor_id = '00000000-0000-0000-0000-0000000000d1';
  assert v_due = 76300 + 4600, 'supplier due: ' || v_due;
  r := post_supplier_payment('{"idempotencyKey":"eeeeeeee-0000-0000-0000-000000000001","storeId":"00000000-0000-0000-0000-0000000000a1","distributorId":"00000000-0000-0000-0000-0000000000d1","amountPaise":50000,"mode":"bank","reference":"NEFT 778"}');
  assert (r->>'duePaise')::bigint = v_due - 50000, r::text;
  begin
    perform post_supplier_payment('{"idempotencyKey":"eeeeeeee-0000-0000-0000-000000000002","storeId":"00000000-0000-0000-0000-0000000000a1","distributorId":"00000000-0000-0000-0000-0000000000d1","amountPaise":99999999,"mode":"bank"}');
    raise exception 'expected overpayment block';
  exception when check_violation then null; end;
end $$;

-- accounting invariant still holds after everything above
do $$ begin
  assert (select sum(balance_paise) from v_trial_balance) = 0, 'trial balance not zero';
end $$;

-- billing staff cannot raise a credit limit (owner/admin only)
reset role;
insert into memberships (user_id, org_id, role) values ('66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000001', 'pharmacist');
set role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
do $$ begin
  update customers set credit_limit_paise = 9999999 where id = '00000000-0000-0000-0000-0000000000c1';
  raise exception 'expected credit limit guard';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update customers set address = 'New address, Indiranagar' where id = '00000000-0000-0000-0000-0000000000c1';
  assert (select address from customers where id = '00000000-0000-0000-0000-0000000000c1') = 'New address, Indiranagar', 'pharmacist should edit address';
end $$;

-- a non-member cannot import into this org
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
do $$ begin
  perform import_products('00000000-0000-0000-0000-000000000001', '[]'::jsonb, true);
  raise exception 'expected import denied';
exception when insufficient_privilege then null; end $$;
reset role;

select 'SPRINT 2 DATABASE TESTS PASSED' as result;
