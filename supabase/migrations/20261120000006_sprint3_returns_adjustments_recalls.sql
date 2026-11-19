-- Sprint 3: sales returns & credit notes (UC-POS-10), same-day bill cancellation (UC-POS-11),
-- purchase / expiry returns & debit notes (UC-PUR-07), stock adjustments with approval (UC-INV-04),
-- recalls with customer trace (UC-INV-07, UC-CMP-07). Everything posts stock, registers and a balanced journal atomically.

-- ───────────────────────── accounts ─────────────────────────
create or replace function seed_chart_of_accounts(p_org uuid) returns void
language sql security definer set search_path = public as $$
  insert into accounts (org_id, code, name, type) values
   (p_org,'CASH','Cash in hand','asset'), (p_org,'UPI_CLR','UPI clearing','asset'), (p_org,'CARD_CLR','Card clearing','asset'),
   (p_org,'WALLET_CLR','Wallet clearing','asset'), (p_org,'BANK','Bank','asset'), (p_org,'DEBTORS','Sundry debtors','asset'),
   (p_org,'INVENTORY','Stock in trade','asset'), (p_org,'IN_CGST','Input CGST','asset'), (p_org,'IN_SGST','Input SGST','asset'),
   (p_org,'IN_IGST','Input IGST','asset'), (p_org,'CREDITORS','Sundry creditors','liability'),
   (p_org,'OUT_CGST','Output CGST','liability'), (p_org,'OUT_SGST','Output SGST','liability'), (p_org,'OUT_IGST','Output IGST','liability'),
   (p_org,'CAPITAL','Capital','equity'), (p_org,'OPENING_BAL','Opening balances','equity'),
   (p_org,'SALES','Sales','income'), (p_org,'SALES_RET','Sales returns','income'),
   (p_org,'ROUND_OFF','Round off','expense'), (p_org,'COGS','Cost of goods sold','expense'),
   (p_org,'EXPIRY_LOSS','Expiry & breakage loss','expense'), (p_org,'STOCK_ADJ','Stock adjustments (shortage / excess)','expense'),
   (p_org,'DISC_RECD','Discount received','income')
  on conflict do nothing
$$;
select seed_chart_of_accounts(id) from orgs;

-- ───────────────────────── tables ─────────────────────────
create table sales_returns (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  org_id uuid not null,
  store_id uuid not null references stores(id),
  bill_id uuid not null references sales_bills(id),
  credit_note_no text not null,
  returned_at timestamptz not null default now(),
  reason text not null,
  refund_mode text not null check (refund_mode in ('cash','upi','card','account')),
  taxable_paise bigint not null default 0, cgst_paise bigint not null default 0, sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0, round_off_paise bigint not null default 0, total_paise bigint not null default 0,
  created_by uuid,
  unique (store_id, credit_note_no)
);

create table sales_return_lines (
  id bigserial primary key,
  return_id uuid not null references sales_returns(id),
  org_id uuid not null,
  bill_line_id bigint not null references sales_bill_lines(id),
  product_id uuid not null references products(id),
  batch_id uuid not null references batches(id),
  qty_base int not null check (qty_base > 0),
  restocked boolean not null,
  amount_paise bigint not null, taxable_paise bigint not null, cgst_paise bigint not null, sgst_paise bigint not null,
  igst_paise bigint not null, cost_paise bigint not null
);
create index sales_return_lines_bill_line on sales_return_lines(bill_line_id);

create table purchase_returns (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  org_id uuid not null,
  store_id uuid not null references stores(id),
  distributor_id uuid not null references distributors(id),
  debit_note_no text not null,
  return_date date not null,
  reason text not null check (reason in ('expiry','near_expiry','breakage','damaged','excess','recall','other')),
  note text,
  inter_state boolean not null,
  value_paise bigint not null default 0, cgst_paise bigint not null default 0, sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0, total_paise bigint not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (store_id, debit_note_no)
);

create table purchase_return_lines (
  id bigserial primary key,
  return_id uuid not null references purchase_returns(id),
  org_id uuid not null,
  batch_id uuid not null references batches(id),
  product_id uuid not null references products(id),
  qty_base int not null check (qty_base > 0),
  value_paise bigint not null,
  gst_rate numeric(5,2) not null,
  tax_paise bigint not null
);

create table stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  store_id uuid not null references stores(id),
  adj_no text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason text not null check (reason in ('damage','breakage','theft','audit_difference','expired_destroyed','found','other')),
  note text,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  value_paise bigint not null default 0
);

