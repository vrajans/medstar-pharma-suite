-- Sprint 5: accounting & GST.
-- Chart of accounts with groups + custom ledgers (UC-ACC-01), manual vouchers incl. expenses with attachment (UC-ACC-03/10),
-- period lock enforced on every journal entry (UC-ACC-07), report functions: ledger / cash & bank book / trial balance /
-- P&L / balance sheet / margin (UC-ACC-04/06), GSTR-1, GSTR-3B (UC-GST-02/03), CMP-08 & GSTR-4 summary (UC-GST-04),
-- Tally export data (UC-ACC-09).
-- Reports are SECURITY INVOKER: they read through RLS, so a user only ever sees their own organisation's books.

-- ───────────────────────── helpers ─────────────────────────
create or replace function fy_start(d date) returns date language sql immutable as $$
  select make_date(case when extract(month from d) >= 4 then extract(year from d)::int else extract(year from d)::int - 1 end, 4, 1)
$$;

create or replace function ist_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ───────────────────────── chart of accounts: groups, custom ledgers ─────────────────────────
alter table accounts add column if not exists grp text;
alter table accounts add column if not exists is_system boolean not null default true;
alter table accounts add column if not exists active boolean not null default true;
alter table accounts add constraint accounts_grp_chk check (grp is null or grp in (
  'cash','bank','debtors','stock','tax_input','current_asset','fixed_asset',
  'creditors','tax_output','loan','current_liability','capital',
  'sales','indirect_inc','direct_exp','indirect_exp'));

create or replace function grp_type(p_grp text) returns account_type language sql immutable as $$
  select case
    when p_grp in ('cash','bank','debtors','stock','tax_input','current_asset','fixed_asset') then 'asset'
    when p_grp in ('creditors','tax_output','loan','current_liability') then 'liability'
    when p_grp = 'capital' then 'equity'
    when p_grp in ('sales','indirect_inc') then 'income'
    when p_grp in ('direct_exp','indirect_exp') then 'expense'
  end::account_type
$$;

create or replace function seed_chart_of_accounts(p_org uuid) returns void
language sql security definer set search_path = public as $$
  insert into accounts (org_id, code, name, type, grp)
  select p_org, code, name, grp_type(grp), grp from (values
   ('CASH','Cash in hand','cash'), ('UPI_CLR','UPI clearing','bank'), ('CARD_CLR','Card clearing','bank'),
   ('WALLET_CLR','Wallet clearing','bank'), ('BANK','Bank','bank'), ('DEBTORS','Sundry debtors','debtors'),
   ('INVENTORY','Stock in trade','stock'), ('IN_CGST','Input CGST','tax_input'), ('IN_SGST','Input SGST','tax_input'),
   ('IN_IGST','Input IGST','tax_input'), ('FIXED_ASSETS','Furniture, fixtures & equipment','fixed_asset'),
   ('DEPOSITS','Deposits & advances','current_asset'),
   ('CREDITORS','Sundry creditors','creditors'),
   ('OUT_CGST','Output CGST','tax_output'), ('OUT_SGST','Output SGST','tax_output'), ('OUT_IGST','Output IGST','tax_output'),
   ('LOANS','Loans','loan'), ('EXP_PAYABLE','Expenses payable','current_liability'),
   ('CAPITAL','Capital','capital'), ('OPENING_BAL','Opening balances','capital'),
   ('SALES','Sales','sales'), ('SALES_RET','Sales returns','sales'),
   ('COGS','Cost of goods sold','direct_exp'), ('EXPIRY_LOSS','Expiry & breakage loss','direct_exp'),
   ('STOCK_ADJ','Stock adjustments (shortage / excess)','direct_exp'),
   ('ROUND_OFF','Round off','indirect_exp'), ('CASH_DIFF','Cash shortage / excess','indirect_exp'),
   ('PETTY_EXP','Petty cash expenses','indirect_exp'), ('RENT','Rent','indirect_exp'), ('SALARY','Salaries & wages','indirect_exp'),
   ('ELECTRICITY','Electricity','indirect_exp'), ('TELEPHONE','Telephone & internet','indirect_exp'),
   ('BANK_CHG','Bank & payment gateway charges','indirect_exp'), ('REPAIRS','Repairs & maintenance','indirect_exp'),
   ('FREIGHT','Freight & courier','indirect_exp'), ('PRINTING','Printing & stationery','indirect_exp'),
   ('PROF_FEES','Professional fees','indirect_exp'), ('LICENCE_FEES','Licence & registration fees','indirect_exp'),
   ('SOFTWARE','Software subscriptions','indirect_exp'), ('MISC_EXP','Miscellaneous expenses','indirect_exp'),
   ('DISC_RECD','Discount received','indirect_inc'), ('OTHER_INC','Other income','indirect_inc')
  ) v(code, name, grp)
  on conflict (org_id, code) do update set grp = excluded.grp where accounts.grp is null
$$;
select seed_chart_of_accounts(id) from orgs;

-- Ledgers are created / renamed only through these functions (system ledgers are used by posting code).
drop policy if exists accounts_ins on accounts;
drop policy if exists accounts_upd on accounts;
revoke insert, update, delete on accounts from authenticated, anon;

