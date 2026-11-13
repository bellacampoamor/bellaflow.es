-- Opdracht Rick 13 november 2026: "reset alle FS- en VO-nummers zodat wij weer op 1 beginnen in alle series en haal de
-- gemaakte VO- en FS-documenten uit de DB. Ik wil helemaal opnieuw beginnen."
-- Eenmalige reset van de verkoopkant, vóór de echte start. Verwijdert ALLE verkooporders, leveringen, facturen
-- (ook eenvoudige facturen en creditfacturen), betalingen, de Shopify-koppelingen, dagafsluitingen en de bijbehorende
-- voorraadmutaties, en zet de tellers van VO, LV, PF, F, FR, FS-BELLA, FS-HDB, FRS-BELLA en FRS-HDB terug, zodat elk
-- weer met 0001 begint. Inkoop, catalogi, klanten, producten, leveranciers en instellingen blijven staan.
-- Veiligheid: stopt zonder iets te doen als er een factuur na 13 november 2026 bestaat (dan draait Bella Flow echt).

begin;

do $$
begin
  if exists (select 1 from invoices where invoice_date > date '2026-11-13') then
    raise exception 'Reset geweigerd: er zijn facturen na 13-11-2026. Deze migratie is alleen voor de start.';
  end if;
end $$;

-- Facturen zijn normaal onwijzigbaar (trigger invoices_guard); alleen voor deze reset even uit.
alter table invoices disable trigger invoices_guard;

delete from hdb_shopify_orders;
delete from email_outbox where invoice_id is not null or delivery_id is not null or sales_order_id is not null;
delete from payments;
delete from invoice_lines;
delete from invoices;
delete from delivery_lines;
delete from deliveries;
delete from sales_orders;             -- regels en tijdlijn gaan mee (on delete cascade)
delete from cash_closings;

-- Voorraadmutaties van de verkoop: aflevering, retour en voorraadverschil van de kassa.
delete from stock_movements where kind in ('levering', 'retour') or (kind = 'correctie' and note like 'Kassa:%');

-- Tellers van de verkoopkant terug naar het begin (de eerstvolgende is weer 0001).
delete from number_series where id ~ '^(VO|LV|PF|F|FR|FS|FSH|FRS|FRSH)-\d{4}$';

alter table invoices enable trigger invoices_guard;

commit;
