-- Afleverbon: klaarzetten met akkoord, printen en ondertekenen. Route: coördinaten en volgorde.

alter table deliveries drop constraint deliveries_status_check;
alter table deliveries add constraint deliveries_status_check
  check (status in ('planned', 'ready', 'in_transit', 'delivered', 'cancelled'));

alter table deliveries
  add column ready_at date,
  add column approved_by text not null default '',
  add column note_printed_at timestamptz,
  add column signed_note_received boolean not null default false,
  add column route_position integer;

alter table warehouses
  add column latitude numeric(9, 6),
  add column longitude numeric(9, 6),
  add column is_route_origin boolean not null default false;

alter table sales_orders
  add column delivery_latitude numeric(9, 6),
  add column delivery_longitude numeric(9, 6);

-- Vertrekpunt van de bezorgroute.
update warehouses set latitude = 37.911372, longitude = -0.743650, is_route_origin = true where code = 'MAG-CAM';
