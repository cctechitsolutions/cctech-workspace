begin;
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
commit;
