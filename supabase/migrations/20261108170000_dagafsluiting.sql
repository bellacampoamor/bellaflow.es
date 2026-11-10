-- Dagafsluiting en kasopmaak van de kassa (opdracht Rick 8 november 2026).
-- Per bedrijf (Bella of HDB) en per dag één afsluiting: geteld contant tegenover het systeem, met het verschil.
-- Een afsluiting is daarna niet meer te wijzigen of te verwijderen (alleen lezen en toevoegen).
create table if not exists cash_closings (
  id uuid primary key default gen_random_uuid(),
  issuer text not null check (issuer in ('bella', 'hdb')),
  business_date date not null,
  salesperson_id uuid not null references salespeople(id),
  opening_float numeric(12, 2) not null default 0,
  cash_sales numeric(12, 2) not null default 0,
  card_sales numeric(12, 2) not null default 0,
  other_sales numeric(12, 2) not null default 0,
  invoice_count integer not null default 0,
  first_invoice text not null default '',
  last_invoice text not null default '',
  base_amount numeric(12, 2) not null default 0,
  vat_amount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  counts jsonb not null default '{}'::jsonb,
  expected_cash numeric(12, 2) not null default 0,
  counted_cash numeric(12, 2) not null default 0 check (counted_cash >= 0),
  difference numeric(12, 2) not null default 0,
  card_terminal numeric(12, 2),
  deposited numeric(12, 2) not null default 0 check (deposited >= 0),
  kept_in_drawer numeric(12, 2) not null default 0 check (kept_in_drawer >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (issuer, business_date),
  check (deposited <= counted_cash),
  check (difference = 0 or length(trim(note)) > 0)
);
create index if not exists cash_closings_issuer_date_idx on cash_closings (issuer, business_date desc);

alter table cash_closings enable row level security;
create policy team_read on cash_closings for select to authenticated using ((select public.is_team_member()));
create policy team_insert on cash_closings for insert to authenticated with check ((select public.is_team_member()));
grant select, insert on cash_closings to authenticated;