create or replace function create_account(p_org uuid, p_name text, p_grp text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text;
begin
  if not has_role(p_org, array['owner','admin','accountant']::member_role[]) then
    raise exception 'Only the owner, admin or accountant can add ledgers' using errcode = 'insufficient_privilege';
  end if;
  if length(coalesce(trim(p_name), '')) < 2 then raise exception 'Ledger name is required' using errcode = 'check_violation'; end if;
  if grp_type(p_grp) is null or p_grp in ('debtors','creditors','stock') then
    raise exception 'Choose a valid group (customers and suppliers are added from their own screens)' using errcode = 'check_violation';
  end if;
  if exists (select 1 from accounts where org_id = p_org and lower(name) = lower(trim(p_name))) then
    raise exception 'A ledger called "%" already exists', trim(p_name) using errcode = 'unique_violation';
  end if;
  v_code := 'U' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 7));
  insert into accounts (org_id, code, name, type, grp, is_system) values (p_org, v_code, trim(p_name), grp_type(p_grp), p_grp, false)
  returning id into v_id;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (p_org, auth.uid(), 'create_account', 'accounts', v_id::text, jsonb_build_object('name', trim(p_name), 'group', p_grp));
  return jsonb_build_object('accountId', v_id, 'code', v_code);
end $$;

