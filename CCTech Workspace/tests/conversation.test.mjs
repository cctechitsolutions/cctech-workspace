import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { planConversation, parseVendorReply } from '../supabase/functions/_shared/conversation.mjs';

test('parts intake asks missing fields and excludes customer identity/budget from vendor requirements',()=>{
 let state;let plan;
 for(const text of ['Need display','HP ProBook 440 G3','1','4000','yes','delivery','Private delivery address 560064','Private Customer']) {
  plan=planConversation({message:{message_text:text},session:{state},actor_role:'customer'});state=plan.state;
 }
 const enquiry=plan.actions.find(a=>a.type==='create_enquiry');assert.ok(enquiry);assert.equal(enquiry.budget,4000);
 assert.match(enquiry.requirements,/HP ProBook 440 G3/);assert.doesNotMatch(enquiry.requirements,/Private Customer|4000|560064/);
 assert.equal(state.stage,'waiting');
 const paid=planConversation({message:{message_text:'payment sent'},session:{state},actor_role:'customer'});
 assert.ok(paid.actions.some(a=>a.type==='alert'));assert.ok(paid.actions.some(a=>/verify/.test(a.text||'')));
 assert.ok(paid.actions.every(a=>a.type!=='payment_verified'));
});
test('vendor price parsing never picks among conflicting prices or guesses an OEM type',()=>{
 const p=parseVendorReply('OEM Original price: Rs 3000\nWarranty: 6 months\nGST extra\nAvailable');
 assert.equal(p.price,3000);assert.equal(p.quality,'OEM Original');assert.equal(p.gst,'GST excluded');assert.equal(p.available,true);
 assert.equal(parseVendorReply('price 3000 or price 3500 compatible').price,null);
 assert.equal(parseVendorReply('Original display 3000').quality,null);
 assert.equal(parseVendorReply('New laptop price: 20000 warranty: 6 months',true).quality,'New');
 assert.equal(parseVendorReply('Compatible warranty 6 months price 3000 GST extra available').warranty,'6 months');
});
test('ambiguous vendor reply asks for original-message context and alerts team',()=>{
 const p=planConversation({message:{message_text:'4200'},actor_role:'vendor',requests:[{id:'a',status:'sent'},{id:'b',status:'sent'}]});
 assert.ok(!p.actions.some(a=>a.type==='vendor_offer'));assert.ok(p.actions.some(a=>a.type==='alert'));
 const matched=planConversation({message:{message_text:'4200',reply_to_message_id:'mid.a'},actor_role:'vendor',requests:[{id:'a',status:'sent',provider_message_id:'mid.a'},{id:'b',status:'sent'}]});
 assert.equal(matched.actions.find(a=>a.type==='vendor_offer').request_id,'a');assert.match(matched.actions.find(a=>a.type==='reply').text,/OEM Original/);
});
test('vendor details can arrive across messages without asking for the price again',()=>{
 const context={actor_role:'vendor',requests:[{id:'a',status:'sent'}]};
 const first=planConversation({...context,message:{message_text:'3000'}});
 const second=planConversation({...context,session:{state:first.state},message:{message_text:'Compatible, 6 months warranty, GST extra, Available'}});
 const offer=second.actions.find(a=>a.type==='vendor_offer');assert.equal(offer.price,3000);assert.equal(offer.quality,'Compatible');
 assert.equal(offer.gst,'GST excluded');assert.equal(offer.available,true);assert.match(second.actions.find(a=>a.type==='reply').text,/Thank you/);
 const conflict=planConversation({...context,session:{state:second.state},message:{message_text:'Price 3000 or 3500'}});
 assert.equal(conflict.actions.find(a=>a.type==='vendor_offer').price,null);
 const unlabelledChange=planConversation({...context,session:{state:second.state},message:{message_text:'4200'}});
 assert.equal(unlabelledChange.actions.find(a=>a.type==='vendor_offer').price,null);
});
test('service intake does not force delivery or store-fitting on an onsite requirement',()=>{
 let state;let result;
 for(const text of ['Need CCTV installation','New installation','8 cameras','Indoor and outdoor','Yelahanka','yes']) {
  result=planConversation({message:{message_text:text},session:{state},actor_role:'customer'});state=result.state;
 }
 assert.equal(state.stage,'name');assert.equal(state.fields.fulfilment,'service_review');
});
test('inbound processing commits one enquiry and private RFQs exactly once',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
   insert into auth.users values('00000000-0000-0000-0000-000000000001','cctechitsolutions@gmail.com');`);
  for(const name of ['001_vendor_sourcing.sql','002_offer_request_integrity.sql','003_supplier_whatsapp.sql','004_whatsapp_inbox.sql','005_order_workflow.sql','006_approved_business_rules.sql','007_channel_connections.sql','008_conversation_processing.sql']) {
   await db.exec((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;',''));
  }
  await db.query("insert into public.suppliers(name,partner_type,categories,whatsapp_number,enquiry_consent) values('Parts vendor','product_vendor',array['Laptop / desktop / parts'],'919999999999',true)");
  await db.exec('set role service_role');
  let lastMessage;
  for(const [index,text] of ['Need display','HP ProBook 440 G3','1','4000','yes','delivery','Private delivery address 560064','Private Customer'].entries()) {
   const m=(await db.query("insert into public.channel_inbox(channel,business_account_id,provider_message_id,sender_id,message_type,message_text,provider_timestamp,raw_message) values('whatsapp','business-phone',$1,'919888888888','text',$2,now(),'{}') returning id",['msg-'+index,text])).rows[0].id;
   const context=(await db.query('select public.get_conversation_context($1) ctx',[m])).rows[0].ctx;
   const plan=planConversation(context);
   await db.query('select public.commit_conversation_event($1,$2,$3,$4)',[m,context.session.version,plan.state,plan.actions]);lastMessage=m;
  }
  assert.equal((await db.query('select count(*)::int n from public.enquiries')).rows[0].n,1);
  const rfq=(await db.query("select message from public.channel_outbox where dedupe_key like 'vendor-request:%'")).rows;
  assert.equal(rfq.length,1);assert.match(rfq[0].message,/HP ProBook/);assert.doesNotMatch(rfq[0].message,/Private Customer|4000|919888888888/);
  assert.equal((await db.query('select public.commit_conversation_event($1,0,$2,$3) done',[lastMessage,{stage:'start'},[{type:'reply',text:'duplicate'}]])).rows[0].done,false);
  assert.equal((await db.query('select count(*)::int n from public.enquiries')).rows[0].n,1);
  const req=(await db.query('select id from public.supplier_requests')).rows[0].id;
  await db.query("update public.supplier_requests set status='sent',provider_message_id='vendor-mid' where id=$1",[req]);
  const vendorMessage=(await db.query("insert into public.channel_inbox(channel,business_account_id,provider_message_id,sender_id,reply_to_message_id,message_type,message_text,provider_timestamp,raw_message) values('whatsapp','business-phone','vendor-reply','919999999999','vendor-mid','text','OEM Original price: Rs 3000, warranty: 6 months, GST extra, Available',now(),'{}') returning id")).rows[0].id;
  const ctx=(await db.query('select public.get_conversation_context($1) ctx',[vendorMessage])).rows[0].ctx;assert.equal(ctx.actor_role,'vendor');
  const plan=planConversation(ctx);await db.query('select public.commit_conversation_event($1,$2,$3,$4)',[vendorMessage,ctx.session.version,plan.state,plan.actions]);
  const offer=(await db.query('select unit_price,part_quality,compatibility_confirmed from public.supplier_offers')).rows[0];
  assert.equal(Number(offer.unit_price),3000);assert.equal(offer.part_quality,'OEM Original');assert.equal(offer.compatibility_confirmed,false);
  assert.equal((await db.query('select status from public.supplier_requests where id=$1',[req])).rows[0].status,'responded');
  await db.exec('reset role;set role anon');await assert.rejects(db.query('select public.get_conversation_context($1)',[vendorMessage]),/permission denied/);
 } finally {await db.close();}
});
