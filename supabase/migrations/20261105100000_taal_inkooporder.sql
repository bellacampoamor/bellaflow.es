-- Taal van de afgedrukte inkooporder. Leveranciers hebben geen eigen taal, dus er is altijd een vaste keuze.
alter table settings add column language_purchase_order text not null default 'nl' check (language_purchase_order in ('es', 'en', 'nl'));
