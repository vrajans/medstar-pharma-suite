-- Atomic posting functions (ADR-002). Clients never insert into ledgers directly.
-- Tax maths mirrors packages/core/src/gst.ts exactly (Postgres round() is half-away-from-zero).

create or replace function _line_tax(p_amount bigint, p_rate numeric, p_scheme gst_scheme, p_inter boolean,
  out taxable bigint, out cgst bigint, out sgst bigint, out igst bigint)
language plpgsql immutable as $$
declare t bigint;
begin
  if p_scheme = 'composition' then taxable := p_amount; cgst := 0; sgst := 0; igst := 0; return; end if;
  taxable := round(p_amount * 10000.0 / (10000 + round(p_rate * 100)));
  t := p_amount - taxable;
  if p_inter then igst := t; cgst := 0; sgst := 0;
  else cgst := trunc(t / 2.0); sgst := t - cgst; igst := 0; end if;
end $$;

-- ───────────────────────── post_sale ─────────────────────────
-- p: { billUuid, storeId, deviceCode, provisionalNo?, billedAt, customerId?, billDiscountPct?, offline?,
--      lines:[{productId, qtyBase, batchId?, packPricePaise?, discountPct?}],
--      payments:[{mode, amountPaise, reference?}],
--      prescription?:{doctorId?, prescriberName, prescriberRegNo, prescriberAddress?, rxDate, rxImagePath?, patientName, patientAddress},
--      pharmacistId?, onlineOrderId? }
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
    v_rate := resolve_gst_rate(v_prod.hsn, v_date);
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
  if exists (select 1 from jsonb_array_elements(p->'payments') x where x->>'mode' = 'credit') and p->>'customerId' is null then
    raise exception 'Credit sale requires a customer';
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

