-- Afmelden maakt een proforma; de factuur ontstaat pas bij Factureren.
alter table deliveries add column proforma_number text unique;
alter table settings add column prefix_proforma text not null default 'PF';
alter table settings drop column invoice_mode;
