-- Sprint 4: cashier shifts with cash count & X/Z reports (UC-POS-14), controlled-drug stock reconciliation (UC-CMP-02/03),
-- prescription-view logging (UC-CMP-04, DPDP), audit log restricted to owner/admin/auditor (UC-CMP-09).
-- Drawer cash is derived from the journal: every CASH movement posted by the cashier during the shift
-- (sales, refunds, cancellations, udhaar receipts, petty cash) — so nothing in posting functions had to change.

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
   (p_org,'CASH_DIFF','Cash shortage / excess','expense'), (p_org,'PETTY_EXP','Petty cash expenses','expense'),
   (p_org,'DISC_RECD','Discount received','income')
  on conflict do nothing
$$;
select seed_chart_of_accounts(id) from orgs;

-- ───────────────────────── shifts ─────────────────────────
create table pos_shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  store_id uuid not null references stores(id),
  user_id uuid not null,
  device_code text,
  status text not null default 'open' check (status in ('open','closed')),
  opened_at timestamptz not null default now(),
  opening_cash_paise bigint not null check (opening_cash_paise >= 0),
  closed_at timestamptz,
  closed_by uuid,
  denominations jsonb,
  counted_paise bigint,
  expected_paise bigint,
  difference_paise bigint,
  close_note text,
  report jsonb
);
create unique index pos_shifts_one_open on pos_shifts (store_id, user_id) where status = 'open';

create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  store_id uuid not null,
  shift_id uuid not null references pos_shifts(id),
  kind text not null check (kind in ('float_in','expense','bank_deposit','owner_drawing')),
  amount_paise bigint not null check (amount_paise > 0),
  note text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['pos_shifts','cash_movements'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (is_member(org_id))', t || '_read', t);
    execute format('revoke insert, update, delete on %I from authenticated, anon', t);
  end loop;
end $$;

create or replace function open_shift(p_store uuid, p_device text, p_opening_paise bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s stores%rowtype; v_id uuid; v_last bigint;
begin
  select * into s from stores where id = p_store;
  if not found or not has_store_access(s.id) or not has_role(s.org_id, array['owner','admin','pharmacist','billing']::member_role[]) then
    raise exception 'Not allowed to run a till at this store' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from pos_shifts where store_id = s.id and user_id = auth.uid() and status = 'open') then
    raise exception 'You already have an open shift at this store' using errcode = 'check_violation';
  end if;
  if p_opening_paise is null or p_opening_paise < 0 then raise exception 'Opening cash cannot be negative' using errcode = 'check_violation'; end if;
  select counted_paise into v_last from pos_shifts where store_id = s.id and status = 'closed' order by closed_at desc limit 1;
  insert into pos_shifts (org_id, store_id, user_id, device_code, opening_cash_paise)
  values (s.org_id, s.id, auth.uid(), left(p_device, 12), p_opening_paise) returning id into v_id;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (s.org_id, auth.uid(), 'shift_open', 'pos_shifts', v_id::text, jsonb_build_object('openingPaise', p_opening_paise, 'lastClosingPaise', v_last));
  return jsonb_build_object('shiftId', v_id, 'lastClosingPaise', v_last,
    'warning', case when v_last is not null and v_last <> p_opening_paise then 'Opening cash differs from the last closing count' end);
end $$;

create or replace function _shift_guard(p_shift uuid, p_need_open boolean) returns pos_shifts
language plpgsql security definer set search_path = public as $$
declare sh pos_shifts%rowtype;
begin
  select * into sh from pos_shifts where id = p_shift for update;
  if not found or not is_member(sh.org_id) then raise exception 'Shift not found' using errcode = 'insufficient_privilege'; end if;
  if sh.user_id <> auth.uid() and not has_role(sh.org_id, array['owner','admin']::member_role[]) then
    raise exception 'Only the cashier or an owner/admin can do this' using errcode = 'insufficient_privilege';
  end if;
  if p_need_open and sh.status <> 'open' then raise exception 'Shift is already closed' using errcode = 'check_violation'; end if;
  return sh;
end $$;
revoke all on function _shift_guard(uuid, boolean) from public;

create or replace function record_cash_movement(p_shift uuid, p_kind text, p_amount_paise bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sh pos_shifts; v_id uuid := gen_random_uuid(); v_je uuid; v_dr text; v_cr text;
begin
  sh := _shift_guard(p_shift, true);
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'Amount must be positive' using errcode = 'check_violation'; end if;
  if length(coalesce(trim(p_note), '')) < 3 then raise exception 'Add a short note' using errcode = 'check_violation'; end if;
  select dr, cr into v_dr, v_cr from (values ('float_in','CASH','CAPITAL'), ('expense','PETTY_EXP','CASH'), ('bank_deposit','BANK','CASH'), ('owner_drawing','CAPITAL','CASH')) k(kind, dr, cr)
   where k.kind = p_kind;
  if v_dr is null then raise exception 'Unknown cash movement %', p_kind; end if;
  insert into cash_movements (id, org_id, store_id, shift_id, kind, amount_paise, note, created_by)
  values (v_id, sh.org_id, sh.store_id, sh.id, p_kind, p_amount_paise, trim(p_note), auth.uid());
  -- posted under the shift's cashier so it lands in their drawer
  insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
  values (sh.org_id, sh.store_id, (now() at time zone 'Asia/Kolkata')::date, 'cash_movement', v_id, initcap(replace(p_kind, '_', ' ')) || ': ' || trim(p_note), sh.user_id)
  returning id into v_je;
  insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, sh.org_id, acct(sh.org_id, v_dr), p_amount_paise);
  insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, sh.org_id, acct(sh.org_id, v_cr), p_amount_paise);
  return jsonb_build_object('movementId', v_id);