create table stock_adjustment_lines (
  id bigserial primary key,
  adjustment_id uuid not null references stock_adjustments(id),
  org_id uuid not null,
  batch_id uuid not null references batches(id),
  product_id uuid not null references products(id),
  qty_delta int not null check (qty_delta <> 0),
  cost_paise bigint not null default 0
);

do $$
declare t text;
begin
  foreach t in array array['sales_returns','sales_return_lines','purchase_returns','purchase_return_lines','stock_adjustments','stock_adjustment_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (is_member(org_id))', t || '_read', t);
    execute format('revoke insert, update, delete on %I from authenticated, anon', t);
  end loop;
end $$;
create trigger sales_return_lines_ro before update or delete on sales_return_lines for each row execute function forbid_mutation();
create trigger purchase_return_lines_ro before update or delete on purchase_return_lines for each row execute function forbid_mutation();


-- refund / payment account by mode
create or replace function _refund_account(p_org uuid, p_mode text) returns uuid language sql stable as $$
  select acct(p_org, case p_mode when 'cash' then 'CASH' when 'upi' then 'UPI_CLR' when 'card' then 'CARD_CLR' when 'account' then 'DEBTORS' end)
$$;

-- ───────────────────────── sales return / credit note ─────────────────────────
-- p: { idempotencyKey, billId, reason, refundMode: cash|upi|card|account, returnedAt?, lines:[{billLineId, qtyBase, restock?}] }
create or replace function post_sales_return(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b sales_bills%rowtype; s stores%rowtype; v_id uuid := gen_random_uuid(); v_no text; v_existing uuid;
  v_at timestamptz := coalesce((p->>'returnedAt')::timestamptz, now()); v_date date; v_mode text := p->>'refundMode';
  l jsonb; ol sales_bill_lines%rowtype; pr products%rowtype; done record; q int; v_remaining int; v_restock boolean;
  a bigint; tx bigint; cg bigint; sg bigint; ig bigint; c bigint; t record; v_comp boolean;
  s_amt bigint := 0; s_tax bigint := 0; s_cg bigint := 0; s_sg bigint := 0; s_ig bigint := 0; s_cost bigint := 0;
  v_total bigint; v_round bigint; v_je uuid; v_acct uuid; v_n int := 0;
begin
  v_date := (v_at at time zone 'Asia/Kolkata')::date;
  select id into v_existing from sales_returns where idempotency_key = (p->>'idempotencyKey')::uuid;
  if found then return jsonb_build_object('returnId', v_existing, 'duplicate', true); end if;

  select * into b from sales_bills where id = (p->>'billId')::uuid for update;
  if not found then raise exception 'Bill not found'; end if;
  select * into s from stores where id = b.store_id;
  if not has_store_access(s.id) or not has_role(s.org_id, array['owner','admin','pharmacist','billing']::member_role[]) then
    raise exception 'Not allowed to take returns at this store' using errcode = 'insufficient_privilege';
  end if;
  if b.status <> 'posted' then raise exception 'Bill % is cancelled', b.invoice_no using errcode = 'check_violation'; end if;
  if coalesce(trim(p->>'reason'), '') = '' then raise exception 'A return reason is required' using errcode = 'check_violation'; end if;
  if v_mode not in ('cash','upi','card','account') then raise exception 'Refund mode must be cash, upi, card or account'; end if;
  if v_mode = 'account' and b.customer_id is null then raise exception 'Refund to account needs a customer on the bill' using errcode = 'check_violation'; end if;
  if exists (select 1 from period_locks where org_id = s.org_id and locked_until >= v_date) then raise exception 'Period locked'; end if;
  v_comp := b.document_type = 'BILL_OF_SUPPLY';

  v_no := next_invoice_no(s.id, 'CN', v_date);
  insert into sales_returns (id, idempotency_key, org_id, store_id, bill_id, credit_note_no, returned_at, reason, refund_mode, created_by)
  values (v_id, (p->>'idempotencyKey')::uuid, s.org_id, s.id, b.id, v_no, v_at, trim(p->>'reason'), v_mode, auth.uid());

  for l in select * from jsonb_array_elements(p->'lines') loop
    q := (l->>'qtyBase')::int;
    if q is null or q <= 0 then continue; end if;
    select * into ol from sales_bill_lines where id = (l->>'billLineId')::bigint and bill_id = b.id;
    if not found then raise exception 'Line % is not on bill %', l->>'billLineId', b.invoice_no; end if;
    select * into pr from products where id = ol.product_id;
    select coalesce(sum(qty_base),0) qty, coalesce(sum(amount_paise),0) amt, coalesce(sum(taxable_paise),0) tax, coalesce(sum(cgst_paise),0) cg,
           coalesce(sum(sgst_paise),0) sg, coalesce(sum(igst_paise),0) ig, coalesce(sum(cost_paise),0) cost
      into done from sales_return_lines where bill_line_id = ol.id;
    v_remaining := ol.qty_base - done.qty;
    if q > v_remaining then raise exception 'Only % unit(s) of % left to return on %', v_remaining, pr.name, b.invoice_no using errcode = 'check_violation'; end if;
    if q = v_remaining then
      a := ol.amount_paise - done.amt; tx := ol.taxable_paise - done.tax; cg := ol.cgst_paise - done.cg; sg := ol.sgst_paise - done.sg;
      ig := ol.igst_paise - done.ig; c := ol.cost_paise - done.cost;
    else
      a := round(ol.amount_paise * q::numeric / ol.qty_base);
      select * into t from _line_tax(a, ol.gst_rate, case when v_comp then 'composition' else 'regular' end::gst_scheme, false);
      tx := t.taxable; cg := t.cgst; sg := t.sgst; ig := t.igst;
      c := round(ol.cost_paise * q::numeric / ol.qty_base);
    end if;
    -- cold-chain items can never go back on the shelf (temperature history unknown)
    v_restock := coalesce((l->>'restock')::boolean, true) and not pr.cold_chain;
    insert into sales_return_lines (return_id, org_id, bill_line_id, product_id, batch_id, qty_base, restocked, amount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, cost_paise)
    values (v_id, s.org_id, ol.id, ol.product_id, ol.batch_id, q, v_restock, a, tx, cg, sg, ig, c);
    if v_restock then
      update batches set qty_on_hand = qty_on_hand + q where id = ol.batch_id;
      insert into stock_ledger (org_id, store_id, batch_id, product_id, doc_type, doc_id, qty_delta, created_by)
      values (s.org_id, s.id, ol.batch_id, ol.product_id, 'sale_return', v_id, q, auth.uid());
      s_cost := s_cost + c;
    end if;
    if ol.schedule in ('H1','X','NDPS') then
      insert into schedule_register (org_id, store_id, schedule, entry_date, bill_id, invoice_no, patient_name, patient_address,
        prescriber_name, prescriber_reg_no, prescriber_address, product_id, product_name, batch_no, qty_base, pharmacist_id, prescription_id)
      select org_id, store_id, schedule, v_date, bill_id, v_no, patient_name, patient_address, prescriber_name, prescriber_reg_no,
             prescriber_address, product_id, product_name, batch_no, -q, pharmacist_id, prescription_id
      from schedule_register where bill_id = b.id and product_id = ol.product_id and qty_base > 0 order by id limit 1;
    end if;
    s_amt := s_amt + a; s_tax := s_tax + tx; s_cg := s_cg + cg; s_sg := s_sg + sg; s_ig := s_ig + ig; v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Choose at least one item to return' using errcode = 'check_violation'; end if;

  v_total := round(s_amt / 100.0) * 100;
  v_round := v_total - s_amt;
  update sales_returns set taxable_paise = s_tax, cgst_paise = s_cg, sgst_paise = s_sg, igst_paise = s_ig, round_off_paise = v_round, total_paise = v_total where id = v_id;

  insert into payments (org_id, bill_id, mode, amount_paise, reference)
  values (s.org_id, b.id, case when v_mode = 'account' then 'credit' else v_mode end::pay_mode, -v_total, 'Credit note ' || v_no);

  insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
  values (s.org_id, s.id, v_date, 'sale_return', v_id, 'Credit note ' || v_no || ' against ' || b.invoice_no, auth.uid()) returning id into v_je;
  insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, s.org_id, acct(s.org_id, 'SALES_RET'), s_tax);
  if s_cg > 0 then insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, s.org_id, acct(s.org_id, 'OUT_CGST'), s_cg); end if;
  if s_sg > 0 then insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, s.org_id, acct(s.org_id, 'OUT_SGST'), s_sg); end if;
  if s_ig > 0 then insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, s.org_id, acct(s.org_id, 'OUT_IGST'), s_ig); end if;
  if v_round > 0 then insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, s.org_id, acct(s.org_id, 'ROUND_OFF'), v_round);
  elsif v_round < 0 then insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, s.org_id, acct(s.org_id, 'ROUND_OFF'), -v_round); end if;
  v_acct := _refund_account(s.org_id, v_mode);
  insert into journal_lines (entry_id, org_id, account_id, credit_paise, party_id)
  values (v_je, s.org_id, v_acct, v_total, case when v_mode = 'account' then b.customer_id end);
  if s_cost > 0 then
    insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, s.org_id, acct(s.org_id, 'INVENTORY'), s_cost);
    insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, s.org_id, acct(s.org_id, 'COGS'), s_cost);
  end if;

  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (s.org_id, auth.uid(), 'sales_return', 'sales_returns', v_id::text, jsonb_build_object('creditNote', v_no, 'bill', b.invoice_no, 'total', v_total, 'mode', v_mode));
  return jsonb_build_object('returnId', v_id, 'creditNoteNo', v_no, 'totalPaise', v_total, 'roundOffPaise', v_round, 'duplicate', false);
