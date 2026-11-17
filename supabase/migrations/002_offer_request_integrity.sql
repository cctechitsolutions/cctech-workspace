-- Run after 001. A supplier offer must belong to that same supplier's request.
-- Existing inconsistent rows cause this migration to fail rather than hide data loss.
alter table public.supplier_requests
  add constraint supplier_requests_id_supplier_unique unique (id, supplier_id);
alter table public.supplier_offers
  add constraint supplier_offers_request_supplier_fk
  foreign key (supplier_request_id, supplier_id)
  references public.supplier_requests(id, supplier_id) on delete cascade;

-- Qualify outer columns: an unqualified supplier_id inside the subquery can
-- resolve to the request's column instead of the offer being inserted/updated.
drop policy "Supplier submits own offers" on public.supplier_offers;
create policy "Supplier submits own offers" on public.supplier_offers
for insert to authenticated with check (
  exists (
    select 1 from public.supplier_requests r
    join public.suppliers s on s.id = r.supplier_id
    where r.id = supplier_offers.supplier_request_id
      and r.supplier_id = supplier_offers.supplier_id
      and s.portal_user_id = auth.uid()
  )
);
drop policy "Supplier updates own offers" on public.supplier_offers;
create policy "Supplier updates own offers" on public.supplier_offers
for update to authenticated using (
  exists (select 1 from public.suppliers s
    where s.id = supplier_offers.supplier_id and s.portal_user_id = auth.uid())
) with check (
  exists (
    select 1 from public.supplier_requests r
    join public.suppliers s on s.id = r.supplier_id
    where r.id = supplier_offers.supplier_request_id
      and r.supplier_id = supplier_offers.supplier_id
      and s.portal_user_id = auth.uid()
  )
);

alter table public.enquiries alter column reference_code
  set default ('CCT-' || upper(gen_random_uuid()::text));
