-- Database test pack (QA: T-CMP-*, T-BIL-*, accounting invariants, RLS isolation).
-- Run: scripts/test-db.sh   (each block raises on failure)
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- fixtures (as superuser)
insert into memberships (user_id, org_id, role) values
 ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'owner');
insert into orgs (id, legal_name) values ('00000000-0000-0000-0000-000000000002', 'Other Pharmacy');
insert into memberships (user_id, org_id, role) values
 ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000002', 'owner');
insert into pharmacists (id, org_id, name, council, reg_no, pin_hash) values
 ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'Dr. A. Rao', 'Karnataka State Pharmacy Council', 'KSPC-4455', crypt('1234', gen_salt('bf')));
insert into pharmacist_shifts (org_id, store_id, pharmacist_id) values
 ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1');
insert into distributors (id, org_id, name, state_code, drug_licence_no, drug_licence_valid_to) values
 ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'Sri Balaji Pharma', '29', 'KA-B1-20B-1234', '2028-03-31'),
 ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001', 'Expired Licence Distributors', '29', 'KA-OLD-1', '2025-01-01');
insert into products (id, org_id, name, composition, hsn, schedule, habit_forming, units_per_pack, pack_label, listed_online) values
 ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-000000000001', 'Alprax 0.25 Tablet', 'Alprazolam 0.25mg', '30049099', 'H1', true, 10, 'Strip', true),
 ('00000000-0000-0000-0000-00000000b003', '00000000-0000-0000-0000-000000000001', 'Azithral 500 Tablet', 'Azithromycin 500mg', '30042019', 'H', false, 3, 'Strip', true);
insert into customers (id, org_id, name, phone, address, auth_user_id) values
 ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', 'Meena', '9800000001', 'Indiranagar, Bengaluru', '33333333-3333-3333-3333-333333333333');

-- act as owner of org 1
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- T-PUR: GRN (two batches of Dolo with different expiry + 1 free strip, Alprax, Azithral)
select post_purchase('{
  "idempotencyKey":"aaaaaaaa-0000-0000-0000-000000000001","storeId":"00000000-0000-0000-0000-0000000000a1",
  "distributorId":"00000000-0000-0000-0000-0000000000d1","supplierInvoiceNo":"SBP/1001","supplierInvoiceDate":"2026-11-10",
  "lines":[
   {"productId":"00000000-0000-0000-0000-00000000b001","batchNo":"DL2405","expiry":"2026-12-31","packMrpPaise":3091,"packRatePaise":2100,"qtyPacks":2,"freePacks":0},
   {"productId":"00000000-0000-0000-0000-00000000b001","batchNo":"DL2611","expiry":"2028-08-31","packMrpPaise":3091,"packRatePaise":2100,"qtyPacks":10,"freePacks":1},
   {"productId":"00000000-0000-0000-0000-00000000b002","batchNo":"AX0912","expiry":"2027-09-30","packMrpPaise":2200,"packRatePaise":1500,"qtyPacks":5},
   {"productId":"00000000-0000-0000-0000-00000000b003","batchNo":"AZ1123","expiry":"2027-03-31","packMrpPaise":11950,"packRatePaise":8000,"qtyPacks":5}
  ]}'::jsonb);

do $$ declare r jsonb; begin
  -- duplicate GRN is idempotent
  r := post_purchase('{"idempotencyKey":"aaaaaaaa-0000-0000-0000-000000000001","storeId":"00000000-0000-0000-0000-0000000000a1","distributorId":"00000000-0000-0000-0000-0000000000d1","supplierInvoiceNo":"SBP/1001","supplierInvoiceDate":"2026-11-10","lines":[]}'::jsonb);
  assert (r->>'duplicate')::boolean, 'GRN idempotency failed';
  assert (select qty_on_hand from batches where batch_no = 'DL2611') = 165, 'free qty not added to stock (11 strips × 15)';
  assert (select round(cost_per_unit_paise, 2) from batches where batch_no = 'DL2611') = 127.27, 'landed cost with free qty wrong';
end $$;

-- expired distributor licence blocks purchase
do $$ begin
  perform post_purchase('{"idempotencyKey":"aaaaaaaa-0000-0000-0000-000000000002","storeId":"00000000-0000-0000-0000-0000000000a1","distributorId":"00000000-0000-0000-0000-0000000000d2","supplierInvoiceNo":"X1","supplierInvoiceDate":"2026-11-10","lines":[]}'::jsonb);
  raise exception 'expected licence failure';
exception when check_violation then null; end $$;

