-- Bella Flow: van inkoop tot factuur.
-- Kolomnamen zijn gelijk aan de types in src/data/types.ts.
-- Voorraad wordt nooit als los getal bewaard: stock_movements is de bron, v_stock telt op.

-- Stamgegevens ---------------------------------------------------------------

create table settings (
  id text primary key default 'default',
  company_name text not null default '',
  tax_id text not null default '',
  address text not null default '',
  postal_code text not null default '',
  city text not null default '',
  province text not null default '',
  phone text not null default '',
  email text not null default '',
  iban text not null default '',
  invoice_mode text not null default 'manual' check (invoice_mode in ('manual', 'auto')),
  payment_days integer not null default 14 check (payment_days >= 0),
  invoice_footer text not null default ''
);

create table warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null default 'magazijn' check (kind in ('winkel', 'magazijn', 'extern')),
  address text not null default '',
  postal_code text not null default '',
  city text not null default '',
  phone text not null default '',
  contact_name text not null default '',
  receives_goods boolean not null default true,
  ships_goods boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vat_number text not null default '',
  contact_name text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  city text not null default '',
  country text not null default 'Nederland',
  lead_time_days integer not null default 21,
  payment_terms text not null default '',
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'particulier' check (kind in ('particulier', 'zakelijk')),
  name text not null,
  company text not null default '',
  tax_id text not null default '',
  email text not null default '',
  phone text not null default '',
  language text not null default 'es' check (language in ('es', 'nl', 'en')),
  address text not null default '',
  postal_code text not null default '',
  city text not null default '',
  province text not null default '',
  country text not null default 'España',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  collection text not null default '',
  category text not null default '',
  material text not null default '',
  color text not null default '',
  dimensions text not null default '',
  weight_kg numeric(8, 2) not null default 0,
  colli integer not null default 1,
  purchase_price numeric(12, 2) not null default 0,
  sale_price numeric(12, 2) not null default 0, -- inclusief IVA
  vat_rate numeric(5, 2) not null default 21,
  supplier_id uuid references suppliers (id),
  min_stock integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Verkoop --------------------------------------------------------------------

create table sales_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references customers (id),
  order_date date not null,
  channel text not null default 'winkel' check (channel in ('winkel', 'online', 'telefoon', 'beurs')),
  salesperson text not null default '',
  customer_reference text not null default '',
  order_type text not null check (order_type in ('direct', 'bestelling')),
  fulfilment text not null check (fulfilment in ('meenemen', 'verzenden', 'bezorgen')),
  requested_date date,
  promised_date date,
  delivery_name text not null default '',
  delivery_phone text not null default '',
  delivery_address text not null default '',
  delivery_postal_code text not null default '',
  delivery_city text not null default '',
  floor text not null default '',
  has_elevator boolean not null default false,
  needs_assembly boolean not null default false,
  remove_old_furniture boolean not null default false,
  delivery_notes text not null default '',
  notes text not null default '',
  status text not null default 'open' check (status in ('open', 'cancelled')),
  created_at timestamptz not null default now()
);

create table sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references sales_orders (id) on delete cascade,
  product_id uuid not null references products (id),
  description text not null,
  options text not null default '', -- stof, afwerking, maatwerk
  qty integer not null check (qty > 0),
  unit_price numeric(12, 2) not null, -- inclusief IVA
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  vat_rate numeric(5, 2) not null default 21,
  source text not null check (source in ('voorraad', 'bestelling')),
  warehouse_id uuid references warehouses (id) -- leeg zolang bestelde goederen niet binnen zijn
);
create index on sales_order_lines (sales_order_id);

create table order_events (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references sales_orders (id) on delete cascade,
  kind text not null,
  message text not null,
  old_date date,
  new_date date,
  customer_notified boolean not null default false,
  created_at timestamptz not null default now()
);
create index on order_events (sales_order_id);