end $$;

-- X report (live) / Z report (at close). Everything the cashier posted at this store during the shift window.
create or replace function shift_summary(p_shift uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sh pos_shifts%rowtype; v_to timestamptz; acc jsonb; v_cash bigint; bills record; rets record;
begin
  select * into sh from pos_shifts where id = p_shift;
  if not found or not is_member(sh.org_id) then raise exception 'Shift not found' using errcode = 'insufficient_privilege'; end if;
  v_to := coalesce(sh.closed_at, now());
  select coalesce(jsonb_object_agg(code, net), '{}') into acc from (
    select a.code, sum(jl.debit_paise - jl.credit_paise) as net
    from journal_entries je join journal_lines jl on jl.entry_id = je.id join accounts a on a.id = jl.account_id
    where je.store_id = sh.store_id and je.created_by = sh.user_id and je.created_at >= sh.opened_at and je.created_at <= v_to
      and je.source_type <> 'shift_close' and a.code in ('CASH','UPI_CLR','CARD_CLR','WALLET_CLR','DEBTORS')
    group by a.code) x;
  v_cash := coalesce((acc->>'CASH')::bigint, 0);
  select count(*) filter (where status = 'posted') as n, coalesce(sum(total_paise) filter (where status = 'posted'), 0) as total,
         count(*) filter (where status = 'cancelled') as cancelled, count(*) filter (where needs_review) as review
    into bills from sales_bills
    where store_id = sh.store_id and created_by = sh.user_id and created_at >= sh.opened_at and created_at <= v_to;
  select count(*) as n, coalesce(sum(total_paise), 0) as total into rets from sales_returns
    where store_id = sh.store_id and created_by = sh.user_id and returned_at >= sh.opened_at and returned_at <= v_to;
  return jsonb_build_object(
    'shiftId', sh.id, 'status', sh.status, 'openedAt', sh.opened_at, 'closedAt', sh.closed_at, 'deviceCode', sh.device_code,
    'openingPaise', sh.opening_cash_paise,
    'cashNetPaise', v_cash,
    'upiPaise', coalesce((acc->>'UPI_CLR')::bigint, 0), 'cardPaise', coalesce((acc->>'CARD_CLR')::bigint, 0),
    'walletPaise', coalesce((acc->>'WALLET_CLR')::bigint, 0), 'creditNetPaise', coalesce((acc->>'DEBTORS')::bigint, 0),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'amountPaise', amount_paise, 'note', note, 'at', created_at) order by created_at)
                           from cash_movements where shift_id = sh.id), '[]'),
    'bills', bills.n, 'salesPaise', bills.total, 'cancelledBills', bills.cancelled, 'reviewBills', bills.review,
    'returns', rets.n, 'refundsPaise', rets.total,
    'expectedCashPaise', sh.opening_cash_paise + v_cash,
    'countedPaise', sh.counted_paise, 'differencePaise', sh.difference_paise, 'closeNote', sh.close_note);
end $$;

