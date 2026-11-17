-- CCTech existing-project upgrade: RUN ONCE after migrations 001 and 002.
-- Retains suppliers/enquiries. Creates approved rules and private channel integration.
-- Does not connect Meta, deploy functions, book couriers or send messages.
begin;

-- 003_supplier_whatsapp.sql
-- Keeps existing suppliers. Add their WhatsApp number through the directory.
alter table public.suppliers
  add column if not exists whatsapp_number text
  check (whatsapp_number is null or whatsapp_number ~ '^[1-9][0-9]{7,14}$');

-- 004_whatsapp_inbox.sql
-- Incoming WhatsApp messages are written only by the signed server webhook.
create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  phone_number_id text not null,
  sender_number text not null,
  message_type text not null,
  message_text text,
  provider_timestamp timestamptz not null,
  raw_message jsonb not null,
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processed', 'needs_review')),
  enquiry_id uuid references public.enquiries(id),
  created_at timestamptz not null default now()
);
alter table public.whatsapp_messages enable row level security;
revoke all on public.whatsapp_messages from anon, authenticated;
grant select on public.whatsapp_messages to authenticated;
grant all on public.whatsapp_messages to service_role;
drop policy if exists "Staff read WhatsApp inbox" on public.whatsapp_messages;
create policy "Staff read WhatsApp inbox" on public.whatsapp_messages
for select to authenticated using (public.is_cctech_staff());

-- 005_order_workflow.sql
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

-- 006_approved_business_rules.sql
alter table public.supplier_offers drop constraint supplier_offers_part_quality_check;
alter table public.supplier_offers add constraint supplier_offers_part_quality_check
 check(part_quality in ('OEM Original','Second Copy','Compatible','New','Used','Refurbished','Service'));
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('owner','staff','supplier'));
alter table public.profiles add column notification_phone text unique;
create or replace function public.is_cctech_staff() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where user_id=auth.uid() and role in ('owner','staff'));
$$;
create function public.is_cctech_owner() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where user_id=auth.uid() and role='owner');
$$;
drop policy "Staff can manage profiles" on public.profiles;
create policy "Owner manages team" on public.profiles for all to authenticated
using(public.is_cctech_owner()) with check(public.is_cctech_owner());
insert into public.profiles(user_id,role,display_name,notification_phone)
select id,'owner','Chandrashekar','918951711631' from auth.users where lower(email)='cctechitsolutions@gmail.com'
on conflict(user_id) do update set role='owner',notification_phone=excluded.notification_phone;
insert into public.profiles(user_id,role,display_name,notification_phone)
select id,'staff','CCTech staff','916364253615' from auth.users where lower(email)='chandra15031993@gmail.com'
on conflict(user_id) do update set notification_phone=excluded.notification_phone;

update public.workflow_settings set review_url='https://g.page/r/CX4JiKfrrW8NEBM/review',
  payment_instructions='UPI: cctech@sbi | Name: CCTECH IT Solutions';
alter table public.workflow_settings add column default_margin_percent numeric not null default 15;
alter table public.workflow_settings add column owner_phone text not null default '918951711631';
alter table public.workflow_settings add column staff_phone text not null default '916364253615';
alter table public.workflow_settings add column public_workspace_url text check(public_workspace_url is null or public_workspace_url ~ '^https://');
drop policy "Staff settings" on public.workflow_settings;
create policy "Team reads settings" on public.workflow_settings for select to authenticated using(public.is_cctech_staff());
create policy "Owner updates settings" on public.workflow_settings for update to authenticated using(public.is_cctech_owner()) with check(public.is_cctech_owner());

alter table public.sales_orders add column pricing_version integer not null default 1;
alter table public.sales_orders alter column pricing_version set default 2;
alter table public.sales_orders add column rounding_paise bigint not null default 0;
alter table public.sales_orders add column quote_status text not null default 'approved' check(quote_status in ('pending','approved'));
alter table public.sales_orders alter column quote_status set default 'pending';
alter table public.sales_orders add column approved_by uuid references auth.users(id);
alter table public.sales_orders add column approved_at timestamptz;
alter table public.sales_orders add column margin_type text not null default 'percentage';
alter table public.sales_orders add column margin_value numeric not null default 15;
alter table public.sales_orders add column exceeds_budget_limit boolean not null default false;
alter table public.sales_orders add column warranty_snapshot text;
alter table public.sales_orders add column budget_paise bigint;
alter table public.sales_orders add column quote_revision integer not null default 1;
alter table public.sales_orders add column completion_token_hash text;
alter table public.sales_orders add column completion_token_expires timestamptz;
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.sales_orders'::regclass and contype='c'
    and (pg_get_constraintdef(oid) like '%advance_paise =%' or pg_get_constraintdef(oid) like '%total_paise =%')
  loop execute format('alter table public.sales_orders drop constraint %I',c.conname); end loop;
