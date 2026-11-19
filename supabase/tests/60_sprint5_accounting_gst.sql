-- Sprint 5 tests: ledgers & vouchers, reversal, period lock on every posting path, trial balance / P&L / balance sheet tie-out,
-- margin vs books, GSTR-1 section totals, GSTR-3B vs books, composition summary, Tally data, role & tenant isolation.
-- Runs after 10–50 on the demo org (owner 1111…, pharmacist 6666…, other-org owner 2222…).
\set ON_ERROR_STOP on
set client_min_messages = warning;
set timezone = 'Asia/Kolkata';  -- current_date = the IST business date used by the posting functions

-- fixtures (as superuser): accountant, billing staff, a B2B clinic customer, a composition store
insert into memberships (user_id, org_id, role) values
 ('77777777-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000001', 'accountant'),
 ('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-000000000001', 'billing');
insert into customers (id, org_id, name, phone, address, gstin) values
 ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001', 'Sunrise Clinic', '9800000002', 'HAL Road, Bengaluru', '29AABCS1429B1ZB');
insert into stores (id, org_id, code, name, gstin, gst_scheme, state_code, address, pincode) values
 ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'CMP1', 'MedStar Composition', '29AAAFM1234C2Z4', 'composition', '29', 'Jayanagar, Bengaluru', '560041');

set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);

do $$
declare
  st uuid := '00000000-0000-0000-0000-0000000000a1'; o uuid := '00000000-0000-0000-0000-000000000001';
  r jsonb; k uuid := gen_random_uuid();
begin
  -- UC-ACC-01: custom ledger
  r := create_account(o, 'Shop rent deposit', 'current_asset');
  assert (select type from accounts where id = (r->>'accountId')::uuid) = 'asset', 'custom ledger type';
  begin perform create_account(o, 'Shop rent deposit', 'current_asset'); raise exception 'expected duplicate ledger';
  exception when unique_violation then null; end;
  begin perform create_account(o, 'My debtors', 'debtors'); raise exception 'expected debtors group refused';
  exception when check_violation then null; end;

  -- opening bank balance (journal), expense with input GST, rent payment, other income, card settlement (contra)
  perform post_voucher(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', st, 'kind', 'journal', 'date', current_date,
    'narration', 'Opening bank balance', 'lines', jsonb_build_array(
      jsonb_build_object('accountId', acct(o, 'BANK'), 'debitPaise', 5000000), jsonb_build_object('accountId', acct(o, 'OPENING_BAL'), 'creditPaise', 5000000))));
  r := post_voucher(jsonb_build_object('idempotencyKey', k, 'storeId', st, 'kind', 'expense', 'date', current_date,
    'narration', 'AC servicing', 'reference', 'INV-778', 'lines', jsonb_build_array(
      jsonb_build_object('accountId', acct(o, 'REPAIRS'), 'debitPaise', 10000), jsonb_build_object('accountId', acct(o, 'IN_CGST'), 'debitPaise', 900),
      jsonb_build_object('accountId', acct(o, 'IN_SGST'), 'debitPaise', 900), jsonb_build_object('accountId', acct(o, 'CASH'), 'creditPaise', 11800))));
  assert r->>'voucherNo' like 'BLREV/%', 'expense series: ' || r::text;
  assert (post_voucher(jsonb_build_object('idempotencyKey', k, 'storeId', st, 'kind', 'expense', 'date', current_date, 'narration', 'AC servicing',
    'lines', '[]'::jsonb))->>'duplicate')::boolean, 'idempotent repost';
  r := post_voucher(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', st, 'kind', 'payment', 'date', current_date,
    'narration', 'November rent', 'lines', jsonb_build_array(
      jsonb_build_object('accountId', acct(o, 'RENT'), 'debitPaise', 2500000), jsonb_build_object('accountId', acct(o, 'BANK'), 'creditPaise', 2500000))));
  perform set_config('t.rent', r->>'voucherId', false);
  perform post_voucher(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', st, 'kind', 'receipt', 'date', current_date,
    'narration', 'Display rack rental from distributor', 'lines', jsonb_build_array(
      jsonb_build_object('accountId', acct(o, 'BANK'), 'debitPaise', 300000), jsonb_build_object('accountId', acct(o, 'OTHER_INC'), 'creditPaise', 300000))));
  perform post_voucher(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', st, 'kind', 'contra', 'date', current_date,
    'narration', 'Card settlement with MDR', 'lines', jsonb_build_array(
      jsonb_build_object('accountId', acct(o, 'BANK'), 'debitPaise', 9800), jsonb_build_object('accountId', acct(o, 'BANK_CHG'), 'debitPaise', 200),
      jsonb_build_object('accountId', acct(o, 'CARD_CLR'), 'creditPaise', 10000))));
  -- udhaar collected by bank transfer (receipt against a customer)
  perform post_voucher(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', st, 'kind', 'receipt', 'date', current_date,
    'narration', 'NEFT from Meena', 'lines', jsonb_build_array(
      jsonb_build_object('accountId', acct(o, 'BANK'), 'debitPaise', 500),
      jsonb_build_object('accountId', acct(o, 'DEBTORS'), 'creditPaise', 500, 'partyId', '00000000-0000-0000-0000-0000000000c1'))));
