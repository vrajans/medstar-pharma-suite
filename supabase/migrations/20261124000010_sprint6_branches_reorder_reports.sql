-- Sprint 6: run two branches side by side.
-- 1. Stock transfer between branches (send → in transit → receive, shortages, cancel)       UC-INV-05
-- 2. Short list (reorder suggestions) and purchase orders to distributors                   UC-PUR-01/02
-- 3. Owner reports: sales summary (day / payment mode / staff / hour), doctor-wise sales,
--    non-moving stock, stock valuation                                                     UC-RPT-01..05
-- New functions get explicit grants: since migration 0009, functions are not executable by default.

create or replace function _patch_function(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_fn);
begin
  if position(p_from in d) = 0 then raise exception 'patch of %: text not found [%]', p_fn, p_from; end if;
  execute replace(d, p_from, p_to);
end $$;

-- ───────────────────────── stock in transit ledger ─────────────────────────
select _patch_function('seed_chart_of_accounts(uuid)'::regprocedure,
  '(''INVENTORY'',''Stock in trade'',''stock''),', '(''INVENTORY'',''Stock in trade'',''stock''), (''STOCK_TRANSIT'',''Stock in transit (branch transfers)'',''stock''),');
select seed_chart_of_accounts(id) from orgs;

-- ───────────────────────── 1. stock transfers ─────────────────────────
create table stock_transfers (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  org_id uuid not null references orgs(id),
  from_store_id uuid not null references stores(id),
  to_store_id uuid not null references stores(id),
  transfer_no text not null,
  status text not null default 'in_transit' check (status in ('in_transit','received','cancelled')),
  note text,
  value_paise bigint not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  received_by uuid, received_at timestamptz, receive_note text,
  cancelled_by uuid, cancelled_at timestamptz, cancel_reason text,
  check (from_store_id <> to_store_id),
  unique (from_store_id, transfer_no)
);
create index stock_transfers_to on stock_transfers(to_store_id, status);
create table stock_transfer_lines (
  id bigserial primary key,
  transfer_id uuid not null references stock_transfers(id),
  org_id uuid not null,
  product_id uuid not null references products(id),
  from_batch_id uuid not null references batches(id),
  batch_no text not null,
  expiry date not null,
  pack_mrp_paise bigint not null,
  cost_per_unit_paise numeric(14,4) not null,
  qty_base int not null check (qty_base > 0),
  received_qty int check (received_qty >= 0 and received_qty <= qty_base),
  to_batch_id uuid references batches(id)
);
alter table stock_transfers enable row level security;
alter table stock_transfer_lines enable row level security;
create policy stock_transfers_read on stock_transfers for select to authenticated
  using (is_member(org_id) and (has_store_access(from_store_id) or has_store_access(to_store_id)));
create policy stock_transfer_lines_read on stock_transfer_lines for select to authenticated
  using (exists (select 1 from stock_transfers t where t.id = transfer_id));
revoke insert, update, delete on stock_transfers, stock_transfer_lines from authenticated, anon;

-- p: { idempotencyKey, fromStoreId, toStoreId, note?, lines: [{ batchId, qtyBase }] }
create or replace function post_stock_transfer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fs stores%rowtype; ts stores%rowtype; v_id uuid := gen_random_uuid(); v_no text; l jsonb; b batches%rowtype;
        v_qty int; v_val bigint := 0; v_je uuid; v_existing stock_transfers%rowtype; v_controlled int := 0; pr products%rowtype;