end; $$;
alter table public.sales_orders add check(total_paise=vendor_cost_paise+margin_paise+delivery_paise+fitting_paise+tax_paise+rounding_paise);
alter table public.sales_orders add check((pricing_version=1 and advance_paise=round(total_paise::numeric*0.9)::bigint)
  or (pricing_version=2 and advance_paise=case when fulfilment='delivery' then total_paise else round(total_paise::numeric/2)::bigint end));
alter table public.sales_orders add check(pricing_version=1 or (delivery_paise=0 and total_paise%10000=0));
alter table public.sales_orders add check(rounding_paise>=0 and rounding_paise<10000);
alter table public.order_notifications drop constraint order_notifications_kind_check;
alter table public.order_notifications add check(kind in ('advance_request','review_request','completion_request'));
create table public.team_notifications (
  id uuid primary key default gen_random_uuid(),order_id uuid references public.sales_orders(id),
  enquiry_id uuid references public.enquiries(id),event text not null,phone text not null,
  channel text not null check(channel in ('workspace','whatsapp')),message text not null,
  status text not null default 'queued',created_at timestamptz not null default now(),unique(order_id,event,phone)
);
alter table public.team_notifications enable row level security;
revoke all on public.team_notifications from anon,authenticated;
grant select on public.team_notifications to authenticated;
create policy "Team reads alerts" on public.team_notifications for select to authenticated using(public.is_cctech_staff());

-- Integer money calculations match the browser preview. Included vendor GST is
-- normalized using the configured 18% rate before calculating the selling GST.
create function public.calculate_quote_values(p_unit_price numeric,p_quantity integer,p_vendor_gst text,p_margin_type text,p_margin_value numeric,
 p_route text,p_fitting bigint,p_budget bigint default null) returns jsonb language plpgsql immutable as $$
declare cost bigint; requested bigint; margin_amount bigint; fitting_amount bigint; subtotal bigint; tax bigint; total bigint; rounding bigint;
  low bigint; high bigint; mid bigint; target bigint; floor_total bigint;
begin
 if p_unit_price is null or p_unit_price<0 or p_quantity is null or p_quantity<1 or p_vendor_gst is null or p_vendor_gst not in ('GST included','GST excluded')
  or p_margin_type is null or p_margin_type not in ('percentage','fixed') or p_margin_value is null or p_margin_value<0
  or p_route is null or p_route not in ('delivery','store_fitting') or (p_budget is not null and p_budget<=0) then raise exception 'Confirm prices, tax treatment, margin and quantity'; end if;
 cost := (case when p_vendor_gst='GST included' then round(round(p_unit_price*100)*100/118) else round(p_unit_price*100) end)::bigint*p_quantity;
 requested := case when p_margin_type='percentage' then round(cost*p_margin_value/100)::bigint else round(p_margin_value*100)::bigint*p_quantity end;
 if p_route='delivery' then fitting_amount:=0;
 elsif p_quantity=1 then fitting_amount:=60000;
 elsif p_fitting is null or p_fitting<0 then raise exception 'Team must set fitting charge for multiple items';
 else fitting_amount:=p_fitting; end if;
 margin_amount:=requested;
 subtotal:=cost+margin_amount+fitting_amount; tax:=round(subtotal::numeric*18/100); total:=ceil((subtotal+tax)::numeric/10000)::bigint*10000;
 if p_budget is not null and total>p_budget then
   floor_total:=ceil(((cost+fitting_amount)+round((cost+fitting_amount)::numeric*18/100))/10000)::bigint*10000;
   target:=floor((case when floor_total<=p_budget then p_budget else floor(p_budget::numeric*105/100) end)::numeric/10000)::bigint*10000;
   if target>=floor_total then
    low:=0; high:=requested;
    while low<high loop
     mid:=(low+high+1)/2; subtotal:=cost+mid+fitting_amount;
     if ceil((subtotal+round(subtotal::numeric*18/100))/10000)::bigint*10000<=target then low:=mid; else high:=mid-1; end if;
    end loop;
    margin_amount:=low;
   end if;
 end if;
 subtotal:=cost+margin_amount+fitting_amount; tax:=round(subtotal::numeric*18/100); total:=ceil((subtotal+tax)::numeric/10000)::bigint*10000;
 rounding:=total-subtotal-tax;
 return jsonb_build_object('cost',cost,'margin',margin_amount,'fitting',fitting_amount,'tax',tax,'rounding',rounding,'total',total,
  'advance',case when p_route='delivery' then total else round(total::numeric/2)::bigint end,
  'above_budget',p_budget is not null and total>floor(p_budget::numeric*105/100));
end; $$;

-- Retire the earlier function, which could queue unapproved quotes.
revoke execute on function public.create_sales_order(uuid,uuid,integer,text,bigint,bigint,bigint,bigint,text,text) from authenticated;
create function public.prepare_sales_order(p_enquiry_id uuid,p_offer_id uuid,p_quantity integer,p_fulfilment text,
 p_margin_type text,p_margin_value numeric,p_fitting bigint default null,p_budget bigint default null,p_carrier text default null,p_address text default null)
returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare o public.sales_orders; offer public.supplier_offers; e public.enquiries; amounts jsonb; settings public.workflow_settings;
begin
 if not public.is_cctech_staff() then raise exception 'Staff access required'; end if;
 select * into e from public.enquiries where id=p_enquiry_id;
 if not found then raise exception 'Enquiry not found'; end if;
 select so.* into offer from public.supplier_offers so join public.supplier_requests sr on sr.id=so.supplier_request_id
  where so.id=p_offer_id and sr.enquiry_id=p_enquiry_id for update of so;
 if not found or offer.currency<>'INR' or not offer.compatibility_confirmed or offer.stock_status<>'in_stock' or offer.part_quality is null
  or p_quantity>offer.quantity or (offer.offer_valid_until is not null and offer.offer_valid_until<current_date) then raise exception 'Confirm matching offer, stock, type, quantity and validity'; end if;
 if p_fulfilment='delivery' and (nullif(trim(p_carrier),'') is null or nullif(trim(p_address),'') is null) then raise exception 'Confirm delivery provider and address'; end if;
 amounts:=public.calculate_quote_values(offer.unit_price,p_quantity,offer.gst_treatment,p_margin_type,p_margin_value,p_fulfilment,p_fitting,p_budget);
 insert into public.sales_orders(enquiry_id,supplier_offer_id,description,quality,quantity,fulfilment,carrier,delivery_address,vendor_cost_paise,
  margin_paise,delivery_paise,fitting_paise,tax_paise,rounding_paise,total_paise,advance_paise,created_by,pricing_version,quote_status,margin_type,margin_value,exceeds_budget_limit,warranty_snapshot,budget_paise)
 values(e.id,offer.id,offer.item_description,offer.part_quality,p_quantity,p_fulfilment,
  case when p_fulfilment='delivery' then p_carrier end,case when p_fulfilment='delivery' then p_address end,
  (amounts->>'cost')::bigint,(amounts->>'margin')::bigint,0,(amounts->>'fitting')::bigint,(amounts->>'tax')::bigint,(amounts->>'rounding')::bigint,
  (amounts->>'total')::bigint,(amounts->>'advance')::bigint,auth.uid(),2,'pending',p_margin_type,p_margin_value,(amounts->>'above_budget')::boolean,offer.warranty,p_budget) returning * into o;
 select * into settings from public.workflow_settings where id;
 insert into public.team_notifications(order_id,event,phone,channel,message) values
 (o.id,'quote_approval',settings.owner_phone,'whatsapp','Quotation needs approval: '||o.reference),
 (o.id,'quote_approval',settings.staff_phone,'workspace','Quotation needs approval: '||o.reference);
 insert into public.order_events(order_id,event,actor) values(o.id,'Quotation prepared; waiting for owner or staff approval',auth.uid());
 return o;
end; $$;

create function public.approve_sales_order(p_order_id uuid,p_allow_over_budget boolean default false,p_expected_revision integer default null) returns public.sales_orders
language plpgsql security definer set search_path=public as $$
declare o public.sales_orders; e public.enquiries; instructions text; current_offer public.supplier_offers; current_cost bigint;
begin
 if not public.is_cctech_staff() then raise exception 'Staff access required'; end if;
 select * into o from public.sales_orders where id=p_order_id for update;
 if not found then raise exception 'Order not found'; end if;
 if o.quote_status='approved' then return o; end if;
 if p_expected_revision is null or p_expected_revision<>o.quote_revision then raise exception 'Quotation changed; refresh and review before approving'; end if;
 select * into current_offer from public.supplier_offers where id=o.supplier_offer_id;
 current_cost:=(case when current_offer.gst_treatment='GST included' then round(round(current_offer.unit_price*100)*100/118) else round(current_offer.unit_price*100) end)::bigint*o.quantity;
 if not current_offer.compatibility_confirmed or current_offer.stock_status<>'in_stock' or current_offer.quantity<o.quantity
  or (current_offer.offer_valid_until is not null and current_offer.offer_valid_until<current_date)
  or current_cost is distinct from o.vendor_cost_paise or current_offer.part_quality is distinct from o.quality
  or current_offer.item_description is distinct from o.description or current_offer.warranty is distinct from o.warranty_snapshot
  then raise exception 'Vendor offer changed; review and revise before approving'; end if;
 if nullif(trim(o.warranty_snapshot),'') is null then raise exception 'Ask vendor for warranty before approving'; end if;
 if o.exceeds_budget_limit and not p_allow_over_budget then raise exception 'Price exceeds budget plus 5 percent; team decision required'; end if;
 update public.sales_orders set quote_status='approved',approved_by=auth.uid(),approved_at=now() where id=o.id returning * into o;
 select * into e from public.enquiries where id=o.enquiry_id;
 select payment_instructions into instructions from public.workflow_settings where id;
 insert into public.order_notifications(order_id,kind,channel,recipient,message) values(o.id,'advance_request',e.source_channel,e.customer_contact,
  'This is Chandrashekar from CCTech IT Solutions.'||E'\n'||o.description||' ('||o.quality||')'||E'\nWarranty: '||o.warranty_snapshot||
  E'\nTotal including 18% GST and rounding: Rs '||to_char(o.total_paise::numeric/100,'FM999999999990.00')||
  E'\nPay '||case when o.fulfilment='delivery' then '100% before dispatch' else '50% advance' end||': Rs '||to_char(o.advance_paise::numeric/100,'FM999999999990.00')||
  case when o.fulfilment='delivery' then E'\nPay your courier directly for delivery.' else E'\nRemaining 50% payable at the store.' end||
  coalesce(E'\n'||instructions,'')||E'\nOrder: '||o.reference) on conflict(order_id,kind) do nothing;
 insert into public.order_events(order_id,event,actor) values(o.id,'Quotation approved for customer sending',auth.uid());
 return o;
