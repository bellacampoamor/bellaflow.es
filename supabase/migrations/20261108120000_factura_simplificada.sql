-- Kassa: facturen van de kassa zijn facturas simplificadas, met een eigen nummerreeks (voorvoegsel onder Beheer, standaard FS).
-- Tot en met 1.000 euro mogen de klantgegevens ontbreken; daarboven zijn naam, adres, woonplaats en NIE of paspoort verplicht
-- (dat controleert de app bij het afrekenen).
alter table settings add column if not exists prefix_invoice_simplified text not null default 'FS';
alter table invoices add column if not exists simplified boolean not null default false;
comment on column invoices.simplified is 'Factura simplificada (kassa), eigen nummerreeks met settings.prefix_invoice_simplified.';
