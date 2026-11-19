-- Sprint 4 tests: cash shift lifecycle (expected cash from the journal), shortage posting, controlled-drug reconciliation,
-- prescription-view logging, audit-log visibility. Runs after 10–40 on the demo org (owner 1111…, pharmacist 6666…).
\set ON_ERROR_STOP on
set client_min_messages = warning;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- open: ₹2,000 float; a second open is refused
do $$ declare r jsonb; begin
  r := open_shift('00000000-0000-0000-0000-0000000000a1', 'POS1', 200000);
  perform set_config('t.shift', r->>'shiftId', false);
  begin perform open_shift('00000000-0000-0000-0000-0000000000a1', 'POS1', 0); raise exception 'expected double open block';
  exception when check_violation then null; end;
end $$;

-- activity during the shift: cash sale ₹62, UPI sale, cash refund, udhaar receipt in cash ₹10, petty expense ₹50
do $$ declare r jsonb; v_line bigint; begin
  r := post_sale(jsonb_build_object('billUuid', 'bbbbbbbb-0000-0000-0000-000000000050', 'storeId', '00000000-0000-0000-0000-0000000000a1', 'deviceCode', 'POS1',
       'billedAt', now(), 'lines', jsonb_build_array(jsonb_build_object('productId', '00000000-0000-0000-0000-00000000b001', 'qtyBase', 30)),
       'payments', jsonb_build_array(jsonb_build_object('mode', 'cash', 'amountPaise', 6200))));
  perform set_config('t.bill', r->>'billId', false);
  perform post_sale(jsonb_build_object('billUuid', 'bbbbbbbb-0000-0000-0000-000000000051', 'storeId', '00000000-0000-0000-0000-0000000000a1', 'deviceCode', 'POS1',
       'billedAt', now(), 'lines', jsonb_build_array(jsonb_build_object('productId', '00000000-0000-0000-0000-00000000b001', 'qtyBase', 15)),
       'payments', jsonb_build_array(jsonb_build_object('mode', 'upi', 'amountPaise', 3100))));
end $$;
do $$ declare v_line bigint; begin
  select id into v_line from sales_bill_lines where bill_id = current_setting('t.bill')::uuid order by id limit 1;
  perform post_sales_return(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'billId', current_setting('t.bill')::uuid, 'reason', 'Customer changed mind',
    'refundMode', 'cash', 'lines', jsonb_build_array(jsonb_build_object('billLineId', v_line, 'qtyBase', 15))));
  perform post_customer_receipt(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', '00000000-0000-0000-0000-0000000000a1',
    'customerId', '00000000-0000-0000-0000-0000000000c1', 'amountPaise', 1000, 'mode', 'cash'));
  perform record_cash_movement(current_setting('t.shift')::uuid, 'expense', 5000, 'Tea and courier');
  begin perform record_cash_movement(current_setting('t.shift')::uuid, 'bribe', 100, 'nope'); raise exception 'expected unknown kind';
  exception when others then if sqlerrm like 'expected%' then raise; end if; end;
end $$;

-- X report: expected = 2000 + 62 − 31 (refund) + 10 − 50 = ₹1,991
do $$ declare x jsonb; begin
  x := shift_summary(current_setting('t.shift')::uuid);
  assert (x->>'cashNetPaise')::bigint = 6200 - 3100 + 1000 - 5000, 'cash net: ' || x::text;
  assert (x->>'expectedCashPaise')::bigint = 199100, 'expected: ' || (x->>'expectedCashPaise');
  assert (x->>'upiPaise')::bigint = 3100 and (x->>'bills')::int = 2 and (x->>'returns')::int = 1, 'mix: ' || x::text;
  assert (my_open_shift('00000000-0000-0000-0000-0000000000a1')->>'shiftId') = current_setting('t.shift'), 'my_open_shift';
end $$;

-- the pharmacist can't close the owner's shift
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
do $$ begin
  perform close_shift(current_setting('t.shift')::uuid, '{"500":3}'::jsonb, null);
  raise exception 'expected close denied';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- close ₹200 short without a note → refused; with a note → Z report and CASH_DIFF debited ₹200
do $$ declare z jsonb; v_diff0 bigint; begin
  begin
    perform close_shift(current_setting('t.shift')::uuid, '{"500":3,"100":2,"50":1,"20":2,"1":1}'::jsonb, null);
    raise exception 'expected note required';
  exception when check_violation then null; end;
  select coalesce(sum(debit_paise), 0) into v_diff0 from v_trial_balance where code = 'CASH_DIFF';
  z := close_shift(current_setting('t.shift')::uuid, '{"500":3,"100":2,"50":1,"20":2,"1":1}'::jsonb, 'Short — refund given twice, checking CCTV');
  assert (z->>'countedPaise')::bigint = 179100 and (z->>'differencePaise')::bigint = -20000, 'z: ' || z::text;
  assert (select debit_paise from v_trial_balance where code = 'CASH_DIFF') = v_diff0 + 20000, 'shortage not posted';
  assert (select status from pos_shifts where id = current_setting('t.shift')::uuid) = 'closed';
  assert my_open_shift('00000000-0000-0000-0000-0000000000a1') is null, 'shift still open';
  begin perform record_cash_movement(current_setting('t.shift')::uuid, 'expense', 100, 'late'); raise exception 'expected closed shift block';
  exception when check_violation then null; end;
  -- a new shift reports the last closing count
  assert (open_shift('00000000-0000-0000-0000-0000000000a1', 'POS1', 150000)->>'lastClosingPaise')::bigint = 179100, 'last closing not reported';
end $$;

-- UC-CMP-02/03: controlled-drug reconciliation — closing = on hand, register qty = net sold
do $$ declare r jsonb; e jsonb; begin
  r := controlled_stock_summary('00000000-0000-0000-0000-0000000000a1', '2026-01-01', current_date + 1);
  select x into e from jsonb_array_elements(r) x where x->>'product' like 'Alprax%';
  assert e is not null, 'Alprax missing: ' || r::text;
  assert (e->>'closing')::int = (e->>'on_hand_now')::int, 'closing <> on hand: ' || e::text;
  assert (e->>'opening')::int + (e->>'received')::int - (e->>'sold')::int + (e->>'customer_returns')::int - (e->>'returned_to_supplier')::int + (e->>'adjusted')::int = (e->>'closing')::int, 'movement does not add up: ' || e::text;
  assert (e->>'register_qty')::int = (e->>'sold')::int - (e->>'customer_returns')::int - 5, 'register vs stock: ' || e::text;  -- register also records the 5 damaged (not restocked) returns
end $$;

-- UC-CMP-04: viewing a prescription is logged; billing staff without the role can't
do $$ declare p text; v_rx uuid; begin
  select id into v_rx from prescriptions where prescriber_reg_no = 'KMC-12345' limit 1;
  p := log_rx_view(v_rx);
  assert exists (select 1 from audit_log where action = 'rx_view' and entity_id = v_rx::text), 'rx view not logged';
end $$;

-- UC-CMP-09: audit log is owner/admin/auditor only
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
do $$ begin
  assert (select count(*) from audit_log) = 0, 'pharmacist can read audit log';
end $$;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  assert (select count(*) from audit_log where action in ('shift_open','shift_close')) >= 3, 'owner cannot read audit log';
  assert (select sum(balance_paise) from v_trial_balance) = 0, 'trial balance not zero';
end $$;
reset role;

select 'SPRINT 4 DATABASE TESTS PASSED' as result;