end; $$;

create function public.revise_sales_order(p_order_id uuid,p_margin_type text,p_margin_value numeric,p_fitting bigint default null)
returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare o public.sales_orders; offer public.supplier_offers; amounts jsonb;
begin
 if not public.is_cctech_staff() then raise exception 'Staff access required'; end if;
 select * into o from public.sales_orders where id=p_order_id for update;
 if not found or o.quote_status<>'pending' then raise exception 'Only an unapproved quotation can be edited'; end if;
 select * into offer from public.supplier_offers where id=o.supplier_offer_id;
 if not offer.compatibility_confirmed or offer.stock_status<>'in_stock' or (offer.offer_valid_until is not null and offer.offer_valid_until<current_date) then raise exception 'Recheck current vendor offer before revising'; end if;
 amounts:=public.calculate_quote_values(offer.unit_price,o.quantity,offer.gst_treatment,p_margin_type,p_margin_value,o.fulfilment,p_fitting,o.budget_paise);
 update public.sales_orders set vendor_cost_paise=(amounts->>'cost')::bigint,margin_paise=(amounts->>'margin')::bigint,
 fitting_paise=(amounts->>'fitting')::bigint,tax_paise=(amounts->>'tax')::bigint,rounding_paise=(amounts->>'rounding')::bigint,
 total_paise=(amounts->>'total')::bigint,advance_paise=(amounts->>'advance')::bigint,exceeds_budget_limit=(amounts->>'above_budget')::boolean,
 margin_type=p_margin_type,margin_value=p_margin_value,quote_revision=quote_revision+1,warranty_snapshot=offer.warranty
 where id=o.id returning * into o;
 insert into public.order_events(order_id,event,actor) values(o.id,'Pending quotation revised',auth.uid()); return o;
end; $$;

create or replace function public.record_order_payment(p_order_id uuid,p_amount bigint,p_reference text)
returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare o public.sales_orders;
begin
 if not public.is_cctech_owner() then raise exception 'Owner verification required'; end if;
 select * into o from public.sales_orders where id=p_order_id for update;
 if not found or o.quote_status<>'approved' then raise exception 'Approve quotation first'; end if;
 if p_amount is null or p_amount<=0 or p_amount+o.received_paise>o.total_paise or nullif(trim(p_reference),'') is null then raise exception 'Check verified payment amount and reference'; end if;
 insert into public.order_payments(order_id,amount_paise,payment_reference,verified_by) values(o.id,p_amount,trim(p_reference),auth.uid());
 update public.sales_orders set received_paise=received_paise+p_amount,
 status=case when status='awaiting_advance' and received_paise+p_amount>=advance_paise then 'confirmed' else status end where id=o.id returning * into o;
 insert into public.order_events(order_id,event,actor) values(o.id,'Owner verified payment: '||trim(p_reference),auth.uid()); return o;
