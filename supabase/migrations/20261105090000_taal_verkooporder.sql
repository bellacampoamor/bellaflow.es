-- Ook de afgedrukte verkooporder krijgt een eigen documenttaal.
alter table settings add column language_sales_order text not null default 'klant' check (language_sales_order in ('klant', 'es', 'en', 'nl'));