begin
  select * into v_existing from stock_transfers where idempotency_key = (p->>'idempotencyKey')::uuid;
  if found then return jsonb_build_object('transferId', v_existing.id, 'transferNo', v_existing.transfer_no, 'duplicate', true); end if;
  select * into fs from stores where id = (p->>'fromStoreId')::uuid;
  select * into ts from stores where id = (p->>'toStoreId')::uuid;
  if fs.id is null or ts.id is null or fs.org_id <> ts.org_id or fs.id = ts.id then raise exception 'Choose two different branches of your pharmacy' using errcode = 'check_violation'; end if;
  if not has_store_access(fs.id) or not has_role(fs.org_id, array['owner','admin','pharmacist','purchase']::member_role[]) then
    raise exception 'Only the owner, admin, pharmacist or purchase staff of the sending branch can transfer stock' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(fs.gstin, '') <> coalesce(ts.gstin, '') then
    raise exception 'These branches have different GSTINs, so a transfer is a taxable sale between two registrations and needs a tax invoice. MedStar handles transfers only between branches under one GSTIN.'
      using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'Add at least one item' using errcode = 'check_violation'; end if;

  v_no := next_invoice_no(fs.id, 'ST', ist_today());
  insert into stock_transfers (id, idempotency_key, org_id, from_store_id, to_store_id, transfer_no, note, created_by)
  values (v_id, (p->>'idempotencyKey')::uuid, fs.org_id, fs.id, ts.id, v_no, nullif(trim(p->>'note'), ''), auth.uid());

  for l in select * from jsonb_array_elements(p->'lines') loop
    v_qty := (l->>'qtyBase')::int;
    select * into b from batches where id = (l->>'batchId')::uuid and store_id = fs.id for update;
    if not found then raise exception 'Batch not found in %', fs.code using errcode = 'check_violation'; end if;
    select * into pr from products where id = b.product_id;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity for % must be more than zero', pr.name using errcode = 'check_violation'; end if;
    if b.status <> 'active' then raise exception '% batch % is %, it cannot be transferred', pr.name, b.batch_no, b.status using errcode = 'check_violation'; end if;
    if b.expiry < ist_today() then raise exception '% batch % has expired — return it to the distributor instead', pr.name, b.batch_no using errcode = 'check_violation'; end if;
    if b.qty_on_hand < v_qty then raise exception 'Only % % of % (batch %) in stock', b.qty_on_hand, pr.base_unit_label, pr.name, b.batch_no using errcode = 'check_violation'; end if;
    update batches set qty_on_hand = qty_on_hand - v_qty where id = b.id;
    insert into stock_ledger (org_id, store_id, batch_id, product_id, doc_type, doc_id, qty_delta, created_by)
    values (fs.org_id, fs.id, b.id, b.product_id, 'transfer_out', v_id, -v_qty, auth.uid());
    insert into stock_transfer_lines (transfer_id, org_id, product_id, from_batch_id, batch_no, expiry, pack_mrp_paise, cost_per_unit_paise, qty_base)
    values (v_id, fs.org_id, b.product_id, b.id, b.batch_no, b.expiry, b.pack_mrp_paise, b.cost_per_unit_paise, v_qty);
    v_val := v_val + round(v_qty * b.cost_per_unit_paise)::bigint;
    if pr.schedule in ('H1','X','NDPS') then v_controlled := v_controlled + 1; end if;
  end loop;

  if v_val > 0 then
    insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
    values (fs.org_id, fs.id, ist_today(), 'stock_transfer', v_id, 'Stock sent ' || v_no || ' to ' || ts.code, auth.uid()) returning id into v_je;
    insert into journal_lines (entry_id, org_id, account_id, debit_paise, credit_paise) values
      (v_je, fs.org_id, acct(fs.org_id, 'STOCK_TRANSIT'), v_val, 0),
      (v_je, fs.org_id, acct(fs.org_id, 'INVENTORY'), 0, v_val);
  end if;
  update stock_transfers set value_paise = v_val where id = v_id;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (fs.org_id, auth.uid(), 'stock_transfer_sent', 'stock_transfers', v_id::text,
          jsonb_build_object('transferNo', v_no, 'to', ts.code, 'lines', jsonb_array_length(p->'lines'), 'controlledLines', v_controlled, 'valuePaise', v_val));
  return jsonb_build_object('transferId', v_id, 'transferNo', v_no, 'valuePaise', v_val, 'duplicate', false);
end $$;

