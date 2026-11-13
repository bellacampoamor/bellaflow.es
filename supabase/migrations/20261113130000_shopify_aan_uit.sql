-- Shopify van HDB aan en uit (opdracht Rick 13 november 2026): in de testperiode wil Rick kunnen kiezen of
-- kassaverkopen van HDB naar de Shopify van HomeDecoBali gaan. Standaard aan (zoals tot nu toe). Herhaalbaar.
alter table settings add column if not exists hdb_shopify_enabled boolean not null default true;
