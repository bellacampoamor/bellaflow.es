-- Creditfacturen en retouren (opdracht Rick 8 november 2026).
-- Een factuur wijzigt nooit. Een retour, een fout of een korting achteraf wordt een creditfactuur (factura rectificativa)
-- met negatieve bedragen en een verwijzing naar de oorspronkelijke factuur. Elk een eigen nummerreeks:
-- gewone facturen FR, kassa Bella FRS-BELLA, kassa HDB FRS-HDB.

alter table settings add column if not exists prefix_invoice_credit text not null default 'FR';
alter table settings add column if not exists prefix_invoice_credit_simplified text not null default 'FRS-BELLA';
alter table settings add column if not exists prefix_invoice_credit_simplified_hdb text not null default 'FRS-HDB';

alter table invoices drop constraint if exists invoices_kind_check;
alter table invoices add constraint invoices_kind_check check (kind in ('deelfactuur', 'eindfactuur', 'volledig', 'creditfactuur'));
alter table invoices add column if not exists credit_of uuid references invoices (id);
alter table invoices add column if not exists credit_reason text not null default '';
create index if not exists invoices_credit_of_idx on invoices (credit_of) where credit_of is not null;
-- Een creditfactuur heeft altijd een oorspronkelijke factuur en een reden, en een gewone factuur heeft die niet.
alter table invoices drop constraint if exists invoices_credit_check;
alter table invoices add constraint invoices_credit_check check (
  (kind = 'creditfactuur' and credit_of is not null and length(trim(credit_reason)) > 0 and total <= 0)
  or (kind <> 'creditfactuur' and credit_of is null)
);
comment on column invoices.credit_of is 'Creditfactuur (factura rectificativa): de factuur die gecorrigeerd wordt.';

alter table invoice_lines add column if not exists credits_line_id uuid references invoice_lines (id);
comment on column invoice_lines.credits_line_id is 'Op een creditfactuur: de regel van de oorspronkelijke factuur die gecrediteerd wordt.';

-- Betalingen: verrekening tussen creditfactuur en factuur, en terugbetalingen als negatief bedrag.
alter table payments drop constraint if exists payments_method_check;
alter table payments add constraint payments_method_check check (method in ('pin', 'contant', 'overboeking', 'online', 'verrekening'));
alter table payments drop constraint if exists payments_amount_check;
alter table payments add constraint payments_amount_check check (amount <> 0);

-- Retour: het artikel komt terug in voorraad.
alter table stock_movements drop constraint if exists stock_movements_kind_check;
alter table stock_movements add constraint stock_movements_kind_check check (kind in ('ontvangst', 'levering', 'overboeking', 'correctie', 'retour'));