end; $$;
-- Preserve the existing stage rules, but gate them on quotation approval and the
-- selected payment percentage instead of hard-coding the former 90% rule.
create or replace function public.advance_order(p_order_id uuid,p_status text) returns public.sales_orders
language plpgsql security definer set search_path=public as $$
declare o public.sales_orders; token text; base text;
begin
 if not public.is_cctech_staff() then raise exception 'Staff access required'; end if;
 select * into o from public.sales_orders where id=p_order_id for update;
 if not found then raise exception 'Order not found'; end if;
 if o.quote_status<>'approved' or o.received_paise<o.advance_paise then raise exception 'Verify required payment before fulfilment'; end if;
 if o.status='completed' and p_status='completed' then return o; end if;
 if not ((o.status='confirmed' and p_status='in_progress') or (o.fulfilment='delivery' and o.status in ('confirmed','in_progress') and p_status='dispatched')
  or (o.fulfilment='delivery' and o.status='dispatched' and p_status='completed') or (o.fulfilment='store_fitting' and o.status='in_progress' and p_status='completed')) then raise exception 'Invalid order status transition'; end if;
 update public.sales_orders set status=p_status,completed_at=case when p_status='completed' then now() else null end where id=o.id returning * into o;
 insert into public.order_events(order_id,event,actor) values(o.id,p_status,auth.uid());
 if p_status='completed' and exists(select 1 from public.workflow_settings where id and nullif(review_url,'') is not null) then perform public.queue_order_review(o.id); end if;
 if (p_status='dispatched' or (p_status='in_progress' and o.fulfilment='store_fitting')) then
  select public_workspace_url into base from public.workflow_settings where id;
  if base is not null then
   token:=gen_random_uuid()::text||gen_random_uuid()::text;
   update public.sales_orders set completion_token_hash=encode(sha256(convert_to(token,'UTF8')),'hex'),completion_token_expires=now()+interval '14 days' where id=o.id;
   insert into public.order_notifications(order_id,kind,channel,recipient,message)
   select o.id,'completion_request',source_channel,customer_contact,'After receiving your order or collecting your fitted device, confirm completion: '||rtrim(base,'/')||'/order-complete.html#token='||token
   from public.enquiries where id=o.enquiry_id on conflict(order_id,kind) do nothing;
  end if;
 end if;
 return o;
end; $$;

