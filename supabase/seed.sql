-- =============================================================================
-- seed.sql  -  Zones (permanent) + a lean TEST catalogue (is_test_data = true)
-- The test rows are removed by Admin > "Clear Test Data" at go-live.
-- Costs are per ORDER unit in GBP. Stock levels are in COUNT units.
-- =============================================================================

insert into public.zones (name, description, sort_order) values
  ('Front Display',    'Front counter and display cabinet',              10),
  ('Dry Store',        'Ambient shelving: coffee, syrups, dry goods',    20),
  ('Chiller / Fridge', 'Walk-in chiller and under-counter fridges',      30),
  ('Kitchen',          'Kitchen prep and baking ingredients',            40),
  ('Packaging',        'Cups, lids and take-away packaging',             50)
on conflict (name) do nothing;

insert into public.suppliers (name, contact_email, contact_phone, lead_time_days, notes, is_test_data) values
  ('TEST - Fresh Dairy Ltd',      'orders@freshdairy.example',   '020 7946 0001', 1, 'Test supplier. Order by 2pm for next-day delivery.', true),
  ('TEST - Bean & Brew Wholesale','orders@beanbrew.example',     '020 7946 0002', 2, 'Test supplier. Coffee, syrups, drinks.',            true),
  ('TEST - PackRight Supplies',   'sales@packright.example',     '020 7946 0003', 3, 'Test supplier. Packaging and dry goods.',           true)
on conflict (name) do nothing;

insert into public.products
  (zone_id, supplier_id, code_tag, has_handwritten_tag, name, brand, category, visual_hints,
   count_unit, order_unit, conversion_factor, default_shelf_depth, allow_open_fraction,
   min_stock, target_stock, safety_margin, round_up_order, unit_cost_gbp, is_test_data)
select z.id, s.id, p.code_tag, p.has_tag, p.name, p.brand, p.category, p.hints,
       p.count_unit, p.order_unit, p.factor, p.depth, p.allow_open,
       p.min_stock, p.target_stock, p.safety, p.round_up, p.cost, true
from (values
  ('Chiller / Fridge','TEST - Fresh Dairy Ltd',       'DA01', false, 'Oat Milk 1L (Barista)',        'Oatly',      'dairy',
     'Cream/blue 1L carton with Barista Edition text, stacked 2-3 high on chiller shelf',
     'carton', 'case', 6,  2, false, 6,  18, 2, true,  14.40),
  ('Chiller / Fridge','TEST - Fresh Dairy Ltd',       'DA02', false, 'Whole Milk 4 pint',           'Local Dairy','dairy',
     'Clear 4-pint plastic bottle with blue cap, often in rows of 2 behind each other',
     'bottle', 'case', 6,  2, false, 6,  24, 4, true,  9.60),
  ('Dry Store',       'TEST - Bean & Brew Wholesale', 'CF01', true,  'House Blend Coffee Beans 6x1kg','Bean & Brew','coffee',
     'Brown cardboard box with handwritten CF01 on front face; contains six 1kg foil bags',
     'box',    'box',  1,  1, true,  1,  3,  0.5, true, 68.00),
  ('Dry Store',       'TEST - Bean & Brew Wholesale', 'SY01', false, 'Vanilla Syrup 1L',            'Monin',      'syrups',
     '1L glass bottle, light yellow/cream label reading VANILLA, gold pump',
     'bottle', 'case', 6,  1, false, 2,  6,  1, true,  38.50),
  ('Dry Store',       'TEST - Bean & Brew Wholesale', 'SY02', false, 'Caramel Syrup 1L',            'Monin',      'syrups',
     '1L glass bottle, amber/orange label reading CARAMEL, gold pump - looks very similar to vanilla',
     'bottle', 'case', 6,  1, false, 2,  6,  1, true,  38.50),
  ('Packaging',       'TEST - PackRight Supplies',    'CP12', true,  '12oz Hot Cups (box of 1000)', 'PackRight',  'packaging',
     'Brown cardboard box with handwritten CP12 on front face or top corner',
     'box',    'box',  1,  2, true,  1,  4,  1, true,  62.00),
  ('Packaging',       'TEST - PackRight Supplies',    'TP12', true,  '12oz Lids (box of 1000)',     'PackRight',  'packaging',
     'White-and-brown cardboard box with handwritten TP12 on front face; do not confuse with CP12',
     'box',    'box',  1,  2, true,  1,  4,  1, true,  41.00),
  ('Kitchen',         'TEST - PackRight Supplies',    'KT01', false, 'Strong White Bread Flour 16kg','Allinson',  'kitchen',
     'Large paper sack, 16kg, blue and white print, stored on bottom shelf or floor pallet',
     'sack',   'sack', 1,  1, true,  1,  3,  0.5, true, 21.50),
  ('Front Display',   'TEST - Bean & Brew Wholesale', 'FD01', false, 'Still Water 500ml',           'Highland Spring','drinks',
     '500ml clear plastic bottle, blue label, laid in rows in the display fridge',
     'bottle', 'case', 24, 2, false, 12, 48, 6, true,  7.20)
) as p(zone_name, supplier_name, code_tag, has_tag, name, brand, category, hints,
       count_unit, order_unit, factor, depth, allow_open,
       min_stock, target_stock, safety, round_up, cost)
join public.zones     z on z.name = p.zone_name
join public.suppliers s on s.name = p.supplier_name
on conflict do nothing;

