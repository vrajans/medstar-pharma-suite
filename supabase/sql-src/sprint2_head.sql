-- Sprint 2: product master & import (UC-PRD-01..04, 08, 11), Nil-rated product override (UC-GST-01),
-- distributors (UC-PUR-01), GRN refinements (UC-PUR-04/06), opening stock (UC-INV-09), customers & doctors
-- (UC-CRM-01..03), credit sales with limits + receipts (UC-CRM-05), supplier payments (UC-PUR-09).
-- post_sale / post_purchase / pos_catalogue are redefined here (generated from their previous versions
-- by scripts/build-migration-0005.py) so earlier migrations stay untouched.

-- ───────────────────────── schema changes ─────────────────────────
alter table products
  add column gst_rate_override numeric(5,2) check (gst_rate_override is null or gst_rate_override between 0 and 40),
  add column is_active boolean not null default true,
  add column updated_at timestamptz not null default now();
comment on column products.gst_rate_override is 'Product-level GST rate (e.g. the notified Nil-rated life-saving drugs, whose HSN alone does not identify them)';

alter table customers
  add column is_active boolean not null default true,
  add constraint customers_phone_chk check (phone is null or phone ~ '^[0-9]{10}$');

create unique index doctors_org_regno on doctors (org_id, upper(reg_no)) where reg_no is not null;

alter table distributors
  add column is_active boolean not null default true,
  add constraint distributors_gstin_chk check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
create unique index distributors_org_gstin on distributors (org_id, gstin) where gstin is not null;

alter table purchase_invoices add column due_date date;

create policy product_barcodes_del on product_barcodes for delete to authenticated
  using (has_role(org_id, array['owner','admin','purchase']::member_role[]));

-- opening balances account (equity) for existing and new organisations
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
   (p_org,'EXPIRY_LOSS','Expiry & breakage loss','expense'), (p_org,'DISC_RECD','Discount received','income')
  on conflict do nothing
$$;
select seed_chart_of_accounts(id) from orgs;

-- ───────────────────────── helpers ─────────────────────────
create or replace function product_gst_rate(p_product uuid, p_on date) returns numeric
language sql stable as $$
  select coalesce(p.gst_rate_override, resolve_gst_rate(p.hsn, p_on)) from products p where p.id = p_product
$$;

create or replace function party_balance(p_org uuid, p_code text, p_party uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(jl.debit_paise - jl.credit_paise), 0)::bigint
  from journal_lines jl join accounts a on a.id = jl.account_id
  where jl.org_id = p_org and a.code = p_code and jl.party_id = p_party
$$;
revoke all on function party_balance(uuid, text, uuid) from public;

-- only owners/admins may set or change a customer's credit limit (UI hides it too; this is the real guard)
create or replace function guard_credit_limit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.credit_limit_paise is distinct from coalesce(old.credit_limit_paise, 0)
     and not has_role(new.org_id, array['owner','admin']::member_role[]) then
    raise exception 'Only an owner or admin can change credit limits' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger customers_credit_limit_guard before insert or update of credit_limit_paise on customers
  for each row execute function guard_credit_limit();