-- Inkoop en ontvangst --------------------------------------------------------

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  supplier_id uuid not null references suppliers (id),
  order_date date not null,
  supplier_reference text not null default '',
  notes text not null default '',
  status text not null default 'open' check (status in ('open', 'cancelled')),
  created_at timestamptz not null default now()
);

create table purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders (id) on delete cascade,
  product_id uuid not null references products (id),
  qty integer not null check (qty > 0),
  unit_cost numeric(12, 2) not null default 0,
  sales_order_line_id uuid references sales_order_lines (id) -- ingekocht voor deze klantorder
);
create index on purchase_order_lines (purchase_order_id);

create table inbound_shipments (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders (id) on delete cascade,
  sequence integer not null,
  expected_date date not null,
  original_date date not null,
  warehouse_id uuid not null references warehouses (id), -- verwachte losplek
  carrier text not null default '',
  status text not null default 'expected' check (status in ('expected', 'partial', 'received', 'closed')),
  notes text not null default '',
  unique (purchase_order_id, sequence)
);

create table inbound_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references inbound_shipments (id) on delete cascade,
  purchase_order_line_id uuid not null references purchase_order_lines (id) on delete cascade,
  qty integer not null check (qty > 0)
);
create index on inbound_shipment_lines (shipment_id);

create table goods_receipts (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  shipment_id uuid not null references inbound_shipments (id),
  received_date date not null,
  delivery_note text not null default '',
  received_by text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- Eén pakbonregel kan over meerdere rijen verdeeld zijn, per magazijn één rij.
create table goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references goods_receipts (id) on delete cascade,
  shipment_line_id uuid not null references inbound_shipment_lines (id),
  product_id uuid not null references products (id),
  warehouse_id uuid not null references warehouses (id),
  qty_received integer not null default 0 check (qty_received >= 0),
  qty_damaged integer not null default 0 check (qty_damaged >= 0),
  location_bin text not null default ''
);
create index on goods_receipt_lines (receipt_id);

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  warehouse_id uuid not null references warehouses (id),
  qty integer not null check (qty <> 0),
  kind text not null check (kind in ('ontvangst', 'levering', 'overboeking', 'correctie')),
  ref_id text not null default '',
  note text not null default '',
  moved_at date not null
);
create index on stock_movements (product_id, warehouse_id);

-- Levering aan klant ---------------------------------------------------------

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  sales_order_id uuid not null references sales_orders (id),
  sequence integer not null,
  method text not null check (method in ('meenemen', 'vervoerder', 'eigen_team')),
  planned_date date not null,
  time_slot text not null default '',
  carrier text not null default '',
  status text not null default 'planned' check (status in ('planned', 'in_transit', 'delivered', 'cancelled')),
  delivered_at date,
  signed_by text not null default '',
  notes text not null default ''
);
create index on deliveries (sales_order_id);

create table delivery_lines (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries (id) on delete cascade,
  sales_order_line_id uuid not null references sales_order_lines (id),
  warehouse_id uuid not null references warehouses (id),
  qty integer not null check (qty > 0)
);
create index on delivery_lines (delivery_id);

-- Facturatie -----------------------------------------------------------------

create table invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  sales_order_id uuid not null references sales_orders (id),
  customer_id uuid not null references customers (id),
  kind text not null check (kind in ('deelfactuur', 'eindfactuur', 'volledig')),
  invoice_date date not null,
  due_date date not null,
  base_amount numeric(12, 2) not null,
  vat_amount numeric(12, 2) not null,
  total numeric(12, 2) not null,
  deposit_settled numeric(12, 2) not null default 0,
  language text not null default 'es',
  created_at timestamptz not null default now()
);
create index on invoices (sales_order_id);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id) on delete cascade,
  delivery_line_id uuid references delivery_lines (id),
  description text not null,
  qty integer not null,
  unit_price numeric(12, 2) not null,
  discount_pct numeric(5, 2) not null default 0,
  vat_rate numeric(5, 2) not null,
  line_total numeric(12, 2) not null
);
create index on invoice_lines (invoice_id);
create unique index invoice_lines_delivery_line_once on invoice_lines (delivery_line_id) where delivery_line_id is not null;

