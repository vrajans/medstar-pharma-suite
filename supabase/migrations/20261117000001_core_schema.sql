-- MedStar Pharma Suite — core schema v1
-- Owner: database-engineer · Reviewed: cto, security-privacy, pharmacy-sme, accounting-sme
-- Money is integer paise (bigint). Quantities are integer base units (tablet, ml, piece).

create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- ───────────────────────── enums ─────────────────────────
create type gst_scheme      as enum ('regular','composition');
create type member_role     as enum ('owner','admin','pharmacist','billing','purchase','accountant','rider','auditor');
create type drug_schedule   as enum ('OTC','G','H','H1','X','C','C1','NDPS');
create type batch_status    as enum ('active','quarantined','recalled','nsq');
create type pay_mode        as enum ('cash','upi','card','credit','wallet');
create type doc_type        as enum ('sale','sale_return','purchase','purchase_return','stock_adjust','transfer_out','transfer_in','opening');
create type order_status    as enum ('placed','rx_verification','confirmed','picking','packed','out_for_delivery','ready_for_pickup','delivered','cancelled','rejected','returned');
create type account_type    as enum ('asset','liability','equity','income','expense');

-- ───────────────────────── tenancy ─────────────────────────
create table orgs (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text,
  pan text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  created_at timestamptz not null default now()
);

create table stores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  code text not null check (code ~ '^[A-Z0-9]{1,5}$'),       -- invoice series prefix
  name text not null,
  gstin text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  gst_scheme gst_scheme not null default 'regular',
  state_code char(2) not null,
  address text not null,
  pincode char(6) not null,
  phone text,
  online_enabled boolean not null default false,
  pharmacist_presence text not null default 'hard' check (pharmacist_presence in ('hard','soft')),
  rx_validity_days int not null default 180,
  near_expiry_days int not null default 30,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table memberships (
  user_id uuid not null,               -- auth.users.id
  org_id uuid not null references orgs(id),
  role member_role not null,
  store_ids uuid[] ,                    -- null = all stores
  max_discount_pct numeric(5,2) not null default 10,
  active boolean not null default true,
  primary key (user_id, org_id)
);

create table licences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  store_id uuid not null references stores(id),
  kind text not null,                   -- 'Form 20','Form 21','Form 20F', 'FSSAI', 'Shop & Establishment' …
  number text not null,
  valid_from date,
  valid_to date,
  document_path text
);

create table pharmacists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  user_id uuid,
  name text not null,
  council text not null,                -- State Pharmacy Council
  reg_no text not null,
  reg_valid_to date,
  pin_hash text,                         -- crypt() hash of approval PIN
  unique (org_id, reg_no)
);

create table pharmacist_shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  store_id uuid not null references stores(id),
  pharmacist_id uuid not null references pharmacists(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- ───────────────────────── helpers ─────────────────────────
create or replace function is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.active)
$$;

create or replace function has_role(p_org uuid, p_roles member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.active and m.role = any(p_roles))
$$;

create or replace function has_store_access(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join stores s on s.org_id = m.org_id
    where s.id = p_store and m.user_id = auth.uid() and m.active
      and (m.store_ids is null or p_store = any(m.store_ids)))
$$;

-- ───────────────────────── tax & products ─────────────────────────
create table tax_rates (                  -- global, maintained by platform (accounting-sme)
  id bigserial primary key,
  hsn_prefix text not null,
  rate numeric(5,2) not null check (rate >= 0),
  effective_from date not null,
  effective_to date,
  note text,
  unique (hsn_prefix, effective_from)
);

create or replace function resolve_gst_rate(p_hsn text, p_on date) returns numeric
language sql stable as $$
  select rate from tax_rates
  where p_hsn like hsn_prefix || '%' and effective_from <= p_on and (effective_to is null or p_on <= effective_to)
  order by length(hsn_prefix) desc, effective_from desc limit 1
$$;

