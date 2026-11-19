-- Sprint 3 tests: credit notes, same-day cancellation, debit notes, stock adjustments with approval, recalls.
-- Runs after 10/20/30. Uses demo org 1 (owner 1111…, pharmacist member 6666…), bill …005 (Dolo + Azithral + Alprax H1, Meena, part credit).
\set ON_ERROR_STOP on
set client_min_messages = warning;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- UC-POS-10: partial then final return of the Alprax (H1) line; refund to the customer's account
do $$ declare r jsonb; v_line bigint; v_bal0 bigint; v_stock0 int; begin
  select id into v_line from sales_bill_lines where bill_id = (select id from sales_bills where bill_uuid = 'bbbbbbbb-0000-0000-0000-000000000005')
    and product_id = '00000000-0000-0000-0000-00000000b002';
  select outstanding_paise into v_bal0 from v_customer_balances where customer_id = '00000000-0000-0000-0000-0000000000c1';
  select qty_on_hand into v_stock0 from batches where batch_no = 'AX0912' and store_id = '00000000-0000-0000-0000-0000000000a1';

  r := post_sales_return(jsonb_build_object('idempotencyKey', 'ffffffff-0000-0000-0000-000000000001',
        'billId', (select id from sales_bills where bill_uuid = 'bbbbbbbb-0000-0000-0000-000000000005'), 'reason', 'Doctor changed prescription', 'refundMode', 'account',
        'lines', jsonb_build_array(jsonb_build_object('billLineId', v_line, 'qtyBase', 5))));
  assert r->>'creditNoteNo' = 'BLRCN/26-27/0001', 'CN number: ' || (r->>'creditNoteNo');
  assert (select (taxable_paise, cgst_paise, sgst_paise) from sales_return_lines where return_id = (r->>'returnId')::uuid) = (1048::bigint, 26::bigint, 26::bigint), 'partial return tax';
  assert (r->>'totalPaise')::bigint = 1100, 'CN total ' || (r->>'totalPaise');
  assert (select qty_on_hand from batches where batch_no = 'AX0912' and store_id = '00000000-0000-0000-0000-0000000000a1') = v_stock0 + 5, 'not restocked';
  assert (select outstanding_paise from v_customer_balances where customer_id = '00000000-0000-0000-0000-0000000000c1') = v_bal0 - 1100, 'account refund';
  assert exists (select 1 from schedule_register where invoice_no = 'BLRCN/26-27/0001' and qty_base = -5 and prescriber_reg_no = 'KMC-12345'), 'H1 register return row';

  -- idempotent replay
  r := post_sales_return(jsonb_build_object('idempotencyKey', 'ffffffff-0000-0000-0000-000000000001', 'billId', (select id from sales_bills where bill_uuid = 'bbbbbbbb-0000-0000-0000-000000000005'),
        'reason', 'x', 'refundMode', 'cash', 'lines', '[]'::jsonb));
  assert (r->>'duplicate')::boolean, 'return not idempotent';

  -- over-return refused
  begin
    perform post_sales_return(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'billId', (select id from sales_bills where bill_uuid = 'bbbbbbbb-0000-0000-0000-000000000005'),
      'reason', 'too many', 'refundMode', 'cash', 'lines', jsonb_build_array(jsonb_build_object('billLineId', v_line, 'qtyBase', 6))));
    raise exception 'expected over-return block';
  exception when check_violation then null; end;

  -- final return takes the exact remainder: the line nets to zero tax
  r := post_sales_return(jsonb_build_object('idempotencyKey', 'ffffffff-0000-0000-0000-000000000002', 'billId', (select id from sales_bills where bill_uuid = 'bbbbbbbb-0000-0000-0000-000000000005'),
        'reason', 'Rest returned', 'refundMode', 'cash', 'lines', jsonb_build_array(jsonb_build_object('billLineId', v_line, 'qtyBase', 5, 'restock', false))));
  assert (select sum(taxable_paise) from sales_return_lines where bill_line_id = v_line) = (select taxable_paise from sales_bill_lines where id = v_line), 'taxable does not net';
  assert (select sum(cgst_paise + sgst_paise) from sales_return_lines where bill_line_id = v_line) = (select cgst_paise + sgst_paise from sales_bill_lines where id = v_line), 'tax does not net';
  assert (select qty_on_hand from batches where batch_no = 'AX0912' and store_id = '00000000-0000-0000-0000-0000000000a1') = v_stock0 + 5, 'damaged return must not restock';
end $$;