create table payments (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references sales_orders (id),
  invoice_id uuid references invoices (id),
  kind text not null check (kind in ('vooruitbetaling', 'betaling')),
  method text not null check (method in ('pin', 'contant', 'overboeking', 'online')),
  amount numeric(12, 2) not null check (amount > 0),
  paid_at date not null,
  reference text not null default ''
);
create index on payments (sales_order_id);

-- Nummering ------------------------------------------------------------------

create table number_series (
  id text primary key, -- bijvoorbeeld 'F-2026'
  last_number integer not null default 0
);

-- Nummers uit de database, zodat twee gebruikers nooit hetzelfde nummer krijgen.
create function next_number(p_series text, p_year integer)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_id text := p_series || '-' || p_year;
  v_next integer;
begin
  insert into number_series (id, last_number) values (v_id, 1)
  on conflict (id) do update set last_number = number_series.last_number + 1
  returning last_number into v_next;
  return v_id || '-' || lpad(v_next::text, 4, '0');
end;
$$;

-- Facturen: geen terugdatering, en bedragen staan vast na uitgifte.
create function guard_invoice()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from invoices where invoice_date > new.invoice_date) then
      raise exception 'Factuurdatum % ligt voor de laatst uitgegeven factuur', new.invoice_date;
    end if;
    return new;
  end if;
  raise exception 'Een uitgegeven factuur kan niet worden gewijzigd of verwijderd';
end;
$$;

create trigger invoices_guard
before insert or update or delete on invoices
for each row execute function guard_invoice();

-- Rapportage -----------------------------------------------------------------

create view v_stock with (security_invoker = true) as
with on_hand as (
  select product_id, warehouse_id, sum(qty)::integer as on_hand
  from stock_movements group by 1, 2
),
shipped as (
  select dl.sales_order_line_id, sum(dl.qty)::integer as qty
  from delivery_lines dl
  join deliveries d on d.id = dl.delivery_id and d.status = 'delivered'
  group by 1
),
reserved as (
  select l.product_id, l.warehouse_id, sum(l.qty - coalesce(s.qty, 0))::integer as reserved
  from sales_order_lines l
  join sales_orders o on o.id = l.sales_order_id and o.status = 'open'
  left join shipped s on s.sales_order_line_id = l.id
  where l.warehouse_id is not null
  group by 1, 2
)
select
  coalesce(h.product_id, r.product_id) as product_id,
  coalesce(h.warehouse_id, r.warehouse_id) as warehouse_id,
  coalesce(h.on_hand, 0) as on_hand,
  coalesce(r.reserved, 0) as reserved,
  coalesce(h.on_hand, 0) - coalesce(r.reserved, 0) as available
from on_hand h
full join reserved r on r.product_id = h.product_id and r.warehouse_id = h.warehouse_id;

-- Toegang: ieder ingelogd teamlid mag alles. Anonieme bezoekers niets.
do $$
declare t text;
begin
  foreach t in array array[
    'settings','warehouses','suppliers','customers','products','sales_orders','sales_order_lines',
    'order_events','purchase_orders','purchase_order_lines','inbound_shipments','inbound_shipment_lines',
    'goods_receipts','goods_receipt_lines','stock_movements','deliveries','delivery_lines','invoices',
    'invoice_lines','payments','number_series'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy team_all on %I for all to authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

grant select on v_stock to authenticated;
revoke execute on function next_number(text, integer) from public;
grant execute on function next_number(text, integer) to authenticated;

insert into settings (id) values ('default');

-- De drie locaties van Bella Outdoor and Furnishing.
insert into warehouses (code, name, kind, city) values
  ('SHR-CAM', 'Showroom Campoamor', 'winkel', 'Campoamor'),
  ('MAG-CAM', 'Magazijn Campoamor', 'magazijn', 'Campoamor'),
  ('MAG-ALM', 'Magazijn Almoradí', 'magazijn', 'Almoradí');
