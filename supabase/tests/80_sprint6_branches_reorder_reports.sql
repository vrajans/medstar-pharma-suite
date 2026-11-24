-- Sprint 6 tests: branch stock transfer (send, short receipt, cancel, GSTIN rule, controlled-drug trail, books),
-- reorder suggestions and purchase orders, owner reports. Runs after 10–70 (BLR2 = second branch under BLR1's GSTIN).
\set ON_ERROR_STOP on
set client_min_messages = warning;
set timezone = 'Asia/Kolkata';
set role authenticated;

-- billing staff can't move stock between branches
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
do $$ begin
  perform post_stock_transfer(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'fromStoreId', '00000000-0000-0000-0000-0000000000a1',
    'toStoreId', '00000000-0000-0000-0000-0000000000a3', 'lines', '[]'::jsonb));
  raise exception 'expected billing denied';
exception when insufficient_privilege then null; end $$;

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$
declare a1 uuid := '00000000-0000-0000-0000-0000000000a1'; a3 uuid := '00000000-0000-0000-0000-0000000000a3'; o uuid := '00000000-0000-0000-0000-000000000001';
  dolo uuid; alprax uuid; q_dolo int; q_alp int; r jsonb; t uuid; k uuid := gen_random_uuid(); v bigint; ln bigint;
begin
  select id, qty_on_hand into dolo, q_dolo from batches where store_id = a1 and batch_no = 'DL2611' and qty_on_hand >= 40 and status = 'active' order by qty_on_hand desc limit 1;
  select id, qty_on_hand into alprax, q_alp from batches where store_id = a1 and batch_no = 'AX0912';

  -- a branch with a different GSTIN needs a tax invoice: refused
  begin
    perform post_stock_transfer(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'fromStoreId', a1, 'toStoreId', '00000000-0000-0000-0000-0000000000a2',
      'lines', jsonb_build_array(jsonb_build_object('batchId', dolo, 'qtyBase', 10))));
    raise exception 'expected GSTIN refusal';
  exception when check_violation then if sqlerrm not like '%different GSTINs%' then raise; end if; end;
  -- more than in stock: refused
  begin
    perform post_stock_transfer(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'fromStoreId', a1, 'toStoreId', a3,
      'lines', jsonb_build_array(jsonb_build_object('batchId', dolo, 'qtyBase', q_dolo + 1))));
    raise exception 'expected stock refusal';
  exception when check_violation then null; end;

  -- send 40 Dolo + 10 Alprax (H1)
  r := post_stock_transfer(jsonb_build_object('idempotencyKey', k, 'fromStoreId', a1, 'toStoreId', a3, 'note', 'Weekend top-up',
    'lines', jsonb_build_array(jsonb_build_object('batchId', dolo, 'qtyBase', 40), jsonb_build_object('batchId', alprax, 'qtyBase', 10))));
  t := (r->>'transferId')::uuid;
  assert r->>'transferNo' like 'BLRST/%', 'series: ' || r::text;
  assert (post_stock_transfer(jsonb_build_object('idempotencyKey', k, 'fromStoreId', a1, 'toStoreId', a3, 'lines', '[]'::jsonb))->>'duplicate')::boolean, 'idempotent';
  assert (select qty_on_hand from batches where id = dolo) = q_dolo - 40 and (select qty_on_hand from batches where id = alprax) = q_alp - 10, 'stock not reduced at sender';
  select sum(debit_paise - credit_paise) into v from journal_lines where account_id = acct(o, 'STOCK_TRANSIT');
  assert v = (r->>'valuePaise')::bigint and v > 0, 'in-transit value ' || v;
  perform set_config('t.transfer', t::text, false);
  perform set_config('t.value', (r->>'valuePaise'), false);
end $$;

-- receive at BLR2 (owner has access to all stores): Alprax arrives 2 short
do $$
declare t uuid := current_setting('t.transfer')::uuid; o uuid := '00000000-0000-0000-0000-000000000001'; a3 uuid := '00000000-0000-0000-0000-0000000000a3';
  ln_alp bigint; r jsonb; v bigint; c jsonb;
begin
  select l.id into ln_alp from stock_transfer_lines l join products p on p.id = l.product_id where l.transfer_id = t and p.schedule = 'H1';
  begin
    perform receive_stock_transfer(t, jsonb_build_array(jsonb_build_object('lineId', ln_alp, 'receivedQty', 8)), null);
    raise exception 'expected note for shortage';
  exception when check_violation then null; end;
  r := receive_stock_transfer(t, jsonb_build_array(jsonb_build_object('lineId', ln_alp, 'receivedQty', 8)), 'One strip damaged in transit');
  assert (r->>'shortLines')::int = 1 and (r->>'shortPaise')::bigint > 0, 'receipt: ' || r::text;
  assert (select qty_on_hand from batches where store_id = a3 and batch_no = 'AX0912') = 8, 'Alprax not received';
  assert (select sum(qty_on_hand) from batches where store_id = a3 and batch_no = 'DL2611') = 40, 'Dolo not received';
  select coalesce(sum(debit_paise - credit_paise), 0) into v from journal_lines where account_id = acct(o, 'STOCK_TRANSIT');
  assert v = 0, 'transit not cleared: ' || v;
  assert (select status from stock_transfers where id = t) = 'received', 'status';
  begin perform receive_stock_transfer(t, null, null); raise exception 'expected double receive refused';
  exception when check_violation then null; end;
  -- controlled-drug trail: BLR2 shows 8 received by transfer
  c := controlled_stock_summary(a3, current_date, current_date);
  assert exists (select 1 from jsonb_array_elements(c) x where x->>'product' like 'Alprax%' and (x->>'received')::int = 8), 'H1 trail at receiver: ' || c::text;
  -- books still balance
  assert (select sum((x->>'closing')::bigint) from jsonb_array_elements(trial_balance(o, fy_start(current_date), current_date)) x) = 0, 'TB';
