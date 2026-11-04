-- Verkopers als vaste lijst; elke verkooporder hoort bij een verkoper.
create table salespeople (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null default '',
  phone text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table salespeople enable row level security;
create policy team_all on salespeople for all to authenticated using (true) with check (true);
grant select, insert, update, delete on salespeople to authenticated;

alter table sales_orders drop column salesperson;
alter table sales_orders add column salesperson_id uuid not null references salespeople (id);
