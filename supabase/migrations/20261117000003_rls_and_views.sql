-- Row Level Security (ADR-001). Every tenant table is isolated by org_id.

-- 1) Masters: members can read; writes limited by role.
do $$
declare t text;
begin
  foreach t in array array['stores','licences','pharmacists','pharmacist_shifts','products','product_barcodes','customers','consents',
                           'doctors','prescriptions','distributors','accounts','serviceable_pincodes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (is_member(org_id))', t || '_read', t);
    execute format('create policy %I on %I for insert to authenticated with check (has_role(org_id, array[''owner'',''admin'',''pharmacist'',''billing'',''purchase'']::member_role[]))', t || '_ins', t);
    execute format('create policy %I on %I for update to authenticated using (has_role(org_id, array[''owner'',''admin'',''pharmacist'',''purchase'']::member_role[]))', t || '_upd', t);
  end loop;
end $$;

-- 2) Posted documents & ledgers: read-only to members, written only by security-definer posting functions.
do $$
declare t text;
begin
  foreach t in array array['batches','stock_ledger','sales_bills','sales_bill_lines','payments','schedule_register','purchase_invoices',
                           'purchase_lines','journal_entries','journal_lines','audit_log','online_order_items','online_order_prescriptions',
                           'order_status_history'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (is_member(org_id))', t || '_read', t);
    execute format('revoke insert, update, delete on %I from authenticated, anon', t);
  end loop;
end $$;

alter table orgs enable row level security;
create policy orgs_read on orgs for select to authenticated using (is_member(id));

alter table memberships enable row level security;
create policy memberships_self on memberships for select to authenticated using (user_id = auth.uid() or has_role(org_id, array['owner','admin']::member_role[]));
create policy memberships_admin on memberships for all to authenticated using (has_role(org_id, array['owner','admin']::member_role[]));

alter table invoice_series enable row level security;     -- no client access
alter table period_locks enable row level security;
create policy period_locks_read on period_locks for select to authenticated using (is_member(org_id));
create policy period_locks_admin on period_locks for all to authenticated using (has_role(org_id, array['owner','admin']::member_role[]));

alter table tax_rates enable row level security;
create policy tax_rates_read on tax_rates for select to anon, authenticated using (true);

alter table recalls enable row level security;
create policy recalls_read on recalls for select to authenticated using (org_id is null or is_member(org_id));

-- 3) Online orders: store staff + the ordering customer.
alter table online_orders enable row level security;
create policy orders_staff on online_orders for select to authenticated using (is_member(org_id));
create policy orders_customer on online_orders for select to authenticated
  using (customer_id in (select id from customers where auth_user_id = auth.uid()));
create policy orders_staff_upd on online_orders for update to authenticated
  using (has_role(org_id, array['owner','admin','pharmacist','billing','rider']::member_role[]));

create policy customers_self on customers for select to authenticated using (auth_user_id = auth.uid());
create policy prescriptions_self on prescriptions for select to authenticated
  using (customer_id in (select id from customers where auth_user_id = auth.uid()));

-- 4) Storefront catalogue (public): listed products of online-enabled orgs, no cost data.
create or replace view storefront_products with (security_invoker = false) as
  select p.id, p.org_id, p.name, p.manufacturer, p.composition, p.dosage_form, p.category, p.schedule,
         (p.rx_required or p.schedule in ('H','H1','X','NDPS')) as rx_required,
         (p.schedule in ('X','NDPS') or p.habit_forming) as store_only,
         p.cold_chain, p.pack_label, p.units_per_pack,
         (select max(b.pack_mrp_paise) from batches b where b.product_id = p.id and b.status = 'active' and b.expiry >= current_date and b.qty_on_hand > 0) as mrp_paise,
         exists (select 1 from batches b where b.product_id = p.id and b.status = 'active' and b.expiry >= current_date and b.qty_on_hand > 0) as in_stock
  from products p
  where p.listed_online and p.blocked_reason is null
    and exists (select 1 from stores s where s.org_id = p.org_id and s.online_enabled);
grant select on storefront_products to anon, authenticated;

-- 5) Reporting views (security_invoker so RLS applies)
create or replace view v_stock_by_batch with (security_invoker = true) as
  select b.org_id, b.store_id, p.name, p.schedule, b.batch_no, b.expiry, b.qty_on_hand, b.pack_mrp_paise, b.status,
         (b.expiry - current_date) as days_to_expiry,
         round(b.qty_on_hand * b.cost_per_unit_paise) as value_at_cost_paise
  from batches b join products p on p.id = b.product_id;

create or replace view v_trial_balance with (security_invoker = true) as
  select jl.org_id, a.code, a.name, a.type,
         sum(jl.debit_paise) as debit_paise, sum(jl.credit_paise) as credit_paise,
         sum(jl.debit_paise) - sum(jl.credit_paise) as balance_paise
  from journal_lines jl join accounts a on a.id = jl.account_id
  group by jl.org_id, a.code, a.name, a.type;

create or replace view v_gstr1_hsn with (security_invoker = true) as
  select b.org_id, b.store_id, to_char(b.billed_at at time zone 'Asia/Kolkata', 'YYYY-MM') as period, l.hsn, l.gst_rate,
         sum(l.qty_base) as qty_base, sum(l.amount_paise) as value_paise, sum(l.taxable_paise) as taxable_paise,
         sum(l.cgst_paise) as cgst_paise, sum(l.sgst_paise) as sgst_paise, sum(l.igst_paise) as igst_paise
  from sales_bill_lines l join sales_bills b on b.id = l.bill_id
  where b.status = 'posted'
  group by 1,2,3,4,5;

grant execute on function post_sale(jsonb), post_purchase(jsonb), verify_online_rx(uuid, uuid, boolean, text), apply_recall(uuid) to authenticated;