end $$;

-- cancel a transfer still in transit: stock comes back
do $$
declare a1 uuid := '00000000-0000-0000-0000-0000000000a1'; a3 uuid := '00000000-0000-0000-0000-0000000000a3'; o uuid := '00000000-0000-0000-0000-000000000001';
  dolo uuid; q int; r jsonb; v bigint;
begin
  select id, qty_on_hand into dolo, q from batches where store_id = a1 and batch_no = 'DL2611' and qty_on_hand >= 5 order by qty_on_hand desc limit 1;
  r := post_stock_transfer(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'fromStoreId', a1, 'toStoreId', a3,
    'lines', jsonb_build_array(jsonb_build_object('batchId', dolo, 'qtyBase', 5))));
  begin perform cancel_stock_transfer((r->>'transferId')::uuid, 'no'); raise exception 'expected reason';
  exception when check_violation then null; end;
  perform cancel_stock_transfer((r->>'transferId')::uuid, 'Sent to the wrong branch');
  assert (select qty_on_hand from batches where id = dolo) = q, 'stock not restored';
  select coalesce(sum(debit_paise - credit_paise), 0) into v from journal_lines where account_id = acct(o, 'STOCK_TRANSIT');
  assert v = 0, 'transit after cancel: ' || v;
  begin perform receive_stock_transfer((r->>'transferId')::uuid, null, null); raise exception 'expected cancelled refused';
  exception when check_violation then null; end;
end $$;

-- short list and purchase order
do $$
declare a1 uuid := '00000000-0000-0000-0000-0000000000a1'; s jsonb; r jsonb; x jsonb;
begin
  update products set reorder_level = 50 where id = '00000000-0000-0000-0000-00000000b001';
  s := reorder_suggestions(a1, 30);
  select e into x from jsonb_array_elements(s) e where e->>'productId' = '00000000-0000-0000-0000-00000000b001';
  assert x is not null and (x->>'suggestedPacks')::int > 0, 'Dolo not on short list: ' || s::text;
  assert x->>'distributor' is not null and (x->>'lastRatePaise')::bigint > 0, 'last supplier / rate missing: ' || x::text;
  begin
    perform create_purchase_order(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', a1, 'distributorId', '00000000-0000-0000-0000-0000000000d2',
      'lines', jsonb_build_array(jsonb_build_object('productId', '00000000-0000-0000-0000-00000000b001', 'qtyPacks', 5))));
    raise exception 'expected expired-licence refusal';
  exception when check_violation then null; end;
  r := create_purchase_order(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', a1, 'distributorId', '00000000-0000-0000-0000-0000000000d1',
    'lines', jsonb_build_array(jsonb_build_object('productId', '00000000-0000-0000-0000-00000000b001', 'qtyPacks', (x->>'suggestedPacks')::int, 'expectedRatePaise', x->>'lastRatePaise'))));
  assert r->>'poNo' like 'BLRPO/%', 'po: ' || r::text;
  perform set_purchase_order_status((r->>'poId')::uuid, 'received');
  begin perform set_purchase_order_status((r->>'poId')::uuid, 'cancelled'); raise exception 'expected closed';
  exception when check_violation then null; end;
end $$;

-- reports
do $$
declare a1 uuid := '00000000-0000-0000-0000-0000000000a1'; s jsonb; m bigint; v jsonb; c bigint;
begin
  s := sales_report(a1, '2000-01-01', current_date);
  assert (s->'totals'->>'bills')::int = (select count(*) from sales_bills where store_id = a1 and status = 'posted'), 'bill count';
  select sum((x->>'amount')::bigint) into m from jsonb_array_elements(s->'modes') x;
  assert m = (s->'totals'->>'sales')::bigint, 'payment modes ' || m || ' vs sales ' || (s->'totals'->>'sales');
  assert (select sum((x->>'sales')::bigint) from jsonb_array_elements(s->'staff') x) = (s->'totals'->>'sales')::bigint, 'staff split';
  assert (select sum((x->>'bills')::int) from jsonb_array_elements(s->'hours') x) = (s->'totals'->>'bills')::int, 'hour split';
  assert jsonb_array_length(doctor_sales_report(a1, '2000-01-01', current_date)) >= 1, 'doctor report';
  assert jsonb_typeof(non_moving_stock(a1, 0)) = 'array', 'non-moving';
  v := stock_valuation(a1);
  select round(sum(qty_on_hand * cost_per_unit_paise)) into c from batches where store_id = a1 and qty_on_hand > 0 and status = 'active' and expiry >= current_date;
  assert abs((v->>'costPaise')::bigint - c) <= jsonb_array_length(v->'rows'), 'valuation ' || (v->>'costPaise') || ' vs ' || c;
  assert (v->>'mrpPaise')::bigint > (v->>'costPaise')::bigint, 'MRP above cost';
end $$;

-- billing staff can't see owner reports; the other pharmacy sees nothing
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
do $$ begin
  perform sales_report('00000000-0000-0000-0000-0000000000a1', current_date, current_date); raise exception 'expected billing denied report';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  assert (select count(*) from stock_transfers) = 0 and (select count(*) from purchase_orders) = 0, 'tenant leak';
end $$;
reset role;

select 'SPRINT 6 DATABASE TESTS PASSED' as result;