-- p_denoms: {"500": 4, "200": 3, "100": 10, ..., "coins_paise": 1250}
create or replace function close_shift(p_shift uuid, p_denoms jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sh pos_shifts; k text; v jsonb; v_counted bigint := 0; v_expected bigint; v_diff bigint; v_je uuid; v_report jsonb;
begin
  sh := _shift_guard(p_shift, true);
  for k, v in select * from jsonb_each(coalesce(p_denoms, '{}')) loop
    if k = 'coins_paise' then v_counted := v_counted + greatest(coalesce((v #>> '{}')::bigint, 0), 0);
    elsif k in ('2000','500','200','100','50','20','10','5','2','1') then v_counted := v_counted + k::bigint * 100 * greatest(coalesce((v #>> '{}')::int, 0), 0);
    else raise exception 'Unknown denomination %', k; end if;
  end loop;
  v_expected := (shift_summary(sh.id)->>'expectedCashPaise')::bigint;
  v_diff := v_counted - v_expected;
  if abs(v_diff) > 10000 and length(coalesce(trim(p_note), '')) < 5 then
    raise exception 'Cash differs by more than ₹100 (₹%) — explain the difference in the note', round(v_diff / 100.0, 2) using errcode = 'check_violation';
  end if;
  if v_diff <> 0 then
    insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
    values (sh.org_id, sh.store_id, (now() at time zone 'Asia/Kolkata')::date, 'shift_close', sh.id,
            case when v_diff < 0 then 'Cash shortage' else 'Cash excess' end || ' at shift close' || coalesce(': ' || nullif(trim(p_note), ''), ''), sh.user_id)
    returning id into v_je;
    if v_diff < 0 then
      insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, sh.org_id, acct(sh.org_id, 'CASH_DIFF'), -v_diff);
      insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, sh.org_id, acct(sh.org_id, 'CASH'), -v_diff);
    else
      insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, sh.org_id, acct(sh.org_id, 'CASH'), v_diff);
      insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, sh.org_id, acct(sh.org_id, 'CASH_DIFF'), v_diff);
    end if;
  end if;
  update pos_shifts set status = 'closed', closed_at = now(), closed_by = auth.uid(), denominations = p_denoms, counted_paise = v_counted,
    expected_paise = v_expected, difference_paise = v_diff, close_note = nullif(trim(p_note), '') where id = sh.id;
  v_report := shift_summary(sh.id);
  update pos_shifts set report = v_report where id = sh.id;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (sh.org_id, auth.uid(), 'shift_close', 'pos_shifts', sh.id::text, jsonb_build_object('expected', v_expected, 'counted', v_counted, 'difference', v_diff));
  return v_report;
end $$;

create or replace function my_open_shift(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from pos_shifts where store_id = p_store and user_id = auth.uid() and status = 'open' limit 1;
  return case when v is null then null else shift_summary(v) end;
end $$;

-- ───────────────────────── controlled drugs: stock reconciliation (H1 / X / NDPS) ─────────────────────────
create or replace function controlled_stock_summary(p_store uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with mv as (
    select sl.product_id, sl.doc_type, sl.qty_delta, (sl.created_at at time zone 'Asia/Kolkata')::date as d
    from stock_ledger sl join products p on p.id = sl.product_id
    where sl.store_id = p_store and p.schedule in ('H1','X','NDPS') and has_store_access(p_store)
  )
  select coalesce(jsonb_agg(row_to_json(x) order by x.schedule, x.product), '[]') from (
    select p.name as product, p.schedule, p.base_unit_label as unit,
      coalesce(sum(m.qty_delta) filter (where m.d < p_from), 0) as opening,
      coalesce(sum(m.qty_delta) filter (where m.d between p_from and p_to and m.doc_type in ('purchase','opening','transfer_in')), 0) as received,
      coalesce(-sum(m.qty_delta) filter (where m.d between p_from and p_to and m.doc_type = 'sale'), 0) as sold,
      coalesce(sum(m.qty_delta) filter (where m.d between p_from and p_to and m.doc_type = 'sale_return'), 0) as customer_returns,
      coalesce(-sum(m.qty_delta) filter (where m.d between p_from and p_to and m.doc_type in ('purchase_return','transfer_out')), 0) as returned_to_supplier,
      coalesce(sum(m.qty_delta) filter (where m.d between p_from and p_to and m.doc_type = 'stock_adjust'), 0) as adjusted,
      coalesce(sum(m.qty_delta) filter (where m.d <= p_to), 0) as closing,
      (select coalesce(sum(qty_on_hand), 0) from batches b where b.product_id = p.id and b.store_id = p_store) as on_hand_now,
      (select coalesce(sum(r.qty_base), 0) from schedule_register r where r.product_id = p.id and r.store_id = p_store and r.entry_date between p_from and p_to) as register_qty
    from products p join mv m on m.product_id = p.id
    group by p.id, p.name, p.schedule, p.base_unit_label
  ) x
$$;

-- ───────────────────────── prescription archive: every view is logged (DPDP / CMP-04) ─────────────────────────
create or replace function log_rx_view(p_prescription uuid) returns text
language plpgsql security definer set search_path = public as $$
declare rx prescriptions%rowtype;
begin
  select * into rx from prescriptions where id = p_prescription;
  if not found or not has_role(rx.org_id, array['owner','admin','pharmacist','auditor']::member_role[]) then
    raise exception 'Not allowed to view prescriptions' using errcode = 'insufficient_privilege';
  end if;
  insert into audit_log (org_id, user_id, action, entity, entity_id) values (rx.org_id, auth.uid(), 'rx_view', 'prescriptions', rx.id::text);
  return rx.image_path;
end $$;

-- ───────────────────────── audit log: owner / admin / auditor only ─────────────────────────
drop policy if exists audit_log_read on audit_log;
create policy audit_log_read on audit_log for select to authenticated using (has_role(org_id, array['owner','admin','auditor']::member_role[]));

grant execute on function open_shift(uuid, text, bigint), record_cash_movement(uuid, text, bigint, text), shift_summary(uuid),
  close_shift(uuid, jsonb, text), my_open_shift(uuid), controlled_stock_summary(uuid, date, date), log_rx_view(uuid) to authenticated;
