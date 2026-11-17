-- Retour en creditfactuur in één keer, en terug naar Shopify (opdracht Rick 17 november 2026):
-- "Wanneer ik een retour doe of een credit doe, dat die wordt teruggedraaid met een creditfactuur, dat de voorraad wordt
-- teruggeboekt en dat dat ook via de API weer wordt teruggekoppeld in Shopify." Geld terug zoals er betaald is (pin of contant).
--
-- 1. commit_batch: schrijft alle rijen van één handeling (creditfactuur, regels, terugbetaling, voorraad Retour, wachtrij
--    Shopify) in één transactie. Lukt één rij niet, dan wordt niets vastgelegd: nooit meer voorraad terug zonder creditfactuur.
--    security invoker: de gewone rechten (RLS, alleen teamleden) blijven gelden. Alleen de tabellen hieronder.
-- 2. hdb_shopify_orders krijgt een soort: verkoop (kassabon) of retour (creditfactuur op een kassabon van HDB).

create or replace function public.commit_batch(p_batch jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  step jsonb;
  r jsonb;
  t text;
  cols text;
  allowed text[] := array['invoices', 'invoice_lines', 'payments', 'stock_movements', 'order_events', 'hdb_shopify_orders'];
begin
  for step in select * from jsonb_array_elements(coalesce(p_batch, '[]'::jsonb)) loop
    t := step->>'table';
    if not (t = any(allowed)) then raise exception 'Tabel % hoort niet in een batch.', t; end if;
    for r in select * from jsonb_array_elements(coalesce(step->'rows', '[]'::jsonb)) loop
      -- Alleen de kolommen die in de rij staan, zodat standaardwaarden van de tabel blijven gelden.
      select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t and r ? c.column_name;
      if cols is null then raise exception 'Lege rij voor %.', t; end if;
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', t, cols, cols, t) using r;
    end loop;
  end loop;
end;
$$;

revoke all on function public.commit_batch(jsonb) from public;
grant execute on function public.commit_batch(jsonb) to authenticated;

alter table hdb_shopify_orders add column if not exists kind text not null default 'verkoop';
alter table hdb_shopify_orders drop constraint if exists hdb_shopify_orders_kind_check;
alter table hdb_shopify_orders add constraint hdb_shopify_orders_kind_check check (kind in ('verkoop', 'retour'));
-- Retour: de terugbetaling (refund) in Shopify op de bestelling van de oorspronkelijke kassabon.
alter table hdb_shopify_orders add column if not exists shopify_refund_id text not null default '';