create or replace function _post_sale_line(p_bill uuid, s stores, pr products, b batches, p_qty int, l jsonb, p_rate numeric, p_disc numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_price bigint := coalesce((l->>'packPricePaise')::bigint, b.pack_mrp_paise);
        v_gross bigint; v_priced bigint; v_amount bigint; t record; v_cost bigint;
begin
  if v_price > b.pack_mrp_paise then raise exception 'Selling price cannot exceed MRP for %', pr.name using errcode = 'check_violation'; end if;
  if p_qty % pr.units_per_pack <> 0 and not pr.allow_loose then raise exception '% cannot be sold loose', pr.name; end if;
  v_gross  := round(b.pack_mrp_paise * p_qty::numeric / pr.units_per_pack);
  v_priced := round(v_price * p_qty::numeric / pr.units_per_pack);
  v_amount := round(v_priced * (1 - p_disc / 100));
  select * into t from _line_tax(v_amount, p_rate, s.gst_scheme, false);
  v_cost := round(b.cost_per_unit_paise * p_qty);
  insert into sales_bill_lines (bill_id, org_id, product_id, batch_id, hsn, schedule, qty_base, pack_mrp_paise, units_per_pack,
    discount_pct, gross_paise, amount_paise, taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, cost_paise)
  values (p_bill, s.org_id, pr.id, b.id, pr.hsn, pr.schedule, p_qty, b.pack_mrp_paise, pr.units_per_pack,
    p_disc, v_gross, v_amount, t.taxable, case when s.gst_scheme = 'composition' then 0 else p_rate end, t.cgst, t.sgst, t.igst, v_cost);
  update batches set qty_on_hand = qty_on_hand - p_qty where id = b.id;
  insert into stock_ledger (org_id, store_id, batch_id, product_id, doc_type, doc_id, qty_delta, created_by)
  values (s.org_id, s.id, b.id, pr.id, 'sale', p_bill, -p_qty, auth.uid());
end $$;
revoke all on function _post_sale_line(uuid, stores, products, batches, int, jsonb, numeric, numeric) from public;

-- ───────────────────────── post_purchase (GRN) ─────────────────────────
-- p: { idempotencyKey, storeId, distributorId, supplierInvoiceNo, supplierInvoiceDate,
--      lines:[{productId, batchNo, expiry, packMrpPaise, packRatePaise, qtyPacks, freePacks?, discountPct?}] }
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
    v_rate := resolve_gst_rate(pr.hsn, v_date);
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
    round_off_paise = v_round, total_paise = v_total
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

-- ───────────────────────── online order helpers ─────────────────────────
create or replace function verify_online_rx(p_order uuid, p_pharmacist uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o online_orders%rowtype;
begin
  select * into o from online_orders where id = p_order for update;
  if not has_role(o.org_id, array['owner','admin','pharmacist']::member_role[]) then
    raise exception 'Only a pharmacist can verify prescriptions' using errcode = 'insufficient_privilege';
  end if;
  update prescriptions set verified_by = p_pharmacist, verified_at = now(),
    verification_status = case when p_approve then 'approved' else 'rejected' end, rejection_reason = p_reason
  where id in (select prescription_id from online_order_prescriptions where order_id = p_order);
  if o.status = 'placed' then update online_orders set status = 'rx_verification' where id = p_order; end if;
  update online_orders set rx_approved = p_approve where id = p_order;
  update online_orders set status = case when p_approve then 'confirmed' else 'rejected' end::order_status where id = p_order;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (o.org_id, auth.uid(), case when p_approve then 'rx_approve' else 'rx_reject' end, 'online_orders', p_order::text, jsonb_build_object('reason', p_reason));
end $$;

-- Schedule recall: quarantine matching batches across the org (UC-INV-07)
create or replace function apply_recall(p_recall uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r recalls%rowtype; n int;
begin
  select * into r from recalls where id = p_recall;
  update batches b set status = 'recalled'
  from products p
  where p.id = b.product_id and b.batch_no = r.batch_no and (r.org_id is null or b.org_id = r.org_id)
    and p.name ilike '%' || r.product_name || '%' and is_member(b.org_id);
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────────────────────── place_online_order (storefront) ─────────────────────────
-- p: { storeId, fulfilment, address?, pincode?, items:[{productId, qtyBase}], prescriptionIds:[], paymentMode, notes? }
create or replace function place_online_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_store stores%rowtype; v_cust uuid; v_id uuid := gen_random_uuid(); v_no text; i jsonb; v_rx uuid;
begin
  select * into v_store from stores where id = (p->>'storeId')::uuid and online_enabled;
  if not found then raise exception 'Store is not accepting online orders'; end if;
  select id into v_cust from customers where org_id = v_store.org_id and auth_user_id = auth.uid();
  if v_cust is null then raise exception 'Please complete your profile first' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from consents where customer_id = v_cust and purpose = 'service' and granted) then
    raise exception 'Service consent (DPDP notice) required before placing an order';
  end if;
  if p->>'fulfilment' = 'delivery' and not exists (select 1 from serviceable_pincodes where store_id = v_store.id and pincode = p->>'pincode') then
    raise exception 'We do not deliver to pincode % from this store', p->>'pincode' using errcode = 'check_violation';
  end if;
  v_no := 'WEB-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || '-' || upper(substr(replace(v_id::text,'-',''), 1, 6));
  insert into online_orders (id, org_id, store_id, customer_id, order_no, fulfilment, delivery_address, delivery_pincode, payment_mode, notes)
  values (v_id, v_store.org_id, v_store.id, v_cust, v_no, p->>'fulfilment', p->>'address', p->>'pincode', p->>'paymentMode', p->>'notes');
  for i in select * from jsonb_array_elements(p->'items') loop
    insert into online_order_items (order_id, org_id, product_id, qty_base)
    select v_id, v_store.org_id, pr.id, (i->>'qtyBase')::int from products pr
    where pr.id = (i->>'productId')::uuid and pr.org_id = v_store.org_id and pr.listed_online and pr.blocked_reason is null;
    if not found then raise exception 'Product % is not available online', i->>'productId'; end if;
  end loop;
  for v_rx in select (x)::uuid from jsonb_array_elements_text(coalesce(p->'prescriptionIds','[]'::jsonb)) x loop
    if not exists (select 1 from prescriptions where id = v_rx and customer_id = v_cust) then raise exception 'Invalid prescription'; end if;
    insert into online_order_prescriptions (order_id, prescription_id, org_id) values (v_id, v_rx, v_store.org_id);
  end loop;
  if (select has_rx_items from online_orders where id = v_id) and not exists (select 1 from online_order_prescriptions where order_id = v_id) then
    raise exception 'Upload a valid prescription for prescription medicines' using errcode = 'check_violation';
  end if;
  if (select has_rx_items from online_orders where id = v_id) then
    update online_orders set status = 'rx_verification' where id = v_id;
  end if;
  return jsonb_build_object('orderId', v_id, 'orderNo', v_no, 'status', (select status from online_orders where id = v_id));
end $$;
grant execute on function place_online_order(jsonb) to authenticated;
