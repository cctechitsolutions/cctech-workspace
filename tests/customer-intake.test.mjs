import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planConversation} from '../supabase/functions/_shared/conversation.mjs';

function chat(messages,initial) {
 let state=initial,plan;
 const history=[];
 for(const input of messages) {
  plan=planConversation({actor_role:'customer',session:{state},message:{channel:'facebook',sender_id:'123456789',message_type:'text',...(typeof input==='string'?{message_text:input}:input)}});
  state=plan.state;history.push(plan);
 }
 return {...plan,history};
}
const answer=plan=>plan.actions.find(a=>a.type==='reply')?.text||'';

test('broken screens and charging faults start diagnosis rather than a part quotation',()=>{
 for(const text of ['My HP laptop screen is black','Laptop is very slow','Need help, display not working','Printer not working','My laptop is not charging']) {
  const plan=chat([text]);assert.equal(plan.state.kind,'repair',text);assert.match(answer(plan),/full device model/);assert.ok(!plan.actions.some(a=>a.type==='create_enquiry'));
 }
 const part=chat(['HP laptop display required']);assert.equal(part.state.kind,'parts');assert.equal(part.state.fields.part,'display');
});
test('full purchase brief remembers condition, purpose, budget and quantity',()=>{
 const p=chat(['Need one used Dell laptop for office work, budget 25k']);
 assert.equal(p.state.fields.budget,25000);assert.equal(p.state.fields.quantity,1);assert.match(p.state.fields.condition,/Used/);
 assert.equal(p.state.stage,'confirm');assert.doesNotMatch(answer(p),/What is your budget/);
 const done=chat(['yes','collect','Private Buyer','skip'],p.state);
 const enquiry=done.actions.find(a=>a.type==='create_enquiry');assert.ok(enquiry);
 assert.equal(enquiry.category,'Used / refurbished equipment');assert.equal(enquiry.pricing_mode,'complete_equipment');
 assert.doesNotMatch(enquiry.requirements,/25k|25000|Private Buyer|123456789|budget/i);
 assert.equal(done.state.fields.fulfilment,'store_collection');
});
test('AutoCAD purchase asks about 2D or 3D before selecting equipment',()=>{
 const p=chat(['I need a new desktop for AutoCAD']);assert.match(answer(p),/2D.*3D/);
 assert.ok(!p.actions.some(a=>a.type==='create_enquiry'));
});
test('a supplied configuration avoids asking the purpose again',()=>{
 const p=chat(['Need laptop i5 12th gen 16GB RAM 512GB SSD']);
 assert.ok(p.state.fields.configuration);assert.match(answer(p),/budget/);
});
test('new as a condition answer does not reset the conversation; staff purchases stay in sales',()=>{
 const p=chat(['Need laptop','Office work','30000','new']);
 assert.equal(p.state.kind,'buy');assert.equal(p.state.fields.condition,'New');assert.match(answer(p),/pieces or units/);
 assert.equal(chat(['Need laptops for my staff']).state.kind,'buy');
});
test('wireless mouse and Raspberry Pi have product-specific questions',()=>{
 const mouse=chat(['Need wireless mouse']);assert.equal(mouse.state.kind,'accessory');assert.match(answer(mouse),/pieces or units/);
 const pi=chat(['Raspberry Pi 5 required']);assert.match(answer(pi),/model\/RAM size.*board only or a kit/);
 const ram=chat(['Need SSD for HP ProBook 440 G3']);assert.match(answer(ram),/current RAM\/storage/);
});
test('software installation asks about preserving files and licence without seeking credentials',()=>{
 const p=chat(['Need Windows 11 reinstall','Reinstall','HP ProBook 440 G3']);
 assert.equal(p.state.kind,'software');assert.match(answer(p),/files.*backup.*valid licence/);
 const done=chat(['Preserve files, backup available, own licence','Yelahanka','yes','Customer','skip'],p.state);
 const enquiry=done.actions.find(a=>a.type==='create_enquiry');assert.equal(enquiry.category,'Software / licensing');
 assert.match(answer(done),/service request/);assert.doesNotMatch(answer(done),/vendor prices/);
 assert.doesNotMatch(done.history.map(answer).join('\n'),/send.*(?:password|OTP|PIN)/i);
 assert.equal(chat(['MS Office installation needed']).state.kind,'software');
});
test('licence enquiries collect device count and renewal details',()=>{
 const p=chat(['Need Microsoft 365 licence','Renewal, business standard','3 users']);
 assert.equal(p.state.kind,'licence');assert.equal(p.state.fields.quantity,3);assert.match(answer(p),/installing or activating/);
});
test('network, power, data recovery and business support ask distinct questions',()=>{
 assert.match(answer(chat(['Our office Wi-Fi drops frequently'])),/home or an office.*devices/);
 assert.match(answer(chat(['Need UPS for office'])),/equipment.*devices/);
 assert.match(answer(chat(['My files are deleted'])),/device or drive/);
 assert.match(answer(chat(['Need AMC for our office'])),/computers need support/);
 assert.match(answer(chat(['Need new biometric system'])),/doors or users/);
 assert.match(answer(chat(['Need office relocation'])),/users\/devices or sites/);
});
test('service enquiry maps to its actual category and does not ask product delivery',()=>{
 const p=chat(['Need CCTV installation','New installation','8 cameras','Both, no existing system','Yelahanka','yes','Customer','skip']);
 const enquiry=p.actions.find(a=>a.type==='create_enquiry');assert.equal(enquiry.category,'CCTV / security');
 assert.equal(enquiry.fulfilment,'service_review');assert.ok(!p.history.map(answer).some(t=>/part delivery|fitting at/.test(t)));
 assert.match(answer(p),/service request/);
});
test('budget corrections do not become the answer to the active model question',()=>{
 const p=chat(['Need display','Actually budget 4000']);assert.equal(p.state.fields.budget,4000);
 assert.equal(p.state.fields.model,undefined);assert.match(answer(p),/full device model/);
 const corrected=chat(['HP ProBook 440 G3','1','Actually two pieces'],p.state);
 assert.equal(corrected.state.fields.quantity,2);assert.equal(corrected.state.stage,'confirm');
});
test('corrections at confirmation preserve other details',()=>{
 const p=chat(['Need display HP ProBook 440 G3, 1 piece, budget 4000','Actually 2 pieces']);
 assert.equal(p.state.stage,'confirm');assert.equal(p.state.fields.quantity,2);assert.equal(p.state.fields.model,'HP ProBook 440 G3');
 const revised=chat(['edit','model','Dell Latitude 5400'],p.state);
 assert.equal(revised.state.fields.model,'Dell Latitude 5400');assert.equal(revised.state.fields.budget,4000);assert.equal(revised.state.stage,'confirm');
});
test('a brand alone is insufficient; unknown and model photos go to team review',()=>{
 const p=chat(['Need display','HP']);assert.equal(p.state.fields.model,undefined);assert.match(answer(p),/not only the brand/);
 const photo=chat([{message_type:'attachment',message_text:null}],p.state);
 assert.equal(photo.state.needs_review,true);assert.match(answer(photo),/cannot read/);assert.ok(photo.actions.some(a=>a.type==='alert'));
 const finished=chat(['unknown','1','skip','yes','collect','Customer','skip'],p.state);
 assert.ok(finished.actions.some(a=>a.type==='alert'&&/review/.test(a.text)));assert.ok(finished.actions.some(a=>a.type==='create_enquiry'));
});
test('human requests retain context and notify team, with explicit new-enquiry restart',()=>{
 const p=chat(['Need display','Please call me']);assert.equal(p.state.stage,'human');assert.equal(p.state.fields.part,'display');
 assert.ok(p.actions.some(a=>a.type==='alert'));assert.ok(!p.actions.some(a=>a.type==='create_enquiry'));
 const followup=chat(['Please help urgently'],p.state);assert.equal(followup.state.stage,'human');
 const fresh=chat(['new','Need used laptop'],followup.state);assert.equal(fresh.state.kind,'buy');assert.equal(fresh.state.fields.part,undefined);
});
test('multiple independent products are handed to the team for separate pricing',()=>{
 const p=chat(['I need display and charger for HP laptop']);assert.equal(p.state.stage,'human');
 assert.ok(p.actions.some(a=>a.type==='alert'&&/separate/.test(a.text)));assert.ok(!p.actions.some(a=>a.type==='create_enquiry'));
});
test('existing order support requests a reference and never invents status',()=>{
 const p=chat(['Where is my order?','CCT-123, delivery update please']);assert.equal(p.state.stage,'waiting');
 assert.ok(p.actions.some(a=>a.type==='alert'&&/CCT-123/.test(a.text)));assert.match(answer(p),/team will check/);
 assert.ok(!p.actions.some(a=>a.type==='create_enquiry'));
});
test('older persisted service and parts sessions survive deployment',()=>{
 const old={stage:'collect',kind:'service',choice:5,slot:2,fields:{requirement:'CCTV installation',quantity:'8 cameras'}};
 const p=chat(['Yelahanka'],old);assert.equal(p.state.kind,'cctv');assert.equal(p.state.fields.area,'Yelahanka');
 const parts=chat(['HP ProBook 440 G3'],{stage:'collect',kind:'parts',slot:1,fields:{part:'display'}});
 assert.equal(parts.state.fields.model,'HP ProBook 440 G3');assert.match(answer(parts),/pieces or units/);
});
test('private details embedded in free-form service text stay out of vendor RFQs',()=>{
 const p=chat(['Laptop repair, budget 4000, contact me at 9876543210, email private@example.com','HP ProBook 440 G3','No power light','Started yesterday, no spill','Yelahanka','yes','Private Customer','+919876543210']);
 const enquiry=p.actions.find(a=>a.type==='create_enquiry');assert.ok(enquiry);
 assert.doesNotMatch(enquiry.requirements,/4000|9876543210|private@example|Private Customer/);
 assert.match(enquiry.requirements,/No power light/);
});
