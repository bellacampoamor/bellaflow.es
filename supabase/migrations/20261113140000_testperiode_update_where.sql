-- Herstel testperiode (13 november 2026): Testgegevens wissen gaf in Supabase "UPDATE requires a WHERE clause"
-- (pg-safeupdate). De update van settings aan het eind van wipe_test_data had geen where; nu 'where true'.
-- Er was niets gewist: de fout draaide de hele functie terug. Verder ongewijzigd.

create or replace function public.wipe_test_data(p_by text, p_customers boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb := '{}'::jsonb;
  n integer;
  blocked boolean := false;
begin
  -- Via de app: alleen een teamlid. (In de SQL Editor is er geen gebruiker; dat mag.)
  if to_regprocedure('auth.uid()') is not null then
    execute 'select auth.uid() is not null and not public.is_team_member()' into blocked;
  end if;
  if blocked then raise exception 'Geen medewerker met toegang.'; end if;
  if exists (select 1 from settings where live_since is not null) then
    raise exception 'Bella Flow is live: testgegevens wissen kan niet meer.';
  end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Vul in wie de testgegevens wist.'; end if;

  -- 'where true': Supabase kan een delete zonder where weigeren (pg-safeupdate).
  -- Facturen zijn normaal onwijzigbaar (trigger invoices_guard); alleen hier even uit.
  alter table invoices disable trigger invoices_guard;

  delete from hdb_shopify_orders where true;                         get diagnostics n = row_count; v := v || jsonb_build_object('shopify', n);
  delete from email_outbox where true;                               get diagnostics n = row_count; v := v || jsonb_build_object('mails', n);
  delete from payments where true;                                   get diagnostics n = row_count; v := v || jsonb_build_object('betalingen', n);
  delete from invoice_lines where true;
  delete from invoices where true;                                   get diagnostics n = row_count; v := v || jsonb_build_object('facturen', n);
  delete from delivery_lines where true;
  delete from deliveries where true;                                 get diagnostics n = row_count; v := v || jsonb_build_object('leveringen', n);
  delete from goods_receipt_lines where true;
  delete from goods_receipts where true;                             get diagnostics n = row_count; v := v || jsonb_build_object('ontvangsten', n);
  delete from inbound_shipment_lines where true;
  delete from inbound_shipments where true;
  delete from purchase_order_dispatches where true;
  delete from purchase_order_lines where true;
  delete from purchase_orders where true;                            get diagnostics n = row_count; v := v || jsonb_build_object('inkooporders', n);
  delete from transports where true;                                 get diagnostics n = row_count; v := v || jsonb_build_object('transporten', n);
  delete from sales_orders where true;                               get diagnostics n = row_count; v := v || jsonb_build_object('verkooporders', n);
  delete from cash_closings where true;                              get diagnostics n = row_count; v := v || jsonb_build_object('dagafsluitingen', n);
  delete from stock_movements where true;                            get diagnostics n = row_count; v := v || jsonb_build_object('mutaties', n);
  delete from products where true;                                   get diagnostics n = row_count; v := v || jsonb_build_object('producten', n);
  if p_customers then
    -- De vaste klant voor kassaverkopen zonder klantgegevens blijft.
    delete from customers where coalesce(notes, '') <> 'Vaste klant voor kassaverkopen zonder klantgegevens (Bella Flow).';
    get diagnostics n = row_count; v := v || jsonb_build_object('klanten', n);
  end if;
  delete from year_closings where true;
  delete from number_series where true;

  alter table invoices enable trigger invoices_guard;

  update settings set fiscal_year = extract(year from current_date)::int, test_wiped_at = now(), test_wiped_by = trim(p_by) where true;
  return v;
end;
$$;

revoke execute on function public.wipe_test_data(text, boolean) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.wipe_test_data(text, boolean) to authenticated';
  end if;
end $$;
