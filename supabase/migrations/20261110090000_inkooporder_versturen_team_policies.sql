-- Verzendlog inkooporders: alleen teamleden (10 november 2026).
-- Op een nieuwe database doet 20261108085000_beveiliging.sql dit al; in Supabase stonden hier nog using (true).
drop policy if exists team_read on public.purchase_order_dispatches;
drop policy if exists team_insert on public.purchase_order_dispatches;
create policy team_read on public.purchase_order_dispatches for select to authenticated using ((select public.is_team_member()));
create policy team_insert on public.purchase_order_dispatches for insert to authenticated with check ((select public.is_team_member()));