create or replace function update_account(p_account uuid, p_name text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a accounts%rowtype; v_bal bigint;
begin
  select * into a from accounts where id = p_account;
  if not found or not has_role(a.org_id, array['owner','admin','accountant']::member_role[]) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if a.is_system and (p_active is false or trim(p_name) is distinct from a.name) then
    raise exception 'System ledgers can''t be renamed or deactivated' using errcode = 'check_violation';
  end if;
  if p_active is false then
    select coalesce(sum(debit_paise - credit_paise), 0) into v_bal from journal_lines where account_id = a.id;
    if v_bal <> 0 then raise exception 'Ledger has a balance of %; bring it to zero before deactivating', v_bal using errcode = 'check_violation'; end if;
  end if;
  update accounts set name = coalesce(nullif(trim(p_name), ''), name), active = coalesce(p_active, active) where id = a.id;
end $$;

-- ───────────────────────── period lock (UC-ACC-07) ─────────────────────────
create table period_lock_history (
  id bigserial primary key,
  org_id uuid not null references orgs(id),
  locked_until date,
  previous date,
  reason text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
alter table period_lock_history enable row level security;
create policy period_lock_history_read on period_lock_history for select to authenticated using (is_member(org_id));
revoke insert, update, delete on period_lock_history from authenticated, anon;
drop policy if exists period_locks_admin on period_locks;
revoke insert, update, delete on period_locks from authenticated, anon;

-- One rule for every document: nothing can be posted on or before the lock date — sales, returns, purchases, vouchers, shifts.
create or replace function enforce_period_lock() returns trigger language plpgsql security definer set search_path = public as $$
declare v date;
begin
  select locked_until into v from period_locks where org_id = new.org_id;
  if v is not null and new.entry_date <= v then
    raise exception 'Books are locked up to % — post this in an open period, or ask the owner to unlock', to_char(v, 'DD-Mon-YYYY')
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger journal_entries_period_lock before insert on journal_entries for each row execute function enforce_period_lock();

create or replace function set_period_lock(p_org uuid, p_until date, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prev date;
begin
  if not has_role(p_org, array['owner','admin']::member_role[]) then
    raise exception 'Only the owner or admin can lock books' using errcode = 'insufficient_privilege';
  end if;
  select locked_until into v_prev from period_locks where org_id = p_org;
  if p_until is not null and p_until >= ist_today() then
    raise exception 'You can only lock dates before today' using errcode = 'check_violation';
  end if;
  if v_prev is not null and (p_until is null or p_until < v_prev) then
    if not has_role(p_org, array['owner']::member_role[]) then
      raise exception 'Only the owner can unlock a locked period' using errcode = 'insufficient_privilege';
    end if;
    if length(coalesce(trim(p_reason), '')) < 5 then
      raise exception 'Give a reason for unlocking (it is kept in the audit log)' using errcode = 'check_violation';
    end if;
  end if;
  if p_until is null then delete from period_locks where org_id = p_org;
  else insert into period_locks (org_id, locked_until) values (p_org, p_until) on conflict (org_id) do update set locked_until = excluded.locked_until;
  end if;
  insert into period_lock_history (org_id, locked_until, previous, reason, changed_by) values (p_org, p_until, v_prev, nullif(trim(p_reason), ''), auth.uid());
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (p_org, auth.uid(), case when p_until is null or p_until < coalesce(v_prev, p_until) then 'period_unlock' else 'period_lock' end,
          'period_locks', p_org::text, jsonb_build_object('lockedUntil', p_until, 'previous', v_prev, 'reason', p_reason));
  return jsonb_build_object('lockedUntil', p_until, 'previous', v_prev);
end $$;

-- ───────────────────────── vouchers (UC-ACC-03, UC-ACC-10) ─────────────────────────
create table vouchers (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  org_id uuid not null,
  store_id uuid not null references stores(id),
  kind text not null check (kind in ('payment','receipt','contra','journal','expense')),
  voucher_no text not null,
  voucher_date date not null,
  narration text not null,
  reference text,
  attachment_path text,
  amount_paise bigint not null check (amount_paise > 0),
  journal_entry_id uuid references journal_entries(id),
  status text not null default 'posted' check (status in ('posted','reversed')),
  reversal_of uuid references vouchers(id),
  reversed_by uuid references vouchers(id),
  reverse_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (store_id, voucher_no)
);
create index vouchers_store_date on vouchers(store_id, voucher_date);
alter table vouchers enable row level security;
create policy vouchers_read on vouchers for select to authenticated using (is_member(org_id));
revoke insert, update, delete on vouchers from authenticated, anon;

create or replace function _voucher_series(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'payment' then 'PV' when 'receipt' then 'RV' when 'contra' then 'CV' when 'expense' then 'EV' else 'JV' end
$$;

-- p: { idempotencyKey, storeId, kind, date, narration, reference?, attachmentPath?,
--      lines: [{ accountId, debitPaise?, creditPaise?, partyId? }] }
create or replace function post_voucher(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s stores%rowtype; v_kind text := p->>'kind'; v_date date := (p->>'date')::date; v_id uuid := gen_random_uuid(); v_no text; v_je uuid;
  l jsonb; a accounts%rowtype; v_dr bigint; v_cr bigint; t_dr bigint := 0; t_cr bigint := 0; v_party uuid; v_existing vouchers%rowtype;
  n_lines int := 0; cashbank_dr int := 0; cashbank_cr int := 0; other_dr int := 0; other_cr int := 0; exp_dr int := 0; bad_exp int := 0;
  v_cb boolean; contra_bad boolean := false;
begin
  select * into v_existing from vouchers where idempotency_key = (p->>'idempotencyKey')::uuid;
  if found then return jsonb_build_object('voucherId', v_existing.id, 'voucherNo', v_existing.voucher_no, 'duplicate', true); end if;

  select * into s from stores where id = (p->>'storeId')::uuid;
  if not found or not has_store_access(s.id) or not has_role(s.org_id, array['owner','admin','accountant']::member_role[]) then
    raise exception 'Only the owner, admin or accountant can post vouchers' using errcode = 'insufficient_privilege';
  end if;
  if v_kind is null or v_kind not in ('payment','receipt','contra','journal','expense') then raise exception 'Unknown voucher type %', v_kind; end if;
  if v_date is null then raise exception 'Voucher date is required' using errcode = 'check_violation'; end if;
  if v_date > ist_today() then raise exception 'Voucher date cannot be in the future' using errcode = 'check_violation'; end if;
  if length(coalesce(trim(p->>'narration'), '')) < 3 then raise exception 'Add a narration' using errcode = 'check_violation'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') < 2 then
    raise exception 'A voucher needs at least one debit and one credit line' using errcode = 'check_violation';
  end if;

  for l in select * from jsonb_array_elements(p->'lines') loop
    select * into a from accounts where id = (l->>'accountId')::uuid and org_id = s.org_id;
    if not found then raise exception 'Unknown ledger %', l->>'accountId' using errcode = 'check_violation'; end if;
    if not a.active then raise exception 'Ledger % is inactive', a.name using errcode = 'check_violation'; end if;
    if a.grp = 'stock' or a.code = 'COGS' then
      raise exception '% is posted automatically by purchases, sales and stock adjustments', a.name using errcode = 'check_violation';
    end if;
    if a.grp = 'tax_input' and s.gst_scheme = 'composition' then
      raise exception 'Composition dealers cannot claim input tax credit' using errcode = 'check_violation';
    end if;
    v_dr := coalesce((l->>'debitPaise')::bigint, 0); v_cr := coalesce((l->>'creditPaise')::bigint, 0);
    if v_dr < 0 or v_cr < 0 or (v_dr > 0) = (v_cr > 0) then
      raise exception 'Each line needs either a debit or a credit amount (%).', a.name using errcode = 'check_violation';
    end if;
    v_party := nullif(l->>'partyId', '')::uuid;
    if a.code = 'DEBTORS' then
      if v_party is null or not exists (select 1 from customers where id = v_party and org_id = s.org_id) then
        raise exception 'Choose the customer for Sundry debtors' using errcode = 'check_violation'; end if;
    elsif a.code = 'CREDITORS' then
      if v_party is null or not exists (select 1 from distributors where id = v_party and org_id = s.org_id) then
        raise exception 'Choose the supplier for Sundry creditors' using errcode = 'check_violation'; end if;
    elsif v_party is not null then
      raise exception 'Only debtor / creditor lines carry a party' using errcode = 'check_violation';
    end if;
    v_cb := a.grp in ('cash','bank');
    n_lines := n_lines + 1; t_dr := t_dr + v_dr; t_cr := t_cr + v_cr;
    if v_dr > 0 then
      if v_cb then cashbank_dr := cashbank_dr + 1; else other_dr := other_dr + 1; end if;
      if a.grp in ('direct_exp','indirect_exp','fixed_asset') then exp_dr := exp_dr + 1;
      elsif a.grp <> 'tax_input' then bad_exp := bad_exp + 1; end if;
      if v_kind = 'contra' and not v_cb and a.grp <> 'indirect_exp' then contra_bad := true; end if;
    else
      if v_cb then cashbank_cr := cashbank_cr + 1; else other_cr := other_cr + 1; end if;
      if v_kind = 'expense' and not (v_cb or a.grp in ('creditors','current_liability')) then
        raise exception 'An expense is paid from cash / bank or booked to a supplier / expenses payable' using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  if t_dr <> t_cr then raise exception 'Debits (%) and credits (%) must be equal', t_dr, t_cr using errcode = 'check_violation'; end if;
  if t_dr = 0 then raise exception 'Voucher amount must be more than zero' using errcode = 'check_violation'; end if;
  if v_kind = 'payment' and (other_cr > 0 or cashbank_cr = 0 or other_dr = 0) then
    raise exception 'Payment: credit cash / bank and debit the ledger being paid' using errcode = 'check_violation';
  elsif v_kind = 'receipt' and (other_dr > 0 or cashbank_dr = 0 or other_cr = 0) then
    raise exception 'Receipt: debit cash / bank and credit the ledger it came from' using errcode = 'check_violation';
  elsif v_kind = 'contra' and (other_cr > 0 or contra_bad or cashbank_dr = 0) then
    raise exception 'Contra moves money between cash and bank accounts (bank charges may be debited)' using errcode = 'check_violation';
  elsif v_kind = 'expense' and (exp_dr = 0 or bad_exp > 0) then
    raise exception 'Expense: debit an expense ledger (and input GST if claimable)' using errcode = 'check_violation';
  end if;

  v_no := next_invoice_no(s.id, _voucher_series(v_kind), v_date);
  insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
  values (s.org_id, s.id, v_date, 'voucher', v_id, initcap(v_kind) || ' ' || v_no || ': ' || trim(p->>'narration')
          || coalesce(' · Ref ' || nullif(trim(p->>'reference'), ''), ''), auth.uid())
  returning id into v_je;
  insert into journal_lines (entry_id, org_id, account_id, debit_paise, credit_paise, party_id)
  select v_je, s.org_id, (x->>'accountId')::uuid, coalesce((x->>'debitPaise')::bigint, 0), coalesce((x->>'creditPaise')::bigint, 0), nullif(x->>'partyId', '')::uuid
  from jsonb_array_elements(p->'lines') x;
  insert into vouchers (id, idempotency_key, org_id, store_id, kind, voucher_no, voucher_date, narration, reference, attachment_path, amount_paise, journal_entry_id, created_by)
  values (v_id, (p->>'idempotencyKey')::uuid, s.org_id, s.id, v_kind, v_no, v_date, trim(p->>'narration'), nullif(trim(p->>'reference'), ''),
          nullif(p->>'attachmentPath', ''), t_dr, v_je, auth.uid());
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (s.org_id, auth.uid(), 'post_voucher', 'vouchers', v_id::text, jsonb_build_object('voucherNo', v_no, 'kind', v_kind, 'amount', t_dr));
  return jsonb_build_object('voucherId', v_id, 'voucherNo', v_no, 'amountPaise', t_dr, 'duplicate', false);
end $$;

-- Reversal posts a mirror entry (append-only books); the original stays visible, marked reversed.
create or replace function reverse_voucher(p_voucher uuid, p_reason text, p_date date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vouchers%rowtype; v_id uuid := gen_random_uuid(); v_no text; v_je uuid; v_date date := coalesce(p_date, ist_today());
begin
  select * into v from vouchers where id = p_voucher for update;
  if not found or not has_role(v.org_id, array['owner','admin','accountant']::member_role[]) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v.status <> 'posted' or v.reversal_of is not null then raise exception 'This voucher is already reversed or is itself a reversal' using errcode = 'check_violation'; end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'Give a reason for the reversal' using errcode = 'check_violation'; end if;
  if v_date > ist_today() or v_date < v.voucher_date then raise exception 'Reversal date must be between the voucher date and today' using errcode = 'check_violation'; end if;
  v_no := next_invoice_no(v.store_id, _voucher_series(v.kind), v_date);
  insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
  values (v.org_id, v.store_id, v_date, 'voucher', v_id, 'Reversal of ' || v.voucher_no || ': ' || trim(p_reason), auth.uid()) returning id into v_je;
  insert into journal_lines (entry_id, org_id, account_id, debit_paise, credit_paise, party_id)
  select v_je, jl.org_id, jl.account_id, jl.credit_paise, jl.debit_paise, jl.party_id from journal_lines jl where jl.entry_id = v.journal_entry_id;
  insert into vouchers (id, idempotency_key, org_id, store_id, kind, voucher_no, voucher_date, narration, amount_paise, journal_entry_id, reversal_of, created_by)
  values (v_id, gen_random_uuid(), v.org_id, v.store_id, v.kind, v_no, v_date, 'Reversal of ' || v.voucher_no || ': ' || trim(p_reason), v.amount_paise, v_je, v.id, auth.uid());
  update vouchers set status = 'reversed', reversed_by = v_id, reverse_reason = trim(p_reason) where id = v.id;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (v.org_id, auth.uid(), 'reverse_voucher', 'vouchers', v.id::text, jsonb_build_object('voucherNo', v.voucher_no, 'reversalNo', v_no, 'reason', p_reason));
  return jsonb_build_object('voucherId', v_id, 'voucherNo', v_no);
end $$;

-- Voucher attachments (bills, receipts): <org_id>/vouchers/<file>
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $q$ insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
                values ('documents', 'documents', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
                on conflict (id) do nothing $q$;
    execute $q$ create policy documents_staff_rw on storage.objects for all to authenticated
                using (bucket_id = 'documents' and public.is_member(((storage.foldername(name))[1])::uuid))
                with check (bucket_id = 'documents' and public.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin','accountant']::public.member_role[])) $q$;
  end if;
end $$;

-- ───────────────────────── books: ledger, trial balance, P&L, balance sheet (UC-ACC-04, UC-ACC-06) ─────────────────────────
-- Balances are Dr − Cr in paise. Income / expense ledgers open at the start of the financial year (1 April).

create or replace function ledger_report(p_account uuid, p_from date, p_to date, p_store uuid default null, p_party uuid default null)
returns jsonb language sql stable as $$
  with a as (select * from accounts where id = p_account),
  base as (
    select je.id as entry_id, je.entry_date, je.source_type, je.source_id, je.narration, je.store_id, jl.id as line_id,
           jl.debit_paise as d, jl.credit_paise as c, jl.party_id
    from journal_lines jl join journal_entries je on je.id = jl.entry_id
    where jl.account_id = p_account and je.entry_date <= p_to
      and (p_store is null or je.store_id = p_store) and (p_party is null or jl.party_id = p_party)
  ),
  op as (
    select coalesce(sum(d - c), 0)::bigint as v from base, a
    where base.entry_date < p_from and (a.type in ('asset','liability','equity') or base.entry_date >= fy_start(p_from))
  ),
  r as (
    select b.*, (select v from op) + sum(d - c) over (order by entry_date, line_id) as bal,
           (select string_agg(distinct x.name, ', ') from journal_lines ol join accounts x on x.id = ol.account_id
             where ol.entry_id = b.entry_id and ol.account_id <> p_account) as against
    from base b where b.entry_date between p_from and p_to
  )
  select jsonb_build_object(
    'account', (select jsonb_build_object('id', id, 'code', code, 'name', name, 'type', type, 'grp', grp) from a),
    'opening', (select v from op),
    'debit', coalesce((select sum(d) from r), 0), 'credit', coalesce((select sum(c) from r), 0),
    'closing', (select v from op) + coalesce((select sum(d - c) from r), 0),
    'count', (select count(*) from r),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('date', entry_date, 'entryId', entry_id, 'source', source_type, 'sourceId', source_id,
              'narration', narration, 'against', against, 'debit', d, 'credit', c, 'balance', bal, 'partyId', party_id) order by entry_date, line_id)
             from (select * from r order by entry_date, line_id limit 5000) z), '[]'::jsonb))
$$;

create or replace function trial_balance(p_org uuid, p_from date, p_to date, p_store uuid default null)
returns jsonb language sql stable as $$
  with mv as (
    select jl.account_id, je.entry_date, jl.debit_paise as d, jl.credit_paise as c
    from journal_lines jl join journal_entries je on je.id = jl.entry_id
    where jl.org_id = p_org and je.entry_date <= p_to and (p_store is null or je.store_id = p_store)
  ),
  t as (
    select a.id, a.code, a.name, a.type, a.grp,
      coalesce(case when a.type in ('asset','liability','equity') then sum(m.d - m.c) filter (where m.entry_date < p_from)
                    else sum(m.d - m.c) filter (where m.entry_date >= fy_start(p_from) and m.entry_date < p_from) end, 0)::bigint as opening,
      coalesce(sum(m.d) filter (where m.entry_date >= p_from), 0)::bigint as debit,
      coalesce(sum(m.c) filter (where m.entry_date >= p_from), 0)::bigint as credit
    from accounts a left join mv m on m.account_id = a.id
    where a.org_id = p_org
    group by a.id, a.code, a.name, a.type, a.grp
  ),
  bf as (  -- profit / loss of earlier financial years (no FY closing entry yet — UC-ACC-08 is R2)
    select coalesce(sum(m.d - m.c), 0)::bigint as v from mv m join accounts a on a.id = m.account_id
    where a.type in ('income','expense') and m.entry_date < fy_start(p_from)
  )
  select coalesce(jsonb_agg(row_to_json(x) order by x.sort, x.grp, x.code), '[]'::jsonb) from (
    select id, code, name, type, grp, opening, debit, credit, opening + debit - credit as closing,
           case type when 'asset' then 1 when 'liability' then 2 when 'equity' then 3 when 'income' then 4 else 5 end as sort
    from t where opening <> 0 or debit <> 0 or credit <> 0
    union all
    select null, 'PL_BF', 'Profit & loss of earlier years', 'equity', 'capital', v, 0, 0, v, 3 from bf where v <> 0
  ) x
$$;

create or replace function profit_and_loss(p_org uuid, p_from date, p_to date, p_store uuid default null)
returns jsonb language sql stable as $$
  with t as (
    select a.code, a.name, a.type, a.grp,
      sum(case when a.type = 'income' then jl.credit_paise - jl.debit_paise else jl.debit_paise - jl.credit_paise end)::bigint as amount
    from journal_lines jl join journal_entries je on je.id = jl.entry_id join accounts a on a.id = jl.account_id
    where jl.org_id = p_org and a.type in ('income','expense') and je.entry_date between p_from and p_to
      and (p_store is null or je.store_id = p_store)
    group by a.code, a.name, a.type, a.grp having sum(jl.debit_paise) <> 0 or sum(jl.credit_paise) <> 0
  ),
  s as (
    select coalesce(sum(amount) filter (where grp = 'sales'), 0) as sales,
           coalesce(sum(amount) filter (where grp = 'direct_exp'), 0) as direct,
           coalesce(sum(amount) filter (where grp = 'indirect_inc'), 0) as other_inc,
           coalesce(sum(amount) filter (where grp = 'indirect_exp' or (type = 'expense' and grp is null)), 0) as indirect
    from t
  )
  select jsonb_build_object(
    'trading', coalesce((select jsonb_agg(row_to_json(t) order by t.grp desc, t.amount desc) from t where grp in ('sales','direct_exp')), '[]'::jsonb),
    'otherIncome', coalesce((select jsonb_agg(row_to_json(t) order by t.amount desc) from t where grp = 'indirect_inc'), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(row_to_json(t) order by t.amount desc) from t where grp = 'indirect_exp' or (type = 'expense' and grp is null)), '[]'::jsonb),
    'netSales', s.sales, 'directCosts', s.direct, 'grossProfit', s.sales - s.direct, 'otherIncomeTotal', s.other_inc,
    'expensesTotal', s.indirect, 'netProfit', s.sales - s.direct + s.other_inc - s.indirect)
  from s
$$;

create or replace function balance_sheet(p_org uuid, p_as_of date, p_store uuid default null)
returns jsonb language sql stable as $$
  with t as (
    select a.code, a.name, a.type, a.grp, sum(jl.debit_paise - jl.credit_paise)::bigint as dr_cr
    from journal_lines jl join journal_entries je on je.id = jl.entry_id join accounts a on a.id = jl.account_id
    where jl.org_id = p_org and je.entry_date <= p_as_of and (p_store is null or je.store_id = p_store)
    group by a.code, a.name, a.type, a.grp
  ),
  pl as (
    select coalesce(-sum(jl.debit_paise - jl.credit_paise) filter (where je.entry_date >= fy_start(p_as_of)), 0)::bigint as current_year,
           coalesce(-sum(jl.debit_paise - jl.credit_paise) filter (where je.entry_date < fy_start(p_as_of)), 0)::bigint as earlier
    from journal_lines jl join journal_entries je on je.id = jl.entry_id join accounts a on a.id = jl.account_id
    where jl.org_id = p_org and a.type in ('income','expense') and je.entry_date <= p_as_of and (p_store is null or je.store_id = p_store)
  )
  select jsonb_build_object(
    'assets', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'grp', grp, 'amount', dr_cr) order by grp, code) from t where type = 'asset' and dr_cr <> 0), '[]'::jsonb),
    'liabilities', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'grp', grp, 'amount', -dr_cr) order by grp, code) from t where type = 'liability' and dr_cr <> 0), '[]'::jsonb),
    'equity', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'grp', grp, 'amount', -dr_cr) order by code) from t where type = 'equity' and dr_cr <> 0), '[]'::jsonb),
    'profitCurrentYear', pl.current_year, 'profitEarlierYears', pl.earlier,
    'totalAssets', coalesce((select sum(dr_cr) from t where type = 'asset'), 0),
    'totalLiabilitiesEquity', coalesce((select -sum(dr_cr) from t where type in ('liability','equity')), 0) + pl.current_year + pl.earlier)
  from pl
