-- Sprint 1: onboarding (UC-ORG-01/02), users & roles via invitations (UC-ORG-05), pharmacists & shifts with PIN
-- approvals (UC-ORG-03, UC-POS-06, UC-CMP-05), licence alerts (UC-ORG-04), POS catalogue (UC-PRD-04), Rx storage.
-- Supabase installs pgcrypto/pg_trgm in schema "extensions", so functions using them include it in search_path.

-- ───────────────────────── onboarding ─────────────────────────
-- p: { legalName, tradeName?, pan?, store: { code, name, gstin?, gstScheme, stateCode, address, pincode, phone? } }
create or replace function create_organization(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_org uuid; v_store uuid; s jsonb := p->'store';
begin
  if v_user is null then raise exception 'Sign in first' using errcode = 'insufficient_privilege'; end if;
  if coalesce(trim(p->>'legalName'), '') = '' then raise exception 'Legal name is required'; end if;
  if (select count(*) from memberships where user_id = v_user and role = 'owner') >= 5 then
    raise exception 'Organisation limit reached for this account';
  end if;
  insert into orgs (legal_name, trade_name, pan)
  values (trim(p->>'legalName'), nullif(trim(p->>'tradeName'), ''), nullif(upper(trim(p->>'pan')), ''))
  returning id into v_org;
  insert into stores (org_id, code, name, gstin, gst_scheme, state_code, address, pincode, phone)
  values (v_org, upper(trim(s->>'code')), trim(s->>'name'), nullif(upper(trim(s->>'gstin')), ''),
          coalesce(s->>'gstScheme', 'regular')::gst_scheme, s->>'stateCode', trim(s->>'address'), s->>'pincode', s->>'phone')
  returning id into v_store;
  if (select gstin from stores where id = v_store) is not null and left((select gstin from stores where id = v_store), 2) <> s->>'stateCode' then
    raise exception 'GSTIN state code does not match the store state';
  end if;
  insert into memberships (user_id, org_id, role, max_discount_pct) values (v_user, v_org, 'owner', 100);
  perform seed_chart_of_accounts(v_org);
  insert into audit_log (org_id, user_id, action, entity, entity_id) values (v_org, v_user, 'create_organization', 'orgs', v_org::text);
  return jsonb_build_object('orgId', v_org, 'storeId', v_store);
end $$;

create or replace function add_store(p_org uuid, s jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_role(p_org, array['owner','admin']::member_role[]) then raise exception 'Only owners/admins can add stores' using errcode = 'insufficient_privilege'; end if;
  if nullif(trim(s->>'gstin'), '') is not null and left(upper(trim(s->>'gstin')), 2) <> s->>'stateCode' then
    raise exception 'GSTIN state code does not match the store state';
  end if;
  insert into stores (org_id, code, name, gstin, gst_scheme, state_code, address, pincode, phone)
  values (p_org, upper(trim(s->>'code')), trim(s->>'name'), nullif(upper(trim(s->>'gstin')), ''),
          coalesce(s->>'gstScheme', 'regular')::gst_scheme, s->>'stateCode', trim(s->>'address'), s->>'pincode', s->>'phone')
  returning id into v_id;
  return v_id;
end $$;

-- ───────────────────────── invitations ─────────────────────────
create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  email text not null check (email = lower(email) and email like '%@%'),
  role member_role not null,
  store_ids uuid[],
  max_discount_pct numeric(5,2) not null default 10,
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid not null,
  accepted_by uuid,
  accepted_at timestamptz,
  revoked boolean not null default false,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
alter table invitations enable row level security;
create policy invitations_admin_read on invitations for select to authenticated using (has_role(org_id, array['owner','admin']::member_role[]));
revoke insert, update, delete on invitations from authenticated, anon;

create or replace function invite_member(p_org uuid, p_email text, p_role member_role, p_store_ids uuid[] default null, p_max_discount numeric default 10)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_token uuid;
begin
  if not has_role(p_org, array['owner','admin']::member_role[]) then raise exception 'Only owners/admins can invite' using errcode = 'insufficient_privilege'; end if;
  if p_role = 'owner' and not has_role(p_org, array['owner']::member_role[]) then raise exception 'Only an owner can invite another owner' using errcode = 'insufficient_privilege'; end if;
  if p_store_ids is not null and exists (select 1 from unnest(p_store_ids) sid where not exists (select 1 from stores where id = sid and org_id = p_org)) then
    raise exception 'Store does not belong to this organisation';
  end if;
  update invitations set revoked = true where org_id = p_org and email = lower(trim(p_email)) and accepted_at is null and not revoked;
  insert into invitations (org_id, email, role, store_ids, max_discount_pct, invited_by)
  values (p_org, lower(trim(p_email)), p_role, p_store_ids, p_max_discount, auth.uid()) returning token into v_token;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (p_org, auth.uid(), 'invite_member', 'invitations', lower(trim(p_email)), jsonb_build_object('role', p_role));
  return v_token;   -- delivered by email/WhatsApp through an Edge Function
end $$;

create or replace function accept_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare i invitations%rowtype; v_email text := lower(auth.jwt()->>'email');
begin
  select * into i from invitations where token = p_token for update;
  if not found or i.revoked or i.accepted_at is not null or i.expires_at < now() then raise exception 'Invitation is invalid or has expired'; end if;
  if v_email is distinct from i.email then raise exception 'This invitation was sent to a different email address' using errcode = 'insufficient_privilege'; end if;
  insert into memberships (user_id, org_id, role, store_ids, max_discount_pct)
  values (auth.uid(), i.org_id, i.role, i.store_ids, i.max_discount_pct)
  on conflict (user_id, org_id) do update set role = excluded.role, store_ids = excluded.store_ids, max_discount_pct = excluded.max_discount_pct, active = true;
  update invitations set accepted_by = auth.uid(), accepted_at = now() where id = i.id;
  return i.org_id;
end $$;

create or replace function set_member_active(p_org uuid, p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role(p_org, array['owner','admin']::member_role[]) then raise exception 'Not allowed' using errcode = 'insufficient_privilege'; end if;
  if p_user = auth.uid() then raise exception 'You cannot deactivate yourself'; end if;
  if (select role from memberships where org_id = p_org and user_id = p_user) = 'owner' and not has_role(p_org, array['owner']::member_role[]) then
    raise exception 'Only an owner can deactivate an owner' using errcode = 'insufficient_privilege';
  end if;
  update memberships set active = p_active where org_id = p_org and user_id = p_user;
  insert into audit_log (org_id, user_id, action, entity, entity_id, details)
  values (p_org, auth.uid(), 'set_member_active', 'memberships', p_user::text, jsonb_build_object('active', p_active));
end $$;

-- memberships are now managed only through invitations / RPCs
drop policy if exists memberships_admin on memberships;
revoke insert, update, delete on memberships from authenticated, anon;

-- ───────────────────────── pharmacists, PIN approvals, shifts ─────────────────────────
-- pin_hash must never be readable by clients
revoke select, insert, update, delete on pharmacists from authenticated, anon;
grant select (id, org_id, user_id, name, council, reg_no, reg_valid_to) on pharmacists to authenticated;
revoke insert, update, delete on pharmacist_shifts from authenticated, anon;

create or replace function add_pharmacist(p_org uuid, p_name text, p_council text, p_reg_no text, p_reg_valid_to date, p_pin text, p_user uuid default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if not has_role(p_org, array['owner','admin']::member_role[]) then raise exception 'Only owners/admins can register pharmacists' using errcode = 'insufficient_privilege'; end if;
  if p_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must be 4–6 digits'; end if;
  if p_reg_valid_to is not null and p_reg_valid_to < current_date then raise exception 'Pharmacist registration has expired'; end if;
  insert into pharmacists (org_id, user_id, name, council, reg_no, reg_valid_to, pin_hash)
  values (p_org, p_user, trim(p_name), trim(p_council), upper(trim(p_reg_no)), p_reg_valid_to, crypt(p_pin, gen_salt('bf')))
  returning id into v_id;
  return v_id;
end $$;

create or replace function set_pharmacist_pin(p_pharmacist uuid, p_old_pin text, p_new_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare ph pharmacists%rowtype;
begin
  select * into ph from pharmacists where id = p_pharmacist;
  if not is_member(ph.org_id) then raise exception 'Not allowed' using errcode = 'insufficient_privilege'; end if;
  if not (has_role(ph.org_id, array['owner','admin']::member_role[]) or ph.pin_hash = crypt(p_old_pin, ph.pin_hash)) then
    raise exception 'Current PIN is wrong' using errcode = 'insufficient_privilege';
  end if;
  if p_new_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must be 4–6 digits'; end if;
  update pharmacists set pin_hash = crypt(p_new_pin, gen_salt('bf')) where id = p_pharmacist;
end $$;

-- One-time approval issued when a pharmacist enters their PIN at the counter; consumed by post_sale.
create table pharmacist_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  store_id uuid not null references stores(id),
  pharmacist_id uuid not null references pharmacists(id),
  requested_by uuid,
  used_by_bill uuid,
  created_at timestamptz not null default now()
);
alter table pharmacist_approvals enable row level security;
create policy pharmacist_approvals_read on pharmacist_approvals for select to authenticated using (is_member(org_id));
revoke insert, update, delete on pharmacist_approvals from authenticated, anon;

create or replace function _check_pin(p_store uuid, p_pharmacist uuid, p_pin text) returns pharmacists
language plpgsql security definer set search_path = public, extensions as $$
declare ph pharmacists%rowtype; v_fail int;
begin
  select * into ph from pharmacists where id = p_pharmacist;
  if not found or not has_store_access(p_store) or ph.org_id <> (select org_id from stores where id = p_store) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select count(*) into v_fail from audit_log
   where action = 'pin_failed' and entity_id = p_pharmacist::text and created_at > now() - interval '15 minutes';
  if v_fail >= 5 then raise exception 'PIN locked for 15 minutes after repeated failures' using errcode = 'insufficient_privilege'; end if;
  if ph.pin_hash is null or ph.pin_hash <> crypt(p_pin, ph.pin_hash) then
    insert into audit_log (org_id, user_id, action, entity, entity_id) values (ph.org_id, auth.uid(), 'pin_failed', 'pharmacists', p_pharmacist::text);
    return null;
  end if;
  if ph.reg_valid_to is not null and ph.reg_valid_to < current_date then raise exception 'Pharmacist registration expired on %', ph.reg_valid_to; end if;
  return ph;
end $$;
revoke all on function _check_pin(uuid, uuid, text) from public;

-- returns approval id (or null when the PIN is wrong — failed attempts are logged, so this must not raise)
create or replace function approve_rx_with_pin(p_store uuid, p_pharmacist uuid, p_pin text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ph pharmacists; v_id uuid;
begin
  ph := _check_pin(p_store, p_pharmacist, p_pin);
  if ph.id is null then return null; end if;
  insert into pharmacist_approvals (org_id, store_id, pharmacist_id, requested_by)
  values (ph.org_id, p_store, ph.id, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function start_pharmacist_shift(p_store uuid, p_pharmacist uuid, p_pin text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ph pharmacists; v_id uuid;
begin
  ph := _check_pin(p_store, p_pharmacist, p_pin);
  if ph.id is null then return null; end if;
  update pharmacist_shifts set ended_at = now() where pharmacist_id = ph.id and ended_at is null;
  insert into pharmacist_shifts (org_id, store_id, pharmacist_id) values (ph.org_id, p_store, ph.id) returning id into v_id;
  insert into audit_log (org_id, user_id, action, entity, entity_id) values (ph.org_id, auth.uid(), 'shift_start', 'pharmacist_shifts', v_id::text);
  return v_id;
end $$;

create or replace function end_pharmacist_shift(p_store uuid, p_pharmacist uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_store_access(p_store) then raise exception 'Not allowed' using errcode = 'insufficient_privilege'; end if;
  update pharmacist_shifts set ended_at = now() where store_id = p_store and pharmacist_id = p_pharmacist and ended_at is null;
end $$;

-- ───────────────────────── session context ─────────────────────────
create or replace function my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'userId', auth.uid(),
    'email', auth.jwt()->>'email',
    'orgs', coalesce(jsonb_agg(jsonb_build_object(
      'orgId', o.id, 'orgName', coalesce(o.trade_name, o.legal_name), 'role', m.role, 'maxDiscountPct', m.max_discount_pct,
      'stores', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', s.id, 'code', s.code, 'name', s.name, 'gstScheme', s.gst_scheme, 'stateCode', s.state_code, 'gstin', s.gstin, 'address', s.address, 'phone', s.phone,
          'pharmacistPresence', s.pharmacist_presence, 'rxValidityDays', s.rx_validity_days, 'nearExpiryDays', s.near_expiry_days,
          'onDuty', (select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'name', ph.name, 'regNo', ph.reg_no)), '[]')
                     from pharmacist_shifts sh join pharmacists ph on ph.id = sh.pharmacist_id
                     where sh.store_id = s.id and sh.ended_at is null)
        ) order by s.code), '[]')
        from stores s where s.org_id = o.id and (m.store_ids is null or s.id = any(m.store_ids)))
    ) order by o.legal_name) filter (where o.id is not null), '[]'))
  from memberships m join orgs o on o.id = m.org_id
  where m.user_id = auth.uid() and m.active
