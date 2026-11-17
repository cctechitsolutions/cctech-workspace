begin;
-- Separate social channels while retaining the earlier generic social option.
alter table public.enquiries drop constraint if exists enquiries_source_channel_check;
alter table public.enquiries add constraint enquiries_source_channel_check check
  (source_channel in ('whatsapp','facebook','instagram','website','phone','email','walk_in','social','other'));
alter table public.supplier_offers add column if not exists part_quality text
  check (part_quality in ('OEM Original','Second Copy','Compatible'));
alter table public.supplier_offers add column if not exists compatibility_confirmed boolean not null default false;
-- A vendor's statement is evidence, not CCTech's compatibility approval.
create function public.guard_offer_confirmation() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_cctech_staff() then
    new.compatibility_confirmed := false;
    new.evidence_confirmed := false;
  end if;
  return new;
end; $$;
create trigger supplier_offer_confirmation before insert or update on public.supplier_offers
for each row execute function public.guard_offer_confirmation();

create table public.workflow_settings (
  id boolean primary key default true check (id),
  review_url text check (review_url is null or review_url ~ '^https://'),
  payment_instructions text,
  updated_at timestamptz not null default now()
);
insert into public.workflow_settings(id) values (true);
create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id),
  supplier_offer_id uuid not null references public.supplier_offers(id),
  reference text not null unique default ('CCT-ORD-' || upper(gen_random_uuid()::text)),
  description text not null,
  quality text not null,
  quantity integer not null check(quantity > 0),
  fulfilment text not null check(fulfilment in ('delivery','store_fitting')),
  carrier text,
  delivery_address text,
  vendor_cost_paise bigint not null check(vendor_cost_paise >= 0),
  margin_paise bigint not null check(margin_paise >= 0),
  delivery_paise bigint not null check(delivery_paise >= 0),
  fitting_paise bigint not null check(fitting_paise >= 0),
  tax_paise bigint not null check(tax_paise >= 0),
  total_paise bigint not null check(total_paise > 0),
  advance_paise bigint not null,
  received_paise bigint not null default 0 check(received_paise >= 0),
  status text not null default 'awaiting_advance' check(status in ('awaiting_advance','confirmed','in_progress','dispatched','completed')),
  completed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(enquiry_id),
  check(total_paise = vendor_cost_paise + margin_paise + delivery_paise + fitting_paise + tax_paise),
  check(advance_paise = round(total_paise::numeric * 0.9)::bigint),
  check(received_paise <= total_paise),
  check((fulfilment='delivery' and fitting_paise=0) or (fulfilment='store_fitting' and delivery_paise=0))
);
create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sales_orders(id),
  amount_paise bigint not null check(amount_paise > 0),
  payment_reference text not null unique check(length(trim(payment_reference)) > 0),
  verified_by uuid not null references auth.users(id),
  verified_at timestamptz not null default now()
);
create table public.order_notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sales_orders(id),
  kind text not null check(kind in ('advance_request','review_request')),
  channel text not null,
  recipient text,
  message text not null,
  status text not null default 'queued' check(status in ('queued','sent','failed')),
  provider_message_id text,
  created_at timestamptz not null default now(),
  unique(order_id,kind)
);
create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sales_orders(id),
  event text not null,
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.workflow_settings enable row level security;
alter table public.sales_orders enable row level security;
alter table public.order_payments enable row level security;
alter table public.order_notifications enable row level security;
alter table public.order_events enable row level security;
revoke all on public.workflow_settings,public.sales_orders,public.order_payments,public.order_notifications,public.order_events from anon,authenticated;
grant select on public.sales_orders,public.order_payments,public.order_notifications,public.order_events to authenticated;
grant select,update on public.workflow_settings to authenticated;
create policy "Staff settings" on public.workflow_settings for all to authenticated
  using(public.is_cctech_staff()) with check(public.is_cctech_staff());
