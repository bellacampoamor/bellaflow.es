-- Inkooporders per dag als JSON per mail naar de leverancier (besluit Rick 7 november 2026).
-- Elke verzending wordt per inkooporder gelogd en is op de inkooporder te zien.
alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check check (
  (kind = 'getekende_afleverbon' and delivery_id is not null)
  or (kind = 'factuur' and invoice_id is not null)
  or (kind = 'inkooporders')
);

create table if not exists purchase_order_dispatches (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id),
  email_id uuid references email_outbox(id),
  channel text not null default 'json_mail' check (channel in ('json_mail')),
  dispatch_date date not null,
  file_name text not null default '',
  to_email text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists purchase_order_dispatches_po_idx on purchase_order_dispatches (purchase_order_id);
create index if not exists purchase_order_dispatches_email_idx on purchase_order_dispatches (email_id);

-- Een log wijzig je niet achteraf: alleen lezen en toevoegen.
alter table purchase_order_dispatches enable row level security;
create policy team_read on purchase_order_dispatches for select to authenticated using (true);
create policy team_insert on purchase_order_dispatches for insert to authenticated with check (true);
grant select, insert on purchase_order_dispatches to authenticated;