$$;

-- ───────────────────────── POS catalogue / search ─────────────────────────
-- p_q null → full sellable catalogue for the offline cache; otherwise ranked search by barcode / brand / salt.
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
           coalesce(resolve_gst_rate(p.hsn, current_date), -1) as "gstRate",
           (select min(barcode) from product_barcodes pb where pb.product_id = p.id) as barcode,
           (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'batchNo', b.batch_no, 'expiry', b.expiry, 'qtyBase', b.qty_on_hand,
                    'packMrpPaise', b.pack_mrp_paise, 'status', b.status, 'receivedAt', b.received_at) order by b.expiry), '[]')
              from batches b where b.product_id = p.id and b.store_id = p_store and b.qty_on_hand > 0) as batches,
           case when v_q is null then 0
                when exists (select 1 from product_barcodes pb where pb.product_id = p.id and pb.barcode = v_q) then 100
                when lower(p.name) like v_q || '%' then 50 + similarity(lower(p.name), v_q)
                else greatest(similarity(lower(p.name), v_q), similarity(lower(coalesce(p.composition, '')), v_q)) end as rank
    from products p
    where p.org_id = (select org_id from stores where id = p_store)
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

-- ───────────────────────── licence alerts ─────────────────────────
create or replace view v_licence_alerts with (security_invoker = true) as
  select l.org_id, l.store_id, s.name as store_name, 'licence' as kind, l.kind as name, l.number, l.valid_to, (l.valid_to - current_date) as days_left
  from licences l join stores s on s.id = l.store_id
  where l.valid_to is not null and l.valid_to <= current_date + 30
  union all
  select ph.org_id, null, null, 'pharmacist', ph.name, ph.reg_no, ph.reg_valid_to, (ph.reg_valid_to - current_date)
  from pharmacists ph where ph.reg_valid_to is not null and ph.reg_valid_to <= current_date + 30
  union all
  select d.org_id, null, null, 'distributor', d.name, d.drug_licence_no, d.drug_licence_valid_to, (d.drug_licence_valid_to - current_date)
  from distributors d where d.drug_licence_valid_to is not null and d.drug_licence_valid_to <= current_date + 30;

