-- Mailen per document (besluit Rick 8 november 2026): onder Instellingen per document aan of uit
-- of Bella Flow het automatisch naar de klant mailt. Met de hand mailen vanaf het document blijft altijd mogelijk.
-- Standaard zoals het tot nu toe werkte: facturen en de getekende afleverbon aan, de verkooporder (nieuw) uit.
alter table settings add column if not exists mail_sales_order boolean not null default false;
alter table settings add column if not exists mail_invoice_simplified boolean not null default true;
alter table settings add column if not exists mail_invoice boolean not null default true;
alter table settings add column if not exists mail_signed_note boolean not null default true;

-- De verkooporder als pdf in de mailwachtrij.
alter table email_outbox add column if not exists sales_order_id uuid references sales_orders(id);
alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check check (
  (kind = 'getekende_afleverbon' and delivery_id is not null)
  or (kind = 'factuur' and invoice_id is not null)
  or (kind = 'inkooporders')
  or (kind = 'verkooporder' and sales_order_id is not null)
);
create index if not exists email_outbox_sales_order_idx on email_outbox (sales_order_id);