$$;

-- Gross margin by product / category / manufacturer, net of customer returns (UC-ACC-06)
create or replace function margin_report(p_store uuid, p_from date, p_to date, p_by text default 'product')
returns jsonb language sql stable as $$
  with mv as (
    select l.product_id, l.taxable_paise as sales, l.cost_paise as cost, l.qty_base as qty
    from sales_bill_lines l join sales_bills b on b.id = l.bill_id
    where b.store_id = p_store and b.status = 'posted' and (b.billed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    union all
    select rl.product_id, -rl.taxable_paise, case when rl.restocked then -rl.cost_paise else 0 end, -rl.qty_base
    from sales_return_lines rl join sales_returns r on r.id = rl.return_id
    where r.store_id = p_store and (r.returned_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ),
  g as (
    select case p_by when 'category' then p.category when 'manufacturer' then coalesce(p.manufacturer, '(not set)') else p.name end as label,
           sum(qty)::bigint as qty, sum(sales)::bigint as sales, sum(cost)::bigint as cost
    from mv join products p on p.id = mv.product_id group by 1
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'qty', qty, 'sales', sales, 'cost', cost, 'margin', sales - cost,
              'marginPct', case when sales <> 0 then round((sales - cost) * 100.0 / sales, 1) end) order by sales - cost desc)
             from (select * from g order by sales - cost desc limit 500) z), '[]'::jsonb),
    'sales', coalesce((select sum(sales) from g), 0), 'cost', coalesce((select sum(cost) from g), 0))
