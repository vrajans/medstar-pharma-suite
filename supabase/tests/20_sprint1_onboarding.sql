-- Sprint 1 tests: onboarding, invitations, roles, pharmacist PIN & shifts, POS catalogue, licence alerts.
\set ON_ERROR_STOP on
set client_min_messages = warning;
set role authenticated;

-- UC-ORG-01/02: a brand-new user onboards their pharmacy
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select set_config('request.jwt.claims', '{"email":"owner@sharmamedicals.in"}', false);
do $$ declare r jsonb; c jsonb; begin
  r := create_organization('{"legalName":"Sharma Medicals","tradeName":"Sharma Medicals","pan":"ABCPS1234D",
        "store":{"code":"PUN1","name":"Sharma Medicals Kothrud","gstScheme":"composition","stateCode":"27","address":"Kothrud, Pune","pincode":"411038"}}'::jsonb);
  perform set_config('t.org', r->>'orgId', false);
  perform set_config('t.store', r->>'storeId', false);
  c := my_context();
  assert jsonb_array_length(c->'orgs') = 1 and c->'orgs'->0->>'role' = 'owner', 'context: ' || c::text;
  assert c->'orgs'->0->'stores'->0->>'gstScheme' = 'composition';
  assert (select count(*) from accounts) >= 20, 'chart of accounts not seeded';
end $$;

-- GSTIN state code must match store state
do $$ begin
  perform add_store(current_setting('t.org')::uuid, '{"code":"PUN2","name":"X","stateCode":"27","gstin":"29AAAFM1234C1Z5","address":"a","pincode":"411001"}'::jsonb);
  raise exception 'expected gstin/state mismatch to be caught';
exception when others then
  if sqlerrm like 'expected%' then raise; end if;
end $$;

-- memberships cannot be self-granted
do $$ begin
  insert into memberships (user_id, org_id, role) values (auth.uid(), '00000000-0000-0000-0000-000000000001', 'owner');
  raise exception 'expected membership insert denied';
exception when insufficient_privilege then null; end $$;

-- UC-ORG-05: invite billing staff limited to the store, accept with matching email only
do $$ declare v_token uuid; begin
  v_token := invite_member(current_setting('t.org')::uuid, 'Ravi@SharmaMedicals.in', 'billing', array[current_setting('t.store')::uuid], 5);
  perform set_config('t.token', v_token::text, false);
end $$;

select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select set_config('request.jwt.claims', '{"email":"someoneelse@gmail.com"}', false);
do $$ begin
  perform accept_invitation(current_setting('t.token')::uuid);
  raise exception 'expected wrong-email rejection';
exception when insufficient_privilege then null; end $$;

select set_config('request.jwt.claims', '{"email":"ravi@sharmamedicals.in"}', false);
do $$ declare c jsonb; begin
  perform accept_invitation(current_setting('t.token')::uuid);
  c := my_context();
  assert c->'orgs'->0->>'role' = 'billing' and (c->'orgs'->0->>'maxDiscountPct')::numeric = 5, c::text;
  -- billing staff cannot invite or add pharmacists
  begin
    perform invite_member(current_setting('t.org')::uuid, 'x@y.in', 'admin');
    raise exception 'expected invite denied';
  exception when insufficient_privilege then null; end;
  begin
    perform accept_invitation(current_setting('t.token')::uuid);
    raise exception 'expected token reuse rejected';
  exception when others then if sqlerrm like 'expected%' then raise; end if; end;
end $$;

-- UC-ORG-03: owner registers a pharmacist with a PIN
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select set_config('request.jwt.claims', '{"email":"owner@sharmamedicals.in"}', false);
do $$ declare v_id uuid; begin
  v_id := add_pharmacist(current_setting('t.org')::uuid, 'Sunita Sharma', 'Maharashtra State Pharmacy Council', 'mspc-778899', '2028-12-31', '4321');
  perform set_config('t.ph', v_id::text, false);
  begin
    perform pin_hash from pharmacists;
    raise exception 'pin_hash must not be readable';
  exception when insufficient_privilege then null; end;
  assert (select reg_no from pharmacists where id = v_id) = 'MSPC-778899';
end $$;

-- billing staff (Ravi) at the counter: wrong PIN → null + logged, right PIN → approval; shift start
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
do $$ declare v uuid; begin
  v := approve_rx_with_pin(current_setting('t.store')::uuid, current_setting('t.ph')::uuid, '0000');
  assert v is null, 'wrong PIN accepted';
  v := start_pharmacist_shift(current_setting('t.store')::uuid, current_setting('t.ph')::uuid, '4321');
  assert v is not null, 'shift not started';
  assert jsonb_array_length(my_context()->'orgs'->0->'stores'->0->'onDuty') = 1, 'on-duty pharmacist missing from context';
