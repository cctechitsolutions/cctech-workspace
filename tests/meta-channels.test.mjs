import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { normalizeMetaMessages, createMetaWebhook, outboundRequest } from '../supabase/functions/_shared/meta-channels.mjs';
const event={object:'instagram',entry:[{id:'123',messaging:[{sender:{id:'456'},recipient:{id:'123'},timestamp:1793700000000,message:{mid:'mid.1',text:'Need a laptop'}}]}]};
test('a separate WhatsApp setup token preserves the original Facebook challenge and signed POST checks',async()=>{
 const waToken='private-whatsapp-verification-value-12345';
 let stored=0;
 const handler=createMetaWebhook({verifyToken:'existing-facebook-value',whatsappVerifyToken:waToken,
  secrets:{instagram:'ig-secret'},bindings:{instagram:'123'},storeMessages:async()=>{stored++;}});
 const challenge=(token,mode='subscribe')=>new Request('https://example.test?'+new URLSearchParams({'hub.mode':mode,'hub.verify_token':token,'hub.challenge':'challenge-42'}));
 for(const token of ['existing-facebook-value',waToken]) {
  const result=await handler(challenge(token));assert.equal(result.status,200);assert.equal(await result.text(),'challenge-42');
  assert.equal(result.headers.get('Cache-Control'),'no-store');
 }
 for(const token of ['', 'wrong-token'])assert.equal((await handler(challenge(token))).status,403);
 assert.equal((await handler(challenge(waToken,'wrong-mode'))).status,403);
 assert.equal((await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify(event),headers:{'x-hub-signature-256':waToken}}))).status,401);
 assert.equal(stored,0);
 const body=JSON.stringify(event),signature='sha256='+createHmac('sha256','ig-secret').update(body).digest('hex');
 assert.equal((await handler(new Request('https://example.test',{method:'POST',body,headers:{'x-hub-signature-256':signature}}))).status,200);
 assert.equal(stored,1);
 const short=createMetaWebhook({whatsappVerifyToken:'short',secrets:{},bindings:{}});
 assert.equal((await short(challenge('short'))).status,503);
});
test('channel messages stay scoped to their business account and ignore echoes',()=>{
 assert.equal(normalizeMetaMessages(event,{instagram:'123'})[0].channel,'instagram');
 assert.deepEqual(normalizeMetaMessages(event,{instagram:'999'}),[]);
 const echo=structuredClone(event);echo.entry[0].messaging[0].message.is_echo=true;assert.deepEqual(normalizeMetaMessages(echo,{instagram:'123'}),[]);
 const facebook={...event,object:'page'};assert.equal(normalizeMetaMessages(facebook,{facebook:'123'})[0].channel,'facebook');
});
test('unified receiver validates the channel secret and waits for storage',async()=>{
 const body=JSON.stringify(event),signature='sha256='+createHmac('sha256','ig-secret').update(body).digest('hex');let count=0;
 const handler=createMetaWebhook({verifyToken:'verify',secrets:{instagram:'ig-secret'},bindings:{instagram:'123'},storeMessages:async rows=>{count+=rows.length;}});
 assert.equal((await handler(new Request('https://example.test',{method:'POST',body,headers:{'x-hub-signature-256':signature}}))).status,200);assert.equal(count,1);
 assert.equal((await handler(new Request('https://example.test',{method:'POST',body,headers:{'x-hub-signature-256':'sha256='+'0'.repeat(64)}}))).status,401);assert.equal(count,1);
});
test('sending requires activation, current window and explicit WhatsApp cost approval',()=>{
 const now=Date.now(),last=new Date(now-60000).toISOString();const notice={channel:'whatsapp',recipient:'919999999999',message:'Price?'};
 const cfg={sendEnabled:true,businessId:'123',token:'not-real-token',graphVersion:'v99.0',senderPhone:'918888888888',costsApproved:true};
 assert.match(outboundRequest(notice,{...cfg,sendEnabled:false},last,now).blocked,/disabled/);
 assert.match(outboundRequest(notice,{...cfg,costsApproved:false},last,now).blocked,/costs/);
 assert.match(outboundRequest(notice,cfg,null,now).blocked,/template/);
 const req=outboundRequest(notice,cfg,last,now);assert.equal(JSON.parse(req.options.body).to,notice.recipient);assert.equal(req.options.redirect,'error');
 assert.match(outboundRequest({...notice,recipient:cfg.senderPhone},cfg,last,now).blocked,/own notification/);
 const ig=outboundRequest({...notice,channel:'instagram',recipient:'456'},cfg,last,now);assert.match(ig.url,/graph.instagram.com/);
 assert.match(outboundRequest({...notice,channel:'facebook'},cfg,null,now).blocked,/window/);
});
test('only explicitly approved templates can be sent outside the reply window',()=>{
 const notice={channel:'whatsapp',recipient:'919999999999',message:'Price?',template_name:'vendor_request',template_parameters:['HP display']};
 const cfg={sendEnabled:true,businessId:'123',token:'not-real',graphVersion:'v99.0',costsApproved:true,paidTemplatesEnabled:true,approvedTemplates:['vendor_request']};
 assert.equal(JSON.parse(outboundRequest(notice,cfg,null).options.body).type,'template');
 assert.ok(outboundRequest({...notice,template_name:'unapproved'},cfg,null).blocked);
});
