-- Factuur per e-mail (afrekenen aan de kassa, of later vanaf de factuur).
-- De mailwachtrij kende alleen de getekende afleverbon; nu ook facturen.
alter table email_outbox alter column delivery_id drop not null;
alter table email_outbox add column if not exists invoice_id uuid references invoices(id);
alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check check (
  (kind = 'getekende_afleverbon' and delivery_id is not null)
  or (kind = 'factuur' and invoice_id is not null)
);
create index if not exists email_outbox_invoice_idx on email_outbox (invoice_id);
