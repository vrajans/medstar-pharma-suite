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

-- ───────────────────────── redefined: post_sale ─────────────────────────
create or replace function post_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_store stores%rowtype;
  v_bill_id uuid;
  v_existing record;
  v_date date := (p->>'billedAt')::timestamptz at time zone 'Asia/Kolkata';
  v_bill_disc numeric := coalesce((p->>'billDiscountPct')::numeric, 0);
  v_offline boolean := coalesce((p->>'offline')::boolean, false);
  v_line jsonb; v_prod products%rowtype; v_rate numeric; v_disc numeric;
  v_remaining int; v_take int; v_b batches%rowtype; v_pack_price bigint;
  v_gross bigint; v_amount bigint; t record;
  s_gross bigint := 0; s_amount bigint := 0; s_taxable bigint := 0; s_cgst bigint := 0; s_sgst bigint := 0; s_igst bigint := 0; s_cost bigint := 0;
  v_round bigint; v_total bigint; v_paid bigint := 0;
  v_has_rx boolean := false; v_has_reg boolean := false; v_review text := null;
  v_rx jsonb := p->'prescription'; v_rx_id uuid; v_pharm uuid := nullif(p->>'pharmacistId','')::uuid;
  v_invoice text; v_je uuid; v_pay jsonb; v_cost bigint; v_line_count int := 0;
  v_credit bigint := 0; v_cust customers%rowtype; v_outstanding bigint;