end $$;
reset role;
do $$ begin
  assert (select count(*) from audit_log where action = 'pin_failed' and entity_id = current_setting('t.ph')) = 1, 'failed PIN not logged';
end $$;

-- lockout after 5 failures
set role authenticated;
do $$ declare v uuid; begin
  for i in 1..4 loop v := approve_rx_with_pin(current_setting('t.store')::uuid, current_setting('t.ph')::uuid, '1111'); end loop;
  begin
    v := approve_rx_with_pin(current_setting('t.store')::uuid, current_setting('t.ph')::uuid, '4321');
    raise exception 'expected lockout';
  exception when insufficient_privilege then null; end;
end $$;

-- UC-PRD-04: POS catalogue search (owner adds products via table insert, stock via GRN)
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
do $$ declare v_p uuid; v_d uuid; r jsonb; begin
  insert into products (org_id, name, composition, hsn, schedule, units_per_pack, pack_label)
  values (current_setting('t.org')::uuid, 'Crocin Advance Tablet', 'Paracetamol 500mg', '30049099', 'OTC', 15, 'Strip') returning id into v_p;
  insert into product_barcodes (org_id, product_id, barcode) values (current_setting('t.org')::uuid, v_p, '8901571000123');
  insert into products (org_id, name, composition, hsn, schedule, units_per_pack)
  values (current_setting('t.org')::uuid, 'Montair LC Tablet', 'Montelukast + Levocetirizine', '30049099', 'H', 10);
  insert into distributors (org_id, name, state_code, drug_licence_no, drug_licence_valid_to)
  values (current_setting('t.org')::uuid, 'Pune Pharma Distributors', '27', 'MH-PZ1-20B-55', current_date + 10) returning id into v_d;
  perform post_purchase(jsonb_build_object('idempotencyKey', gen_random_uuid(), 'storeId', current_setting('t.store'), 'distributorId', v_d,
    'supplierInvoiceNo', 'PPD/77', 'supplierInvoiceDate', current_date,
    'lines', jsonb_build_array(jsonb_build_object('productId', v_p, 'batchNo', 'CR01', 'expiry', current_date + 400, 'packMrpPaise', 2050, 'packRatePaise', 1500, 'qtyPacks', 10))));

  r := pos_catalogue(current_setting('t.store')::uuid, '8901571000123');
  assert jsonb_array_length(r) = 1 and r->0->>'name' = 'Crocin Advance Tablet', 'barcode search: ' || r::text;
  assert (r->0->>'gstRate')::numeric = 5 and jsonb_array_length(r->0->'batches') = 1;
  r := pos_catalogue(current_setting('t.store')::uuid, 'paracet');
  assert jsonb_array_length(r) = 1, 'salt search';
  r := pos_catalogue(current_setting('t.store')::uuid, 'montair');
  assert jsonb_array_length(r) = 1 and jsonb_array_length(r->0->'batches') = 0, 'name search with no stock';
  r := pos_catalogue(current_setting('t.store')::uuid);
  assert jsonb_array_length(r) = 1, 'offline snapshot should only include stocked products';

  -- UC-ORG-04: distributor licence expiring in 10 days shows in alerts
  assert exists (select 1 from v_licence_alerts where kind = 'distributor' and days_left = 10), 'licence alert missing';
end $$;

-- composition dealer bill: Bill of Supply, no tax, cost includes GST
do $$ declare r jsonb; begin
  r := post_sale(jsonb_build_object('billUuid', gen_random_uuid(), 'storeId', current_setting('t.store'), 'deviceCode', 'POS1', 'billedAt', now(),
       'lines', jsonb_build_array(jsonb_build_object('productId', (select id from products where name like 'Crocin%'), 'qtyBase', 15)),
       'payments', jsonb_build_array(jsonb_build_object('mode', 'cash', 'amountPaise', 2100))));
  assert r->>'invoiceNo' like 'PUN1/%/0000%', r::text;
  assert (select document_type from sales_bills where id = (r->>'billId')::uuid) = 'BILL_OF_SUPPLY';
  assert (select cgst_paise + sgst_paise from sales_bills where id = (r->>'billId')::uuid) = 0;
end $$;

-- tenant isolation: Sharma's billing staff can't search the demo org's store
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
do $$ begin
  perform pos_catalogue('00000000-0000-0000-0000-0000000000a1', 'dolo');
  raise exception 'expected cross-tenant search denied';
exception when insufficient_privilege then null; end $$;
reset role;

select 'SPRINT 1 DATABASE TESTS PASSED' as result;