end $$;

-- ───────────────────────── same-day cancellation (UC-POS-11) ─────────────────────────
-- Owners/admins: any bill of today. Others: their own bill, within 30 minutes. Bills with returns cannot be cancelled.
create or replace function cancel_sale(p_bill uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b sales_bills%rowtype; s stores%rowtype; v_je uuid; v_today date := (now() at time zone 'Asia/Kolkata')::date; ln record;
begin
  select * into b from sales_bills where id = p_bill for update;
  if not found then raise exception 'Bill not found'; end if;
  select * into s from stores where id = b.store_id;
  if not has_store_access(s.id) then raise exception 'Not allowed' using errcode = 'insufficient_privilege'; end if;
  if not has_role(s.org_id, array['owner','admin']::member_role[]) then
    if not has_role(s.org_id, array['pharmacist','billing']::member_role[]) or b.created_by is distinct from auth.uid() or b.billed_at < now() - interval '30 minutes' then
      raise exception 'Only an owner/admin can cancel this bill (staff may cancel their own bill within 30 minutes)' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if b.status <> 'posted' then raise exception 'Bill is already cancelled' using errcode = 'check_violation'; end if;
  if (b.billed_at at time zone 'Asia/Kolkata')::date <> v_today then
    raise exception 'Only today''s bills can be cancelled — use a sales return (credit note) instead' using errcode = 'check_violation';
  end if;
  if exists (select 1 from sales_returns where bill_id = b.id) then raise exception 'Bill has returns — it cannot be cancelled' using errcode = 'check_violation'; end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'Give a reason (at least 5 characters)' using errcode = 'check_violation'; end if;

  update sales_bills set status = 'cancelled', review_note = coalesce(review_note || '; ', '') || 'Cancelled: ' || trim(p_reason) where id = b.id;
  for ln in select * from sales_bill_lines where bill_id = b.id loop
    update batches set qty_on_hand = qty_on_hand + ln.qty_base where id = ln.batch_id;
    insert into stock_ledger (org_id, store_id, batch_id, product_id, doc_type, doc_id, qty_delta, created_by)
    values (s.org_id, s.id, ln.batch_id, ln.product_id, 'sale_return', b.id, ln.qty_base, auth.uid());
  end loop;
  insert into schedule_register (org_id, store_id, schedule, entry_date, bill_id, invoice_no, patient_name, patient_address,
    prescriber_name, prescriber_reg_no, prescriber_address, product_id, product_name, batch_no, qty_base, pharmacist_id, prescription_id)
  select org_id, store_id, schedule, v_today, bill_id, invoice_no || ' CANCELLED', patient_name, patient_address, prescriber_name,
         prescriber_reg_no, prescriber_address, product_id, product_name, batch_no, -qty_base, pharmacist_id, prescription_id
  from schedule_register where bill_id = b.id and qty_base > 0;
  insert into payments (org_id, bill_id, mode, amount_paise, reference)
  select org_id, bill_id, mode, -amount_paise, 'Cancelled' from payments where bill_id = b.id and amount_paise > 0;

  insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
  values (s.org_id, s.id, v_today, 'sale_cancel', b.id, 'Cancellation of ' || b.invoice_no || ': ' || trim(p_reason), auth.uid()) returning id into v_je;
  insert into journal_lines (entry_id, org_id, account_id, debit_paise, credit_paise, party_id)
  select v_je, jl.org_id, jl.account_id, jl.credit_paise, jl.debit_paise, jl.party_id
  from journal_lines jl join journal_entries je on je.id = jl.entry_id
  where je.source_type = 'sale' and je.source_id = b.id;

  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (s.org_id, auth.uid(), 'cancel_sale', 'sales_bills', b.id::text, jsonb_build_object('invoiceNo', b.invoice_no, 'reason', p_reason, 'total', b.total_paise));
  return jsonb_build_object('billId', b.id, 'invoiceNo', b.invoice_no, 'status', 'cancelled');
end $$;

-- ───────────────────────── purchase / expiry return → debit note (UC-PUR-07) ─────────────────────────
-- p: { idempotencyKey, storeId, distributorId, returnDate?, reason, note?, lines:[{batchId, qtyBase}] }
-- Valued at landed cost; regular dealers reverse the input tax credit. Dr Creditors / Cr Inventory (+ Cr Input GST).
create or replace function post_purchase_return(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s stores%rowtype; d distributors%rowtype; v_id uuid := gen_random_uuid(); v_no text; v_existing uuid; v_inter boolean;
        v_date date := coalesce((p->>'returnDate')::date, (now() at time zone 'Asia/Kolkata')::date);
        l jsonb; bt batches%rowtype; q int; v_val bigint; v_rate numeric; v_tax bigint;
        s_val bigint := 0; s_tax bigint := 0; v_cg bigint; v_sg bigint; v_ig bigint; v_je uuid; v_n int := 0;
begin
  select id into v_existing from purchase_returns where idempotency_key = (p->>'idempotencyKey')::uuid;
  if found then return jsonb_build_object('returnId', v_existing, 'duplicate', true); end if;
  select * into s from stores where id = (p->>'storeId')::uuid;
  if not found or not has_store_access(s.id) or not has_role(s.org_id, array['owner','admin','purchase']::member_role[]) then
    raise exception 'Only owners, admins and purchase staff can return stock to distributors' using errcode = 'insufficient_privilege';
  end if;
  select * into d from distributors where id = (p->>'distributorId')::uuid and org_id = s.org_id;
  if not found then raise exception 'Unknown distributor'; end if;
  if exists (select 1 from period_locks where org_id = s.org_id and locked_until >= v_date) then raise exception 'Period locked'; end if;
  v_inter := d.state_code <> s.state_code;
  v_no := next_invoice_no(s.id, 'DN', v_date);
  insert into purchase_returns (id, idempotency_key, org_id, store_id, distributor_id, debit_note_no, return_date, reason, note, inter_state, created_by)
  values (v_id, (p->>'idempotencyKey')::uuid, s.org_id, s.id, d.id, v_no, v_date, p->>'reason', nullif(trim(p->>'note'), ''), v_inter, auth.uid());

  for l in select * from jsonb_array_elements(p->'lines') loop
    q := (l->>'qtyBase')::int;
    if q is null or q <= 0 then continue; end if;
    select * into bt from batches where id = (l->>'batchId')::uuid and store_id = s.id for update;
    if not found then raise exception 'Batch not found at this store'; end if;
    if q > bt.qty_on_hand then raise exception 'Only % unit(s) of batch % on hand', bt.qty_on_hand, bt.batch_no using errcode = 'check_violation'; end if;
    v_val := round(bt.cost_per_unit_paise * q);
    v_rate := case when s.gst_scheme = 'composition' then 0 else coalesce(product_gst_rate(bt.product_id, v_date), 0) end;
    v_tax := round(v_val * v_rate / 100);
    insert into purchase_return_lines (return_id, org_id, batch_id, product_id, qty_base, value_paise, gst_rate, tax_paise)
    values (v_id, s.org_id, bt.id, bt.product_id, q, v_val, v_rate, v_tax);
    update batches set qty_on_hand = qty_on_hand - q where id = bt.id;
    insert into stock_ledger (org_id, store_id, batch_id, product_id, doc_type, doc_id, qty_delta, created_by)
    values (s.org_id, s.id, bt.id, bt.product_id, 'purchase_return', v_id, -q, auth.uid());
    s_val := s_val + v_val; s_tax := s_tax + v_tax; v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Choose at least one batch to return' using errcode = 'check_violation'; end if;

  v_ig := case when v_inter then s_tax else 0 end;
  v_cg := case when v_inter then 0 else trunc(s_tax / 2.0) end;
  v_sg := s_tax - v_ig - v_cg;
  update purchase_returns set value_paise = s_val, cgst_paise = v_cg, sgst_paise = v_sg, igst_paise = v_ig, total_paise = s_val + s_tax where id = v_id;

  insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
  values (s.org_id, s.id, v_date, 'purchase_return', v_id, 'Debit note ' || v_no || ' to ' || d.name || ' (' || (p->>'reason') || ')', auth.uid()) returning id into v_je;
  insert into journal_lines (entry_id, org_id, account_id, debit_paise, party_id) values (v_je, s.org_id, acct(s.org_id, 'CREDITORS'), s_val + s_tax, d.id);
  if s_val > 0 then insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, s.org_id, acct(s.org_id, 'INVENTORY'), s_val); end if;
  if v_cg > 0 then insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, s.org_id, acct(s.org_id, 'IN_CGST'), v_cg); end if;
  if v_sg > 0 then insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, s.org_id, acct(s.org_id, 'IN_SGST'), v_sg); end if;
  if v_ig > 0 then insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, s.org_id, acct(s.org_id, 'IN_IGST'), v_ig); end if;

  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (s.org_id, auth.uid(), 'purchase_return', 'purchase_returns', v_id::text, jsonb_build_object('debitNote', v_no, 'distributor', d.name, 'total', s_val + s_tax));
  return jsonb_build_object('returnId', v_id, 'debitNoteNo', v_no, 'valuePaise', s_val, 'taxPaise', s_tax, 'totalPaise', s_val + s_tax, 'duplicate', false);