begin
  -- idempotency: same billUuid → same result
  select id, invoice_no, total_paise into v_existing from sales_bills where bill_uuid = (p->>'billUuid')::uuid;
  if found then
    return jsonb_build_object('billId', v_existing.id, 'invoiceNo', v_existing.invoice_no, 'totalPaise', v_existing.total_paise, 'duplicate', true);
  end if;

  select * into v_store from stores where id = (p->>'storeId')::uuid;
  if not found or not has_store_access(v_store.id) then raise exception 'No access to store' using errcode = 'insufficient_privilege'; end if;
  if exists (select 1 from period_locks where org_id = v_store.org_id and locked_until >= v_date) then
    raise exception 'Period locked up to %', (select locked_until from period_locks where org_id = v_store.org_id);
  end if;
  if v_bill_disc > (select max_discount_pct from memberships where user_id = v_user and org_id = v_store.org_id) then
    raise exception 'Bill discount % exceeds your limit', v_bill_disc;
  end if;

  if nullif(p->>'customerId', '') is not null then
    select * into v_cust from customers where id = (p->>'customerId')::uuid and org_id = v_store.org_id;
    if not found then raise exception 'Unknown customer for this pharmacy' using errcode = 'check_violation'; end if;
  end if;

  -- pre-scan compliance
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    select * into v_prod from products where id = (v_line->>'productId')::uuid and org_id = v_store.org_id;
    if not found then raise exception 'Unknown product %', v_line->>'productId'; end if;
    if v_prod.blocked_reason is not null then raise exception '% is blocked: %', v_prod.name, v_prod.blocked_reason; end if;
    if v_prod.rx_required or v_prod.schedule in ('H','H1','X','NDPS') then v_has_rx := true; end if;
    if v_prod.schedule in ('H1','X','NDPS') then v_has_reg := true; end if;
  end loop;

  if v_has_rx then
    if v_pharm is null or not exists (select 1 from pharmacists where id = v_pharm and org_id = v_store.org_id) then
      raise exception 'Pharmacist approval required for prescription drugs' using errcode = 'check_violation';
    end if;
    -- PIN approval (approve_rx_with_pin) is one-time, store-bound and valid for 30 minutes.
    -- Offline bills cannot reach the server for a PIN check: accepted, but flagged for review.
    if nullif(p->>'pharmacistApprovalId', '') is not null then
      update pharmacist_approvals set used_by_bill = (p->>'billUuid')::uuid
       where id = (p->>'pharmacistApprovalId')::uuid and pharmacist_id = v_pharm and store_id = v_store.id
         and used_by_bill is null and created_at > now() - interval '30 minutes';
      if not found then raise exception 'Pharmacist approval is invalid, used or expired — re-enter PIN' using errcode = 'check_violation'; end if;
    elsif v_offline then
      v_review := 'Rx approved offline (PIN not verified by server)';
    else
      raise exception 'Pharmacist PIN approval required for prescription drugs' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from pharmacist_shifts where store_id = v_store.id and pharmacist_id = v_pharm and ended_at is null) then
      if v_store.pharmacist_presence = 'hard' and not v_offline then
        raise exception 'Prescription drugs require a registered pharmacist on duty' using errcode = 'check_violation';
      end if;
      v_review := coalesce(v_review || '; ', '') || 'Rx sale without pharmacist shift';
    end if;
  end if;

  if v_has_reg then
    if coalesce(v_rx->>'patientName','') = '' or coalesce(v_rx->>'patientAddress','') = ''
       or coalesce(v_rx->>'prescriberName','') = '' or coalesce(v_rx->>'prescriberRegNo','') = '' or coalesce(v_rx->>'rxDate','') = '' then
      raise exception 'Schedule H1/X/NDPS: patient name & address, prescriber name & registration number and Rx date are required'
        using errcode = 'check_violation';
    end if;
  end if;

  if v_rx is not null then
    insert into prescriptions (org_id, customer_id, doctor_id, prescriber_name, prescriber_reg_no, prescriber_address,
      patient_name, patient_address, rx_date, image_path, verified_by, verified_at, verification_status, times_used)
    values (v_store.org_id, nullif(p->>'customerId','')::uuid, nullif(v_rx->>'doctorId','')::uuid, v_rx->>'prescriberName', v_rx->>'prescriberRegNo',
      v_rx->>'prescriberAddress', v_rx->>'patientName', v_rx->>'patientAddress', nullif(v_rx->>'rxDate','')::date, v_rx->>'rxImagePath',
      v_pharm, now(), 'approved', 1)
    returning id into v_rx_id;
  end if;

  v_bill_id := gen_random_uuid();
  v_invoice := next_invoice_no(v_store.id, 'SALE', v_date);
  insert into sales_bills (id, bill_uuid, org_id, store_id, invoice_no, provisional_no, document_type, channel, online_order_id, billed_at,
    customer_id, prescription_id, pharmacist_id, gross_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise,
    round_off_paise, total_paise, created_by)
  values (v_bill_id, (p->>'billUuid')::uuid, v_store.org_id, v_store.id, v_invoice, p->>'provisionalNo',
    case when v_store.gst_scheme = 'composition' then 'BILL_OF_SUPPLY' else 'TAX_INVOICE' end,
    case when p ? 'onlineOrderId' then 'online' else 'counter' end, nullif(p->>'onlineOrderId','')::uuid,
    (p->>'billedAt')::timestamptz, nullif(p->>'customerId','')::uuid, v_rx_id, v_pharm, 0,0,0,0,0,0,0,0, v_user);

  -- lines with FEFO allocation (one bill line per batch)
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    select * into v_prod from products where id = (v_line->>'productId')::uuid;
    v_rate := product_gst_rate(v_prod.id, v_date);
    if v_rate is null then raise exception 'No GST rate for HSN %', v_prod.hsn; end if;
    v_disc := 100 - (100 - coalesce((v_line->>'discountPct')::numeric, 0)) * (1 - v_bill_disc / 100);
    v_remaining := (v_line->>'qtyBase')::int;
    if v_remaining <= 0 then raise exception 'Quantity must be positive'; end if;

    for v_b in
      select * from batches
      where store_id = v_store.id and product_id = v_prod.id and status = 'active' and expiry >= v_date and qty_on_hand > 0
        and (v_line->>'batchId' is null or id = (v_line->>'batchId')::uuid)
      order by expiry, received_at
      for update
    loop
      exit when v_remaining = 0;
      v_take := least(v_b.qty_on_hand, v_remaining);
      perform _post_sale_line(v_bill_id, v_store, v_prod, v_b, v_take, v_line, v_rate, v_disc);
      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      if v_line->>'batchId' is not null then
        select * into v_b from batches where id = (v_line->>'batchId')::uuid;
        if v_b.status <> 'active' then raise exception 'Batch % is % and cannot be sold', v_b.batch_no, v_b.status; end if;
        if v_b.expiry < v_date then raise exception 'Batch % expired on %', v_b.batch_no, v_b.expiry; end if;
      end if;
      if not v_offline then
        raise exception 'Insufficient stock for % (short by % units)', v_prod.name, v_remaining using errcode = 'check_violation';
      end if;
      -- offline sale already happened physically: book against latest sellable batch, flag for review (ADR-003)
      select * into v_b from batches where store_id = v_store.id and product_id = v_prod.id and status = 'active' and expiry >= v_date
        order by expiry desc limit 1 for update;
      if not found then raise exception 'No sellable batch for % to reconcile offline sale', v_prod.name; end if;
      perform _post_sale_line(v_bill_id, v_store, v_prod, v_b, v_remaining, v_line, v_rate, v_disc);
      v_review := coalesce(v_review || '; ', '') || 'Negative stock on ' || v_prod.name;
    end if;
  end loop;

  select coalesce(sum(gross_paise),0), coalesce(sum(amount_paise),0), coalesce(sum(taxable_paise),0), coalesce(sum(cgst_paise),0),
         coalesce(sum(sgst_paise),0), coalesce(sum(igst_paise),0), coalesce(sum(cost_paise),0), count(*)
    into s_gross, s_amount, s_taxable, s_cgst, s_sgst, s_igst, s_cost, v_line_count
    from sales_bill_lines where bill_id = v_bill_id;

  v_total := round(s_amount / 100.0) * 100;
  v_round := v_total - s_amount;

  update sales_bills set gross_paise = s_gross, discount_paise = s_gross - s_amount, taxable_paise = s_taxable,
    cgst_paise = s_cgst, sgst_paise = s_sgst, igst_paise = s_igst, round_off_paise = v_round, total_paise = v_total,
    needs_review = v_review is not null, review_note = v_review
  where id = v_bill_id;

  -- payments
  for v_pay in select * from jsonb_array_elements(p->'payments') loop
    insert into payments (org_id, bill_id, mode, amount_paise, reference)
    values (v_store.org_id, v_bill_id, (v_pay->>'mode')::pay_mode, (v_pay->>'amountPaise')::bigint, v_pay->>'reference');
    v_paid := v_paid + (v_pay->>'amountPaise')::bigint;
  end loop;
  if v_paid <> v_total then raise exception 'Payments (%) must equal bill total (%)', v_paid, v_total using errcode = 'check_violation'; end if;
  -- credit (udhaar) sales: customer required, limit enforced (offline sales already happened → flagged)
  select coalesce(sum((x->>'amountPaise')::bigint), 0) into v_credit from jsonb_array_elements(p->'payments') x where x->>'mode' = 'credit';
  if v_credit > 0 then
    if v_cust.id is null then raise exception 'Credit sale requires a customer' using errcode = 'check_violation'; end if;
    if v_cust.credit_limit_paise <= 0 then raise exception 'Credit is not enabled for %', coalesce(v_cust.name, v_cust.phone) using errcode = 'check_violation'; end if;
    v_outstanding := party_balance(v_store.org_id, 'DEBTORS', v_cust.id);
    if v_outstanding + v_credit > v_cust.credit_limit_paise then
      if not v_offline then
        raise exception 'Credit limit exceeded: outstanding %, this bill %, limit %', v_outstanding, v_credit, v_cust.credit_limit_paise using errcode = 'check_violation';
      end if;
      update sales_bills set needs_review = true, review_note = coalesce(review_note || '; ', '') || 'Credit limit exceeded offline' where id = v_bill_id;
    end if;
  end if;

  -- statutory register rows
  if v_has_reg then
    insert into schedule_register (org_id, store_id, schedule, entry_date, bill_id, invoice_no, patient_name, patient_address,
      prescriber_name, prescriber_reg_no, prescriber_address, product_id, product_name, batch_no, qty_base, pharmacist_id, prescription_id)
    select v_store.org_id, v_store.id, l.schedule, v_date, v_bill_id, v_invoice, v_rx->>'patientName', v_rx->>'patientAddress',
      v_rx->>'prescriberName', v_rx->>'prescriberRegNo', v_rx->>'prescriberAddress', l.product_id, pr.name, b.batch_no, l.qty_base, v_pharm, v_rx_id
    from sales_bill_lines l join products pr on pr.id = l.product_id join batches b on b.id = l.batch_id
    where l.bill_id = v_bill_id and l.schedule in ('H1','X','NDPS');
  end if;

  -- journal: Dr payments / Cr sales + output tax ± round-off; Dr COGS / Cr inventory
  insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
  values (v_store.org_id, v_store.id, v_date, 'sale', v_bill_id, 'Sale ' || v_invoice, v_user) returning id into v_je;

  insert into journal_lines (entry_id, org_id, account_id, debit_paise, party_id)
  select v_je, v_store.org_id,
    acct(v_store.org_id, case x->>'mode' when 'cash' then 'CASH' when 'upi' then 'UPI_CLR' when 'card' then 'CARD_CLR' when 'wallet' then 'WALLET_CLR' else 'DEBTORS' end),
    sum((x->>'amountPaise')::bigint), case when x->>'mode' = 'credit' then nullif(p->>'customerId','')::uuid end
  from jsonb_array_elements(p->'payments') x group by x->>'mode' having sum((x->>'amountPaise')::bigint) > 0;

  insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'SALES'), s_taxable);
  if s_cgst > 0 then insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'OUT_CGST'), s_cgst); end if;
  if s_sgst > 0 then insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'OUT_SGST'), s_sgst); end if;
  if s_igst > 0 then insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'OUT_IGST'), s_igst); end if;
  if v_round > 0 then insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'ROUND_OFF'), v_round);
  elsif v_round < 0 then insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'ROUND_OFF'), -v_round); end if;
  if s_cost > 0 then
    insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'COGS'), s_cost);
    insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'INVENTORY'), s_cost);
  end if;

  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (v_store.org_id, v_user, 'post_sale', 'sales_bills', v_bill_id::text, jsonb_build_object('invoiceNo', v_invoice, 'device', p->>'deviceCode', 'offline', v_offline));

  return jsonb_build_object('billId', v_bill_id, 'invoiceNo', v_invoice, 'totalPaise', v_total, 'roundOffPaise', v_round,
    'needsReview', v_review is not null, 'lines', v_line_count, 'duplicate', false);