end $$;

-- validation failures
do $$
declare st uuid := '00000000-0000-0000-0000-0000000000a1'; o uuid := '00000000-0000-0000-0000-000000000001'; bad jsonb; msg text;
begin
  foreach bad in array array[
    -- unbalanced
    jsonb_build_object('kind', 'journal', 'lines', jsonb_build_array(jsonb_build_object('accountId', acct(o, 'RENT'), 'debitPaise', 100), jsonb_build_object('accountId', acct(o, 'CAPITAL'), 'creditPaise', 90))),
    -- payment that doesn't touch cash/bank
    jsonb_build_object('kind', 'payment', 'lines', jsonb_build_array(jsonb_build_object('accountId', acct(o, 'RENT'), 'debitPaise', 100), jsonb_build_object('accountId', acct(o, 'CAPITAL'), 'creditPaise', 100))),
    -- stock is automatic
    jsonb_build_object('kind', 'journal', 'lines', jsonb_build_array(jsonb_build_object('accountId', acct(o, 'INVENTORY'), 'debitPaise', 100), jsonb_build_object('accountId', acct(o, 'CAPITAL'), 'creditPaise', 100))),
    -- debtor without party
    jsonb_build_object('kind', 'receipt', 'lines', jsonb_build_array(jsonb_build_object('accountId', acct(o, 'CASH'), 'debitPaise', 100), jsonb_build_object('accountId', acct(o, 'DEBTORS'), 'creditPaise', 100))),
    -- contra with a non-bank credit
    jsonb_build_object('kind', 'contra', 'lines', jsonb_build_array(jsonb_build_object('accountId', acct(o, 'BANK'), 'debitPaise', 100), jsonb_build_object('accountId', acct(o, 'SALES'), 'creditPaise', 100))),
    -- line with both sides
    jsonb_build_object('kind', 'journal', 'lines', jsonb_build_array(jsonb_build_object('accountId', acct(o, 'RENT'), 'debitPaise', 100, 'creditPaise', 100), jsonb_build_object('accountId', acct(o, 'CAPITAL'), 'creditPaise', 0))),
    -- future date
    jsonb_build_object('kind', 'journal', 'date', current_date + 30, 'lines', jsonb_build_array(jsonb_build_object('accountId', acct(o, 'RENT'), 'debitPaise', 100), jsonb_build_object('accountId', acct(o, 'CAPITAL'), 'creditPaise', 100)))
  ] loop
    begin
      perform post_voucher(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', st, 'date', current_date, 'narration', 'should fail') || bad);
      raise exception 'expected rejection for %', bad;
    exception when check_violation then null;
    end;
  end loop;
end $$;

-- billing staff can't post vouchers or add ledgers
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
do $$ begin
  perform create_account('00000000-0000-0000-0000-000000000001', 'Sneaky', 'indirect_exp'); raise exception 'expected ledger denied';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform post_voucher(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', '00000000-0000-0000-0000-0000000000a1', 'kind', 'payment',
    'date', current_date, 'narration', 'cash out', 'lines', '[]'::jsonb));
  raise exception 'expected voucher denied';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into accounts (org_id, code, name, type) values ('00000000-0000-0000-0000-000000000001', 'X1', 'direct insert', 'expense');
  raise exception 'expected direct insert denied';
exception when insufficient_privilege then null; end $$;