create table products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  name text not null,
  manufacturer text,
  composition text,                     -- salt + strength, e.g. "Paracetamol 650mg"
  dosage_form text,                     -- tablet, syrup, injection …
  category text not null default 'Rx',
  hsn text not null check (hsn ~ '^[0-9]{4,8}$'),
  schedule drug_schedule not null default 'OTC',
  rx_required boolean not null default false,
  habit_forming boolean not null default false,
  cold_chain boolean not null default false,
  pack_label text not null default 'Strip',   -- unit the MRP is printed on
  base_unit_label text not null default 'Tab',
  units_per_pack int not null default 1 check (units_per_pack > 0),
  allow_loose boolean not null default true,
  listed_online boolean not null default false,
  blocked_reason text,                  -- banned FDC / NSQ at product level
  reorder_level int not null default 0,
  rack text,
  created_at timestamptz not null default now()
);
create index products_name_trgm on products using gin (name gin_trgm_ops);
create index products_comp_trgm on products using gin (composition gin_trgm_ops);
create index products_org on products(org_id);

create table product_barcodes (
  barcode text not null,
  org_id uuid not null references orgs(id),
  product_id uuid not null references products(id),
  primary key (org_id, barcode)
);

create table batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  store_id uuid not null references stores(id),
  product_id uuid not null references products(id),
  batch_no text not null,
  expiry date not null,
  pack_mrp_paise bigint not null check (pack_mrp_paise > 0),
  cost_per_unit_paise numeric(14,4) not null default 0,  -- landed cost per base unit (ex-GST for regular dealers)
  qty_on_hand int not null default 0,
  status batch_status not null default 'active',
  received_at timestamptz not null default now(),
  unique (store_id, product_id, batch_no, pack_mrp_paise)
);
create index batches_fefo on batches(store_id, product_id, expiry, received_at) where status = 'active';

-- Append-only stock movements
create table stock_ledger (
  id bigserial primary key,
  org_id uuid not null,
  store_id uuid not null,
  batch_id uuid not null references batches(id),
  product_id uuid not null,
  doc_type doc_type not null,
  doc_id uuid not null,
  qty_delta int not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index stock_ledger_doc on stock_ledger(doc_id);

-- ───────────────────────── parties ─────────────────────────
create table customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  auth_user_id uuid,                    -- storefront login
  name text,
  phone text,
  address text,
  gstin text,
  credit_limit_paise bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, phone)
);

create table consents (
  id bigserial primary key,
  org_id uuid not null references orgs(id),
  customer_id uuid not null references customers(id),
  purpose text not null check (purpose in ('service','refill_reminders','marketing')),
  notice_version text not null,
  granted boolean not null,
  channel text not null,
  created_at timestamptz not null default now()
);

create table doctors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  name text not null,
  qualification text,
  council text,
  reg_no text,
  address text,
  phone text
);

create table prescriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  customer_id uuid references customers(id),
  doctor_id uuid references doctors(id),
  prescriber_name text,
  prescriber_reg_no text,
  prescriber_address text,
  patient_name text,
  patient_address text,
  rx_date date,
  image_path text,                       -- storage: prescriptions/{org_id}/...
  verified_by uuid references pharmacists(id),
  verified_at timestamptz,
  verification_status text not null default 'pending' check (verification_status in ('pending','approved','rejected','partial')),
  rejection_reason text,
  times_used int not null default 0,
  created_at timestamptz not null default now()
);

create table distributors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  name text not null,
  gstin text,
  state_code char(2) not null,
  drug_licence_no text not null,
  drug_licence_valid_to date,
  credit_days int not null default 30,
  phone text
);

-- ───────────────────────── accounting ─────────────────────────
create table accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  code text not null,                     -- system code e.g. CASH, SALES_5, OUT_CGST
  name text not null,
  type account_type not null,
  party_id uuid,                          -- customer / distributor sub-ledger
  unique (org_id, code)
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  store_id uuid,
  entry_date date not null,
  source_type text not null,
  source_id uuid,
  narration text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table journal_lines (
  id bigserial primary key,
  entry_id uuid not null references journal_entries(id),
  org_id uuid not null,
  account_id uuid not null references accounts(id),
  debit_paise bigint not null default 0 check (debit_paise >= 0),
  credit_paise bigint not null default 0 check (credit_paise >= 0),
  party_id uuid,
  check (debit_paise = 0 or credit_paise = 0)
);

create table period_locks (
  org_id uuid primary key references orgs(id),
  locked_until date not null
);