end $$;

-- ───────────────────────── redefined: post_purchase ─────────────────────────
create or replace function post_purchase(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_store stores%rowtype; d distributors%rowtype; v_id uuid; v_inter boolean;
  v_line jsonb; pr products%rowtype; v_rate numeric; v_batch uuid; v_taxable bigint; v_tax bigint;
  v_units int; v_cost numeric; v_date date := (p->>'supplierInvoiceDate')::date; v_existing uuid;
  s_taxable bigint := 0; s_tax bigint := 0; v_total bigint; v_round bigint; v_je uuid; v_warn text[] := '{}';
begin
  select id into v_existing from purchase_invoices where idempotency_key = (p->>'idempotencyKey')::uuid;
  if found then return jsonb_build_object('purchaseId', v_existing, 'duplicate', true); end if;

  select * into v_store from stores where id = (p->>'storeId')::uuid;
  if not found or not has_store_access(v_store.id) or not has_role(v_store.org_id, array['owner','admin','purchase']::member_role[]) then
    raise exception 'Not allowed to post purchases for this store' using errcode = 'insufficient_privilege';
  end if;
  select * into d from distributors where id = (p->>'distributorId')::uuid and org_id = v_store.org_id;
  if not found then raise exception 'Unknown distributor'; end if;
  if d.drug_licence_valid_to is not null and d.drug_licence_valid_to < v_date then
    raise exception 'Distributor drug licence expired on %', d.drug_licence_valid_to using errcode = 'check_violation';
  end if;
  v_inter := d.state_code <> v_store.state_code;

  v_id := gen_random_uuid();
  insert into purchase_invoices (id, idempotency_key, org_id, store_id, distributor_id, supplier_invoice_no, supplier_invoice_date, inter_state,
    taxable_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, created_by)
  values (v_id, (p->>'idempotencyKey')::uuid, v_store.org_id, v_store.id, d.id, p->>'supplierInvoiceNo', v_date, v_inter, 0,0,0,0,0,0, v_user);

  for v_line in select * from jsonb_array_elements(p->'lines') loop
    select * into pr from products where id = (v_line->>'productId')::uuid and org_id = v_store.org_id;
    if not found then raise exception 'Unknown product %', v_line->>'productId'; end if;
    v_rate := product_gst_rate(pr.id, v_date);
    if v_rate is null then raise exception 'No GST rate configured for HSN % (%)', pr.hsn, pr.name; end if;
    if exists (select 1 from batches b where b.store_id = v_store.id and b.product_id = pr.id
               and b.pack_mrp_paise <> (v_line->>'packMrpPaise')::bigint and b.received_at > now() - interval '180 days') then
      v_warn := v_warn || (pr.name || ': MRP differs from a recent batch — check the printed MRP');
    end if;
    if exists (select 1 from batches b where b.store_id = v_store.id and b.product_id = pr.id and b.batch_no = v_line->>'batchNo'
               and b.expiry <> (v_line->>'expiry')::date) then
      v_warn := v_warn || (pr.name || ' batch ' || (v_line->>'batchNo') || ' already exists with a different expiry');
    end if;
    if (v_line->>'packRatePaise')::bigint > (v_line->>'packMrpPaise')::bigint then
      raise exception 'Purchase rate above MRP for % batch %', pr.name, v_line->>'batchNo';
    end if;
    if (v_line->>'expiry')::date < v_date + 90 then v_warn := v_warn || (pr.name || ' batch ' || (v_line->>'batchNo') || ' expires within 3 months'); end if;

    v_taxable := round((v_line->>'packRatePaise')::bigint * (v_line->>'qtyPacks')::int * (1 - coalesce((v_line->>'discountPct')::numeric,0)/100));
    v_tax := round(v_taxable * v_rate / 100);
    v_units := ((v_line->>'qtyPacks')::int + coalesce((v_line->>'freePacks')::int,0)) * pr.units_per_pack;
    -- landed cost per base unit: ex-GST for regular dealers (ITC), incl. GST for composition dealers
    v_cost := (v_taxable + case when v_store.gst_scheme = 'composition' then v_tax else 0 end)::numeric / nullif(v_units,0);

    insert into batches (org_id, store_id, product_id, batch_no, expiry, pack_mrp_paise, cost_per_unit_paise, qty_on_hand)
    values (v_store.org_id, v_store.id, pr.id, v_line->>'batchNo', (v_line->>'expiry')::date, (v_line->>'packMrpPaise')::bigint, coalesce(v_cost,0), v_units)
    on conflict (store_id, product_id, batch_no, pack_mrp_paise) do update
      set cost_per_unit_paise = (batches.cost_per_unit_paise * batches.qty_on_hand + excluded.cost_per_unit_paise * excluded.qty_on_hand)
                                / nullif(batches.qty_on_hand + excluded.qty_on_hand, 0),
          qty_on_hand = batches.qty_on_hand + excluded.qty_on_hand
    returning id into v_batch;

    insert into purchase_lines (purchase_id, org_id, product_id, batch_id, qty_packs, free_packs, pack_rate_paise, discount_pct, gst_rate, taxable_paise, tax_paise)
    values (v_id, v_store.org_id, pr.id, v_batch, (v_line->>'qtyPacks')::int, coalesce((v_line->>'freePacks')::int,0),
      (v_line->>'packRatePaise')::bigint, coalesce((v_line->>'discountPct')::numeric,0), v_rate, v_taxable, v_tax);
    insert into stock_ledger (org_id, store_id, batch_id, product_id, doc_type, doc_id, qty_delta, created_by)
    values (v_store.org_id, v_store.id, v_batch, pr.id, 'purchase', v_id, v_units, v_user);
    s_taxable := s_taxable + v_taxable; s_tax := s_tax + v_tax;
  end loop;

  v_total := round((s_taxable + s_tax) / 100.0) * 100;
  v_round := v_total - (s_taxable + s_tax);
  update purchase_invoices set taxable_paise = s_taxable,
    cgst_paise = case when v_inter then 0 else trunc(s_tax/2.0) end,
    sgst_paise = case when v_inter then 0 else s_tax - trunc(s_tax/2.0) end,
    igst_paise = case when v_inter then s_tax else 0 end,
    round_off_paise = v_round, total_paise = v_total, due_date = v_date + d.credit_days
  where id = v_id;

  insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
  values (v_store.org_id, v_store.id, v_date, 'purchase', v_id, 'Purchase ' || d.name || ' #' || (p->>'supplierInvoiceNo'), v_user) returning id into v_je;
  if v_store.gst_scheme = 'composition' then
    insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'INVENTORY'), s_taxable + s_tax);
  else
    insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'INVENTORY'), s_taxable);
    if v_inter then
      insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'IN_IGST'), s_tax);
    else
      insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'IN_CGST'), trunc(s_tax/2.0));
      insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'IN_SGST'), s_tax - trunc(s_tax/2.0));
    end if;
  end if;
  if v_round > 0 then insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'ROUND_OFF'), v_round);
  elsif v_round < 0 then insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, v_store.org_id, acct(v_store.org_id,'ROUND_OFF'), -v_round); end if;
  insert into journal_lines (entry_id, org_id, account_id, credit_paise, party_id) values (v_je, v_store.org_id, acct(v_store.org_id,'CREDITORS'), v_total, d.id);

  return jsonb_build_object('purchaseId', v_id, 'totalPaise', v_total, 'warnings', to_jsonb(v_warn), 'duplicate', false);