end $$;

-- ───────────────────────── stock adjustments with approval (UC-INV-04) ─────────────────────────
create or replace function _post_stock_adjustment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a stock_adjustments%rowtype; ln stock_adjustment_lines%rowtype; bt batches%rowtype; c bigint; v_net bigint := 0; v_je uuid;
        v_date date := (now() at time zone 'Asia/Kolkata')::date; s stores%rowtype;
begin
  select * into a from stock_adjustments where id = p_id for update;
  select * into s from stores where id = a.store_id;
  if exists (select 1 from period_locks where org_id = s.org_id and locked_until >= v_date) then raise exception 'Period locked'; end if;
  for ln in select * from stock_adjustment_lines where adjustment_id = p_id loop
    select * into bt from batches where id = ln.batch_id for update;
    if bt.qty_on_hand + ln.qty_delta < 0 then
      raise exception 'Batch % has only % unit(s); cannot remove %', bt.batch_no, bt.qty_on_hand, -ln.qty_delta using errcode = 'check_violation';
    end if;
    c := round(bt.cost_per_unit_paise * abs(ln.qty_delta));
    update stock_adjustment_lines set cost_paise = c where id = ln.id;
    update batches set qty_on_hand = qty_on_hand + ln.qty_delta where id = bt.id;
    insert into stock_ledger (org_id, store_id, batch_id, product_id, doc_type, doc_id, qty_delta, created_by)
    values (a.org_id, a.store_id, bt.id, bt.product_id, 'stock_adjust', a.id, ln.qty_delta, auth.uid());
    v_net := v_net + sign(ln.qty_delta) * c;
  end loop;
  update stock_adjustments set status = 'approved', adj_no = next_invoice_no(a.store_id, 'SA', v_date), value_paise = v_net,
    decided_by = auth.uid(), decided_at = now() where id = a.id;
  if v_net <> 0 then
    insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
    values (a.org_id, a.store_id, v_date, 'stock_adjust', a.id, 'Stock adjustment (' || a.reason || ')' || coalesce(': ' || a.note, ''), auth.uid()) returning id into v_je;
    if v_net < 0 then
      insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, a.org_id, acct(a.org_id, 'STOCK_ADJ'), -v_net);
      insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, a.org_id, acct(a.org_id, 'INVENTORY'), -v_net);
    else
      insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, a.org_id, acct(a.org_id, 'INVENTORY'), v_net);
      insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, a.org_id, acct(a.org_id, 'STOCK_ADJ'), v_net);
    end if;
  end if;