-- reversal (accountant)
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
do $$ declare r jsonb; v_rent bigint; begin
  r := reverse_voucher(current_setting('t.rent')::uuid, 'Paid twice by mistake');
  assert (select status from vouchers where id = current_setting('t.rent')::uuid) = 'reversed', 'not marked reversed';
  select coalesce(sum(debit_paise - credit_paise), 0) into v_rent from journal_lines where account_id = acct('00000000-0000-0000-0000-000000000001', 'RENT');
  assert v_rent = 0, 'rent not reversed: ' || v_rent;
  begin perform reverse_voucher(current_setting('t.rent')::uuid, 'again please'); raise exception 'expected double reversal block';
  exception when check_violation then null; end;
  begin perform reverse_voucher((r->>'voucherId')::uuid, 'reverse the reversal'); raise exception 'expected reversal-of-reversal block';
  exception when check_violation then null; end;
end $$;

-- B2B sale with a credit note (owner bills at the counter)
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare r jsonb; v_line bigint; begin
  r := post_sale(jsonb_build_object('billUuid', 'bbbbbbbb-0000-0000-0000-000000000060', 'storeId', '00000000-0000-0000-0000-0000000000a1', 'deviceCode', 'POS1',
       'billedAt', now(), 'customerId', '00000000-0000-0000-0000-0000000000c2',
       'lines', jsonb_build_array(jsonb_build_object('productId', '00000000-0000-0000-0000-00000000b001', 'qtyBase', 30)),
       'payments', jsonb_build_array(jsonb_build_object('mode', 'upi', 'amountPaise', 6200))));
  perform set_config('t.b2b', r->>'invoiceNo', false);
  select id into v_line from sales_bill_lines where bill_id = (r->>'billId')::uuid order by id limit 1;
  perform post_sales_return(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'billId', (r->>'billId')::uuid, 'reason', 'Excess supplied',
    'refundMode', 'upi', 'lines', jsonb_build_array(jsonb_build_object('billLineId', v_line, 'qtyBase', 15))));
end $$;

-- books tie out
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
do $$
declare o uuid := '00000000-0000-0000-0000-000000000001'; st uuid := '00000000-0000-0000-0000-0000000000a1';
  tb jsonb; pl jsonb; bs jsonb; lg jsonb; m jsonb; fy date := fy_start(current_date); v bigint;
begin
  tb := trial_balance(o, fy, current_date);
  assert (select sum((x->>'closing')::bigint) from jsonb_array_elements(tb) x) = 0, 'TB closing not zero: ' || tb::text;
  assert (select sum((x->>'opening')::bigint) from jsonb_array_elements(tb) x) = 0, 'TB opening not zero';
  assert (select (x->>'closing')::bigint from jsonb_array_elements(tb) x where x->>'code' = 'REPAIRS') = 10000, 'repairs in TB';
  -- mid-year window: opening balances still balance
  tb := trial_balance(o, current_date, current_date);
  assert (select sum((x->>'opening')::bigint) from jsonb_array_elements(tb) x) = 0, 'TB (today) opening not zero';
  assert (select sum((x->>'closing')::bigint) from jsonb_array_elements(tb) x) = 0, 'TB (today) closing not zero';

  pl := profit_and_loss(o, fy, current_date);
  select -sum((x->>'closing')::bigint) into v from jsonb_array_elements(trial_balance(o, fy, current_date)) x where x->>'type' in ('income','expense');
  assert (pl->>'netProfit')::bigint = v, 'P&L ' || (pl->>'netProfit') || ' vs TB ' || v;
  assert (pl->>'grossProfit')::bigint = (pl->>'netSales')::bigint - (pl->>'directCosts')::bigint, 'gross profit';
  assert exists (select 1 from jsonb_array_elements(pl->'otherIncome') x where x->>'code' = 'OTHER_INC' and (x->>'amount')::bigint = 300000), 'other income';

  bs := balance_sheet(o, current_date);
  assert (bs->>'totalAssets')::bigint = (bs->>'totalLiabilitiesEquity')::bigint, 'balance sheet does not balance: ' || bs::text;
  assert (bs->>'profitCurrentYear')::bigint = (pl->>'netProfit')::bigint, 'BS profit vs P&L';

  lg := ledger_report(acct(o, 'BANK'), fy, current_date);
  assert (lg->>'closing')::bigint = (select sum(jl.debit_paise - jl.credit_paise) from journal_lines jl join journal_entries je on je.id = jl.entry_id
    where jl.account_id = acct(o, 'BANK') and je.entry_date <= current_date), 'bank closing: ' || (lg->>'closing');
  assert (select count(*) from jsonb_array_elements(lg->'rows') x where x->>'source' = 'voucher') = 6, 'bank voucher rows';
  assert (lg->'rows'->-1->>'balance')::bigint = (lg->>'closing')::bigint, 'running balance';
  assert (lg->>'opening')::bigint + (lg->>'debit')::bigint - (lg->>'credit')::bigint = (lg->>'closing')::bigint, 'ledger arithmetic';
  lg := ledger_report(acct(o, 'DEBTORS'), '2000-01-01', current_date, null, '00000000-0000-0000-0000-0000000000c1');
  assert (lg->>'closing')::bigint = (select outstanding_paise from v_customer_balances where customer_id = '00000000-0000-0000-0000-0000000000c1'), 'party ledger vs balance';

  -- margin (documents) = net sales (books), whole history of the store
  m := margin_report(st, '2000-01-01', current_date, 'category');
  pl := profit_and_loss(o, '2000-01-01', current_date, st);
  assert (m->>'sales')::bigint = (pl->>'netSales')::bigint, 'margin sales ' || (m->>'sales') || ' vs books ' || (pl->>'netSales');