end $$;

-- ───────────────────────── redefined: pos_catalogue ─────────────────────────
create or replace function pos_catalogue(p_store uuid, p_q text default null, p_limit int default 20) returns jsonb
language plpgsql stable security invoker set search_path = public, extensions as $$
declare v_q text := nullif(lower(trim(p_q)), ''); v_res jsonb;
begin
  if not has_store_access(p_store) then raise exception 'No access to store' using errcode = 'insufficient_privilege'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.rank desc, x.name), '[]') into v_res from (
    select p.id, p.name, p.composition, p.manufacturer, p.hsn, p.schedule, p.rx_required as "rxRequired",
           p.habit_forming as "habitForming", p.cold_chain as "coldChain", p.units_per_pack as "unitsPerPack",
           p.pack_label as "packLabel", p.base_unit_label as "baseLabel", p.allow_loose as "allowLoose", p.rack,
           p.blocked_reason as "blockedReason",
           coalesce(p.gst_rate_override, resolve_gst_rate(p.hsn, current_date), -1) as "gstRate",
           (select min(barcode) from product_barcodes pb where pb.product_id = p.id) as barcode,
           (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'batchNo', b.batch_no, 'expiry', b.expiry, 'qtyBase', b.qty_on_hand,
                    'packMrpPaise', b.pack_mrp_paise, 'status', b.status, 'receivedAt', b.received_at) order by b.expiry), '[]')
              from batches b where b.product_id = p.id and b.store_id = p_store and b.qty_on_hand > 0) as batches,
           case when v_q is null then 0
                when exists (select 1 from product_barcodes pb where pb.product_id = p.id and pb.barcode = v_q) then 100
                when lower(p.name) like v_q || '%' then 50 + similarity(lower(p.name), v_q)
                else greatest(similarity(lower(p.name), v_q), similarity(lower(coalesce(p.composition, '')), v_q)) end as rank
    from products p
    where p.org_id = (select org_id from stores where id = p_store) and p.is_active
      and (v_q is null
           or exists (select 1 from product_barcodes pb where pb.product_id = p.id and pb.barcode = v_q)
           or lower(p.name) like '%' || v_q || '%'
           or lower(coalesce(p.composition, '')) like '%' || v_q || '%'
           or similarity(lower(p.name), v_q) > 0.3)
      and (v_q is not null or exists (select 1 from batches b where b.product_id = p.id and b.store_id = p_store and b.qty_on_hand > 0))
    order by rank desc, p.name
    limit case when v_q is null then 5000 else least(p_limit, 50) end
  ) x;
  return v_res;
