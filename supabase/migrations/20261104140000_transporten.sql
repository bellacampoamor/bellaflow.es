-- Transport van Nederland naar Spanje: dagelijkse inkopen worden aan een vertrekkende vrachtwagen gekoppeld.

create table transports (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  departure_date date not null,
  arrival_date date not null,
  carrier text not null default '',
  reference text not null default '',
  capacity_m3 numeric(8, 2) not null default 0,
  status text not null default 'planned' check (status in ('planned', 'departed', 'arrived', 'cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  check (arrival_date >= departure_date)
);

alter table inbound_shipments add column transport_id uuid references transports (id);
create index on inbound_shipments (transport_id);

alter table products add column volume_m3 numeric(8, 3) not null default 0;

alter table transports enable row level security;
create policy team_all on transports for all to authenticated using (true) with check (true);
grant select, insert, update, delete on transports to authenticated;
