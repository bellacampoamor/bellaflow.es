-- Afdrukformaat van de eenvoudige factuur van de kassa (besluit Rick 9 november 2026):
-- 'a4' = eenvoudige factuur op A4 (standaard), 'bon80' = kassabon op een thermische bonprinter van 80 mm.
alter table settings add column if not exists print_invoice_simplified text not null default 'a4';
alter table settings drop constraint if exists settings_print_invoice_simplified_check;
alter table settings add constraint settings_print_invoice_simplified_check check (print_invoice_simplified in ('a4', 'bon80'));
