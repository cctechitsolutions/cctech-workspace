// Deterministic intake: no paid AI API, no guessing vendor prices or treating a
// customer's payment claim as verified funds. Unclear cases go to the team.
import { planCustomer } from './customer-intake.mjs';
const intro = 'This is Chandrashekar from CCTech IT Solutions.';
export const welcome = `${intro}\nHow can we help?\n1. Buy computers / servers\n2. Parts / accessories\n3. Repairs / support\n4. Networking / Wi-Fi\n5. CCTV / security\n6. UPS / batteries\n7. AMC / business IT support\n8. Software / licences\n9. Office IT setup / relocation\n10. Sell / exchange equipment\n11. Existing enquiry / order\n12. Other\nReply with the number or describe your requirement.`;
export function parseVendorReply(text, equipment = false) {
 const labelled=[...text.matchAll(/(?:₹|rs\.?\s*|price\s*[:=-]?\s*)([\d,]+(?:\.\d{1,2})?)/gi)].map(m=>Number(m[1].replaceAll(',','')));
 const plain=/^\s*(\d+(?:\.\d{1,2})?)\s*$/.exec(text);
 const prices=[...new Set(labelled.length ? labelled : plain ? [+plain[1]] : [])];
 const types=equipment===true?[[/\brefurbished\b/i,'Refurbished'],[/\bused\b/i,'Used'],[/\bnew\b/i,'New']]:[[/\boem(?:\s+original)?\b/i,'OEM Original'],[/second\s+copy/i,'Second Copy'],[/\bcompatible\b/i,'Compatible']];
 const found=types.filter(([pattern])=>pattern.test(text)).map(([,label])=>label);
 const quality=equipment==='service'?'Service':found.length===1?found[0]:null;
 const warranty=/\bno warranty\b/i.test(text)?'No warranty':(/warranty\s*[:=-]?\s*(\d+\s*(?:days?|months?|years?))(?:\s+(?:replacement|service|manufacturer))?/i.exec(text)?.[1] || /(\d+\s*(?:days?|months?|years?))\s+(?:(?:replacement|service|manufacturer)\s+)?warranty/i.exec(text)?.[1] || /^\s*(\d+\s*(?:days?|months?|years?))\s*$/i.exec(text)?.[1] || null);
 const gst=/gst\s*(?:included|inclusive)|including\s+gst/i.test(text)?'GST included':/gst\s*(?:excluded|extra)|excluding\s+gst/i.test(text)?'GST excluded':null;
 const available=/\b(in stock|available|ready stock)\b/i.test(text)&&!/\b(not available|out of stock)\b/i.test(text);
 const alternativePrice=/\b(?:or)\s*(?:₹|rs\.?\s*)?\d{3,}/i.test(text);
 return { price:!alternativePrice&&prices.length===1&&Number.isFinite(prices[0])&&prices[0]>=0?prices[0]:null, price_ambiguous:alternativePrice||prices.length>1, quality, warranty:warranty?.trim()||null, gst, available };
}
export function planConversation(context) {
 const { message, actor_role:role, requests=[] }=context;
 const text=(message.message_text || '').trim();
 const state=structuredClone(context.session?.state || { stage:'start', fields:{} });
 const actions=[]; const reply=value=>actions.push({type:'reply',text:value}); const alert=value=>actions.push({type:'alert',text:value});
 if(role==='owner'||role==='staff') { reply('Please open the CCTech workspace to approve quotations or verify payments securely.'); return {state,actions}; }
 if(role==='vendor') {
  const exact=message.reply_to_message_id ? requests.filter(r=>r.provider_message_id===message.reply_to_message_id || r.reply_ids?.includes(message.reply_to_message_id)) : [];
  const candidates=exact.length ? exact : requests.filter(r=>r.status==='sent');
  if(candidates.length!==1) {reply('Please reply to the original part enquiry message so we can match your price correctly.');alert('Vendor reply could not be matched to one enquiry.');return {state,actions};}
  const mode=candidates[0].pricing_mode;
  const parsed=parseVendorReply(text, mode==='complete_equipment'?true:['installation_project','amc_on_call'].includes(mode)?'service':false);
  state.vendor_offers ||= {};
  const requestId=candidates[0].id;const previous=state.vendor_offers[requestId]||{};
  const explicitPrice=/(?:price|₹|\brs\b)/i.test(text);
  const offer={price:parsed.price_ambiguous?null:parsed.price!==null?(previous.price==null||explicitPrice||parsed.price===previous.price?parsed.price:null):explicitPrice?null:previous.price??null,
   quality:parsed.quality || (/oem|original|second\s*copy|compatible|\bnew\b|\bused\b|refurbished/i.test(text)?null:previous.quality??null),
   warranty:parsed.warranty || (/warranty/i.test(text)?null:previous.warranty??null),
   gst:parsed.gst || (/gst/i.test(text)?null:previous.gst??null),
   available:/not available|out of stock/i.test(text)?false:parsed.available||previous.available||false};
  const raw=[previous.raw_reply,text].filter(Boolean).join('\n').slice(-10000);
  state.vendor_offers[requestId]={...offer,raw_reply:raw};
  const keys=Object.keys(state.vendor_offers);for(const key of keys.slice(0,Math.max(0,keys.length-20)))delete state.vendor_offers[key];
  actions.push({type:'vendor_offer',request_id:requestId,...offer,raw_reply:raw});
  const missing=[];if(offer.price===null)missing.push('your price for the requested item');if(!offer.quality)missing.push(candidates[0].pricing_mode==='complete_equipment'?'whether it is new, used or refurbished':'whether it is OEM Original, Second Copy or Compatible');if(!offer.warranty)missing.push('the warranty');if(!offer.gst)missing.push('whether GST is included or extra');if(!offer.available)missing.push('whether it is available');
  if(missing.length) {reply(`Please confirm ${missing.join(', ')}.`);alert('Vendor reply is incomplete or unclear. Clarification requested; team can review the enquiry.');}
  else {reply('Thank you. We received your price and details.');alert('Vendor offer received. Review compatibility and approve the customer quotation.');}
  return {state,actions};
 }
 return planCustomer(context,state,welcome);
}