create or replace function seed_chart_of_accounts(p_org uuid) returns void
language sql security definer set search_path = public as $$
  insert into accounts (org_id, code, name, type) values
   (p_org,'CASH','Cash in hand','asset'), (p_org,'UPI_CLR','UPI clearing','asset'), (p_org,'CARD_CLR','Card clearing','asset'),
   (p_org,'WALLET_CLR','Wallet clearing','asset'), (p_org,'BANK','Bank','asset'), (p_org,'DEBTORS','Sundry debtors','asset'),
   (p_org,'INVENTORY','Stock in trade','asset'), (p_org,'IN_CGST','Input CGST','asset'), (p_org,'IN_SGST','Input SGST','asset'),
   (p_org,'IN_IGST','Input IGST','asset'), (p_org,'CREDITORS','Sundry creditors','liability'),
   (p_org,'OUT_CGST','Output CGST','liability'), (p_org,'OUT_SGST','Output SGST','liability'), (p_org,'OUT_IGST','Output IGST','liability'),
   (p_org,'CAPITAL','Capital','equity'), (p_org,'SALES','Sales','income'), (p_org,'SALES_RET','Sales returns','income'),
   (p_org,'ROUND_OFF','Round off','expense'), (p_org,'COGS','Cost of goods sold','expense'),
   (p_org,'EXPIRY_LOSS','Expiry & breakage loss','expense'), (p_org,'DISC_RECD','Discount received','income')
  on conflict do nothing
$$;

create or replace function acct(p_org uuid, p_code text) returns uuid
language sql stable as $$ select id from accounts where org_id = p_org and code = p_code $$;

-- Balanced-entry check at commit time
create or replace function check_journal_balanced() returns trigger language plpgsql as $$
declare d bigint; c bigint;
begin
  select coalesce(sum(debit_paise),0), coalesce(sum(credit_paise),0) into d, c from journal_lines where entry_id = new.entry_id;
  if d <> c then raise exception 'Journal entry % not balanced (Dr % / Cr %)', new.entry_id, d, c; end if;
  return null;
end $$;
create constraint trigger journal_balanced after insert on journal_lines
  deferrable initially deferred for each row execute function check_journal_balanced();

-- ───────────────────────── invoice series ─────────────────────────
create table invoice_series (
  store_id uuid not null references stores(id),
  doc text not null,                     -- 'SALE','CN','DN','PUR'
  fy text not null,                      -- '26-27'
  next_seq int not null default 1,
  primary key (store_id, doc, fy)
);

create or replace function fy_label(d date) returns text language sql immutable as $$
  select lpad(((case when extract(month from d) >= 4 then extract(year from d) else extract(year from d) - 1 end)::int % 100)::text, 2, '0')
      || '-' ||
      lpad((((case when extract(month from d) >= 4 then extract(year from d) else extract(year from d) - 1 end)::int + 1) % 100)::text, 2, '0')
$$;

create or replace function next_invoice_no(p_store uuid, p_doc text, p_date date) returns text
language plpgsql as $$
declare v_fy text := fy_label(p_date); v_seq int; v_code text; v_prefix text; v_series text;
begin
  select code into v_code from stores where id = p_store;
  v_series := case p_doc when 'SALE' then v_code when 'CN' then left(v_code,3) || 'CN' else left(v_code,3) || p_doc end;
  insert into invoice_series(store_id, doc, fy) values (p_store, p_doc, v_fy) on conflict do nothing;
  update invoice_series set next_seq = next_seq + 1
    where store_id = p_store and doc = p_doc and fy = v_fy returning next_seq - 1 into v_seq;
  v_prefix := left(v_series, 5) || '/' || v_fy || '/';
  return v_prefix || lpad(v_seq::text, greatest(4, 16 - length(v_prefix)), '0');
end $$;

-- ───────────────────────── sales ─────────────────────────
create table sales_bills (
  id uuid primary key default gen_random_uuid(),
  bill_uuid uuid not null unique,         -- idempotency key from POS
  org_id uuid not null,
  store_id uuid not null references stores(id),
  invoice_no text not null,
  provisional_no text,
  document_type text not null check (document_type in ('TAX_INVOICE','BILL_OF_SUPPLY')),
  channel text not null default 'counter' check (channel in ('counter','online','phone')),
  online_order_id uuid,
  billed_at timestamptz not null,
  customer_id uuid references customers(id),
  prescription_id uuid references prescriptions(id),
  pharmacist_id uuid references pharmacists(id),
  gross_paise bigint not null, discount_paise bigint not null, taxable_paise bigint not null,
  cgst_paise bigint not null, sgst_paise bigint not null, igst_paise bigint not null,
  round_off_paise bigint not null, total_paise bigint not null,
  status text not null default 'posted' check (status in ('posted','cancelled')),
  needs_review boolean not null default false,
  review_note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (store_id, invoice_no)
);

