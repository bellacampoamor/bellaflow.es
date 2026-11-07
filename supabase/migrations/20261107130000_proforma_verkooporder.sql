-- Proforma: een verkooporder die in de winkel is gescand (scan.bellaflow.es), nog zonder klant en met een
-- tijdelijk nummer (PRO-). Bij bevestigen krijgt hij een klant, het VO-nummer en de status open.

alter table sales_orders alter column customer_id drop not null;
alter table sales_orders drop constraint if exists sales_orders_status_check;
alter table sales_orders add constraint sales_orders_status_check check (status in ('proforma', 'open', 'cancelled'));
-- Alleen een proforma mag zonder klant.
alter table sales_orders add constraint sales_orders_klant_verplicht check (customer_id is not null or status = 'proforma');

-- Een proforma reserveert voorraad, zodat niemand hetzelfde stuk nog eens verkoopt.
create or replace view v_stock with (security_invoker = true) as
with on_hand as (
  select product_id, warehouse_id, sum(qty)::integer as on_hand
  from stock_movements group by 1, 2
),
shipped as (
  select dl.sales_order_line_id, sum(dl.qty)::integer as qty
  from delivery_lines dl
  join deliveries d on d.id = dl.delivery_id and d.status = 'delivered'
  group by 1
),
reserved as (
  select l.product_id, l.warehouse_id, sum(l.qty - coalesce(s.qty, 0))::integer as reserved
  from sales_order_lines l
  join sales_orders o on o.id = l.sales_order_id and o.status in ('open', 'proforma')
  left join shipped s on s.sales_order_line_id = l.id
  where l.warehouse_id is not null
  group by 1, 2
)
select
  coalesce(h.product_id, r.product_id) as product_id,
  coalesce(h.warehouse_id, r.warehouse_id) as warehouse_id,
  coalesce(h.on_hand, 0) as on_hand,
  coalesce(r.reserved, 0) as reserved,
  coalesce(h.on_hand, 0) - coalesce(r.reserved, 0) as available
from on_hand h
full join reserved r on r.product_id = h.product_id and r.warehouse_id = h.warehouse_id;