end $$;

-- GSTR-1 & GSTR-3B
do $$
declare st uuid := '00000000-0000-0000-0000-0000000000a1'; g jsonb; b jsonb; t bigint; ob bigint;
begin
  g := gstr1(st, '2000-01-01', current_date);
  assert exists (select 1 from jsonb_array_elements(g->'b2b') x where x->>'doc_no' = current_setting('t.b2b') and x->>'ctin' = '29AABCS1429B1ZB'), 'B2B invoice missing';
  assert jsonb_array_length(g->'cdnr') = 1 and (g->'cdnr'->0->>'orig_no') = current_setting('t.b2b'), 'CDNR: ' || (g->'cdnr')::text;
  select coalesce(sum((x->>'txval')::bigint), 0) into t from jsonb_array_elements(g->'b2b') x;
  t := t + coalesce((select sum((x->>'txval')::bigint) from jsonb_array_elements(g->'b2cs') x), 0)
         - coalesce((select sum((x->>'txval')::bigint) from jsonb_array_elements(g->'cdnr') x), 0)
         + (g->'nil'->>'b2b')::bigint + (g->'nil'->>'b2c')::bigint;
  assert t = (g->'totals'->>'txval')::bigint, 'sections ' || t || ' vs total ' || (g->'totals'->>'txval');
  assert (select sum((x->>'txval')::bigint) from jsonb_array_elements(g->'hsn') x) = (g->'totals'->>'txval')::bigint, 'HSN total';
  assert exists (select 1 from jsonb_array_elements(g->'docs') x where x->>'kind' = 'INV' and (x->>'cancelled')::int >= 1), 'cancelled bills in doc summary';
  assert exists (select 1 from jsonb_array_elements(g->'docs') x where x->>'kind' = 'CN'), 'credit notes in doc summary';

  b := gstr3b(st, '2000-01-01', current_date);
  assert (b->'outwardTaxable'->>'camt') = (b->'booksOutputTax'->>'camt') and (b->'outwardTaxable'->>'samt') = (b->'booksOutputTax'->>'samt'),
    'return vs books: ' || b::text;
  assert (b->'outwardTaxable'->>'camt')::bigint = (g->'totals'->>'camt')::bigint, '3B vs GSTR-1 CGST';
  select sum(debit_paise - credit_paise) into ob from journal_lines jl join journal_entries je on je.id = jl.entry_id
    where je.store_id = st and jl.account_id = acct('00000000-0000-0000-0000-000000000001', 'IN_CGST');
  assert (b->'itc'->>'camt')::bigint = ob, 'ITC vs books';
  assert (b->'itcBySource'->>'voucher')::bigint = 1800, 'ITC from expense voucher: ' || (b->'itcBySource')::text;
end $$;

-- composition: GSTR-1 / 3B refused; CMP-08 math
do $$ declare c jsonb; begin
  begin perform gstr1('00000000-0000-0000-0000-0000000000a2', '2026-04-01', current_date); raise exception 'expected composition refusal';
  exception when check_violation then null; end;
  c := composition_summary('00000000-0000-0000-0000-0000000000a1', '2000-01-01', current_date);
  assert (c->>'taxableTurnover')::bigint <= (c->>'turnover')::bigint, 'taxable <= turnover';
  assert (c->>'cgst')::bigint = round((c->>'taxableTurnover')::bigint * 0.005), 'CMP-08 CGST at 0.5%';
  assert (composition_summary('00000000-0000-0000-0000-0000000000a2', '2026-04-01', current_date)->>'turnover')::bigint = 0, 'empty composition store';