-- cold-chain items are never restocked even if asked
do $$ declare r jsonb; v_bill uuid; v_line bigint; v_ins uuid; v_q int; v_appr uuid; begin
  update products set cold_chain = true where id = '00000000-0000-0000-0000-00000000b003';
  select id into v_bill from sales_bills where bill_uuid = 'bbbbbbbb-0000-0000-0000-000000000005';
  select id into v_line from sales_bill_lines where bill_id = v_bill and product_id = '00000000-0000-0000-0000-00000000b003';
  select qty_on_hand into v_q from batches where batch_no = 'AZ1123';
  r := post_sales_return(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'billId', v_bill, 'reason', 'Patient allergic', 'refundMode', 'upi',
        'lines', jsonb_build_array(jsonb_build_object('billLineId', v_line, 'qtyBase', 1, 'restock', true))));
  assert not (select restocked from sales_return_lines where return_id = (r->>'returnId')::uuid), 'cold chain restocked';
  assert (select qty_on_hand from batches where batch_no = 'AZ1123') = v_q, 'cold chain stock changed';
  update products set cold_chain = false where id = '00000000-0000-0000-0000-00000000b003';
end $$;

-- UC-POS-11: same-day cancellation reverses stock, payments and the journal; not allowed twice, nor for old bills or bills with returns
do $$ declare r jsonb; v_q0 int; v_tb bigint; v_id uuid; begin
  select sum(qty_on_hand) into v_q0 from batches where product_id = '00000000-0000-0000-0000-00000000b001' and store_id = '00000000-0000-0000-0000-0000000000a1';
  r := post_sale(jsonb_build_object('billUuid', 'bbbbbbbb-0000-0000-0000-000000000040', 'storeId', '00000000-0000-0000-0000-0000000000a1', 'deviceCode', 'POS1',
       'billedAt', now(), 'lines', jsonb_build_array(jsonb_build_object('productId', '00000000-0000-0000-0000-00000000b001', 'qtyBase', 30)),
       'payments', jsonb_build_array(jsonb_build_object('mode', 'cash', 'amountPaise', 6200))));
  v_id := (r->>'billId')::uuid;
  perform cancel_sale(v_id, 'Wrong item scanned');
  assert (select status from sales_bills where id = v_id) = 'cancelled';
  assert (select sum(qty_on_hand) from batches where product_id = '00000000-0000-0000-0000-00000000b001' and store_id = '00000000-0000-0000-0000-0000000000a1') = v_q0, 'stock not restored';
  assert (select sum(amount_paise) from payments where bill_id = v_id) = 0, 'payments not reversed';
  assert (select coalesce(sum(debit_paise - credit_paise), 0) from journal_lines jl join journal_entries je on je.id = jl.entry_id
          where je.source_id = v_id and jl.account_id = acct('00000000-0000-0000-0000-000000000001', 'SALES')) = 0, 'sales not reversed';
  begin perform cancel_sale(v_id, 'again please'); raise exception 'expected double cancel block'; exception when check_violation then null; end;
end $$;
do $$ begin
  perform cancel_sale((select id from sales_bills where bill_uuid = 'bbbbbbbb-0000-0000-0000-000000000005'), 'old bill cancel');
  raise exception 'expected old/returned bill cancel block';
exception when check_violation then null; end $$;

-- a returned item cannot be returned on a cancelled bill
do $$ begin
  perform post_sales_return(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'billId', (select id from sales_bills where bill_uuid = 'bbbbbbbb-0000-0000-0000-000000000040'),
    'reason', 'x', 'refundMode', 'cash', 'lines', jsonb_build_array(jsonb_build_object('billLineId', (select min(id) from sales_bill_lines where bill_id = (select id from sales_bills where bill_uuid = 'bbbbbbbb-0000-0000-0000-000000000040')), 'qtyBase', 1))));
  raise exception 'expected cancelled-bill return block';
exception when check_violation then null; end $$;

-- UC-PUR-07: expired Glucon-D returned to the distributor → debit note at cost + reversed ITC (18 %)
do $$ declare r jsonb; v_due0 bigint; v_batch uuid; begin
  select batch_id into v_batch from v_returnable_batches where batch_no = 'GD9';
  select due_paise into v_due0 from v_supplier_balances where distributor_id = '00000000-0000-0000-0000-0000000000d1';
  r := post_purchase_return(jsonb_build_object('idempotencyKey', 'abababab-0000-0000-0000-000000000001', 'storeId', '00000000-0000-0000-0000-0000000000a1',
        'distributorId', '00000000-0000-0000-0000-0000000000d1', 'reason', 'expiry', 'lines', jsonb_build_array(jsonb_build_object('batchId', v_batch, 'qtyBase', 4))));
  assert r->>'debitNoteNo' = 'BLRDN/26-27/0001', r::text;
  assert (r->>'valuePaise')::bigint = 80000 and (r->>'taxPaise')::bigint = 14400, 'debit note value/tax: ' || r::text;
  assert (select qty_on_hand from batches where id = v_batch) = 0, 'stock not reduced';
  assert (select due_paise from v_supplier_balances where distributor_id = '00000000-0000-0000-0000-0000000000d1') = v_due0 - 94400, 'payable not reduced';
  begin
    perform post_purchase_return(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', '00000000-0000-0000-0000-0000000000a1',
      'distributorId', '00000000-0000-0000-0000-0000000000d1', 'reason', 'expiry', 'lines', jsonb_build_array(jsonb_build_object('batchId', v_batch, 'qtyBase', 1))));
    raise exception 'expected empty-batch block';
  exception when check_violation then null; end;
