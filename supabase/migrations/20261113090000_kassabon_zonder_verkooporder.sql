-- Besluit Rick 13 november 2026: een kassabon (factura simplificada) is niet meer dan dat. Er is geen verkooporder,
-- geen levering en geen proforma; alleen de eigen reeks uit Instellingen (FS-BELLA, FS-HDB).
-- Intern blijft een record bestaan (voorraad, betaling, retour, Shopify). Dat record draagt voortaan het nummer van de kassabon.
-- Deze migratie zet bestaande kassaverkopen om en geeft de VO-, LV- en PF-nummers terug die ze verbruikten.
-- Herhaalbaar.

begin;

create temp table pos_sale on commit drop as
select i.sales_order_id as order_id, i.number as bon, so.number as old_order,
  (select d.number from deliveries d where d.sales_order_id = i.sales_order_id order by d.sequence limit 1) as old_lv
from invoices i join sales_orders so on so.id = i.sales_order_id
where i.simplified and i.kind <> 'creditfactuur' and so.number <> i.number;

-- Voorraadmutaties verwezen naar het VO-nummer (voorraadverschil) of het LV-nummer (aflevering).
update stock_movements m set ref_id = p.bon
from pos_sale p
where m.ref_id in (p.old_order, p.old_lv);

update deliveries d set number = p.bon, proforma_number = p.bon
from pos_sale p where d.sales_order_id = p.order_id;

update order_events e set message = replace(replace(e.message, p.old_order, p.bon), coalesce(p.old_lv, p.old_order), p.bon)
from pos_sale p where e.sales_order_id = p.order_id;

update order_events e set message = 'Kassaverkoop aangemaakt.'
from invoices i where i.sales_order_id = e.sales_order_id and i.simplified and i.kind <> 'creditfactuur'
  and e.kind = 'aangemaakt' and e.message like 'Verkooporder %';

update sales_orders so set number = p.bon
from pos_sale p where so.id = p.order_id;

-- Tellers terugzetten op het hoogste nummer dat nog in gebruik is (alleen gewone verkooporders en leveringen).
update number_series ns set last_number = coalesce((
  select max(substring(x.n from '-(\d{4})$')::int) from (
    select number as n from sales_orders where ns.id like 'VO-%'
    union all select number from deliveries where ns.id like 'LV-%'
    union all select proforma_number from deliveries where ns.id like 'PF-%'
  ) x
  where x.n ~ ('-' || split_part(ns.id, '-', 2) || '-\d{4}$')
    and x.n not in (select number from invoices where simplified)
), 0)
where ns.id ~ '^(VO|LV|PF)-\d{4}$';

commit;