create policy "Staff read orders" on public.sales_orders for select to authenticated using(public.is_cctech_staff());
create policy "Staff read payments" on public.order_payments for select to authenticated using(public.is_cctech_staff());
create policy "Staff read notifications" on public.order_notifications for select to authenticated using(public.is_cctech_staff());
create policy "Staff read order events" on public.order_events for select to authenticated using(public.is_cctech_staff());

create function public.create_sales_order(
  p_enquiry_id uuid,p_offer_id uuid,p_quantity integer,p_fulfilment text,
  p_margin_unit bigint,p_delivery bigint,p_fitting bigint,p_tax bigint,
  p_carrier text default null,p_address text default null
) returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare o public.sales_orders; offer public.supplier_offers; e public.enquiries;
  vendor_total bigint; final_total bigint; instructions text;
begin
  if not public.is_cctech_staff() then raise exception 'Staff access required'; end if;
  select * into e from public.enquiries where id=p_enquiry_id;
  if not found then raise exception 'Enquiry not found'; end if;
  select so.* into offer from public.supplier_offers so join public.supplier_requests sr on sr.id=so.supplier_request_id
    where so.id=p_offer_id and sr.enquiry_id=p_enquiry_id for update of so;
  if not found then raise exception 'Offer does not belong to enquiry'; end if;
  if offer.unit_price is null or not offer.compatibility_confirmed or offer.part_quality is null or offer.stock_status <> 'in_stock'
    or offer.currency<>'INR' or offer.gst_treatment is null or offer.gst_treatment not in ('GST included','GST excluded')
    or (offer.offer_valid_until is not null and offer.offer_valid_until < current_date)
    or p_quantity is null or p_quantity < 1 or p_quantity > offer.quantity then raise exception 'Confirm offer fit, type, price, quantity, stock and validity'; end if;
  if p_fulfilment is null or p_fulfilment not in ('delivery','store_fitting') or p_margin_unit is null or p_margin_unit < 0
    or p_delivery is null or p_delivery < 0 or p_fitting is null or p_fitting < 0 or p_tax is null or p_tax < 0
    then raise exception 'Confirm all customer charges'; end if;
  if e.category='Laptop / desktop / parts' and p_margin_unit <> 100000 then raise exception 'Parts margin must be 1000 rupees per unit'; end if;
  if (p_fulfilment='delivery' and (p_fitting<>0 or nullif(trim(p_address),'') is null or nullif(trim(p_carrier),'') is null))
    or (p_fulfilment='store_fitting' and p_delivery<>0) then raise exception 'Confirm delivery address/carrier or store fitting charges'; end if;
  vendor_total := round(offer.unit_price * 100)::bigint * p_quantity;
  final_total := vendor_total + p_margin_unit * p_quantity + p_delivery + p_fitting + p_tax;
  insert into public.sales_orders(enquiry_id,supplier_offer_id,description,quality,quantity,fulfilment,carrier,delivery_address,
    vendor_cost_paise,margin_paise,delivery_paise,fitting_paise,tax_paise,total_paise,advance_paise,created_by)
  values(p_enquiry_id,p_offer_id,offer.item_description,offer.part_quality,p_quantity,p_fulfilment,
    case when p_fulfilment='delivery' then p_carrier end,case when p_fulfilment='delivery' then p_address end,
    vendor_total,p_margin_unit*p_quantity,p_delivery,p_fitting,p_tax,final_total,round(final_total::numeric*0.9)::bigint,auth.uid()) returning * into o;
  select payment_instructions into instructions from public.workflow_settings where id;
  insert into public.order_notifications(order_id,kind,channel,recipient,message)
  values(o.id,'advance_request',e.source_channel,e.customer_contact,
    'This is Chandrashekar from CCTech IT Solutions.' || E'\n' || o.description || ' (' || o.quality || ')' ||
    E'\n' || case when o.fulfilment='delivery' then 'Part delivery via ' || o.carrier else 'Fitting at CCTech store' end ||
    E'\nTotal: Rs ' || to_char(o.total_paise::numeric/100,'FM999999999990.00') ||
    E'\n90% advance: Rs ' || to_char(o.advance_paise::numeric/100,'FM999999999990.00') ||
    E'\nBalance: Rs ' || to_char((o.total_paise-o.advance_paise)::numeric/100,'FM999999999990.00') ||
    coalesce(E'\n' || nullif(instructions,''),'') || E'\nOrder: ' || o.reference);
  insert into public.order_events(order_id,event,actor) values(o.id,'Customer fulfilment choice recorded; advance requested',auth.uid());
  return o;