end $$;

-- UC-INV-04: pharmacist requests, nothing moves; owner approves → stock & STOCK_ADJ posted; reject path
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
do $$ declare r jsonb; v_q0 int; v_batch uuid; begin
  select id, qty_on_hand into v_batch, v_q0 from batches where batch_no = 'IM101';
  r := request_stock_adjustment(jsonb_build_object('storeId', '00000000-0000-0000-0000-0000000000a1', 'reason', 'breakage', 'note', '2 tabs crushed',
        'lines', jsonb_build_array(jsonb_build_object('batchId', v_batch, 'qtyDelta', -2))));
  assert r->>'status' = 'pending', r::text;
  assert (select qty_on_hand from batches where id = v_batch) = v_q0, 'pending adjustment moved stock';
  perform set_config('t.adj', r->>'adjustmentId', false);
  begin perform decide_stock_adjustment((r->>'adjustmentId')::uuid, true); raise exception 'expected pharmacist approval denied';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare r jsonb; v_q0 int; v_adj0 bigint; begin
  select qty_on_hand into v_q0 from batches where batch_no = 'IM101';
  select coalesce(sum(debit_paise), 0) into v_adj0 from v_trial_balance where code = 'STOCK_ADJ';
  r := decide_stock_adjustment(current_setting('t.adj')::uuid, true, 'ok');
  assert (select qty_on_hand from batches where batch_no = 'IM101') = v_q0 - 2, 'approved adjustment not applied';
  assert (select debit_paise from v_trial_balance where code = 'STOCK_ADJ') = v_adj0 + 50000, 'STOCK_ADJ not debited';
  assert (select adj_no from stock_adjustments where id = current_setting('t.adj')::uuid) like 'BLRSA/26-27/%';
  begin perform decide_stock_adjustment(current_setting('t.adj')::uuid, false); raise exception 'expected double decision block';
  exception when check_violation then null; end;
  -- owner's own adjustment posts immediately; a gain credits STOCK_ADJ
  r := request_stock_adjustment(jsonb_build_object('storeId', '00000000-0000-0000-0000-0000000000a1', 'reason', 'found',
        'lines', jsonb_build_array(jsonb_build_object('batchId', (select id from batches where batch_no = 'IM101'), 'qtyDelta', 1))));
  assert r->>'status' = 'approved';
  -- cannot remove more than on hand
  begin
    perform request_stock_adjustment(jsonb_build_object('storeId', '00000000-0000-0000-0000-0000000000a1', 'reason', 'theft',
      'lines', jsonb_build_array(jsonb_build_object('batchId', (select id from batches where batch_no = 'IM101'), 'qtyDelta', -9999))));
    raise exception 'expected negative stock block';
  exception when check_violation then null; end;
end $$;

-- UC-INV-07: recall quarantines matching batches and lists who bought them; release needs owner/admin
do $$ declare r jsonb; imp jsonb; begin
  r := create_recall('00000000-0000-0000-0000-000000000001', '{"productName":"Azithral","batchNo":"az1123","reason":"CDSCO NSQ alert — dissolution failure","source":"CDSCO NSQ Nov-2026"}');
  assert (r->>'quarantined')::int = 1, r::text;
  assert (select status from batches where batch_no = 'AZ1123') = 'recalled';
  imp := recall_impact((r->>'recallId')::uuid);
  assert jsonb_array_length(imp->'buyers') >= 1 and imp->'buyers'->0->>'phone' = '9800000001', 'buyers: ' || imp::text;
  assert jsonb_array_length((pos_catalogue('00000000-0000-0000-0000-0000000000a1', 'azithral'))->0->'batches') = 1
     and (pos_catalogue('00000000-0000-0000-0000-0000000000a1', 'azithral'))->0->'batches'->0->>'status' = 'recalled', 'POS should see recalled status';
end $$;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
do $$ begin
  perform set_batch_status((select id from batches where batch_no = 'AZ1123'), 'active', 'false alarm');
  raise exception 'expected pharmacist release denied';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  perform set_batch_status((select id from batches where batch_no = 'AZ1123'), 'active', 'Manufacturer withdrew the alert');
  assert (select status from batches where batch_no = 'AZ1123') = 'active';
end $$;

-- accounting invariant after returns, cancellation, debit note and adjustments
do $$ begin
  assert (select sum(balance_paise) from v_trial_balance) = 0, 'trial balance not zero';
end $$;
reset role;

select 'SPRINT 3 DATABASE TESTS PASSED' as result;