-- ───────────────────────── prescription storage (Supabase Storage) ─────────────────────────
-- Path convention: <org_id>/<anything>        staff uploads (POS Schedule X/NDPS copies, verification)
--                  <org_id>/customers/<auth.uid()>/<file>   storefront uploads
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $q$ insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
                values ('prescriptions', 'prescriptions', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
                on conflict (id) do nothing $q$;
    execute $q$ create policy rx_staff_rw on storage.objects for all to authenticated
                using (bucket_id = 'prescriptions' and public.is_member(((storage.foldername(name))[1])::uuid))
                with check (bucket_id = 'prescriptions' and public.is_member(((storage.foldername(name))[1])::uuid)) $q$;
    execute $q$ create policy rx_customer_upload on storage.objects for insert to authenticated
                with check (bucket_id = 'prescriptions' and (storage.foldername(name))[2] = 'customers' and (storage.foldername(name))[3] = auth.uid()::text) $q$;
    execute $q$ create policy rx_customer_read on storage.objects for select to authenticated
                using (bucket_id = 'prescriptions' and (storage.foldername(name))[2] = 'customers' and (storage.foldername(name))[3] = auth.uid()::text) $q$;
  end if;
end $$;

grant execute on function create_organization(jsonb), add_store(uuid, jsonb), invite_member(uuid, text, member_role, uuid[], numeric),
  accept_invitation(uuid), set_member_active(uuid, uuid, boolean), add_pharmacist(uuid, text, text, text, date, text, uuid),
  set_pharmacist_pin(uuid, text, text), approve_rx_with_pin(uuid, uuid, text), start_pharmacist_shift(uuid, uuid, text),
  end_pharmacist_shift(uuid, uuid), my_context(), pos_catalogue(uuid, text, int) to authenticated;
grant select on v_licence_alerts to authenticated;