end $$;


-- ───────────────────────── product import (dry run, all-or-nothing) ─────────────────────────
-- p_rows: [{name, manufacturer?, composition?, dosageForm?, category, hsn, schedule, rxRequired, habitForming, coldChain,
--           packLabel, baseUnitLabel, unitsPerPack, barcode?, reorderLevel, rack?, gstRateOverride?, listedOnline}]
-- Match order: barcode → (name, manufacturer, units per pack). Matches are updated, others created.
create or replace function import_products(p_org uuid, p_rows jsonb, p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; i int; v_by_code uuid; v_by_name uuid; v_target uuid; v_errors jsonb := '[]'; v_plan jsonb := '[]';
        v_created int := 0; v_updated int := 0; v_seen_codes text[] := '{}'; e jsonb; v_id uuid; v_warnings jsonb := '[]'; v_old_name text;
begin
  if not has_role(p_org, array['owner','admin','purchase']::member_role[]) then
    raise exception 'Only owners, admins and purchase staff can import products' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'Import at most 20,000 rows at a time'; end if;

  for r, i in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    if coalesce(trim(r->>'name'), '') = '' then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'name is required'); continue; end if;
    if coalesce(r->>'hsn', '') !~ '^[0-9]{4,8}$' then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'HSN must be 4–8 digits'); continue; end if;
    if coalesce(r->>'schedule', '') not in ('OTC','G','H','H1','X','C','C1','NDPS') then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'invalid schedule'); continue; end if;
    if coalesce((r->>'unitsPerPack')::int, 0) <= 0 then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'units per pack must be > 0'); continue; end if;
    if nullif(r->>'barcode', '') is not null then
      if r->>'barcode' = any(v_seen_codes) then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'barcode repeated in this file'); continue; end if;
      v_seen_codes := v_seen_codes || (r->>'barcode');
    end if;

    select product_id into v_by_code from product_barcodes where org_id = p_org and barcode = nullif(r->>'barcode', '');
    select id into v_by_name from products
      where org_id = p_org and lower(name) = lower(trim(r->>'name')) and coalesce(lower(manufacturer), '') = coalesce(lower(trim(r->>'manufacturer')), '')
        and units_per_pack = (r->>'unitsPerPack')::int
      limit 1;
    if v_by_code is not null and v_by_name is not null and v_by_code <> v_by_name then
      v_errors := v_errors || jsonb_build_object('row', i, 'message', 'barcode belongs to a different existing product'); continue;
    end if;
    v_target := coalesce(v_by_code, v_by_name);
    if v_by_code is not null and v_by_name is null then
      select name into v_old_name from products where id = v_by_code;
      v_warnings := v_warnings || jsonb_build_object('row', i, 'message', format('will rename "%s" to "%s" (matched by barcode)', v_old_name, trim(r->>'name')));
    end if;
    if v_target is null then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
    v_plan := v_plan || jsonb_build_object('row', r, 'target', v_target);
  end loop;

  if p_dry_run or jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('dryRun', true, 'created', v_created, 'updated', v_updated, 'errors', v_errors, 'warnings', v_warnings);
  end if;

  for e in select * from jsonb_array_elements(v_plan) loop
    r := e->'row';
    if e->>'target' is null then
      insert into products (org_id, name, manufacturer, composition, dosage_form, category, hsn, schedule, rx_required, habit_forming,
        cold_chain, pack_label, base_unit_label, units_per_pack, reorder_level, rack, gst_rate_override, listed_online)
      values (p_org, trim(r->>'name'), nullif(trim(r->>'manufacturer'), ''), nullif(trim(r->>'composition'), ''), nullif(r->>'dosageForm', ''),
        coalesce(nullif(r->>'category', ''), 'Rx'), r->>'hsn', (r->>'schedule')::drug_schedule, coalesce((r->>'rxRequired')::boolean, false),
        coalesce((r->>'habitForming')::boolean, false), coalesce((r->>'coldChain')::boolean, false), coalesce(nullif(r->>'packLabel', ''), 'Strip'),
        coalesce(nullif(r->>'baseUnitLabel', ''), 'Tab'), (r->>'unitsPerPack')::int, coalesce((r->>'reorderLevel')::int, 0), nullif(r->>'rack', ''),
        (r->>'gstRateOverride')::numeric, coalesce((r->>'listedOnline')::boolean, false))
      returning id into v_id;
    else
      v_id := (e->>'target')::uuid;
      update products set name = trim(r->>'name'), manufacturer = nullif(trim(r->>'manufacturer'), ''), composition = nullif(trim(r->>'composition'), ''),
        dosage_form = nullif(r->>'dosageForm', ''), category = coalesce(nullif(r->>'category', ''), category), hsn = r->>'hsn',
        schedule = (r->>'schedule')::drug_schedule, rx_required = coalesce((r->>'rxRequired')::boolean, false),
        habit_forming = coalesce((r->>'habitForming')::boolean, false), cold_chain = coalesce((r->>'coldChain')::boolean, false),
        pack_label = coalesce(nullif(r->>'packLabel', ''), pack_label), base_unit_label = coalesce(nullif(r->>'baseUnitLabel', ''), base_unit_label),
        units_per_pack = (r->>'unitsPerPack')::int, reorder_level = coalesce((r->>'reorderLevel')::int, 0), rack = nullif(r->>'rack', ''),
        gst_rate_override = (r->>'gstRateOverride')::numeric, listed_online = coalesce((r->>'listedOnline')::boolean, listed_online),
        is_active = true, updated_at = now()
      where id = v_id;
    end if;
    if nullif(r->>'barcode', '') is not null then
      insert into product_barcodes (org_id, product_id, barcode) values (p_org, v_id, r->>'barcode') on conflict do nothing;
    end if;
  end loop;
  insert into audit_log (org_id, user_id, action, entity, details)
  values (p_org, auth.uid(), 'import_products', 'products', jsonb_build_object('created', v_created, 'updated', v_updated));
  return jsonb_build_object('dryRun', false, 'created', v_created, 'updated', v_updated, 'errors', '[]'::jsonb, 'warnings', v_warnings);
