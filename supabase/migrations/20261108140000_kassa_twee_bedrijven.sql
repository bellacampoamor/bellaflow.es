-- Kassa met twee bedrijven (besluit Rick 8 november 2026): een eenvoudige factuur komt van Bella Outdoor and Furnishing
-- of van Handmade Bali Treasures SL (HomeDecoBali, HDB). HDB valt buiten de boekhouding van Bella.
-- Elk bedrijf heeft een eigen nummerreeks (FS-BELLA, FS-HDB), een logo en een beeldmerk. De eenvoudige factuur heeft
-- een eigen afdruktaal (standaard Spaans).

-- Voorvoegsels: het eerste voorvoegsel FS wordt FS-BELLA, HDB krijgt FS-HDB.
alter table settings alter column prefix_invoice_simplified set default 'FS-BELLA';
update settings set prefix_invoice_simplified = 'FS-BELLA' where prefix_invoice_simplified = 'FS';
alter table settings add column if not exists prefix_invoice_simplified_hdb text not null default 'FS-HDB';

-- Afdruktaal van de eenvoudige factuur.
alter table settings add column if not exists language_invoice_simplified text not null default 'es';
alter table settings drop constraint if exists settings_language_invoice_simplified_check;
alter table settings add constraint settings_language_invoice_simplified_check check (language_invoice_simplified in ('es', 'nl', 'en', 'klant'));

-- Logo (linksboven) en beeldmerk (klein onderaan): een upload als data-URL of een pad in public/.
alter table settings add column if not exists logo_bella text not null default '';
alter table settings add column if not exists mark_bella text not null default '';
alter table settings add column if not exists logo_hdb text not null default 'assets/brand/hdb-logo.png';
alter table settings add column if not exists mark_hdb text not null default 'assets/brand/hdb-beeldmerk.png';

-- Gegevens van HDB, onderaan de eenvoudige factuur van HDB.
alter table settings add column if not exists hdb_company_name text not null default 'Handmade Bali Treasures SL';
alter table settings add column if not exists hdb_trade_name text not null default 'HomeDecoBali';
alter table settings add column if not exists hdb_tax_id text not null default 'B05730825';
alter table settings add column if not exists hdb_address text not null default 'Avd de Constitución s/n';
alter table settings add column if not exists hdb_postal_code text not null default '03179';
alter table settings add column if not exists hdb_city text not null default 'Formentera del Segura';
alter table settings add column if not exists hdb_province text not null default 'ALC';
alter table settings add column if not exists hdb_country text not null default 'Spain';
alter table settings add column if not exists hdb_phone text not null default '';
alter table settings add column if not exists hdb_email text not null default '';

-- Uitgevend bedrijf per factuur. Bestaande facturen zijn van Bella.
alter table invoices add column if not exists issuer text not null default 'bella';
alter table invoices drop constraint if exists invoices_issuer_check;
alter table invoices add constraint invoices_issuer_check check (issuer in ('bella', 'hdb'));
comment on column invoices.issuer is 'Uitgevend bedrijf van een eenvoudige factuur (kassa): bella of hdb. HDB valt buiten de boekhouding van Bella.';