create table sales_bill_lines (
  id bigserial primary key,
  bill_id uuid not null references sales_bills(id),
  org_id uuid not null,
  product_id uuid not null references products(id),
  batch_id uuid not null references batches(id),
  hsn text not null,
  schedule drug_schedule not null,
  qty_base int not null,
  pack_mrp_paise bigint not null,
  units_per_pack int not null,
  discount_pct numeric(6,3) not null default 0,
  gross_paise bigint not null, amount_paise bigint not null, taxable_paise bigint not null,
  gst_rate numeric(5,2) not null, cgst_paise bigint not null, sgst_paise bigint not null, igst_paise bigint not null,
  cost_paise bigint not null default 0
);

create table payments (
  id bigserial primary key,
  org_id uuid not null,
  bill_id uuid references sales_bills(id),
  mode pay_mode not null,
  amount_paise bigint not null,
  reference text,
  created_at timestamptz not null default now()
);

-- Statutory registers: Schedule H1 / X / NDPS (append-only, retained ≥ 3 / 2 years)
create table schedule_register (
  id bigserial primary key,
  org_id uuid not null,
  store_id uuid not null,
  schedule drug_schedule not null check (schedule in ('H1','X','NDPS')),
  entry_date date not null,
  bill_id uuid not null references sales_bills(id),
  invoice_no text not null,
  patient_name text not null,
  patient_address text not null,
  prescriber_name text not null,
  prescriber_reg_no text not null,
  prescriber_address text,
  product_id uuid not null,
  product_name text not null,
  batch_no text not null,
  qty_base int not null,
  pharmacist_id uuid,
  prescription_id uuid,
  created_at timestamptz not null default now()
);

-- ───────────────────────── purchase ─────────────────────────
create table purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  org_id uuid not null,
  store_id uuid not null references stores(id),
  distributor_id uuid not null references distributors(id),
  supplier_invoice_no text not null,
  supplier_invoice_date date not null,
  inter_state boolean not null,
  taxable_paise bigint not null, cgst_paise bigint not null, sgst_paise bigint not null, igst_paise bigint not null,
  round_off_paise bigint not null, total_paise bigint not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, distributor_id, supplier_invoice_no)
);

create table purchase_lines (
  id bigserial primary key,
  purchase_id uuid not null references purchase_invoices(id),
  org_id uuid not null,
  product_id uuid not null references products(id),
  batch_id uuid not null references batches(id),
  qty_packs int not null check (qty_packs >= 0),
  free_packs int not null default 0 check (free_packs >= 0),
  pack_rate_paise bigint not null,       -- PTR per pack (ex-GST)
  discount_pct numeric(6,3) not null default 0,
  gst_rate numeric(5,2) not null,
  taxable_paise bigint not null, tax_paise bigint not null
);

-- ───────────────────────── online orders ─────────────────────────
create table online_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  store_id uuid not null references stores(id),
  customer_id uuid not null references customers(id),
  order_no text not null,
  fulfilment text not null check (fulfilment in ('delivery','pickup')),
  delivery_address text,
  delivery_pincode char(6),
  payment_mode text not null check (payment_mode in ('prepaid','cod','pay_at_store')),
  payment_status text not null default 'pending',
  status order_status not null default 'placed',
  has_rx_items boolean not null default false,
  rx_approved boolean not null default false,
  invoice_bill_id uuid references sales_bills(id),
  delivery_otp_hash text,
  delivery_otp_verified boolean not null default false,
  rider_user_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table online_order_items (
  id bigserial primary key,
  order_id uuid not null references online_orders(id),
  org_id uuid not null,
  product_id uuid not null references products(id),
  qty_base int not null check (qty_base > 0),
  approved_qty_base int
);

create table online_order_prescriptions (
  order_id uuid not null references online_orders(id),
  prescription_id uuid not null references prescriptions(id),
  org_id uuid not null,
  primary key (order_id, prescription_id)
);

