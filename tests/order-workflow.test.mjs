import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { rupeesToPaise, fulfilmentQuote, choiceMessage } from '../sourcing-orders-model.mjs';

test('latest customer options use 15% margin, GST, rounding and route-specific payment', () => {
  const input = { unitCost: '3000', quantity: 1, marginValue: '15', vendorTaxTreatment: 'GST excluded', fitting: '' };
  const delivery = fulfilmentQuote({ ...input, fulfilment: 'delivery' });
  const store = fulfilmentQuote({ ...input, fulfilment: 'store_fitting' });
  assert.equal(delivery.totalPaise, 410000); assert.equal(delivery.advancePaise,410000);
  assert.equal(store.totalPaise,480000); assert.equal(store.advancePaise,240000);
  const message = choiceMessage({ description: 'HP display', quality: 'Compatible', deliveryQuote: delivery, storeQuote: store });
  assert.match(message,/100%/); assert.match(message,/50%/); assert.match(message,/directly/); assert.doesNotMatch(message,/margin|vendor/i);
  assert.equal(rupeesToPaise('100.01'),10001);
  for (const bad of ['', '-1', '1.234', '1e5']) assert.throws(() => rupeesToPaise(bad));
});

test('PostgreSQL workflow validates roles, offers, payment, fulfilment and idempotent review queue', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
    const first = (await readFile(new URL('../supabase/migrations/001_vendor_sourcing.sql', import.meta.url), 'utf8')).replace('create extension if not exists pgcrypto;', '');
    await db.exec(first);
    for (const file of ['002_offer_request_integrity.sql','003_supplier_whatsapp.sql','004_whatsapp_inbox.sql','005_order_workflow.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    const owner = '00000000-0000-0000-0000-000000000001'; const supplierUser = '00000000-0000-0000-0000-000000000002';
    await db.query('insert into auth.users values($1,$2),($3,$4)', [owner,'owner@test.example',supplierUser,'vendor@test.example']);
    await db.query("insert into public.profiles(user_id,role) values($1,'staff'),($2,'supplier')", [owner,supplierUser]);
    const supplier = (await db.query("insert into public.suppliers(name,partner_type,portal_user_id) values('Vendor','product_vendor',$1) returning id", [supplierUser])).rows[0].id;
    const enquiry = (await db.query("insert into public.enquiries(customer_name,customer_contact,category,pricing_mode,source_channel,requirements,created_by) values('Customer','919876543210','Laptop / desktop / parts','parts_only','instagram','HP display',$1) returning id", [owner])).rows[0].id;
    const request = (await db.query("insert into public.supplier_requests(enquiry_id,supplier_id,request_message,created_by) values($1,$2,'Display price?',$3) returning id", [enquiry,supplier,owner])).rows[0].id;
    const offer = (await db.query("insert into public.supplier_offers(supplier_request_id,supplier_id,item_description,quantity,unit_price,part_quality,compatibility_confirmed,stock_status,gst_treatment) values($1,$2,'HP display',2,3000,'Compatible',false,'in_stock','GST included') returning id", [request,supplier])).rows[0].id;
    async function identity(id) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated'); }
    const createOrder = (route = 'delivery', margin = 100000, fitting = 0) => db.query('select * from public.create_sales_order($1,$2,1,$3,$4,$5,$6,0,$7,$8)', [enquiry,offer,route,margin,route === 'delivery' ? 40000 : 0,fitting,'Porter','Delivery address']);
    await identity(supplierUser);
    await db.query('update public.supplier_offers set compatibility_confirmed=true,evidence_confirmed=true where id=$1',[offer]);
    const claimed = (await db.query('select compatibility_confirmed,evidence_confirmed from public.supplier_offers where id=$1',[offer])).rows[0];
    assert.equal(claimed.compatibility_confirmed,false); assert.equal(claimed.evidence_confirmed,false);
    await assert.rejects(createOrder(), /Staff access/);
    assert.equal((await db.query('select * from public.sales_orders')).rows.length, 0);
    await identity(owner);
    await assert.rejects(createOrder(), /Confirm offer fit/);
    await db.query('update public.supplier_offers set compatibility_confirmed=true where id=$1',[offer]);
    await assert.rejects(createOrder('delivery',99999), /margin/);
    await assert.rejects(createOrder('delivery',100000,50000), /delivery address\/carrier or store/);
    const order = (await createOrder()).rows[0];
    assert.equal(Number(order.total_paise), 440000); assert.equal(Number(order.advance_paise), 396000);
    await assert.rejects(createOrder(), /unique/);
    await assert.rejects(db.query('update public.sales_orders set received_paise=440000'), /permission denied/);
    await assert.rejects(db.query("select public.advance_order($1,'dispatched')", [order.id]), /advance/);
    await assert.rejects(db.query('select public.queue_order_review($1)', [order.id]), /Complete delivery/);
    await db.query("select public.record_order_payment($1,200000,'UPI-1')", [order.id]);
    assert.equal((await db.query('select status from public.sales_orders where id=$1',[order.id])).rows[0].status,'awaiting_advance');
    await assert.rejects(db.query("select public.record_order_payment($1,196000,'UPI-1')", [order.id]), /unique/);
    await db.query("select public.record_order_payment($1,196000,'UPI-2')", [order.id]);
    await assert.rejects(db.query("select public.advance_order($1,'completed')", [order.id]), /Invalid order/);
    await db.query("update public.workflow_settings set review_url='https://g.page/r/example/review' where id");
    await db.query("select public.advance_order($1,'dispatched')",[order.id]);
    await db.query("select public.advance_order($1,'completed')",[order.id]);
    await db.query('select public.queue_order_review($1)',[order.id]);
    const notices = (await db.query('select kind,channel,message,status from public.order_notifications order by created_at')).rows;
    assert.equal(notices.length, 2); assert.equal(notices[0].channel,'instagram');
    assert.doesNotMatch(notices[0].message,/vendor|margin|3000/i); assert.equal(notices[0].status,'queued');
    assert.match(notices.find(row=>row.kind==='review_request').message,/honest experience.*https:\/\//);
    await assert.rejects(db.query("select public.record_order_payment($1,100000,'UPI-3')",[order.id]), /Check verified payment/);
    await identity(supplierUser);
    assert.equal((await db.query('select * from public.order_notifications')).rows.length,0);
    await assert.rejects(db.query("select public.record_order_payment($1,100,'fake')",[order.id]),/Staff access/);
    await identity(owner);
    const secondEnquiry = (await db.query("insert into public.enquiries(customer_name,category,pricing_mode,source_channel,requirements,created_by) values('Store customer','Laptop / desktop / parts','parts_plus_replacement','facebook','Fit display',$1) returning id",[owner])).rows[0].id;
    const secondRequest = (await db.query("insert into public.supplier_requests(enquiry_id,supplier_id,request_message,created_by) values($1,$2,'Display?',$3) returning id",[secondEnquiry,supplier,owner])).rows[0].id;
    const secondOffer = (await db.query("insert into public.supplier_offers(supplier_request_id,supplier_id,item_description,quantity,unit_price,part_quality,compatibility_confirmed,stock_status,gst_treatment) values($1,$2,'HP display',2,3000,'Compatible',true,'in_stock','GST included') returning id",[secondRequest,supplier])).rows[0].id;
    await assert.rejects(db.query("select * from public.create_sales_order($1,$2,1,'store_fitting',100000,40000,60000,0)",[secondEnquiry,secondOffer]),/delivery address\/carrier or store/);
    const storeOrder = (await db.query("select * from public.create_sales_order($1,$2,2,'store_fitting',100000,0,60000,0)",[secondEnquiry,secondOffer])).rows[0];
    assert.equal(Number(storeOrder.total_paise),860000); assert.equal(Number(storeOrder.delivery_paise),0);
    assert.equal(Number(storeOrder.advance_paise),774000);
    await db.query("select public.record_order_payment($1,774000,'STORE-UPI-1')",[storeOrder.id]);
    await assert.rejects(db.query("select public.advance_order($1,'dispatched')",[storeOrder.id]),/Invalid order/);
    await db.query("select public.advance_order($1,'in_progress')",[storeOrder.id]);
    await db.query("select public.advance_order($1,'completed')",[storeOrder.id]);
    assert.equal((await db.query("select count(*)::int as n from public.order_notifications where order_id=$1 and kind='review_request'",[storeOrder.id])).rows[0].n,1);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.sales_orders'), /permission denied/);
  } finally { await db.close(); }
});