-- T-BIL: OTC sale, FEFO picks the Dec-2026 batch first and splits across batches
do $$ declare r jsonb; begin
  r := post_sale('{
    "billUuid":"bbbbbbbb-0000-0000-0000-000000000001","storeId":"00000000-0000-0000-0000-0000000000a1","deviceCode":"POS1",
    "billedAt":"2026-11-17T10:00:00+05:30",
    "lines":[{"productId":"00000000-0000-0000-0000-00000000b001","qtyBase":35}],
    "payments":[{"mode":"cash","amountPaise":7200}]}'::jsonb);
  assert r->>'invoiceNo' = 'BLR1/26-27/00001', 'invoice no ' || (r->>'invoiceNo');
  assert (r->>'lines')::int = 2, 'expected FEFO split over 2 batches';
  assert (select qty_on_hand from batches where batch_no = 'DL2405') = 0, 'FEFO did not exhaust earliest batch';
  assert (select qty_on_hand from batches where batch_no = 'DL2611') = 160;
  -- idempotent replay (offline sync retry)
  r := post_sale('{"billUuid":"bbbbbbbb-0000-0000-0000-000000000001","storeId":"00000000-0000-0000-0000-0000000000a1","deviceCode":"POS1","billedAt":"2026-11-17T10:00:00+05:30","lines":[{"productId":"00000000-0000-0000-0000-00000000b001","qtyBase":35}],"payments":[{"mode":"cash","amountPaise":7200}]}'::jsonb);
  assert (r->>'duplicate')::boolean and (select count(*) from sales_bills) = 1, 'duplicate sale created';
end $$;

-- payments must equal total
do $$ begin
  perform post_sale('{"billUuid":"bbbbbbbb-0000-0000-0000-000000000002","storeId":"00000000-0000-0000-0000-0000000000a1","deviceCode":"POS1","billedAt":"2026-11-17T10:05:00+05:30","lines":[{"productId":"00000000-0000-0000-0000-00000000b001","qtyBase":15}],"payments":[{"mode":"cash","amountPaise":100}]}'::jsonb);
  raise exception 'expected payment mismatch';
exception when check_violation then null; end $$;

-- T-CMP-001: H1 without prescriber reg no is blocked (valid PIN approval supplied, so the register rule is what blocks)
do $$ begin
  perform post_sale(jsonb_set('{"billUuid":"bbbbbbbb-0000-0000-0000-000000000003","storeId":"00000000-0000-0000-0000-0000000000a1","deviceCode":"POS1","billedAt":"2026-11-17T10:10:00+05:30",
    "pharmacistId":"00000000-0000-0000-0000-0000000000f1",
    "prescription":{"prescriberName":"Dr Kumar","patientName":"Meena","patientAddress":"Indiranagar","rxDate":"2026-11-15"},
    "lines":[{"productId":"00000000-0000-0000-0000-00000000b002","qtyBase":10}],"payments":[{"mode":"upi","amountPaise":2200}]}'::jsonb,
    '{pharmacistApprovalId}', to_jsonb(approve_rx_with_pin('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', '1234')::text)));
  raise exception 'expected H1 block';
exception when check_violation then
  if sqlerrm not like 'Schedule H1/X/NDPS%' then raise exception 'wrong rule fired: %', sqlerrm; end if;
end $$;

-- Rx sale without PIN approval is blocked when online
do $$ begin
  perform post_sale('{"billUuid":"bbbbbbbb-0000-0000-0000-000000000006","storeId":"00000000-0000-0000-0000-0000000000a1","deviceCode":"POS1","billedAt":"2026-11-17T10:11:00+05:30",
    "pharmacistId":"00000000-0000-0000-0000-0000000000f1","lines":[{"productId":"00000000-0000-0000-0000-00000000b003","qtyBase":3}],"payments":[{"mode":"cash","amountPaise":11950}]}'::jsonb);
  raise exception 'expected PIN approval block';
exception when check_violation then null; end $$;

-- H drug without pharmacist is blocked
do $$ begin
  perform post_sale('{"billUuid":"bbbbbbbb-0000-0000-0000-000000000004","storeId":"00000000-0000-0000-0000-0000000000a1","deviceCode":"POS1","billedAt":"2026-11-17T10:12:00+05:30",
    "lines":[{"productId":"00000000-0000-0000-0000-00000000b003","qtyBase":3}],"payments":[{"mode":"cash","amountPaise":11950}]}'::jsonb);
  raise exception 'expected pharmacist block';
exception when check_violation then null; end $$;

