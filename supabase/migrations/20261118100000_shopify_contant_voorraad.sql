-- Contant afgerekend aan de kassa van HDB: geen bestelling en geen betaling in Shopify, alleen de voorraad
-- (besluit Rick 18 november 2026). Nieuwe soorten in de wachtrij en de voorraadaanpassing van Shopify.
--   voorraad         kassabon volledig contant betaald: voorraad in Shopify omlaag
--   voorraad_retour  retour op zo'n kassabon: voorraad in Shopify weer omhoog
alter table hdb_shopify_orders drop constraint if exists hdb_shopify_orders_kind_check;
alter table hdb_shopify_orders add constraint hdb_shopify_orders_kind_check check (kind in ('verkoop', 'retour', 'voorraad', 'voorraad_retour'));
alter table hdb_shopify_orders add column if not exists shopify_adjustment_id text not null default '';