-- A customer's bearer link can complete only its own dispatched/ready order.
-- It cannot approve a quote or verify money. First completion wins atomically.
create function public.complete_customer_order(p_token text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare o public.sales_orders; link text; e public.enquiries;
begin
 if p_token is null or length(p_token)<>72 then raise exception 'Invalid completion link'; end if;
 select * into o from public.sales_orders where completion_token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and completion_token_expires>now() for update;
 if not found then raise exception 'Invalid or expired completion link'; end if;
 if o.status='completed' then return jsonb_build_object('reference',o.reference,'status','completed'); end if;
 if o.quote_status<>'approved' or not ((o.fulfilment='delivery' and o.status='dispatched') or (o.fulfilment='store_fitting' and o.status='in_progress')) then raise exception 'Order is not ready for completion'; end if;
 update public.sales_orders set status='completed',completed_at=now() where id=o.id;
 select review_url into link from public.workflow_settings where id;
 select * into e from public.enquiries where id=o.enquiry_id;
 if link is not null then insert into public.order_notifications(order_id,kind,channel,recipient,message)
 values(o.id,'review_request',e.source_channel,e.customer_contact,'Thank you for choosing CCTech IT Solutions. Please share your honest experience: '||link) on conflict(order_id,kind) do nothing; end if;
 return jsonb_build_object('reference',o.reference,'status','completed');
end; $$;
revoke all on function public.prepare_sales_order(uuid,uuid,integer,text,text,numeric,bigint,bigint,text,text),public.approve_sales_order(uuid,boolean,integer),public.revise_sales_order(uuid,text,numeric,bigint),public.complete_customer_order(text) from public;
grant execute on function public.prepare_sales_order(uuid,uuid,integer,text,text,numeric,bigint,bigint,text,text),public.approve_sales_order(uuid,boolean,integer),public.revise_sales_order(uuid,text,numeric,bigint) to authenticated;
grant execute on function public.complete_customer_order(text) to anon,authenticated;

-- 007_channel_connections.sql
create table public.channel_connections (
 channel text primary key check(channel in ('whatsapp','facebook','instagram')),
 business_account_id text,display_name text,enabled boolean not null default false,
 connected_at timestamptz,updated_at timestamptz not null default now(),check(not enabled or (business_account_id is not null and connected_at is not null))
);
insert into public.channel_connections(channel,display_name) values
 ('whatsapp','CCTech WhatsApp'),('facebook','CCTech Facebook Page'),('instagram','cctech_it_solutions');
create table public.channel_inbox (
 id uuid primary key default gen_random_uuid(),channel text not null,business_account_id text not null,
 provider_message_id text not null,sender_id text not null,message_text text,message_type text not null,
 reply_to_message_id text,provider_timestamp timestamptz not null,raw_message jsonb not null,
 processing_status text not null default 'pending' check(processing_status in ('pending','processed','needs_review')),
 created_at timestamptz not null default now(),unique(channel,business_account_id,provider_message_id)
);
create table public.channel_outbox (
 id uuid primary key default gen_random_uuid(),channel text not null check(channel in ('whatsapp','facebook','instagram')),
 recipient text not null,message text not null,dedupe_key text not null unique,
 supplier_request_id uuid references public.supplier_requests(id),order_notification_id uuid unique references public.order_notifications(id),
 team_notification_id uuid unique references public.team_notifications(id),
 template_name text,template_parameters jsonb,
 status text not null default 'queued' check(status in ('queued','processing','sent','blocked','needs_review')),
 blocked_reason text,provider_message_id text,created_at timestamptz not null default now(),processed_at timestamptz
);
alter table public.suppliers add column enquiry_consent boolean not null default false;
alter table public.supplier_requests add column reminder_queued_at timestamptz;
alter table public.supplier_requests add column provider_message_id text;
alter table public.channel_connections enable row level security;
alter table public.channel_inbox enable row level security;
alter table public.channel_outbox enable row level security;
revoke all on public.channel_connections,public.channel_inbox,public.channel_outbox from anon,authenticated;
grant select on public.channel_connections,public.channel_inbox,public.channel_outbox to authenticated;
grant update on public.channel_connections to authenticated;
grant all on public.channel_connections,public.channel_inbox,public.channel_outbox,public.team_notifications,public.order_notifications,public.supplier_requests to service_role;
create policy "Team reads connection status" on public.channel_connections for select to authenticated using(public.is_cctech_staff());
create policy "Owner configures connections" on public.channel_connections for update to authenticated using(public.is_cctech_owner()) with check(public.is_cctech_owner());
create policy "Team reads channel inbox" on public.channel_inbox for select to authenticated using(public.is_cctech_staff());
create policy "Team reads channel outbox" on public.channel_outbox for select to authenticated using(public.is_cctech_staff());
create function public.mark_channel_receiving() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update public.channel_connections set connected_at=coalesce(connected_at,now()),updated_at=now()
 where channel=new.channel and business_account_id=new.business_account_id;
 return new;
end; $$;
create trigger signed_channel_event after insert on public.channel_inbox for each row execute function public.mark_channel_receiving();

create function public.queue_order_channel_message() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.channel in ('whatsapp','facebook','instagram') and nullif(trim(new.recipient),'') is not null then
  insert into public.channel_outbox(channel,recipient,message,dedupe_key,order_notification_id)
  values(new.channel,new.recipient,new.message,'order-notice:'||new.id,new.id) on conflict(dedupe_key) do nothing;
 end if;
 return new;
end; $$;
create trigger order_message_to_channel after insert on public.order_notifications for each row execute function public.queue_order_channel_message();
create function public.queue_team_channel_message() returns trigger language plpgsql security definer set search_path=public as $$
declare base text;
begin
 if new.channel='whatsapp' then
  select public_workspace_url into base from public.workflow_settings where id;
  insert into public.channel_outbox(channel,recipient,message,dedupe_key,team_notification_id)
  values('whatsapp',new.phone,new.message||case when base is not null then E'\nOpen securely: '||rtrim(base,'/')||'/sourcing-workspace.html'||case when new.order_id is not null then '?order='||new.order_id else '' end else '' end,'team-notice:'||new.id,new.id) on conflict(dedupe_key) do nothing;
 end if;
 return new;
end; $$;
create trigger team_message_to_channel after insert on public.team_notifications for each row execute function public.queue_team_channel_message();

create function public.queue_vendor_request(p_request_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare r public.supplier_requests; s public.suppliers;
begin
 if not public.is_cctech_staff() then raise exception 'Staff access required'; end if;
 select * into r from public.supplier_requests where id=p_request_id for update;
 select * into s from public.suppliers where id=r.supplier_id;
 if r.id is null or r.status<>'draft' or not s.active or not s.enquiry_consent or nullif(s.whatsapp_number,'') is null then raise exception 'Check draft request, active vendor, consent and WhatsApp number'; end if;
 insert into public.channel_outbox(channel,recipient,message,dedupe_key,supplier_request_id)
 values('whatsapp',s.whatsapp_number,r.request_message,'vendor-request:'||r.id,r.id) on conflict(dedupe_key) do nothing;
end; $$;
-- Called by an authenticated server scheduler after deployment. Starting the
-- five-minute clock requires an actual provider-accepted send, not a draft.
create function public.queue_due_vendor_reminders() returns integer language plpgsql security definer set search_path=public as $$
declare r record; cfg public.workflow_settings; count_queued integer:=0;
begin
 select * into cfg from public.workflow_settings where id;
 for r in select sr.*,s.whatsapp_number,s.enquiry_consent from public.supplier_requests sr join public.suppliers s on s.id=sr.supplier_id
  where sr.status='sent' and sr.sent_at<=now()-interval '5 minutes' and sr.reminder_queued_at is null
   and not exists(select 1 from public.supplier_offers so where so.supplier_request_id=sr.id
     and so.unit_price is not null and so.part_quality is not null and nullif(trim(so.warranty),'') is not null
     and so.gst_treatment in ('GST included','GST excluded') and so.stock_status='in_stock')
  for update of sr skip locked
 loop
  if r.enquiry_consent and r.whatsapp_number is not null then
   insert into public.channel_outbox(channel,recipient,message,dedupe_key,supplier_request_id)
   values('whatsapp',r.whatsapp_number,'Any update?','vendor-reminder:'||r.id,r.id) on conflict(dedupe_key) do nothing;
  end if;
  insert into public.team_notifications(enquiry_id,event,phone,channel,message) values
   (r.enquiry_id,'vendor_response_pending',cfg.owner_phone,'whatsapp','Vendor price or clarification is pending. Please review the enquiry in CCTech workspace.'),
   (r.enquiry_id,'vendor_response_pending',cfg.staff_phone,'workspace','Vendor price or clarification is pending. Please review the enquiry in CCTech workspace.');
  update public.supplier_requests set reminder_queued_at=now() where id=r.id;
  count_queued:=count_queued+1;
 end loop;
 return count_queued;
end; $$;
create function public.claim_channel_outbox(p_limit integer default 10) returns setof public.channel_outbox
language sql security definer set search_path=public as $$
 update public.channel_outbox set status='processing',processed_at=now() where id in
  (select id from public.channel_outbox where status='queued' order by created_at for update skip locked limit least(greatest(p_limit,1),25)) returning *;
$$;
revoke all on function public.queue_vendor_request(uuid),public.queue_due_vendor_reminders(),public.claim_channel_outbox(integer) from public,anon,authenticated;
grant execute on function public.queue_vendor_request(uuid) to authenticated;
grant execute on function public.queue_due_vendor_reminders(),public.claim_channel_outbox(integer) to service_role;

-- 008_conversation_processing.sql
alter table public.enquiries add column customer_budget numeric;
alter table public.enquiries add column requested_fulfilment text;
alter table public.enquiries add column customer_requirements jsonb not null default '{}';
create table public.channel_conversations (
 channel text not null,business_account_id text not null,sender_id text not null,
 state jsonb not null default '{"stage":"start","fields":{}}',version integer not null default 0,
 updated_at timestamptz not null default now(),primary key(channel,business_account_id,sender_id)
);
alter table public.channel_conversations enable row level security;
revoke all on public.channel_conversations from anon,authenticated;
grant select on public.channel_conversations to authenticated;
grant all on public.channel_conversations to service_role;
grant all on public.enquiries,public.supplier_offers,public.suppliers to service_role;
create policy "Team reads conversations" on public.channel_conversations for select to authenticated using(public.is_cctech_staff());
create function public.get_conversation_context(p_message_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare m public.channel_inbox; c public.channel_conversations; actor text:='customer'; matched_supplier_id uuid; reqs jsonb;
begin
 select * into m from public.channel_inbox where id=p_message_id and processing_status='pending';
 if not found then return null; end if;
 select * into c from public.channel_conversations where channel=m.channel and business_account_id=m.business_account_id and sender_id=m.sender_id;
 if m.channel='whatsapp' then
  select role into actor from public.profiles where notification_phone=m.sender_id and role in ('owner','staff');
  if actor is null then
   select id into matched_supplier_id from public.suppliers where whatsapp_number=m.sender_id and active;
   actor:=case when matched_supplier_id is null then 'customer' else 'vendor' end;
  end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('pricing_mode',e.pricing_mode,'reply_ids',coalesce((select jsonb_agg(provider_message_id) from public.channel_outbox co where co.supplier_request_id=r.id and provider_message_id is not null),'[]'))),'[]') into reqs
 from public.supplier_requests r join public.enquiries e on e.id=r.enquiry_id where r.supplier_id=matched_supplier_id and r.status in ('draft','sent','responded');
 return jsonb_build_object('message',to_jsonb(m),'session',case when c.sender_id is null then jsonb_build_object('version',0,'state',jsonb_build_object('stage','start','fields','{}'::jsonb)) else to_jsonb(c) end,'actor_role',actor,'requests',reqs);
end; $$;

create function public.commit_conversation_event(p_message_id uuid,p_expected_version integer,p_state jsonb,p_actions jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
declare m public.channel_inbox; c public.channel_conversations; a jsonb; n integer:=0; e public.enquiries; r public.supplier_requests;
 s record; owner_id uuid; cfg public.workflow_settings; brief text; complete boolean; new_state jsonb:=p_state;
begin
 select * into m from public.channel_inbox where id=p_message_id for update;
 if not found then raise exception 'Message not found'; end if;
 if m.processing_status='processed' then return false; end if;
 insert into public.channel_conversations(channel,business_account_id,sender_id) values(m.channel,m.business_account_id,m.sender_id) on conflict do nothing;
 select * into c from public.channel_conversations where channel=m.channel and business_account_id=m.business_account_id and sender_id=m.sender_id for update;
 if c.version<>p_expected_version then raise exception 'Conversation changed; retry this event'; end if;
 select * into cfg from public.workflow_settings where id;
 select user_id into owner_id from public.profiles where role='owner' order by created_at limit 1;
 if owner_id is null then raise exception 'Configure an owner first'; end if;
 for a in select value from jsonb_array_elements(p_actions) loop
  n:=n+1;
  if a->>'type'='reply' then
   insert into public.channel_outbox(channel,recipient,message,dedupe_key) values(m.channel,m.sender_id,a->>'text','reply:'||m.id||':'||n) on conflict(dedupe_key) do nothing;
  elsif a->>'type'='alert' then
   insert into public.team_notifications(event,phone,channel,message) values
    ('conversation_attention',cfg.owner_phone,'whatsapp',a->>'text'),('conversation_attention',cfg.staff_phone,'workspace',a->>'text');
  elsif a->>'type'='create_enquiry' then
   insert into public.enquiries(customer_name,customer_contact,source_channel,category,pricing_mode,requirements,created_by,customer_budget,requested_fulfilment,customer_requirements)
   values(a->>'customer_name',m.sender_id,m.channel,a->>'category',a->>'pricing_mode',a->>'requirements',owner_id,(a->>'budget')::numeric,a->>'fulfilment',coalesce(a->'fields','{}')) returning * into e;
   new_state:=new_state||jsonb_build_object('enquiry_id',e.id);
   brief:='This is Chandrashekar from CCTech IT Solutions.'||E'\n\n'||e.requirements||E'\n\n'||
    case when e.pricing_mode in ('parts_only','parts_plus_replacement') then 'OEM Original, Second Copy or Compatible? Please share price and warranty.' else 'Please share available options, price and warranty.' end;
   for s in select * from public.suppliers where active and e.category=any(categories)
    and (e.pricing_mode not in ('parts_only','complete_equipment') or partner_type<>'service_partner')
    and (e.pricing_mode<>'amc_on_call' or partner_type<>'product_vendor')
   loop
    insert into public.supplier_requests(enquiry_id,supplier_id,request_message,created_by) values(e.id,s.id,brief,owner_id) returning * into r;
    if s.enquiry_consent and s.whatsapp_number is not null then
     insert into public.channel_outbox(channel,recipient,message,dedupe_key,supplier_request_id)
     values('whatsapp',s.whatsapp_number,brief,'vendor-request:'||r.id,r.id);
    else
     insert into public.team_notifications(enquiry_id,event,phone,channel,message) values
      (e.id,'vendor_setup',cfg.owner_phone,'whatsapp','Vendor contact/consent needs setup: '||s.name),
      (e.id,'vendor_setup',cfg.staff_phone,'workspace','Vendor contact/consent needs setup: '||s.name);
    end if;
   end loop;
   if not exists(select 1 from public.supplier_requests where enquiry_id=e.id) then
    insert into public.team_notifications(enquiry_id,event,phone,channel,message) values
     (e.id,'no_vendor',cfg.owner_phone,'whatsapp','No matching vendor for new enquiry. Please assign a vendor.'),
     (e.id,'no_vendor',cfg.staff_phone,'workspace','No matching vendor for new enquiry. Please assign a vendor.');
   end if;
  elsif a->>'type'='vendor_offer' then
   select sr.* into r from public.supplier_requests sr join public.suppliers sp on sp.id=sr.supplier_id
    where sr.id=(a->>'request_id')::uuid and m.channel='whatsapp' and sp.whatsapp_number=m.sender_id and sp.active;
   if not found then raise exception 'Vendor reply request mismatch'; end if;
   -- Later vendor messages invalidate earlier fit confirmations so an operator
   -- cannot approve a stale offer while a correction is awaiting clarification.
   update public.supplier_offers set compatibility_confirmed=false where supplier_request_id=r.id;
   select requirements into brief from public.enquiries where id=r.enquiry_id;
   insert into public.supplier_offers(supplier_request_id,supplier_id,item_description,unit_price,part_quality,warranty,gst_treatment,stock_status,raw_reply)
   values(r.id,r.supplier_id,brief,(a->>'price')::numeric,a->>'quality',a->>'warranty',a->>'gst',case when (a->>'available')::boolean then 'in_stock' else 'unconfirmed' end,a->>'raw_reply');
   complete:=(a->>'price') is not null and (a->>'quality') is not null and nullif(a->>'warranty','') is not null and (a->>'gst') is not null and (a->>'available')::boolean;
   if complete then update public.supplier_requests set status='responded' where id=r.id; end if;
  else raise exception 'Unsupported conversation action';
  end if;
 end loop;
 update public.channel_conversations set state=new_state,version=version+1,updated_at=now() where channel=m.channel and business_account_id=m.business_account_id and sender_id=m.sender_id;
 update public.channel_inbox set processing_status='processed' where id=m.id;
 return true;
end; $$;
revoke all on function public.get_conversation_context(uuid),public.commit_conversation_event(uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.get_conversation_context(uuid),public.commit_conversation_event(uuid,integer,jsonb,jsonb) to service_role;

-- 009_vendor_groups.sql
-- Run this small upgrade once on the existing project. No messages are sent.
begin;
alter table public.suppliers add column if not exists whatsapp_group_name text
  check (whatsapp_group_name is null or char_length(whatsapp_group_name) between 1 and 200);
alter table public.supplier_requests add column if not exists manual_delivery_method text
  check (manual_delivery_method is null or manual_delivery_method in ('individual','group'));
alter table public.supplier_requests add column if not exists manual_group_name text;

commit;
