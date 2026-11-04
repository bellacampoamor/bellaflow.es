-- Winkeladres voor de bcc en de wachtrij voor uitgaande mail.
alter table settings add column shop_email text not null default '';

create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'getekende_afleverbon',
  delivery_id uuid not null references deliveries(id),
  to_email text not null default '',
  bcc_email text not null default '',
  subject text not null,
  body_text text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'no_recipient', 'demo')),
  error text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table email_outbox enable row level security;
create policy team_all on email_outbox for all to authenticated using (true) with check (true);

-- Apart, zodat de pdf's niet met elk scherm mee geladen worden.
create table email_attachments (
  email_id uuid primary key references email_outbox(id) on delete cascade,
  file_name text not null,
  content_base64 text not null
);
alter table email_attachments enable row level security;
create policy team_all on email_attachments for all to authenticated using (true) with check (true);
grant select, insert, update, delete on email_outbox to authenticated;
grant select, insert, update, delete on email_attachments to authenticated;