create table order_status_history (
  id bigserial primary key,
  order_id uuid not null references online_orders(id),
  org_id uuid not null,
  from_status order_status,
  to_status order_status not null,
  changed_by uuid,
  note text,
  created_at timestamptz not null default now()
);

create table serviceable_pincodes (
  store_id uuid not null references stores(id),
  org_id uuid not null,
  pincode char(6) not null,
  delivery_fee_paise bigint not null default 0,
  primary key (store_id, pincode)
);

-- Lifecycle guard (mirror of packages/core/src/order.ts)
create or replace function enforce_order_transition() returns trigger language plpgsql security definer set search_path = public as $$
declare allowed order_status[];
begin
  if new.status = old.status then return new; end if;
  allowed := case old.status
    when 'placed' then array['rx_verification','confirmed','cancelled']
    when 'rx_verification' then array['confirmed','rejected','cancelled']
    when 'confirmed' then array['picking','cancelled']
    when 'picking' then array['packed','cancelled']
    when 'packed' then array['out_for_delivery','ready_for_pickup']
    when 'out_for_delivery' then array['delivered','returned']
    when 'ready_for_pickup' then array['delivered','cancelled']
    when 'delivered' then array['returned']
    else array[]::text[] end::order_status[];
  if not new.status = any(allowed) then
    raise exception 'Invalid order transition % → %', old.status, new.status using errcode = 'check_violation';
  end if;
  if old.status = 'placed' and new.status = 'confirmed' and new.has_rx_items then
    raise exception 'Order has prescription items: pharmacist verification required' using errcode = 'check_violation';
  end if;
  if new.status = 'confirmed' and new.has_rx_items and not new.rx_approved then
    raise exception 'Pharmacist approval of prescription is required' using errcode = 'check_violation';
  end if;
  if new.status in ('out_for_delivery','ready_for_pickup') and new.invoice_bill_id is null then
    raise exception 'Invoice must be generated before dispatch' using errcode = 'check_violation';
  end if;
  if old.status = 'out_for_delivery' and new.status = 'delivered' and not new.delivery_otp_verified then
    raise exception 'Delivery OTP must be verified' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  insert into order_status_history(order_id, org_id, from_status, to_status, changed_by)
    values (new.id, new.org_id, old.status, new.status, auth.uid());
  return new;
end $$;
create trigger online_orders_transition before update of status on online_orders
  for each row execute function enforce_order_transition();

-- Block Schedule X / NDPS / habit-forming items on delivery orders (UC-OMS-05)
create or replace function enforce_online_item_rules() returns trigger language plpgsql security definer set search_path = public as $$
declare v_f text; p record;
begin
  select fulfilment into v_f from online_orders where id = new.order_id;
  select schedule, habit_forming, rx_required, name into p from products where id = new.product_id;
  if v_f = 'delivery' and (p.schedule in ('X','NDPS') or p.habit_forming) then
    raise exception '% cannot be delivered; buy at the store with the original prescription', p.name using errcode = 'check_violation';
  end if;
  if p.rx_required or p.schedule in ('H','H1','X','NDPS') then
    update online_orders set has_rx_items = true where id = new.order_id and not has_rx_items;
  end if;
  return new;
end $$;
create trigger online_order_items_rules before insert on online_order_items
  for each row execute function enforce_online_item_rules();

-- ───────────────────────── recalls & audit ─────────────────────────
create table recalls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,                           -- null = platform-wide CDSCO alert
  product_name text not null,
  manufacturer text,
  batch_no text not null,
  reason text not null,
  source text,                           -- 'CDSCO NSQ Oct-2026', 'manufacturer'
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  org_id uuid,
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only; post a reversal instead', tg_table_name using errcode = 'insufficient_privilege';
end $$;
create trigger stock_ledger_ro       before update or delete on stock_ledger       for each row execute function forbid_mutation();
create trigger journal_lines_ro      before update or delete on journal_lines      for each row execute function forbid_mutation();
create trigger journal_entries_ro    before update or delete on journal_entries    for each row execute function forbid_mutation();
create trigger schedule_register_ro  before update or delete on schedule_register  for each row execute function forbid_mutation();
create trigger audit_log_ro          before update or delete on audit_log          for each row execute function forbid_mutation();
create trigger sales_lines_ro        before update or delete on sales_bill_lines   for each row execute function forbid_mutation();
create trigger payments_ro           before update or delete on payments           for each row execute function forbid_mutation();