end $$;

-- Tally data: every exported voucher balances
do $$ declare e jsonb; begin
  e := tally_export('00000000-0000-0000-0000-000000000001', '2000-01-01', current_date);
  assert jsonb_array_length(e) > 10, 'tally entries';
  assert not exists (select 1 from jsonb_array_elements(e) x
    where (select sum((l->>'debit')::bigint - (l->>'credit')::bigint) from jsonb_array_elements(x->'lines') l) <> 0), 'unbalanced tally voucher';
  assert exists (select 1 from jsonb_array_elements(e) x, jsonb_array_elements(x->'lines') l where l->>'ledger' = 'Meena (9800000001)'), 'party ledger name';
end $$;

-- UC-ACC-07: period lock
do $$ begin
  perform set_period_lock('00000000-0000-0000-0000-000000000001', current_date - 1, null); raise exception 'expected accountant lock denied';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  begin perform set_period_lock('00000000-0000-0000-0000-000000000001', current_date + 5, null); raise exception 'expected future lock refused';
  exception when check_violation then null; end;
  perform set_period_lock('00000000-0000-0000-0000-000000000001', current_date - 1, 'October closed');
  -- a back-dated bill (e.g. an offline bill synced late) can't land in the locked period
  begin
    perform post_sale(jsonb_build_object('billUuid', 'bbbbbbbb-0000-0000-0000-000000000061', 'storeId', '00000000-0000-0000-0000-0000000000a1', 'deviceCode', 'POS1',
       'billedAt', ((current_date - 2) + time '12:00')::timestamptz, 'lines', jsonb_build_array(jsonb_build_object('productId', '00000000-0000-0000-0000-00000000b001', 'qtyBase', 15)),
       'payments', jsonb_build_array(jsonb_build_object('mode', 'cash', 'amountPaise', 3100))));
    raise exception 'expected locked sale refused';
  exception when others then if sqlerrm not like '%locked%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
do $$ declare o uuid := '00000000-0000-0000-0000-000000000001'; begin
  begin
    perform post_voucher(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', '00000000-0000-0000-0000-0000000000a1', 'kind', 'payment',
      'date', current_date - 1, 'narration', 'late entry', 'lines', jsonb_build_array(
        jsonb_build_object('accountId', acct(o, 'MISC_EXP'), 'debitPaise', 100), jsonb_build_object('accountId', acct(o, 'CASH'), 'creditPaise', 100))));
    raise exception 'expected locked voucher refused';
  exception when check_violation then if sqlerrm not like 'Books are locked%' then raise; end if; end;
  -- today is open
  perform post_voucher(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', '00000000-0000-0000-0000-0000000000a1', 'kind', 'payment',
    'date', current_date, 'narration', 'today entry', 'lines', jsonb_build_array(
      jsonb_build_object('accountId', acct(o, 'MISC_EXP'), 'debitPaise', 100), jsonb_build_object('accountId', acct(o, 'CASH'), 'creditPaise', 100))));
  begin perform set_period_lock(o, null, 'reopen please'); raise exception 'expected accountant unlock denied';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  begin perform set_period_lock('00000000-0000-0000-0000-000000000001', null, null); raise exception 'expected reason required';
  exception when check_violation then null; end;
  perform set_period_lock('00000000-0000-0000-0000-000000000001', null, 'CA asked to correct a purchase entry');
  assert not exists (select 1 from period_locks where org_id = '00000000-0000-0000-0000-000000000001'), 'lock not removed';
  assert (select count(*) from period_lock_history where org_id = '00000000-0000-0000-0000-000000000001') = 2, 'lock history';
  assert exists (select 1 from audit_log where action = 'period_unlock'), 'unlock audited';
end $$;

-- tenant isolation: the other pharmacy sees none of these books
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  assert (select count(*) from vouchers) = 0, 'vouchers leak';
  assert jsonb_array_length(trial_balance('00000000-0000-0000-0000-000000000001', '2000-01-01', current_date)) = 0, 'trial balance leak';
  assert jsonb_array_length(tally_export('00000000-0000-0000-0000-000000000001', '2000-01-01', current_date)) = 0, 'tally leak';
  begin perform set_period_lock('00000000-0000-0000-0000-000000000001', current_date - 1, null); raise exception 'expected foreign lock denied';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'SPRINT 5 DATABASE TESTS PASSED' as result;
