import { planConversation, welcome } from './conversation-engine.mjs';

// Staff-assisted intake uses the same pure engine as the signed webhook worker.
// It never sends messages or writes records without the existing enquiry form.
export function createGuidedIntake(panel, navigate) {
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const card=make('section',null,'card');
 card.append(make('h2','Guided customer intake'),make('p','Use this with a real customer on a call or in a chat. Paste each customer reply below. The app asks the next question and prepares an enquiry for your review. Messages are not sent from this screen.','small'));
 const sourceLabel=make('label','Customer channel');const source=make('select');for(const [value,label]of [['whatsapp','WhatsApp'],['facebook','Facebook Messenger'],['instagram','Instagram'],['phone','Phone / walk-in']]){const o=make('option',label);o.value=value;source.append(o);}sourceLabel.append(source);
 const contactLabel=make('label','Customer phone / contact');const contact=make('input');contact.type='text';contact.maxLength=200;contact.placeholder='Phone with country code, or contact reference';contactLabel.append(contact);
 const transcript=make('div',null,'intake-transcript');transcript.setAttribute('role','log');transcript.setAttribute('aria-label','Customer intake conversation');
 const form=make('form');const label=make('label','Customer reply');const input=make('textarea');input.rows=3;input.maxLength=2000;input.required=true;label.append(input);const submit=make('button','Continue intake');submit.type='submit';form.append(label,submit);
 const copy=make('button','Copy latest question','secondary');copy.type='button';const restart=make('button','Start a new intake','secondary');restart.type='button';const review=make('button','Review & save this enquiry');review.type='button';review.hidden=true;const status=make('p',null,'small');status.setAttribute('role','status');
 card.append(sourceLabel,contactLabel,transcript,copy,form,review,restart,status);panel.append(card);
 let state=null, pending=null, latest=welcome;
 function bubble(text,kind){const item=make('div',null,'intake-message '+kind);item.append(make('small',kind==='customer'?'Customer':'CCTech'),make('p',text));transcript.append(item);item.scrollIntoView?.({block:'nearest'});}
 function reset(){state=null;pending=null;latest=welcome;source.disabled=false;contact.disabled=false;review.hidden=true;form.hidden=false;transcript.replaceChildren();input.value='';status.textContent='';bubble(welcome,'assistant');}
 function clear(){reset();contact.value='';source.value='whatsapp';}
 restart.addEventListener('click',clear);
 form.addEventListener('submit',event=>{event.preventDefault();const text=input.value.trim();if(!text)return;
  if(source.value==='whatsapp'&&!/^\+?[1-9]\d{7,14}$/.test(contact.value.replace(/\s/g,''))){status.textContent='Enter the customer phone number with country code before starting WhatsApp intake.';contact.focus();return;}
  const context={actor_role:'customer',message:{message_text:text,channel:source.value==='phone'?'facebook':source.value,sender_id:contact.value.replace(/[+\s]/g,'')},session:state?{state}:null,requests:[]};
  const result=planConversation(context);state=result.state;source.disabled=true;contact.disabled=true;bubble(text,'customer');input.value='';
  for(const action of result.actions){if(action.type==='reply'){latest=action.text;bubble(action.text,'assistant');}if(action.type==='create_enquiry'){pending=action;review.hidden=false;form.hidden=true;}if(action.type==='alert')status.textContent=action.text;}
 });
 copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(latest);status.textContent='Copied. Review and send in your customer chat.';}catch{input.value=latest;input.focus();input.select();status.textContent='Question selected below. Press Ctrl+C to copy; clear it before entering the customer reply.';}});
 review.addEventListener('click',()=>{if(!pending)return;const target=document.getElementById('enquiryForm');const set=(name,value)=>{const control=target.elements.namedItem(name);if(control)control.value=value??'';};
  // Ask before replacing an unsaved enquiry, and leave the draft intact if declined.
  if((target.elements.customer_name.value||target.elements.requirements.value)&&!window.confirm('Replace the unsaved enquiry form with this intake?'))return;
  set('customer_name',pending.customer_name);set('customer_contact',pending.fields.phone||contact.value);set('category',pending.category);set('pricing_mode',pending.pricing_mode);set('source_channel',source.value);
  const notes=[pending.requirements,pending.budget?`Customer budget (internal): ₹${pending.budget}`:'',pending.fulfilment?`Customer choice: ${pending.fulfilment}`:'',pending.fields.address?`Delivery address (internal): ${pending.fields.address}`:''].filter(Boolean).join('\n');set('requirements',notes);
  navigate('enquiries');document.getElementById('message').textContent='Intake prepared. Review the customer enquiry and click Save enquiry. No message has been sent.';target.elements.customer_name.focus();review.disabled=true;review.textContent='Prepared in enquiry form';
 });
 new MutationObserver(()=>{if(document.getElementById('workspace').hidden){clear();review.disabled=false;review.textContent='Review & save this enquiry';}}).observe(document.getElementById('workspace'),{attributes:true,attributeFilter:['hidden']});
 restart.addEventListener('click',()=>{review.disabled=false;review.textContent='Review & save this enquiry';});reset();
}