-- T-CMP-002: complete H1 + H bill with 10 % discount on Azithral → register row, wireframe totals
do $$ declare r jsonb; b sales_bills%rowtype; v_appr uuid; begin
  v_appr := approve_rx_with_pin('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', '1234');
  assert v_appr is not null, 'PIN approval failed';
  r := post_sale(jsonb_set('{"billUuid":"bbbbbbbb-0000-0000-0000-000000000005","storeId":"00000000-0000-0000-0000-0000000000a1","deviceCode":"POS1","billedAt":"2026-11-17T11:00:00+05:30",
    "customerId":"00000000-0000-0000-0000-0000000000c1","pharmacistId":"00000000-0000-0000-0000-0000000000f1",
    "prescription":{"prescriberName":"Dr Kumar","prescriberRegNo":"KMC-12345","patientName":"Meena","patientAddress":"Indiranagar","rxDate":"2026-11-15"},
    "lines":[{"productId":"00000000-0000-0000-0000-00000000b001","qtyBase":30},
             {"productId":"00000000-0000-0000-0000-00000000b003","qtyBase":3,"discountPct":10},
             {"productId":"00000000-0000-0000-0000-00000000b002","qtyBase":10}],
    "payments":[{"mode":"upi","amountPaise":10000},{"mode":"credit","amountPaise":9100}]}'::jsonb, '{pharmacistApprovalId}', to_jsonb(v_appr::text)));
  select * into b from sales_bills where id = (r->>'billId')::uuid;
  assert b.total_paise = 19100 and b.round_off_paise = -37 and b.taxable_paise = 18226 and b.cgst_paise = 455 and b.sgst_paise = 456,
    format('wireframe totals mismatch: %s', row_to_json(b));
  assert (select count(*) from schedule_register where bill_id = b.id and schedule = 'H1' and prescriber_reg_no = 'KMC-12345') = 1, 'H1 register row missing';
end $$;

-- T-CMP-007: registers & ledgers are append-only
do $$ begin
  update schedule_register set patient_name = 'x';
  raise exception 'expected append-only failure';
exception when insufficient_privilege then null; end $$;

-- Accounting invariant: trial balance nets to zero, every entry balanced
do $$ begin
  assert (select sum(balance_paise) from v_trial_balance) = 0, 'trial balance not zero';
  assert (select coalesce(sum(debit_paise),0) from v_trial_balance where code = 'DEBTORS') = 9100, 'credit sale not posted to debtors';
end $$;

-- GSTR-1 HSN view sums to bill taxable
do $$ begin
  assert (select sum(taxable_paise) from v_gstr1_hsn) = (select sum(taxable_paise) from sales_bills), 'HSN summary mismatch';
end $$;

-- Online: Schedule H1 habit-forming item cannot be on a delivery order (T-CMP-003)
reset role;
insert into online_orders (id, org_id, store_id, customer_id, order_no, fulfilment, payment_mode) values
 ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000c1', 'WEB-0001', 'delivery', 'prepaid');
do $$ begin
  insert into online_order_items (order_id, org_id, product_id, qty_base) values
   ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b002', 10);
  raise exception 'expected X/NDPS/habit-forming delivery block';
exception when check_violation then null; end $$;
insert into online_order_items (order_id, org_id, product_id, qty_base) values
 ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b003', 3);

-- T-CMP-004: Rx order cannot skip verification
do $$ begin
  assert (select has_rx_items from online_orders where id = '00000000-0000-0000-0000-0000000000e1'), 'rx flag not set';
  update online_orders set status = 'confirmed' where id = '00000000-0000-0000-0000-0000000000e1';
  raise exception 'expected rx verification block';
exception when check_violation then null; end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select verify_online_rx('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', true);
do $$ begin
  assert (select status from online_orders where id = '00000000-0000-0000-0000-0000000000e1') = 'confirmed', 'rx approve did not confirm';
end $$;
do $$ begin
  update online_orders set status = 'picking' where id = '00000000-0000-0000-0000-0000000000e1';
  update online_orders set status = 'packed' where id = '00000000-0000-0000-0000-0000000000e1';
  update online_orders set status = 'out_for_delivery' where id = '00000000-0000-0000-0000-0000000000e1';
  raise exception 'expected invoice-before-dispatch block';
exception when check_violation then null; end $$;

-- RLS: user of org 2 sees nothing of org 1
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  assert (select count(*) from sales_bills) = 0, 'RLS leak: sales_bills';
  assert (select count(*) from products) = 0, 'RLS leak: products';
  assert (select count(*) from schedule_register) = 0, 'RLS leak: schedule_register';
  assert (select count(*) from journal_lines) = 0, 'RLS leak: journal_lines';
end $$;
do $$ begin
  perform post_sale('{"billUuid":"bbbbbbbb-0000-0000-0000-000000000009","storeId":"00000000-0000-0000-0000-0000000000a1","deviceCode":"X","billedAt":"2026-11-17T12:00:00+05:30","lines":[{"productId":"00000000-0000-0000-0000-00000000b001","qtyBase":1}],"payments":[{"mode":"cash","amountPaise":200}]}'::jsonb);
  raise exception 'expected cross-tenant sale block';
exception when insufficient_privilege then null; end $$;

-- direct insert into ledgers is denied for clients
do $$ begin
  insert into stock_ledger (org_id, store_id, batch_id, product_id, doc_type, doc_id, qty_delta)
  values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), gen_random_uuid(), 'opening', gen_random_uuid(), 1);
  raise exception 'expected insert denied';
exception when insufficient_privilege then null; end $$;

-- customer sees own order only
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$ begin
  assert (select count(*) from online_orders) = 1, 'customer cannot see own order';
  assert (select count(*) from sales_bills) = 0, 'customer sees store bills';
end $$;

-- storefront catalogue for anonymous visitors
set role anon;
do $$ begin
  assert (select count(*) from storefront_products) = 3, 'storefront catalogue count';
  assert (select store_only from storefront_products where name like 'Alprax%'), 'habit-forming not marked store-only';
end $$;
reset role;

select 'ALL DATABASE TESTS PASSED' as result;
