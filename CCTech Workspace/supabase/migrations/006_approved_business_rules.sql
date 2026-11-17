begin;
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
commit;
