-- Een factuur staat vast, dus het artikelnummer gaat mee op de factuurregel.
alter table invoice_lines disable trigger user;
alter table invoice_lines add column article_number text not null default '';
update invoice_lines il set article_number = p.sku
  from delivery_lines dl
  join sales_order_lines sol on sol.id = dl.sales_order_line_id
  join products p on p.id = sol.product_id
  where il.delivery_line_id = dl.id;
alter table invoice_lines enable trigger user;
