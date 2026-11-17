begin;
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
commit;