end $$;

-- ───────────────────────── opening stock (UC-INV-09) ─────────────────────────
create table opening_stock_imports (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  org_id uuid not null,
  store_id uuid not null references stores(id),
  as_of date not null,
  rows int not null,
  value_paise bigint not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table opening_stock_imports enable row level security;
create policy opening_stock_imports_read on opening_stock_imports for select to authenticated using (is_member(org_id));
revoke insert, update, delete on opening_stock_imports from authenticated, anon;

-- p: { idempotencyKey, storeId, asOf, dryRun, rows:[{productId, batchNo, expiry, packMrpPaise, packCostPaise, qtyBase}] }
-- Journal: Dr Inventory (at cost) / Cr Opening balances.
create or replace function post_opening_stock(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_store stores%rowtype; r jsonb; i int; pr products%rowtype; v_errors jsonb := '[]'; v_warn jsonb := '[]';
        v_value bigint := 0; v_cost numeric; v_batch uuid; v_id uuid := gen_random_uuid(); v_je uuid; v_existing uuid;
        v_as_of date := coalesce((p->>'asOf')::date, current_date); v_dry boolean := coalesce((p->>'dryRun')::boolean, true); v_n int := 0;
begin
  select id into v_existing from opening_stock_imports where idempotency_key = (p->>'idempotencyKey')::uuid;
  if found then return jsonb_build_object('importId', v_existing, 'duplicate', true); end if;
  select * into v_store from stores where id = (p->>'storeId')::uuid;
  if not found or not has_store_access(v_store.id) or not has_role(v_store.org_id, array['owner','admin','purchase']::member_role[]) then
    raise exception 'Only owners, admins and purchase staff can load opening stock' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from period_locks where org_id = v_store.org_id and locked_until >= v_as_of) then raise exception 'Period locked'; end if;

  for r, i in select value, ordinality from jsonb_array_elements(p->'rows') with ordinality loop
    select * into pr from products where id = (r->>'productId')::uuid and org_id = v_store.org_id;
    if not found then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'unknown product'); continue; end if;
    if coalesce(trim(r->>'batchNo'), '') = '' then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'batch is required'); continue; end if;
    if coalesce((r->>'qtyBase')::int, 0) <= 0 then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'quantity must be > 0'); continue; end if;
    if coalesce((r->>'packMrpPaise')::bigint, 0) <= 0 then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'MRP must be > 0'); continue; end if;
    if (r->>'packCostPaise')::bigint > (r->>'packMrpPaise')::bigint then v_errors := v_errors || jsonb_build_object('row', i, 'message', 'cost above MRP'); continue; end if;
    if (r->>'expiry')::date < v_as_of then
      v_warn := v_warn || jsonb_build_object('row', i, 'message', pr.name || ' batch ' || (r->>'batchNo') || ' is already expired — it will be loaded but cannot be sold');
    end if;
    v_n := v_n + 1;
    v_value := v_value + round((r->>'packCostPaise')::numeric * (r->>'qtyBase')::int / pr.units_per_pack);
  end loop;

  if v_dry or jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('dryRun', true, 'rows', v_n, 'valuePaise', v_value, 'errors', v_errors, 'warnings', v_warn);
  end if;

  insert into opening_stock_imports (id, idempotency_key, org_id, store_id, as_of, rows, value_paise, created_by)
  values (v_id, (p->>'idempotencyKey')::uuid, v_store.org_id, v_store.id, v_as_of, v_n, v_value, auth.uid());

  for r in select * from jsonb_array_elements(p->'rows') loop
    select * into pr from products where id = (r->>'productId')::uuid;
    v_cost := (r->>'packCostPaise')::numeric / pr.units_per_pack;
    insert into batches (org_id, store_id, product_id, batch_no, expiry, pack_mrp_paise, cost_per_unit_paise, qty_on_hand, received_at)
    values (v_store.org_id, v_store.id, pr.id, upper(trim(r->>'batchNo')), (r->>'expiry')::date, (r->>'packMrpPaise')::bigint, v_cost, (r->>'qtyBase')::int, v_as_of)
    on conflict (store_id, product_id, batch_no, pack_mrp_paise) do update
      set cost_per_unit_paise = (batches.cost_per_unit_paise * batches.qty_on_hand + excluded.cost_per_unit_paise * excluded.qty_on_hand)
                                / nullif(batches.qty_on_hand + excluded.qty_on_hand, 0),
          qty_on_hand = batches.qty_on_hand + excluded.qty_on_hand
    returning id into v_batch;
    insert into stock_ledger (org_id, store_id, batch_id, product_id, doc_type, doc_id, qty_delta, created_by)
    values (v_store.org_id, v_store.id, v_batch, pr.id, 'opening', v_id, (r->>'qtyBase')::int, auth.uid());
  end loop;

  if v_value > 0 then
    insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
    values (v_store.org_id, v_store.id, v_as_of, 'opening_stock', v_id, 'Opening stock ' || v_store.code, auth.uid()) returning id into v_je;
    insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, v_store.org_id, acct(v_store.org_id, 'INVENTORY'), v_value);
    insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, v_store.org_id, acct(v_store.org_id, 'OPENING_BAL'), v_value);
  end if;
  return jsonb_build_object('dryRun', false, 'importId', v_id, 'rows', v_n, 'valuePaise', v_value, 'errors', '[]'::jsonb, 'warnings', v_warn);