end $$;
revoke all on function _post_stock_adjustment(uuid) from public;

-- p: { storeId, reason, note?, lines:[{batchId, qtyDelta}] } → owners/admins post immediately; others create a pending request.
create or replace function request_stock_adjustment(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s stores%rowtype; v_id uuid := gen_random_uuid(); l jsonb; bt batches%rowtype; pr products%rowtype; v_n int := 0; v_auto boolean;
begin
  select * into s from stores where id = (p->>'storeId')::uuid;
  if not found or not has_store_access(s.id) or not has_role(s.org_id, array['owner','admin','pharmacist','purchase']::member_role[]) then
    raise exception 'Not allowed to adjust stock' using errcode = 'insufficient_privilege';
  end if;
  insert into stock_adjustments (id, org_id, store_id, reason, note, requested_by)
  values (v_id, s.org_id, s.id, p->>'reason', nullif(trim(p->>'note'), ''), auth.uid());
  for l in select * from jsonb_array_elements(p->'lines') loop
    if coalesce((l->>'qtyDelta')::int, 0) = 0 then continue; end if;
    select * into bt from batches where id = (l->>'batchId')::uuid and store_id = s.id;
    if not found then raise exception 'Batch not found at this store'; end if;
    select * into pr from products where id = bt.product_id;
    if pr.schedule in ('X','NDPS') and length(coalesce(trim(p->>'note'), '')) < 10 then
      raise exception '% is Schedule %: a detailed note (10+ characters) is required for the register reconciliation', pr.name, pr.schedule using errcode = 'check_violation';
    end if;
    insert into stock_adjustment_lines (adjustment_id, org_id, batch_id, product_id, qty_delta) values (v_id, s.org_id, bt.id, bt.product_id, (l->>'qtyDelta')::int);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Add at least one batch with a quantity change' using errcode = 'check_violation'; end if;
  v_auto := has_role(s.org_id, array['owner','admin']::member_role[]);
  if v_auto then perform _post_stock_adjustment(v_id); end if;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (s.org_id, auth.uid(), 'stock_adjustment_request', 'stock_adjustments', v_id::text, jsonb_build_object('reason', p->>'reason', 'autoApproved', v_auto));
  return jsonb_build_object('adjustmentId', v_id, 'status', case when v_auto then 'approved' else 'pending' end);
end $$;

create or replace function decide_stock_adjustment(p_id uuid, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a stock_adjustments%rowtype;
begin
  select * into a from stock_adjustments where id = p_id for update;
  if not found or not has_role(a.org_id, array['owner','admin']::member_role[]) then
    raise exception 'Only an owner or admin can approve stock adjustments' using errcode = 'insufficient_privilege';
  end if;
  if a.status <> 'pending' then raise exception 'Adjustment already %', a.status using errcode = 'check_violation'; end if;
  update stock_adjustments set decision_note = nullif(trim(p_note), '') where id = p_id;
  if p_approve then perform _post_stock_adjustment(p_id);
  else update stock_adjustments set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = p_id; end if;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (a.org_id, auth.uid(), case when p_approve then 'stock_adjustment_approve' else 'stock_adjustment_reject' end, 'stock_adjustments', p_id::text, jsonb_build_object('note', p_note));
  return jsonb_build_object('adjustmentId', p_id, 'status', case when p_approve then 'approved' else 'rejected' end);
end $$;

-- ───────────────────────── recalls (UC-INV-07 / CMP-07) ─────────────────────────
create or replace function apply_recall(p_recall uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r recalls%rowtype; n int;
begin
  select * into r from recalls where id = p_recall;
  update batches b set status = 'recalled'
  from products p
  where p.id = b.product_id and upper(b.batch_no) = upper(r.batch_no) and (r.org_id is null or b.org_id = r.org_id)
    and p.name ilike '%' || r.product_name || '%' and (r.manufacturer is null or p.manufacturer ilike '%' || r.manufacturer || '%')
    and is_member(b.org_id) and b.status <> 'recalled';
  get diagnostics n = row_count;
  return n;
end $$;

-- p: { productName, manufacturer?, batchNo, reason, source? }
create or replace function create_recall(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; n int;
begin
  if not has_role(p_org, array['owner','admin','pharmacist']::member_role[]) then raise exception 'Not allowed' using errcode = 'insufficient_privilege'; end if;
  if coalesce(trim(p->>'productName'), '') = '' or coalesce(trim(p->>'batchNo'), '') = '' or coalesce(trim(p->>'reason'), '') = '' then
    raise exception 'Product, batch and reason are required' using errcode = 'check_violation';
  end if;
  insert into recalls (org_id, product_name, manufacturer, batch_no, reason, source)
  values (p_org, trim(p->>'productName'), nullif(trim(p->>'manufacturer'), ''), upper(trim(p->>'batchNo')), trim(p->>'reason'), nullif(trim(p->>'source'), ''))
  returning id into v_id;
  n := apply_recall(v_id);
  insert into audit_log (org_id, user_id, action, entity, entity_id, details) values (p_org, auth.uid(), 'create_recall', 'recalls', v_id::text, p || jsonb_build_object('quarantined', n));
  return jsonb_build_object('recallId', v_id, 'quarantined', n);
end $$;

-- Which batches were hit and which customers bought them (for phone-back), within the caller's org.
create or replace function recall_impact(p_recall uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (select * from recalls where id = p_recall),
  hit as (
    select b.id, b.store_id, b.batch_no, b.qty_on_hand, b.status, p.name
    from batches b join products p on p.id = b.product_id, r
    where upper(b.batch_no) = upper(r.batch_no) and p.name ilike '%' || r.product_name || '%' and is_member(b.org_id)
  )
  select jsonb_build_object(
    'batches', coalesce((select jsonb_agg(jsonb_build_object('batchId', h.id, 'store', st.code, 'product', h.name, 'batchNo', h.batch_no, 'qtyOnHand', h.qty_on_hand, 'status', h.status)) from hit h join stores st on st.id = h.store_id), '[]'),
    'buyers', coalesce((select jsonb_agg(jsonb_build_object('invoiceNo', sb.invoice_no, 'billedAt', sb.billed_at, 'customer', c.name, 'phone', c.phone, 'qtyBase', l.qty_base) order by sb.billed_at desc)
                        from sales_bill_lines l join hit h on h.id = l.batch_id join sales_bills sb on sb.id = l.bill_id left join customers c on c.id = sb.customer_id
                        where sb.status = 'posted'), '[]'))
$$;

-- Manual quarantine / release. Releasing a recalled or NSQ batch needs an owner/admin.
create or replace function set_batch_status(p_batch uuid, p_status batch_status, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare bt batches%rowtype;
begin
  select * into bt from batches where id = p_batch;
  if not found or not has_store_access(bt.store_id) or not has_role(bt.org_id, array['owner','admin','pharmacist']::member_role[]) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if bt.status in ('recalled','nsq') and p_status = 'active' and not has_role(bt.org_id, array['owner','admin']::member_role[]) then
    raise exception 'Only an owner or admin can release a recalled / NSQ batch' using errcode = 'insufficient_privilege';
  end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'Give a reason (at least 5 characters)' using errcode = 'check_violation'; end if;
  update batches set status = p_status where id = p_batch;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (bt.org_id, auth.uid(), 'set_batch_status', 'batches', p_batch::text, jsonb_build_object('from', bt.status, 'to', p_status, 'reason', p_reason));
end $$;

-- ───────────────────────── reporting helpers ─────────────────────────
-- sales line with how much has already been returned (for the returns screen)
create or replace view v_bill_lines with (security_invoker = true) as
  select l.id, l.bill_id, l.org_id, l.product_id, p.name as product_name, p.schedule, p.cold_chain, p.units_per_pack, p.pack_label, p.base_unit_label,
         b.batch_no, b.expiry, l.qty_base, l.pack_mrp_paise, l.discount_pct, l.amount_paise, l.gst_rate,
         coalesce(r.qty, 0)::int as returned_qty, coalesce(r.amt, 0)::bigint as returned_paise
  from sales_bill_lines l join products p on p.id = l.product_id join batches b on b.id = l.batch_id
  left join lateral (select sum(qty_base) qty, sum(amount_paise) amt from sales_return_lines rl where rl.bill_line_id = l.id) r on true;

-- batches eligible for a return to a distributor, with the distributor they were last bought from
create or replace view v_returnable_batches with (security_invoker = true) as
  select b.id as batch_id, b.org_id, b.store_id, b.product_id, p.name as product_name, p.schedule, b.batch_no, b.expiry, b.qty_on_hand,
         b.pack_mrp_paise, b.cost_per_unit_paise, b.status, p.units_per_pack, p.pack_label, p.base_unit_label,
         (b.expiry - current_date) as days_to_expiry,
         (select pi.distributor_id from purchase_lines pl join purchase_invoices pi on pi.id = pl.purchase_id
           where pl.batch_id = b.id order by pi.supplier_invoice_date desc limit 1) as last_distributor_id
  from batches b join products p on p.id = b.product_id
  where b.qty_on_hand > 0;

grant execute on function post_sales_return(jsonb), cancel_sale(uuid, text), post_purchase_return(jsonb), request_stock_adjustment(jsonb),
  decide_stock_adjustment(uuid, boolean, text), create_recall(uuid, jsonb), recall_impact(uuid), set_batch_status(uuid, batch_status, text) to authenticated;
grant select on v_bill_lines, v_returnable_batches to authenticated;