-- p_lines: [{ lineId, receivedQty }] — omit for "all received in full". A shortage needs a note and is written off to Stock adjustments.
create or replace function receive_stock_transfer(p_transfer uuid, p_lines jsonb default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t stock_transfers%rowtype; ts stores%rowtype; l stock_transfer_lines%rowtype; v_rq int; v_bid uuid;
        v_recv bigint := 0; v_short bigint := 0; v_line_val bigint; v_line_recv bigint; v_je uuid; n_short int := 0;
begin
  select * into t from stock_transfers where id = p_transfer for update;
  if not found then raise exception 'Transfer not found' using errcode = 'check_violation'; end if;
  select * into ts from stores where id = t.to_store_id;
  if not has_store_access(ts.id) or not has_role(ts.org_id, array['owner','admin','pharmacist','purchase']::member_role[]) then
    raise exception 'Only the owner, admin, pharmacist or purchase staff of the receiving branch can receive stock' using errcode = 'insufficient_privilege';
  end if;
  if t.status <> 'in_transit' then raise exception 'Transfer % is already %', t.transfer_no, t.status using errcode = 'check_violation'; end if;

  for l in select * from stock_transfer_lines where transfer_id = t.id order by id loop
    v_rq := coalesce((select (x->>'receivedQty')::int from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x where (x->>'lineId')::bigint = l.id), l.qty_base);
    if v_rq < 0 or v_rq > l.qty_base then raise exception 'Received quantity must be between 0 and %', l.qty_base using errcode = 'check_violation'; end if;
    v_line_val := round(l.qty_base * l.cost_per_unit_paise)::bigint;
    v_line_recv := round(v_rq * l.cost_per_unit_paise)::bigint;
    v_bid := null;
    if v_rq > 0 then
      insert into batches (org_id, store_id, product_id, batch_no, expiry, pack_mrp_paise, cost_per_unit_paise, qty_on_hand)
      values (t.org_id, ts.id, l.product_id, l.batch_no, l.expiry, l.pack_mrp_paise, l.cost_per_unit_paise, v_rq)
      on conflict (store_id, product_id, batch_no, pack_mrp_paise) do update
        set cost_per_unit_paise = case when batches.qty_on_hand + excluded.qty_on_hand > 0
              then (batches.qty_on_hand * batches.cost_per_unit_paise + excluded.qty_on_hand * excluded.cost_per_unit_paise) / (batches.qty_on_hand + excluded.qty_on_hand)
              else excluded.cost_per_unit_paise end,
            qty_on_hand = batches.qty_on_hand + excluded.qty_on_hand
      returning id into v_bid;
      insert into stock_ledger (org_id, store_id, batch_id, product_id, doc_type, doc_id, qty_delta, created_by)
      values (t.org_id, ts.id, v_bid, l.product_id, 'transfer_in', t.id, v_rq, auth.uid());
    end if;
    if v_rq < l.qty_base then n_short := n_short + 1; end if;
    update stock_transfer_lines set received_qty = v_rq, to_batch_id = v_bid where id = l.id;
    v_recv := v_recv + v_line_recv; v_short := v_short + (v_line_val - v_line_recv);
  end loop;
  if n_short > 0 and length(coalesce(trim(p_note), '')) < 5 then
    raise exception 'Some items arrived short — add a note (what happened) before receiving' using errcode = 'check_violation';
  end if;

  if v_recv + v_short > 0 then
    insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
    values (t.org_id, ts.id, ist_today(), 'stock_transfer', t.id, 'Stock received ' || t.transfer_no || coalesce(' · ' || nullif(trim(p_note), ''), ''), auth.uid())
    returning id into v_je;
    insert into journal_lines (entry_id, org_id, account_id, debit_paise, credit_paise)
    select v_je, t.org_id, acct(t.org_id, x.code), x.dr, x.cr from (values ('INVENTORY', v_recv, 0::bigint), ('STOCK_ADJ', v_short, 0::bigint), ('STOCK_TRANSIT', 0::bigint, v_recv + v_short)) x(code, dr, cr)
    where x.dr > 0 or x.cr > 0;
  end if;
  update stock_transfers set status = 'received', received_by = auth.uid(), received_at = now(), receive_note = nullif(trim(p_note), '') where id = t.id;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (t.org_id, auth.uid(), 'stock_transfer_received', 'stock_transfers', t.id::text,
          jsonb_build_object('transferNo', t.transfer_no, 'shortLines', n_short, 'shortPaise', v_short, 'note', p_note));
  return jsonb_build_object('transferNo', t.transfer_no, 'receivedPaise', v_recv, 'shortPaise', v_short, 'shortLines', n_short);
end $$;

create or replace function cancel_stock_transfer(p_transfer uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t stock_transfers%rowtype; l stock_transfer_lines%rowtype; v_je uuid;
begin
  select * into t from stock_transfers where id = p_transfer for update;
  if not found or not has_store_access(t.from_store_id) or not has_role(t.org_id, array['owner','admin','pharmacist','purchase']::member_role[]) then
    raise exception 'Only the sending branch can cancel a transfer' using errcode = 'insufficient_privilege';
  end if;
  if t.status <> 'in_transit' then raise exception 'Only a transfer still in transit can be cancelled (this one is %)', t.status using errcode = 'check_violation'; end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'Give a reason for cancelling' using errcode = 'check_violation'; end if;
  for l in select * from stock_transfer_lines where transfer_id = t.id loop
    update batches set qty_on_hand = qty_on_hand + l.qty_base where id = l.from_batch_id;
    insert into stock_ledger (org_id, store_id, batch_id, product_id, doc_type, doc_id, qty_delta, created_by)
    values (t.org_id, t.from_store_id, l.from_batch_id, l.product_id, 'transfer_out', t.id, l.qty_base, auth.uid());
  end loop;
  if t.value_paise > 0 then
    insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
    values (t.org_id, t.from_store_id, ist_today(), 'stock_transfer', t.id, 'Transfer cancelled ' || t.transfer_no || ': ' || trim(p_reason), auth.uid()) returning id into v_je;
    insert into journal_lines (entry_id, org_id, account_id, debit_paise, credit_paise) values
      (v_je, t.org_id, acct(t.org_id, 'INVENTORY'), t.value_paise, 0),
      (v_je, t.org_id, acct(t.org_id, 'STOCK_TRANSIT'), 0, t.value_paise);
  end if;
  update stock_transfers set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = trim(p_reason) where id = t.id;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (t.org_id, auth.uid(), 'stock_transfer_cancelled', 'stock_transfers', t.id::text, jsonb_build_object('transferNo', t.transfer_no, 'reason', p_reason));
end $$;

-- ───────────────────────── 2. short list & purchase orders ─────────────────────────
-- Suggest what to buy: stock below the reorder level (packs), or below what sold in the last p_days.
create or replace function reorder_suggestions(p_store uuid, p_days int default 30) returns jsonb
language sql stable as $$
  with stock as (
    select product_id, sum(qty_on_hand)::bigint as qty from batches
    where store_id = p_store and status = 'active' and expiry >= ist_today() group by product_id
  ),
  sold as (
    select l.product_id, sum(l.qty_base)::bigint as qty from sales_bill_lines l join sales_bills b on b.id = l.bill_id
    where b.store_id = p_store and b.status = 'posted' and b.billed_at >= now() - make_interval(days => p_days) group by l.product_id
  ),
  last_buy as (
    select distinct on (pl.product_id) pl.product_id, pi.distributor_id, d.name as distributor, pl.pack_rate_paise, pi.supplier_invoice_date
    from purchase_lines pl join purchase_invoices pi on pi.id = pl.purchase_id join distributors d on d.id = pi.distributor_id
    where pi.store_id = p_store order by pl.product_id, pi.supplier_invoice_date desc, pl.id desc
  ),
  c as (
    select p.id, p.name, p.manufacturer, p.pack_label, p.units_per_pack, p.reorder_level, p.rack, p.schedule,
           coalesce(s.qty, 0) as stock_base, coalesce(so.qty, 0) as sold_base,
           greatest(p.reorder_level * p.units_per_pack * 2, coalesce(so.qty, 0)) as target_base,
           lb.distributor_id, lb.distributor, lb.pack_rate_paise
    from products p left join stock s on s.product_id = p.id left join sold so on so.product_id = p.id left join last_buy lb on lb.product_id = p.id
    where p.org_id = (select org_id from stores where id = p_store) and p.is_active and p.blocked_reason is null
      and ((p.reorder_level > 0 and coalesce(s.qty, 0) <= p.reorder_level * p.units_per_pack) or (coalesce(so.qty, 0) > 0 and coalesce(s.qty, 0) < coalesce(so.qty, 0)))
  )
  select coalesce(jsonb_agg(jsonb_build_object('productId', id, 'name', name, 'manufacturer', manufacturer, 'packLabel', pack_label, 'unitsPerPack', units_per_pack,
           'schedule', schedule, 'rack', rack, 'stockBase', stock_base, 'soldBase', sold_base, 'reorderLevel', reorder_level,
           'suggestedPacks', greatest(1, ceil((target_base - stock_base)::numeric / units_per_pack))::int,
           'distributorId', distributor_id, 'distributor', distributor, 'lastRatePaise', pack_rate_paise) order by distributor nulls last, name), '[]'::jsonb)
  from c
$$;

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  org_id uuid not null references orgs(id),
  store_id uuid not null references stores(id),
  distributor_id uuid not null references distributors(id),
  po_no text not null,
  status text not null default 'open' check (status in ('open','received','cancelled')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (store_id, po_no)
);
create table purchase_order_lines (
  id bigserial primary key,
  po_id uuid not null references purchase_orders(id),
  org_id uuid not null,
  product_id uuid not null references products(id),
  qty_packs int not null check (qty_packs > 0),
  expected_rate_paise bigint
);
alter table purchase_orders enable row level security;
alter table purchase_order_lines enable row level security;
create policy purchase_orders_read on purchase_orders for select to authenticated using (is_member(org_id) and has_store_access(store_id));
create policy purchase_order_lines_read on purchase_order_lines for select to authenticated using (exists (select 1 from purchase_orders o where o.id = po_id));
revoke insert, update, delete on purchase_orders, purchase_order_lines from authenticated, anon;

-- p: { idempotencyKey, storeId, distributorId, note?, lines: [{ productId, qtyPacks, expectedRatePaise? }] }
create or replace function create_purchase_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s stores%rowtype; d distributors%rowtype; v_id uuid := gen_random_uuid(); v_no text; v_existing purchase_orders%rowtype; l jsonb;
begin
  select * into v_existing from purchase_orders where idempotency_key = (p->>'idempotencyKey')::uuid;
  if found then return jsonb_build_object('poId', v_existing.id, 'poNo', v_existing.po_no, 'duplicate', true); end if;
  select * into s from stores where id = (p->>'storeId')::uuid;
  if not found or not has_store_access(s.id) or not has_role(s.org_id, array['owner','admin','pharmacist','purchase']::member_role[]) then
    raise exception 'Only the owner, admin, pharmacist or purchase staff can place orders' using errcode = 'insufficient_privilege';
  end if;
  select * into d from distributors where id = (p->>'distributorId')::uuid and org_id = s.org_id;
  if not found then raise exception 'Choose a supplier' using errcode = 'check_violation'; end if;
  if d.drug_licence_valid_to is not null and d.drug_licence_valid_to < ist_today() then
    raise exception '%''s drug licence expired on % — update it before ordering', d.name, to_char(d.drug_licence_valid_to, 'DD-Mon-YYYY') using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'Add at least one item' using errcode = 'check_violation'; end if;
  v_no := next_invoice_no(s.id, 'PO', ist_today());
  insert into purchase_orders (id, idempotency_key, org_id, store_id, distributor_id, po_no, note, created_by)
  values (v_id, (p->>'idempotencyKey')::uuid, s.org_id, s.id, d.id, v_no, nullif(trim(p->>'note'), ''), auth.uid());
  for l in select * from jsonb_array_elements(p->'lines') loop
    if not exists (select 1 from products where id = (l->>'productId')::uuid and org_id = s.org_id) then raise exception 'Unknown product' using errcode = 'check_violation'; end if;
    if coalesce((l->>'qtyPacks')::int, 0) <= 0 then raise exception 'Quantity must be more than zero' using errcode = 'check_violation'; end if;
    insert into purchase_order_lines (po_id, org_id, product_id, qty_packs, expected_rate_paise)
    values (v_id, s.org_id, (l->>'productId')::uuid, (l->>'qtyPacks')::int, nullif(l->>'expectedRatePaise', '')::bigint);
  end loop;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (s.org_id, auth.uid(), 'create_purchase_order', 'purchase_orders', v_id::text, jsonb_build_object('poNo', v_no, 'distributor', d.name, 'lines', jsonb_array_length(p->'lines')));
  return jsonb_build_object('poId', v_id, 'poNo', v_no, 'duplicate', false);
end $$;

create or replace function set_purchase_order_status(p_po uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare o purchase_orders%rowtype;
begin
  select * into o from purchase_orders where id = p_po for update;
  if not found or not has_store_access(o.store_id) or not has_role(o.org_id, array['owner','admin','pharmacist','purchase']::member_role[]) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('received','cancelled') then raise exception 'Status must be received or cancelled' using errcode = 'check_violation'; end if;
  if o.status <> 'open' then raise exception 'Order % is already %', o.po_no, o.status using errcode = 'check_violation'; end if;
  update purchase_orders set status = p_status, closed_at = now() where id = o.id;
end $$;

-- ───────────────────────── 3. owner reports ─────────────────────────
-- Sales summary: by day, payment mode, staff member and hour of day. Net = bills − credit notes.
create or replace function sales_report(p_store uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s stores%rowtype;
begin
  select * into s from stores where id = p_store;
  if not found or not has_store_access(s.id) or not has_role(s.org_id, array['owner','admin','accountant','auditor','pharmacist']::member_role[]) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return (
    with b as (
      select id, status, total_paise, discount_paise, created_by, billed_at, (billed_at at time zone 'Asia/Kolkata') as local_at
      from sales_bills where store_id = p_store and (billed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    ),
    r as (
      select total_paise, refund_mode, created_by, (returned_at at time zone 'Asia/Kolkata')::date as d
      from sales_returns where store_id = p_store and (returned_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    ),
    pay as (
      select p.mode::text as mode, sum(p.amount_paise)::bigint as amt from payments p join b on b.id = p.bill_id where b.status = 'posted' group by 1
      union all  -- the unpaid part of a bill is udhaar (posted to the customer's account, not a payment row)
      select 'credit', sum(b.total_paise - coalesce((select sum(amount_paise) from payments x where x.bill_id = b.id), 0))::bigint
      from b where b.status = 'posted' having sum(b.total_paise - coalesce((select sum(amount_paise) from payments x where x.bill_id = b.id), 0)) <> 0
    ),
    staff as (
      select m.user_id, coalesce((select i.email from invitations i where i.accepted_by = m.user_id and i.org_id = s.org_id order by i.accepted_at desc limit 1),
                                 case when m.role = 'owner' then 'Owner' else m.role::text end) as label
      from memberships m where m.org_id = s.org_id
    )
    select jsonb_build_object(
      'days', coalesce((select jsonb_agg(x order by x->>'date') from (
          select jsonb_build_object('date', d, 'bills', count(*) filter (where status = 'posted'), 'cancelled', count(*) filter (where status = 'cancelled'),
                 'sales', coalesce(sum(total_paise) filter (where status = 'posted'), 0), 'discount', coalesce(sum(discount_paise) filter (where status = 'posted'), 0),
                 'returns', coalesce((select sum(total_paise) from r where r.d = z.d), 0)) as x
          from (select local_at::date as d, * from b) z group by d) q), '[]'::jsonb),
      'modes', coalesce((select jsonb_agg(jsonb_build_object('mode', mode, 'amount', amt) order by amt desc) from pay), '[]'::jsonb),
      'refunds', coalesce((select jsonb_agg(jsonb_build_object('mode', refund_mode, 'amount', amt)) from (select refund_mode, sum(total_paise)::bigint amt from r group by 1) q), '[]'::jsonb),
      'staff', coalesce((select jsonb_agg(jsonb_build_object('label', coalesce(st.label, 'Unknown'), 'bills', n, 'sales', amt) order by amt desc)
               from (select created_by, count(*) n, sum(total_paise)::bigint amt from b where status = 'posted' group by 1) q left join staff st on st.user_id = q.created_by), '[]'::jsonb),
      'hours', coalesce((select jsonb_agg(jsonb_build_object('hour', h, 'bills', n, 'sales', amt) order by h)
               from (select extract(hour from local_at)::int h, count(*) n, sum(total_paise)::bigint amt from b where status = 'posted' group by 1) q), '[]'::jsonb),
      'totals', jsonb_build_object('bills', (select count(*) from b where status = 'posted'), 'sales', coalesce((select sum(total_paise) from b where status = 'posted'), 0),
                 'returns', coalesce((select sum(total_paise) from r), 0), 'cancelled', (select count(*) from b where status = 'cancelled'),
                 'avgBill', coalesce((select round(avg(total_paise)) from b where status = 'posted'), 0))));
end $$;

-- Prescription (doctor-wise) sales
create or replace function doctor_sales_report(p_store uuid, p_from date, p_to date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('doctor', doctor, 'regNo', reg_no, 'bills', bills, 'sales', sales, 'controlledBills', controlled) order by sales desc), '[]'::jsonb)
  from (
    select coalesce(d.name, rx.prescriber_name, '(not recorded)') as doctor, coalesce(d.reg_no, rx.prescriber_reg_no) as reg_no,
           count(distinct b.id) as bills, sum(b.total_paise)::bigint as sales,
           count(distinct b.id) filter (where exists (select 1 from sales_bill_lines l join products p on p.id = l.product_id where l.bill_id = b.id and p.schedule in ('H1','X','NDPS'))) as controlled
    from sales_bills b join prescriptions rx on rx.id = b.prescription_id left join doctors d on d.id = rx.doctor_id
    where b.store_id = p_store and b.status = 'posted' and (b.billed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    group by 1, 2
  ) x
$$;

-- Non-moving stock: on hand but not sold for p_days
create or replace function non_moving_stock(p_store uuid, p_days int default 90) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'manufacturer', manufacturer, 'packLabel', pack_label, 'unitsPerPack', units_per_pack,
           'qtyBase', qty, 'valuePaise', val, 'lastSold', last_sold, 'nearestExpiry', nearest_expiry) order by val desc), '[]'::jsonb)
  from (
    select p.name, p.manufacturer, p.pack_label, p.units_per_pack, sum(bt.qty_on_hand)::bigint as qty, round(sum(bt.qty_on_hand * bt.cost_per_unit_paise))::bigint as val,
           min(bt.expiry) as nearest_expiry,
           (select max((b.billed_at at time zone 'Asia/Kolkata')::date) from sales_bill_lines l join sales_bills b on b.id = l.bill_id
             where l.product_id = p.id and b.store_id = p_store and b.status = 'posted') as last_sold
    from batches bt join products p on p.id = bt.product_id
    where bt.store_id = p_store and bt.qty_on_hand > 0
    group by p.id, p.name, p.manufacturer, p.pack_label, p.units_per_pack
  ) x
  where last_sold is null or last_sold < ist_today() - p_days
$$;

-- Stock valuation by category: at cost and at MRP
create or replace function stock_valuation(p_store uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_object('category', category, 'products', products, 'qtyBase', qty, 'costPaise', cost, 'mrpPaise', mrp) order by cost desc), '[]'::jsonb),
    'costPaise', coalesce(sum(cost), 0), 'mrpPaise', coalesce(sum(mrp), 0))
  from (
    select coalesce(p.category, '(none)') as category, count(distinct p.id) as products, sum(b.qty_on_hand)::bigint as qty,
           round(sum(b.qty_on_hand * b.cost_per_unit_paise))::bigint as cost,
           round(sum(b.qty_on_hand::numeric * b.pack_mrp_paise / p.units_per_pack))::bigint as mrp
    from batches b join products p on p.id = b.product_id
    where b.store_id = p_store and b.qty_on_hand > 0 and b.status = 'active' and b.expiry >= ist_today()
    group by 1
  ) x
$$;

grant execute on function post_stock_transfer(jsonb), receive_stock_transfer(uuid, jsonb, text), cancel_stock_transfer(uuid, text),
  reorder_suggestions(uuid, int), create_purchase_order(jsonb), set_purchase_order_status(uuid, text),
  sales_report(uuid, date, date), doctor_sales_report(uuid, date, date), non_moving_stock(uuid, int), stock_valuation(uuid) to authenticated;
revoke execute on function post_stock_transfer(jsonb), receive_stock_transfer(uuid, jsonb, text), cancel_stock_transfer(uuid, text),
  reorder_suggestions(uuid, int), create_purchase_order(jsonb), set_purchase_order_status(uuid, text),
  sales_report(uuid, date, date), doctor_sales_report(uuid, date, date), non_moving_stock(uuid, int), stock_valuation(uuid) from public, anon;

drop function _patch_function(regprocedure, text, text);