end $$;

-- ───────────────────────── receipts & payments ─────────────────────────
create or replace function _pay_account(p_org uuid, p_mode text) returns uuid language sql stable as $$
  select acct(p_org, case p_mode when 'cash' then 'CASH' when 'upi' then 'UPI_CLR' when 'card' then 'CARD_CLR' when 'bank' then 'BANK' else null end)
$$;

-- p: { idempotencyKey, storeId, customerId, amountPaise, mode: cash|upi|card|bank, reference?, date? }
create or replace function post_customer_receipt(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_store stores%rowtype; c customers%rowtype; v_amt bigint := (p->>'amountPaise')::bigint; v_bal bigint; v_je uuid; v_acct uuid;
        v_date date := coalesce((p->>'date')::date, (now() at time zone 'Asia/Kolkata')::date);
begin
  if exists (select 1 from journal_entries where source_type = 'receipt' and source_id = (p->>'idempotencyKey')::uuid) then
    return jsonb_build_object('duplicate', true);
  end if;
  select * into v_store from stores where id = (p->>'storeId')::uuid;
  if not found or not has_store_access(v_store.id) or not has_role(v_store.org_id, array['owner','admin','pharmacist','billing','accountant']::member_role[]) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into c from customers where id = (p->>'customerId')::uuid and org_id = v_store.org_id;
  if not found then raise exception 'Unknown customer'; end if;
  v_acct := _pay_account(v_store.org_id, p->>'mode');
  if v_acct is null then raise exception 'Payment mode must be cash, upi, card or bank'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Amount must be positive' using errcode = 'check_violation'; end if;
  v_bal := party_balance(v_store.org_id, 'DEBTORS', c.id);
  if v_amt > v_bal then raise exception 'Amount (%) is more than the outstanding balance (%)', v_amt, v_bal using errcode = 'check_violation'; end if;
  insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
  values (v_store.org_id, v_store.id, v_date, 'receipt', (p->>'idempotencyKey')::uuid,
          'Receipt from ' || coalesce(c.name, c.phone) || coalesce(' · ' || nullif(p->>'reference', ''), ''), auth.uid()) returning id into v_je;
  insert into journal_lines (entry_id, org_id, account_id, debit_paise) values (v_je, v_store.org_id, v_acct, v_amt);
  insert into journal_lines (entry_id, org_id, account_id, credit_paise, party_id) values (v_je, v_store.org_id, acct(v_store.org_id, 'DEBTORS'), v_amt, c.id);
  return jsonb_build_object('entryId', v_je, 'balancePaise', v_bal - v_amt, 'duplicate', false);
end $$;

-- p: { idempotencyKey, storeId, distributorId, amountPaise, mode: cash|upi|bank, reference?, date? }
create or replace function post_supplier_payment(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_store stores%rowtype; d distributors%rowtype; v_amt bigint := (p->>'amountPaise')::bigint; v_due bigint; v_je uuid; v_acct uuid;
        v_date date := coalesce((p->>'date')::date, (now() at time zone 'Asia/Kolkata')::date);
begin
  if exists (select 1 from journal_entries where source_type = 'supplier_payment' and source_id = (p->>'idempotencyKey')::uuid) then
    return jsonb_build_object('duplicate', true);
  end if;
  select * into v_store from stores where id = (p->>'storeId')::uuid;
  if not found or not has_store_access(v_store.id) or not has_role(v_store.org_id, array['owner','admin','accountant','purchase']::member_role[]) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into d from distributors where id = (p->>'distributorId')::uuid and org_id = v_store.org_id;
  if not found then raise exception 'Unknown distributor'; end if;
  v_acct := _pay_account(v_store.org_id, p->>'mode');
  if v_acct is null or p->>'mode' = 'card' then raise exception 'Payment mode must be cash, upi or bank'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Amount must be positive' using errcode = 'check_violation'; end if;
  v_due := -party_balance(v_store.org_id, 'CREDITORS', d.id);
  if v_amt > v_due then raise exception 'Amount (%) is more than what is owed to % (%)', v_amt, d.name, v_due using errcode = 'check_violation'; end if;
  insert into journal_entries (org_id, store_id, entry_date, source_type, source_id, narration, created_by)
  values (v_store.org_id, v_store.id, v_date, 'supplier_payment', (p->>'idempotencyKey')::uuid,
          'Payment to ' || d.name || coalesce(' · ' || nullif(p->>'reference', ''), ''), auth.uid()) returning id into v_je;
  insert into journal_lines (entry_id, org_id, account_id, debit_paise, party_id) values (v_je, v_store.org_id, acct(v_store.org_id, 'CREDITORS'), v_amt, d.id);
  insert into journal_lines (entry_id, org_id, account_id, credit_paise) values (v_je, v_store.org_id, v_acct, v_amt);
  return jsonb_build_object('entryId', v_je, 'duePaise', v_due - v_amt, 'duplicate', false);
end $$;

-- ───────────────────────── balances ─────────────────────────
create or replace view v_customer_balances with (security_invoker = true) as
  select c.org_id, c.id as customer_id, c.name, c.phone, c.credit_limit_paise, c.is_active,
         coalesce(b.balance, 0)::bigint as outstanding_paise, b.last_entry
  from customers c
  left join lateral (
    select sum(jl.debit_paise - jl.credit_paise) as balance, max(je.entry_date) as last_entry
    from journal_lines jl join accounts a on a.id = jl.account_id join journal_entries je on je.id = jl.entry_id
    where a.org_id = c.org_id and a.code = 'DEBTORS' and jl.party_id = c.id
  ) b on true;

create or replace view v_supplier_balances with (security_invoker = true) as
  select d.org_id, d.id as distributor_id, d.name, d.gstin, d.drug_licence_no, d.drug_licence_valid_to, d.credit_days, d.is_active,
         coalesce(b.due, 0)::bigint as due_paise,
         (select min(pi.due_date) from purchase_invoices pi where pi.distributor_id = d.id) as oldest_due_date,
         (select max(pi.supplier_invoice_date) from purchase_invoices pi where pi.distributor_id = d.id) as last_purchase
  from distributors d
  left join lateral (
    select sum(jl.credit_paise - jl.debit_paise) as due
    from journal_lines jl join accounts a on a.id = jl.account_id
    where a.org_id = d.org_id and a.code = 'CREDITORS' and jl.party_id = d.id
  ) b on true;

grant execute on function import_products(uuid, jsonb, boolean), post_opening_stock(jsonb), post_customer_receipt(jsonb),
  post_supplier_payment(jsonb), product_gst_rate(uuid, date) to authenticated;
grant select on v_customer_balances, v_supplier_balances to authenticated;
