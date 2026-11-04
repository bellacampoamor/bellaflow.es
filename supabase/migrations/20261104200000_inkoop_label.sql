-- Elke inkooporder heeft een label: voor de showroom, het magazijn of een verkooporder.
alter table purchase_orders add column label text not null default 'magazijn' check (label in ('showroom', 'magazijn', 'verkoop'));
