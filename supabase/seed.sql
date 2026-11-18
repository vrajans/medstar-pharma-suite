-- Seed: GST rates (GST 2.0, effective 22-Sep-2025 — accounting-sme to re-verify against CBIC notifications)
insert into tax_rates (hsn_prefix, rate, effective_from, effective_to, note) values
 ('3003', 12, '2017-07-01', '2025-09-21', 'Medicaments (bulk) — pre GST 2.0'),
 ('3004', 12, '2017-07-01', '2025-09-21', 'Medicaments (retail packs) — pre GST 2.0'),
 ('3003',  5, '2025-09-22', null, 'Medicaments — GST 2.0'),
 ('3004',  5, '2025-09-22', null, 'Medicaments retail — GST 2.0'),
 ('3002',  5, '2025-09-22', null, 'Vaccines, blood products — verify specific nil items'),
 ('3005',  5, '2025-09-22', null, 'Bandages, gauze, dressings'),
 ('3006',  5, '2025-09-22', null, 'Pharmaceutical goods (Ch. 30)'),
 ('9018',  5, '2025-09-22', null, 'Medical instruments & devices'),
 ('9025',  5, '2025-09-22', null, 'Clinical thermometers'),
 ('9027',  5, '2025-09-22', null, 'Diagnostic kits'),
 ('4015',  5, '2025-09-22', null, 'Surgical gloves'),
 ('3304', 18, '2017-07-01', null, 'Cosmetics / skin care'),
 ('3401', 18, '2017-07-01', null, 'Soap — verify slab'),
 ('2106', 18, '2017-07-01', null, 'Food supplements / nutraceuticals — verify')
on conflict do nothing;
-- NOTE: the 36 Nil-rated life-saving drugs need 8-digit HSN / product-level overrides; load from the notified list.

-- Demo tenant (local development only)
insert into orgs (id, legal_name, trade_name, pan) values
 ('00000000-0000-0000-0000-000000000001', 'MedStar Demo Pharmacy LLP', 'MedStar Demo', 'AAAFM1234C');
insert into stores (id, org_id, code, name, gstin, state_code, address, pincode, online_enabled) values
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'BLR1', 'MedStar Indiranagar',
  '29AAAFM1234C1Z5', '29', '100 Feet Road, Indiranagar, Bengaluru', '560038', true);
select seed_chart_of_accounts('00000000-0000-0000-0000-000000000001');

insert into products (id, org_id, name, manufacturer, composition, dosage_form, hsn, schedule, units_per_pack, pack_label, listed_online) values
 ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000001', 'Dolo 650 Tablet', 'Micro Labs', 'Paracetamol 650mg', 'Tablet', '30049099', 'OTC', 15, 'Strip', true)
on conflict do nothing;
