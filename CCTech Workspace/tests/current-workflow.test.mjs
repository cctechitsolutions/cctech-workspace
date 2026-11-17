import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { fulfilmentQuote } from '../sourcing-orders-model.mjs';

test('approved rules migrate cleanly and protect approvals, owner payments, completion and reminders', async () => {
 const db=new PGlite();
 const owner='00000000-0000-0000-0000-000000000001',staff='00000000-0000-0000-0000-000000000002',vendorUser='00000000-0000-0000-0000-000000000003';
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key,email text);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  await db.query('insert into auth.users values($1,$2),($3,$4),($5,$6)',[owner,'cctechitsolutions@gmail.com',staff,'chandra15031993@gmail.com',vendorUser,'vendor@example.test']);
  for(const name of ['001_vendor_sourcing.sql','002_offer_request_integrity.sql','003_supplier_whatsapp.sql','004_whatsapp_inbox.sql','005_order_workflow.sql','006_approved_business_rules.sql','007_channel_connections.sql']) {
   const sql=(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;','');
   await db.exec(sql);
  }
  const roles=(await db.query('select role,notification_phone from public.profiles order by role')).rows;
  assert.deepEqual(roles,[{role:'owner',notification_phone:'918951711631'},{role:'staff',notification_phone:'916364253615'}]);
  async function identity(id) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); }
  await identity(owner);
  const supplier=(await db.query("insert into public.suppliers(name,partner_type,whatsapp_number) values('Vendor','product_vendor','919999999999') returning id")).rows[0].id;
  async function seed(channel='whatsapp') {
   const e=(await db.query("insert into public.enquiries(customer_name,customer_contact,category,pricing_mode,source_channel,requirements,created_by) values('Customer','919888888888','Laptop / desktop / parts','parts_only',$1,'HP display',$2) returning id",[channel,owner])).rows[0].id;
   const r=(await db.query("insert into public.supplier_requests(enquiry_id,supplier_id,request_message,created_by) values($1,$2,'Display price?',$3) returning id",[e,supplier,owner])).rows[0].id;
   const o=(await db.query("insert into public.supplier_offers(supplier_request_id,supplier_id,item_description,quantity,unit_price,part_quality,compatibility_confirmed,stock_status,gst_treatment,warranty) values($1,$2,'HP display',3,3000,'Compatible',true,'in_stock','GST excluded','6 months') returning id",[r,supplier])).rows[0].id;
   return {e,r,o};
  }
  const first=await seed();
  const prepared=(await db.query("select * from public.prepare_sales_order($1,$2,1,'delivery','percentage',15,null,null,'Porter','Address')",[first.e,first.o])).rows[0];
  assert.equal(Number(prepared.total_paise),410000);assert.equal(Number(prepared.advance_paise),410000);assert.equal(prepared.quote_status,'pending');
  assert.equal((await db.query('select count(*)::int n from public.order_notifications')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from public.team_notifications')).rows[0].n,2);
  await assert.rejects(db.query("select public.record_order_payment($1,410000,'P-1')",[prepared.id]),/Approve quotation/);
  await assert.rejects(db.query("select * from public.create_sales_order($1,$2,1,'delivery',100000,0,0,0,'Porter','Address')",[first.e,first.o]),/permission denied/);
  await identity(staff);
  await db.query("update public.profiles set role='owner' where user_id=$1",[staff]);
  assert.equal((await db.query('select role from public.profiles where user_id=$1',[staff])).rows[0].role,'staff');
  await db.query("select public.revise_sales_order($1,'percentage',15)",[prepared.id]);
  await assert.rejects(db.query('select public.approve_sales_order($1,false,1)',[prepared.id]),/Quotation changed/);
  await db.query('update public.supplier_offers set unit_price=3200 where id=$1',[first.o]);
  await assert.rejects(db.query('select public.approve_sales_order($1,false,2)',[prepared.id]),/Vendor offer changed/);
  await db.query('update public.supplier_offers set unit_price=3000 where id=$1',[first.o]);
  await db.query('select public.approve_sales_order($1,false,2)',[prepared.id]);
  await assert.rejects(db.query("select public.record_order_payment($1,410000,'STAFF-FORGED')",[prepared.id]),/Owner verification/);
  await identity(owner);await db.query('select public.approve_sales_order($1,false,1)',[prepared.id]);
  await assert.rejects(db.query("select public.revise_sales_order($1,'percentage',10)",[prepared.id]),/unapproved quotation/);
  assert.equal((await db.query("select count(*)::int n from public.order_notifications where kind='advance_request'")).rows[0].n,1);
  await db.query("select public.record_order_payment($1,400000,'P-1')",[prepared.id]);
  await assert.rejects(db.query("select public.advance_order($1,'dispatched')",[prepared.id]),/required payment/);
  await db.query("select public.record_order_payment($1,10000,'P-2')",[prepared.id]);
  await db.query("update public.workflow_settings set public_workspace_url='https://workspace.example' where id");
  await db.query("select public.advance_order($1,'dispatched')",[prepared.id]);
  const completion=(await db.query("select message from public.order_notifications where order_id=$1 and kind='completion_request'",[prepared.id])).rows[0].message;
  const token=completion.split('#token=')[1];assert.equal(token.length,72);
  await db.exec('reset role;set role anon');
  await assert.rejects(db.query('select public.complete_customer_order($1)',['x'.repeat(72)]),/Invalid or expired/);
  await db.query('select public.complete_customer_order($1)',[token]);await db.query('select public.complete_customer_order($1)',[token]);
  await identity(owner);await db.query("select public.advance_order($1,'completed')",[prepared.id]);
  assert.equal((await db.query("select count(*)::int n from public.order_notifications where order_id=$1 and kind='review_request'",[prepared.id])).rows[0].n,1);
  const second=await seed('instagram');
  const store=(await db.query("select * from public.prepare_sales_order($1,$2,1,'store_fitting','percentage',15,999999)",[second.e,second.o])).rows[0];
  assert.equal(Number(store.fitting_paise),60000);assert.equal(Number(store.total_paise),480000);assert.equal(Number(store.advance_paise),240000);
  const multi=await seed();await assert.rejects(db.query("select * from public.prepare_sales_order($1,$2,2,'store_fitting','percentage',15)",[multi.e,multi.o]),/multiple items/);
  const budget=await seed();const over=(await db.query("select * from public.prepare_sales_order($1,$2,1,'delivery','percentage',15,null,300000,'Rapido','Address')",[budget.e,budget.o])).rows[0];
  await assert.rejects(db.query('select public.approve_sales_order($1,false,1)',[over.id]),/budget plus 5/);
  for(const [cost,budgetAmount] of [[3000,400000],[3000,380000],[9540,1000000],[105.37,15000]]) {
   const args={unitCost:String(cost),quantity:1,marginValue:'15',vendorTaxTreatment:'GST excluded',fulfilment:'delivery',budget:String(budgetAmount/100)};
   const js=fulfilmentQuote(args); const sql=(await db.query("select public.calculate_quote_values($1,1,'GST excluded','percentage',15,'delivery',null,$2) as q",[cost,budgetAmount])).rows[0].q;
   assert.equal(Number(sql.total),js.totalPaise);assert.equal(Number(sql.margin),js.marginPaise);assert.equal(Number(sql.tax),js.taxPaise);
  }
  // Use a fresh request without a complete response to exercise the timer.
  const timerEnquiry=(await db.query("insert into public.enquiries(customer_name,category,pricing_mode,source_channel,requirements,created_by) values('Timer','Networking','parts_only','whatsapp','Switch',$1) returning id",[owner])).rows[0].id;
  const timerRequest=(await db.query("insert into public.supplier_requests(enquiry_id,supplier_id,request_message,created_by) values($1,$2,'Switch price?',$3) returning id",[timerEnquiry,supplier,owner])).rows[0].id;
  await assert.rejects(db.query('select public.queue_vendor_request($1)',[timerRequest]),/consent/);
  await db.query('update public.suppliers set enquiry_consent=true where id=$1',[supplier]);
  await db.query('select public.queue_vendor_request($1)',[timerRequest]);await db.query('select public.queue_vendor_request($1)',[timerRequest]);
  await db.exec('reset role; set role service_role');
  await db.query("update public.supplier_requests set status='sent',sent_at=now()-interval '6 minutes' where id=$1",[timerRequest]);
  assert.equal((await db.query('select public.queue_due_vendor_reminders() n')).rows[0].n,1);
  assert.equal((await db.query('select public.queue_due_vendor_reminders() n')).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from public.channel_outbox where dedupe_key=$1",['vendor-reminder:'+timerRequest])).rows[0].n,1);
  const claimed=(await db.query('select * from public.claim_channel_outbox(2)')).rows;assert.equal(claimed.length,2);
  assert.ok(claimed.every(row=>row.status==='processing'));
  await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from public.channel_outbox'),/permission denied/);
 } finally {await db.close();}
});