end; $$;

create function public.record_order_payment(p_order_id uuid,p_amount bigint,p_reference text)
returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare o public.sales_orders;
begin
  if not public.is_cctech_staff() then raise exception 'Staff access required'; end if;
  select * into o from public.sales_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if p_amount is null or p_amount<=0 or p_amount+o.received_paise>o.total_paise or nullif(trim(p_reference),'') is null then raise exception 'Check verified payment amount and reference'; end if;
  insert into public.order_payments(order_id,amount_paise,payment_reference,verified_by) values(o.id,p_amount,trim(p_reference),auth.uid());
  update public.sales_orders set received_paise=received_paise+p_amount,
    status=case when status='awaiting_advance' and received_paise+p_amount>=advance_paise then 'confirmed' else status end
    where id=o.id returning * into o;
  insert into public.order_events(order_id,event,actor) values(o.id,'Payment verified: ' || trim(p_reference),auth.uid());
  return o;
end; $$;

create function public.queue_order_review(p_order_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare o public.sales_orders; e public.enquiries; review_link text;
begin
  if not public.is_cctech_staff() then raise exception 'Staff access required'; end if;
  select * into o from public.sales_orders where id=p_order_id for update;
  if not found or o.status<>'completed' then raise exception 'Complete delivery or fitting before asking for a review'; end if;
  select review_url into review_link from public.workflow_settings where id;
  if nullif(trim(review_link),'') is null then raise exception 'Add your business review link in settings first'; end if;
  select * into e from public.enquiries where id=o.enquiry_id;
  insert into public.order_notifications(order_id,kind,channel,recipient,message)
  values(o.id,'review_request',e.source_channel,e.customer_contact,
    'Thank you for choosing CCTech IT Solutions. Please share your honest experience: ' || review_link)
  on conflict(order_id,kind) do nothing;
end; $$;

create function public.advance_order(p_order_id uuid,p_status text) returns public.sales_orders
language plpgsql security definer set search_path=public as $$
declare o public.sales_orders;
begin
  if not public.is_cctech_staff() then raise exception 'Staff access required'; end if;
  select * into o from public.sales_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.received_paise<o.advance_paise then raise exception 'Verify 90 percent advance before fulfilment'; end if;
  if not ((o.status='confirmed' and p_status='in_progress') or
    (o.fulfilment='delivery' and o.status in ('confirmed','in_progress') and p_status='dispatched') or
    (o.fulfilment='delivery' and o.status='dispatched' and p_status='completed') or
    (o.fulfilment='store_fitting' and o.status='in_progress' and p_status='completed')) then raise exception 'Invalid order status transition'; end if;
  update public.sales_orders set status=p_status,completed_at=case when p_status='completed' then now() else null end where id=o.id returning * into o;
  insert into public.order_events(order_id,event,actor) values(o.id,p_status,auth.uid());
  if p_status='completed' and exists(select 1 from public.workflow_settings where id and nullif(review_url,'') is not null) then perform public.queue_order_review(o.id); end if;
  return o;
end; $$;
revoke all on function public.create_sales_order(uuid,uuid,integer,text,bigint,bigint,bigint,bigint,text,text),
  public.record_order_payment(uuid,bigint,text),public.queue_order_review(uuid),public.advance_order(uuid,text) from public,anon;
grant execute on function public.create_sales_order(uuid,uuid,integer,text,bigint,bigint,bigint,bigint,text,text),
  public.record_order_payment(uuid,bigint,text),public.queue_order_review(uuid),public.advance_order(uuid,text) to authenticated;
commit;