$$;

-- ───────────────────────── GST returns (UC-GST-02/03/04) ─────────────────────────
-- Document-based (bills, credit notes, purchases) in the store's state; place of supply = store state for counter sales.
-- Amounts in paise; packages/core turns them into the GST portal / offline-tool JSON.

create or replace function _gst_sales_lines(p_store uuid, p_from date, p_to date)
returns table (kind text, doc_id uuid, doc_no text, doc_date date, doc_value bigint, ctin text, party text, hsn text, unit text, rate numeric,
               qty bigint, txval bigint, camt bigint, samt bigint, iamt bigint, orig_no text, orig_date date)
language sql stable as $$
  select 'INV', b.id, b.invoice_no, (b.billed_at at time zone 'Asia/Kolkata')::date, b.total_paise, nullif(c.gstin, ''), c.name,
         l.hsn, p.base_unit_label, l.gst_rate, l.qty_base::bigint, l.taxable_paise, l.cgst_paise, l.sgst_paise, l.igst_paise, null, null
  from sales_bill_lines l join sales_bills b on b.id = l.bill_id join products p on p.id = l.product_id left join customers c on c.id = b.customer_id
  where b.store_id = p_store and b.status = 'posted' and (b.billed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'CN', r.id, r.credit_note_no, (r.returned_at at time zone 'Asia/Kolkata')::date, r.total_paise, nullif(c.gstin, ''), c.name,
         bl.hsn, p.base_unit_label, bl.gst_rate, -rl.qty_base::bigint, -rl.taxable_paise, -rl.cgst_paise, -rl.sgst_paise, -rl.igst_paise,
         b.invoice_no, (b.billed_at at time zone 'Asia/Kolkata')::date
  from sales_return_lines rl join sales_returns r on r.id = rl.return_id join sales_bill_lines bl on bl.id = rl.bill_line_id
  join sales_bills b on b.id = r.bill_id join products p on p.id = rl.product_id left join customers c on c.id = b.customer_id
  where r.store_id = p_store and (r.returned_at at time zone 'Asia/Kolkata')::date between p_from and p_to
$$;

create or replace function gstr1(p_store uuid, p_from date, p_to date) returns jsonb
language plpgsql stable as $$
declare s stores%rowtype;
begin
  select * into s from stores where id = p_store;
  if not found then raise exception 'Store not found' using errcode = 'insufficient_privilege'; end if;
  if s.gst_scheme = 'composition' then raise exception 'Composition dealers file CMP-08 and GSTR-4, not GSTR-1' using errcode = 'check_violation'; end if;
  return (
    with x as (select * from _gst_sales_lines(p_store, p_from, p_to)),
    b2b_items as (
      select doc_no, doc_date, doc_value, ctin, party, rate, sum(txval) txval, sum(camt) camt, sum(samt) samt, sum(iamt) iamt
      from x where kind = 'INV' and ctin is not null and rate > 0 group by 1,2,3,4,5,6
    ),
    cdnr_items as (
      select doc_no, doc_date, doc_value, ctin, party, orig_no, orig_date, rate, -sum(txval) txval, -sum(camt) camt, -sum(samt) samt, -sum(iamt) iamt
      from x where kind = 'CN' and ctin is not null and rate > 0 group by 1,2,3,4,5,6,7,8
    ),
    docs as (
      select 'INV' as kind, regexp_replace(invoice_no, '[0-9]+$', '') as series, min(invoice_no) as first_no, max(invoice_no) as last_no,
             count(*) as total, count(*) filter (where status = 'cancelled') as cancelled
      from sales_bills where store_id = p_store and (billed_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1, 2
      union all
      select 'CN', regexp_replace(credit_note_no, '[0-9]+$', ''), min(credit_note_no), max(credit_note_no), count(*), 0
      from sales_returns where store_id = p_store and (returned_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1, 2
    )
    select jsonb_build_object(
      'gstin', s.gstin, 'stateCode', s.state_code, 'from', p_from, 'to', p_to,
      'b2b', coalesce((select jsonb_agg(row_to_json(b2b_items) order by doc_no, rate) from b2b_items), '[]'::jsonb),
      'b2cs', coalesce((select jsonb_agg(jsonb_build_object('rate', rate, 'txval', sum_tx, 'camt', sum_c, 'samt', sum_s, 'iamt', sum_i) order by rate)
               from (select rate, sum(txval) sum_tx, sum(camt) sum_c, sum(samt) sum_s, sum(iamt) sum_i from x where ctin is null and rate > 0 group by rate) z), '[]'::jsonb),
      'cdnr', coalesce((select jsonb_agg(row_to_json(cdnr_items) order by doc_no, rate) from cdnr_items), '[]'::jsonb),
      'nil', jsonb_build_object('b2b', coalesce((select sum(txval) from x where rate = 0 and ctin is not null), 0),
                                'b2c', coalesce((select sum(txval) from x where rate = 0 and ctin is null), 0)),
      'hsn', coalesce((select jsonb_agg(jsonb_build_object('b2b', is_b2b, 'hsn', hsn, 'unit', unit, 'rate', rate, 'qty', qty, 'txval', txval,
                         'camt', camt, 'samt', samt, 'iamt', iamt) order by is_b2b desc, hsn, rate)
               from (select ctin is not null as is_b2b, hsn, unit, rate, sum(qty) qty, sum(txval) txval, sum(camt) camt, sum(samt) samt, sum(iamt) iamt
                     from x group by 1, 2, 3, 4) z), '[]'::jsonb),
      'docs', coalesce((select jsonb_agg(row_to_json(docs) order by kind, series) from docs), '[]'::jsonb),
      'totals', jsonb_build_object(
        'invoices', (select count(distinct doc_no) from x where kind = 'INV'), 'creditNotes', (select count(distinct doc_no) from x where kind = 'CN'),
        'txval', coalesce((select sum(txval) from x), 0), 'camt', coalesce((select sum(camt) from x), 0),
        'samt', coalesce((select sum(samt) from x), 0), 'iamt', coalesce((select sum(iamt) from x), 0))));
end $$;

create or replace function gstr3b(p_store uuid, p_from date, p_to date) returns jsonb
language plpgsql stable as $$
declare s stores%rowtype;
begin
  select * into s from stores where id = p_store;
  if not found then raise exception 'Store not found' using errcode = 'insufficient_privilege'; end if;
  if s.gst_scheme = 'composition' then raise exception 'Composition dealers file CMP-08, not GSTR-3B' using errcode = 'check_violation'; end if;
  return (
    with x as (select * from _gst_sales_lines(p_store, p_from, p_to)),
    itc as (
      select a.code, je.source_type, sum(jl.debit_paise - jl.credit_paise)::bigint as amt
      from journal_lines jl join journal_entries je on je.id = jl.entry_id join accounts a on a.id = jl.account_id
      where je.store_id = p_store and je.entry_date between p_from and p_to and a.code in ('IN_IGST','IN_CGST','IN_SGST')
      group by 1, 2
    ),
    books as (
      select a.code, sum(jl.credit_paise - jl.debit_paise)::bigint as amt
      from journal_lines jl join journal_entries je on je.id = jl.entry_id join accounts a on a.id = jl.account_id
      where je.store_id = p_store and je.entry_date between p_from and p_to and a.code in ('OUT_IGST','OUT_CGST','OUT_SGST')
        and je.source_type <> 'voucher'
      group by 1
    ),
    inward_nil as (
      select coalesce(sum(pl.taxable_paise) filter (where not pi.inter_state), 0)::bigint as intra,
             coalesce(sum(pl.taxable_paise) filter (where pi.inter_state), 0)::bigint as inter
      from purchase_lines pl join purchase_invoices pi on pi.id = pl.purchase_id
      where pi.store_id = p_store and pi.supplier_invoice_date between p_from and p_to and pl.gst_rate = 0
    )
    select jsonb_build_object(
      'gstin', s.gstin, 'from', p_from, 'to', p_to,
      'outwardTaxable', jsonb_build_object('txval', coalesce((select sum(txval) from x where rate > 0), 0),
          'iamt', coalesce((select sum(iamt) from x where rate > 0), 0), 'camt', coalesce((select sum(camt) from x where rate > 0), 0),
          'samt', coalesce((select sum(samt) from x where rate > 0), 0)),
      'outwardNil', coalesce((select sum(txval) from x where rate = 0), 0),
      'itc', jsonb_build_object('iamt', coalesce((select sum(amt) from itc where code = 'IN_IGST'), 0),
          'camt', coalesce((select sum(amt) from itc where code = 'IN_CGST'), 0), 'samt', coalesce((select sum(amt) from itc where code = 'IN_SGST'), 0)),
      'itcBySource', coalesce((select jsonb_object_agg(source_type, total) from (select source_type, sum(amt) total from itc group by 1) z), '{}'::jsonb),
      'inwardNil', (select jsonb_build_object('intra', intra, 'inter', inter) from inward_nil),
      'booksOutputTax', jsonb_build_object('iamt', coalesce((select amt from books where code = 'OUT_IGST'), 0),
          'camt', coalesce((select amt from books where code = 'OUT_CGST'), 0), 'samt', coalesce((select amt from books where code = 'OUT_SGST'), 0))));
end $$;

-- Composition: CMP-08 (quarterly) and GSTR-4 (annual) summary. Traders pay 1% (0.5% CGST + 0.5% SGST) on turnover of
-- taxable goods; Nil-rated medicines are excluded. Rate of the product on the bill date decides taxable vs nil.
create or replace function composition_summary(p_store uuid, p_from date, p_to date, p_rate_pct numeric default 1) returns jsonb
language plpgsql stable as $$
declare s stores%rowtype;
begin
  select * into s from stores where id = p_store;
  if not found then raise exception 'Store not found' using errcode = 'insufficient_privilege'; end if;
  return (
    with lines as (
      select (b.billed_at at time zone 'Asia/Kolkata')::date as d, l.product_id, l.amount_paise as amt
      from sales_bill_lines l join sales_bills b on b.id = l.bill_id
      where b.store_id = p_store and b.status = 'posted' and (b.billed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
      union all
      select (b.billed_at at time zone 'Asia/Kolkata')::date, rl.product_id, -rl.amount_paise
      from sales_return_lines rl join sales_returns r on r.id = rl.return_id join sales_bills b on b.id = r.bill_id
      where r.store_id = p_store and (r.returned_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    ),
    t as (
      select coalesce(sum(amt), 0)::bigint as turnover,
             coalesce(sum(amt) filter (where coalesce(product_gst_rate(product_id, d), 0) > 0), 0)::bigint as taxable
      from lines
    ),
    inward as (
      select (d.gstin is not null and d.gstin <> '') as registered, pl.gst_rate as rate,
             sum(pl.taxable_paise)::bigint as txval, sum(pl.tax_paise)::bigint as tax, bool_or(pi.inter_state) as inter
      from purchase_lines pl join purchase_invoices pi on pi.id = pl.purchase_id join distributors d on d.id = pi.distributor_id
      where pi.store_id = p_store and pi.supplier_invoice_date between p_from and p_to
      group by 1, 2
    )
    select jsonb_build_object(
      'gstin', s.gstin, 'scheme', s.gst_scheme, 'from', p_from, 'to', p_to, 'ratePct', p_rate_pct,
      'turnover', t.turnover, 'taxableTurnover', t.taxable, 'exemptTurnover', t.turnover - t.taxable,
      'cgst', round(t.taxable * p_rate_pct / 200.0)::bigint, 'sgst', round(t.taxable * p_rate_pct / 200.0)::bigint,
      'inward', coalesce((select jsonb_agg(row_to_json(inward) order by registered desc, rate) from inward), '[]'::jsonb),
      'reverseCharge', 0)
    from t);
end $$;

-- ───────────────────────── Tally export data (UC-ACC-09) ─────────────────────────
create or replace function tally_export(p_org uuid, p_from date, p_to date, p_store uuid default null) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(e order by e->>'date', e->>'createdAt'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', je.id, 'date', je.entry_date, 'createdAt', je.created_at, 'source', je.source_type, 'narration', je.narration,
      'docNo', case je.source_type
        when 'sale' then (select invoice_no from sales_bills where id = je.source_id)
        when 'sale_cancel' then (select invoice_no from sales_bills where id = je.source_id)
        when 'sale_return' then (select credit_note_no from sales_returns where id = je.source_id)
        when 'purchase' then (select supplier_invoice_no from purchase_invoices where id = je.source_id)
        when 'purchase_return' then (select debit_note_no from purchase_returns where id = je.source_id)
        when 'voucher' then (select voucher_no from vouchers where id = je.source_id)
        else null end,
      'voucherKind', case when je.source_type = 'voucher' then (select kind from vouchers where id = je.source_id) end,
      'lines', (select jsonb_agg(jsonb_build_object(
          'ledger', case when a.code = 'DEBTORS' and jl.party_id is not null then
                           coalesce((select coalesce(c.name, 'Customer') || ' (' || c.phone || ')' from customers c where c.id = jl.party_id), a.name)
                         when a.code = 'CREDITORS' and jl.party_id is not null then
                           coalesce((select d.name from distributors d where d.id = jl.party_id), a.name)
                         else a.name end,
          'grp', a.grp, 'code', a.code, 'party', jl.party_id is not null, 'debit', jl.debit_paise, 'credit', jl.credit_paise) order by jl.id)
        from journal_lines jl join accounts a on a.id = jl.account_id where jl.entry_id = je.id)) as e
    from journal_entries je
    where je.org_id = p_org and je.entry_date between p_from and p_to and (p_store is null or je.store_id = p_store)
    order by je.entry_date, je.created_at
    limit 20000
  ) z
$$;

grant execute on function create_account(uuid, text, text), update_account(uuid, text, boolean), set_period_lock(uuid, date, text),
  post_voucher(jsonb), reverse_voucher(uuid, text, date), ledger_report(uuid, date, date, uuid, uuid), trial_balance(uuid, date, date, uuid),
  profit_and_loss(uuid, date, date, uuid), balance_sheet(uuid, date, uuid), margin_report(uuid, date, date, text),
  gstr1(uuid, date, date), gstr3b(uuid, date, date), composition_summary(uuid, date, date, numeric), tally_export(uuid, date, date, uuid),
  fy_start(date), ist_today() to authenticated;
revoke all on function _gst_sales_lines(uuid, date, date) from public;
grant execute on function _gst_sales_lines(uuid, date, date) to authenticated;
