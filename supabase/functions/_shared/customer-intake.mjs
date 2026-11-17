// Conservative, rule-based customer intake. Uncertain meaning goes to the team;
// neither photos nor prices are interpreted or invented here.
const customerIntro = 'This is Chandrashekar from CCTech IT Solutions.';
const legacySlots = {
 parts: ['part','model','quantity','budget'],
 buy: ['equipment','condition','configuration','purpose','budget','quantity'],
 service: ['requirement','quantity','area'],
};
const customerCategories = {
 parts:'Laptop / desktop / parts', accessory:'Peripherals / accessories',
 repair:'Repair / data recovery', recovery:'Repair / data recovery',
 network:'Networking', cctv:'CCTV / security', access:'Access control / biometric',
 power:'UPS / power backup', amc:'AMC / IT support',
 software:'Software / licensing', licence:'Software / licensing',
 project:'IT infrastructure / server room', buyback:'Buyback / e-waste',
 other:'Installation / onsite project',
};
const customerLabels = {
 part:'Part', model:'Device model', quantity:'Quantity', budget:'Budget', equipment:'Equipment',
 condition:'Condition preference', configuration:'Configuration', purpose:'Use / software',
 requirement:'Requirement / problem', symptom:'Symptoms', history:'When it started / recent changes',
 current_specs:'Current RAM / storage', accessory:'Accessory', preference:'Preference / compatibility',
 scope:'New setup / existing equipment', coverage:'Coverage / devices affected', area:'Service area',
 software:'Software / operating system', task:'Work required', data:'Files / backup requirements',
 load:'Equipment to support', backup:'Backup duration', duration:'Rental duration',
 details:'Additional details', warranty:'Warranty / condition details',
};
function customerNumber(text) {
 const words={one:1,two:2,three:3,four:4,five:5,ten:10};
 const clean=text.toLowerCase().trim();
 if(words[clean])return words[clean];
 const match=/^(\d{1,4})(?:\s*(?:pieces?|pcs?|units?|devices?|users?|laptops?|desktops?|cameras?))?$/i.exec(clean);
 return match && +match[1]>0 ? +match[1] : null;
}
function customerMoney(text, bare=false) {
 const match=/(?:₹\s*|\brs\.?\s*|\binr\s*|\bbudget(?:\s+is|\s+of)?\s*[:=-]?\s*|\bunder\s+|\bbelow\s+)(\d[\d,]*(?:\.\d+)?)\s*(k\b|thousand\b|lakh\b|lac\b)?/i.exec(text)
  || (bare ? /^\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakh|lac)?\s*$/i.exec(text) : null);
 if(!match)return undefined;
 const n=Number(match[1].replaceAll(',',''))*(/lakh|lac/i.test(match[2]||'')?100000:/k|thousand/i.test(match[2]||'')?1000:1);
 return Number.isFinite(n)&&n>0&&n<=100000000?n:undefined;
}
function customerIntent(text) {
 const t=text.toLowerCase();
 const number=/^\s*(\d{1,2})\s*$/.exec(t);
 if(number)return [null,'buy','parts','repair','network','cctv','power','amc','software','project','buyback','order','other'][+number[1]]||null;
 if(/order|quotation|quote status|enquiry status|refund|delivery status|where.*(?:parcel|delivery)/.test(t))return 'order';
 if(/recover|deleted|lost files|formatted|(?:disk|drive|hdd).*(?:not opening|not detect)/.test(t))return 'recovery';
 if(/sell my|sell (?:a |an )?(?:old |used )?(?:laptop|desktop)|buyback|trade.?in|exchange my|e-waste/.test(t))return 'buyback';
 if(/\bamc\b|maintenance contract/.test(t))return 'amc';
 if(/office setup|office.*relocat|server room|structured cabling/.test(t))return 'project';
 if(/biometric|access control/.test(t))return 'access';
 if(/cctv|camera|\bdvr\b|\bnvr\b/.test(t))return 'cctv';
 if(/wi-?fi|internet|router|network|cabling/.test(t))return 'network';
 if(/\bups\b|inverter|backup power/.test(t))return 'power';
 if(/licen[cs]e|subscription|antivirus|microsoft 365|ms office|office installation|windows|software|operating system/.test(t))return /licen[cs]e|subscription|renew|antivirus|microsoft 365|ms office/.test(t)&&!/install|error|not opening|not working|crash/.test(t)?'licence':'software';
 // Fault descriptions must precede the part-name check.
 if(/repair|broken|cracked|not working|won.t|doesn.t|not turn|not start|black screen|screen.*black|slow|overheat|no display|no power|not charging|blue screen|flicker|error|troubleshoot/.test(t)
  && !/\b(?:buy|purchase|replace|replacement)\b/.test(t))return 'repair';
 if(/raspberry|\bpi [345]\b/.test(t))return 'accessory';
 if(/\bmouse\b|monitor|printer|headset|webcam|usb hub|external keyboard|wireless keyboard/.test(t))return 'accessory';
 const equipment=t.search(/laptop|desktop|workstation|server|gaming pc|assembled pc/);
 const memory=t.search(/\bram\b|\bssd\b|\bhdd\b/);
 if(equipment>=0&&!/display|screen|keyboard|hinges?|charger|adapter|battery|panel|touchpad|cooling fan|upgrade/.test(t)&&(memory<0||equipment<memory))return 'buy';
 if(/display|screen|keyboard|hinges?|\bram\b|\bssd\b|\bhdd\b|charger|adapter|battery|panel|touchpad|cooling fan/.test(t))return 'parts';
 if(/laptop|desktop|computer|gaming pc|workstation|server|assembled pc/.test(t))return 'buy';
 return null;
}
function customerFlow(state) {
 const f=state.fields;
 const model=['model','What is the brand and full device model? If you do not know it, send a model-label photo or reply unknown.'];
 const count=['quantity','How many pieces or units do you need?'];
 const area=['area','Which area and PIN code is this required in?'];
 const budget=['budget','What is your budget in rupees? You can reply skip if it is not fixed.'];
 switch(state.kind) {
 case 'parts': return [['part','Which part do you need: display, keyboard, panel, hinges, RAM, SSD, charger or another part?'],model,
  ...(/ram|ssd|hdd/i.test(f.part||'')?[['current_specs','Do you know the current RAM/storage and the capacity you want? You can reply unknown.']]:[]),count,budget];
 case 'buy': return [['equipment','Do you need a laptop, desktop, workstation, server or another item?'],
  ...(!f.configuration?[['purpose','What will you mainly use it for, and which software will you use? You can also share a configuration if you already have one.']]:[]),
  ...(/autocad/i.test(f.purpose||'')&&!/\b[23]d\b/i.test(f.purpose||'')?[['details','Will AutoCAD mainly be used for 2D drawings or 3D work? Which other design software will you use?']]:[]),
  budget,['condition','Would you prefer new, used/refurbished, or either?'],count,
  ...(/rent|hire/i.test(f.requirement||'')?[['duration','How long do you need the rental for?']]:[])];
 case 'accessory': return [['accessory','Which accessory or Raspberry Pi product do you need?'],
  ['preference',/raspberry|\bpi [345]\b/i.test(f.accessory||'')?'Which model/RAM size do you need, and do you need a board only or a kit? If unsure, describe your project.':'Do you have a model or preference, such as wired/wireless, connection type or the device it must work with?'],count,budget];
 case 'repair': return [['requirement','What problem are you facing?'],model,
  ['symptom',/display|screen/i.test(f.requirement||'')?'Does the device turn on, with a power light or fan? Is the screen physically damaged or simply not showing an image?':'What happens when you try to use it? Please share any error message or a short description.'],
  ['history','When did this start? Was there any recent damage, liquid spill, update or repair?'],area];
 case 'recovery': return [['requirement','What happened to the files: deletion, formatting, damage, or a drive that is not detected?'],
  ['model','Which device or drive holds the files?'],['data','What files need recovery, and have you already tried anything to recover them?'],area];
 case 'software': return [['software','Which software or Windows version do you need help with?'],
  ['task','Is this a fresh installation, a reinstall, or a software error? Please share the error if there is one.'],model,
  ['data','Must existing files be preserved, and do you have a backup? Please also say whether you already have a valid licence.'],area];
 case 'licence': return [['software','Which software, licence or antivirus do you need?'],['task','Is this a new purchase or a renewal? Do you know the version or plan?'],
  ['quantity','How many devices or users need it?'],['details','Do you need help installing or activating it?'],budget];
 case 'network': return [['requirement','Is this a new network setup, poor coverage, or an internet/Wi-Fi problem?'],
  ['coverage','Is this at home or an office? How many devices or areas are affected?'],['details','What router or existing equipment do you have, and what happens when you connect? Reply unknown if unsure.'],area];
 case 'cctv': return [['scope','Is this a new CCTV installation, an addition to an existing system, or a repair?'],
  ['quantity','How many cameras or areas need coverage? An approximate number is fine.'],['coverage','Is coverage needed indoors, outdoors, or both? Please describe any existing system or fault.'],area];
 case 'access': return [['requirement','Do you need a new biometric/access-control system, or help with an existing one?'],
  ['quantity','How many doors or users should the system support?'],['details','What access method or existing equipment do you use? Reply unsure if you need a recommendation.'],area];
 case 'power': return [['requirement','Do you need a UPS, a battery replacement, or a repair?'],
  ['load','Which equipment should it support, and how many devices?'],['backup','Approximately how long do you need power backup?'],
  ['model','Do you have an existing UPS or battery model? Reply new setup if you do not.'],area];
 case 'amc': return [['quantity','Approximately how many computers need support?'],
  ['coverage','Should support also cover servers, networking, CCTV or UPS equipment?'],['requirement','What support or current problems should we cover? Do you prefer onsite, remote, or both?'],area];
 case 'project': return [['requirement','What are you planning: an office IT setup, relocation, server room or another installation?'],
  ['quantity','Approximately how many users/devices or sites are involved?'],['details','Which systems are included, and when would you like the work done?'],area];
 case 'buyback': return [model,['configuration','Please share the RAM, storage and processor, if known.'],
  ['condition','Is it working? Mention any faults and whether the charger is available. Photos can be reviewed by our team.'],
  ['budget','What selling price do you expect? Reply skip if unsure.'],area];
 default:return [['requirement','Please describe what you need or the problem you are facing.'],area];
 }
}
function customerExtract(state,text) {
 const f=state.fields, result={};
 const price=customerMoney(text);if(price!==undefined)result.budget=price;
 const qty=/\b(\d{1,4}|one|two|three|four|five|ten)\s+(?:(?:new|used|refurbished|dell|hp|lenovo|asus|acer|apple)\s+){0,4}(?:pieces?|pcs?|units?|laptops?|desktops?|cameras?|devices?|users?)\b/i.exec(text);
 if(qty)result.quantity=customerNumber(qty[1]);
 if(/(?:new\s*(?:or|\/)\s*used|either)/i.test(text))result.condition='Either';
 else if(/\brefurbished\b|\bused\b|\bsecond hand\b/i.test(text)&&state.kind==='buy')result.condition='Used / refurbished';
 else if(/\bnew\b/i.test(text)&&state.kind==='buy')result.condition='New';
 const equipment=/laptop|desktop|workstation|server|gaming pc|assembled pc/i.exec(text);
 if(equipment&&state.kind==='buy')result.equipment=equipment[0];
 const part=/display|screen|keyboard|panel|hinges?|\bram\b|\bssd\b|\bhdd\b|charger|adapter|battery|touchpad|cooling fan/i.exec(text);
 if(part&&state.kind==='parts')result.part=part[0];
 if(state.kind==='accessory') {
  const accessory=/raspberry\s*pi(?:\s*[345])?|mouse|monitor|printer|headset|webcam|usb hub|external keyboard|wireless keyboard/i.exec(text);
  if(accessory)result.accessory=accessory[0];
  if(/\b(?:wired|wireless|bluetooth|usb-c|usb)\b/i.test(text)&&!/raspberry/i.test(f.accessory||result.accessory||''))result.preference=text;
 }
 // A full model needs more than a brand or a family. Do not infer a model
 // from a capacity, budget, serial number or phone number.
 const model=/\b(?:HP|Dell|Lenovo|Asus|Acer|Apple|MSI|Samsung)\s+(?:(?:ProBook|EliteBook|Latitude|Inspiron|ThinkPad|IdeaPad|Pavilion|Vostro|VivoBook|MacBook|TUF)\s+)?[A-Za-z]{0,5}\d[A-Za-z0-9-]*(?:\s+(?:G\d|Gen\s*\d))?\b/i.exec(text);
 if(model&&state.kind!=='buy')result.model=model[0];
 if(state.kind==='buy') {
  if(/\b(?:i[3579][-\s]?\d*|ryzen\s*\d|xeon)\b/i.test(text)&&/\b(?:ram|ssd|hdd|\d+\s*gb)\b/i.test(text))result.configuration=text.split(/[,;\n]|\bbudget\b|₹|\brs\.?\s*\d/i)[0].trim();
  const purpose=/\b(?:for|use|using)\b.{0,12}\b(office work|stud(?:y|ies)|college|school|gaming|design|editing|autocad|tally|coding|programming|accounts)\b([^,;\n]*)/i.exec(text);
  if(purpose)result.purpose=(purpose[1]+purpose[2]).split(/\bbudget\b|₹|\brs\.?\s*\d|\bunder\s+\d|\bbelow\s+\d/i)[0].trim();
 }
 if(['software','licence'].includes(state.kind)) {
  const sw=/windows(?:\s*\d+(?:\s*pro|\s*home)?)?|microsoft 365|ms office|microsoft office|antivirus|tally|autocad/i.exec(text);
  if(sw)result.software=sw[0];
 }
 return result;
}
function customerVendorText(value,fields) {
 let text=String(value);
 // Free-form problem descriptions may contain private details even though
 // the structured budget/contact fields themselves are excluded.
 for(const key of ['customer_name','phone','address']) {
  const privateValue=fields[key];
  if(typeof privateValue==='string'&&privateValue.length>=3)text=text.split(privateValue).join('[private detail removed]');
 }
 text=text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email removed]')
  .replace(/(?:\+?\d[\s()-]*){8,15}/g,'[contact removed]')
  .replace(/\b(?:my name is|call me at|contact me at|delivery address(?: is)?)\b[^,;\n]*/gi,'[private detail removed]')
  .replace(/(?:₹\s*|\brs\.?\s*|\binr\s*|\bbudget(?:\s+is|\s+of)?\s*[:=-]?\s*|\bunder\s+|\bbelow\s+)(\d[\d,]*(?:\.\d+)?)\s*(?:k\b|thousand\b|lakh\b|lac\b)?/gi,'[customer budget removed]');
 return text;
}
function customerSummary(state) {
 return Object.entries(state.fields).filter(([k,v])=>v!==null && !['customer_name','phone','address','fulfilment'].includes(k))
  .map(([k,v])=>`${customerLabels[k]||k}: ${v}`).join('\n');
}
export function planCustomer(context,state,welcome) {
 const {message}=context;const text=(message.message_text||'').trim().slice(0,2000);
 state.fields ||= {};
 if(state.kind==='service'&&!state.intake_version) {
  if(state.stage==='collect')state.slot_key=legacySlots.service[state.slot];
  state.kind=({3:'repair',4:'network',5:'cctv',6:'power',7:'amc',8:'software',9:'project',10:'buyback',12:'other'})[state.choice]||'other';
  state.intake_version=2;
 }
 const actions=[];const reply=text=>actions.push({type:'reply',text});const alert=text=>actions.push({type:'alert',text});
 const done=()=>({state,actions});
 if(/\b(?:human|real person|speak to|talk to|call me|chandrashekar|complaint|unhappy)\b/i.test(text)||/^(?:staff|agent|manager)$/i.test(text)) {
  state.stage='human';state.fields.follow_up=text;alert(`Customer requests team assistance: ${text}`);
  reply('I have notified Chandrashekar and the team. Please leave your question here; the team will respond when available.');return done();
 }
 if(/^(?:new enquiry|new order|new requirement|start again|restart|menu)$/i.test(text)||(/^new$/i.test(text)&&['waiting','human'].includes(state.stage))) {
  state={stage:'menu',fields:{},intake_version:2};reply(welcome);return done();
 }
 if(state.stage==='human') {alert(`Customer follow-up for the team: ${text||'Attachment received'}`);reply('Your message has been shared with the team. Reply new whenever you want to start a separate enquiry.');return done();}
 if(message.message_type==='attachment'||message.message_type==='image') {
  state.fields.photo_received=true;state.needs_review=true;alert('Customer attachment received. Team must review the model, condition or error; the assistant has not interpreted the image.');
  if(state.stage==='collect'&&(state.slot_key==='model'||legacySlots[state.kind]?.[state.slot]==='model'))state.fields.model='Photo supplied — team verification required';
  reply('Thank you. The team can review your photo or attachment. I cannot read its details automatically. Please type the model/error if you can, or reply unknown.');
  return done();
 }
 if(!text){reply('Please type your requirement, or ask for the team if you need help.');return done();}
 if(state.stage==='order_reference') {
  state.fields.order_reference=text;state.stage='waiting';alert(`Existing order needs assistance. Customer supplied: ${text}`);
  reply('Thank you. The team will check your order and confirm the status.');return done();
 }
 if(state.stage==='waiting') {
  if(/\b(?:paid|payment sent|transferred)\b/i.test(text)) {reply('Thank you. Chandrashekar will verify the payment and confirm.');alert('Customer reports a payment. Owner must verify funds in bank/UPI records.');}
  else {reply('Your enquiry is with CCTech. The team will check your message and update you. For a separate requirement, reply new.');alert(`Customer follow-up on existing enquiry: ${text}`);}
  return done();
 }
 const isStart=state.stage==='start'||state.stage==='menu';
 if(isStart) {
  const kind=customerIntent(text);
  if(!kind){state.stage='menu';reply(welcome);return done();}
  if(kind==='order'){state.stage='order_reference';reply('Please share your order/enquiry reference and what help you need. If you do not have a reference, send the name used for the order.');return done();}
  state.kind=kind;state.intake_version=2;state.stage='collect';state.fields={};
  const requestedItems=[...text.matchAll(/display|keyboard|charger|mouse|printer|monitor|\bssd\b|\bram\b/gi)].map(m=>m[0].toLowerCase());
  if(/\band\b|\balso\b|\+/.test(text)&&new Set(requestedItems).size>1&&!/\b(?:configuration|config|i[3579]|ryzen)\b/i.test(text)) {
   state.stage='human';state.fields.requirement=text;
   alert(`Multiple customer items need separate requirements and pricing: ${text}`);
   reply(customerIntro+'\nI have shared your multiple-item requirement with the team so each item can be checked and quoted separately. Please send the device models and quantities here.');return done();
  }
  if(!/^\d+$/.test(text)&&!['buy','parts','accessory','software','licence'].includes(kind))state.fields.requirement=text;
  if(kind==='buy'&&/rent|hire/i.test(text))state.fields.requirement=text;
  Object.assign(state.fields,customerExtract(state,text));
 } else if(state.stage==='collect') {
  // Existing conversations retain their active question after a deployment.
  if(!state.intake_version) {
   state.slot_key=legacySlots[state.kind]?.[state.slot];state.intake_version=2;
   if(state.kind==='service')state.kind=({3:'repair',4:'network',5:'cctv',6:'power',7:'amc',8:'software',9:'project',10:'buyback',12:'other'})[state.choice]||'other';
  }
  if(/^(?:hi|hello|hey|thanks|thank you)$/i.test(text)){reply(customerFlow(state).find(([key])=>key===state.slot_key)?.[1]||'Please send the requested details, or reply unknown.');return done();}
  const key=state.slot_key||customerFlow(state)[state.slot]?.[0];
  const extracted=customerExtract(state,text);
  const correction=/\b(?:actually|change|correct|instead|make it|budget|quantity)\b/i.test(text)&&Object.keys(extracted).length>0;
  Object.assign(state.fields,extracted);
  if(!correction||key in extracted) {
   if(key==='quantity'&&['parts','buy','accessory','licence'].includes(state.kind)) {
    const n=extracted.quantity||customerNumber(text);if(!n){reply('Please enter the number of pieces, units or users, for example 1 or 2.');return done();}state.fields.quantity=n;
   } else if(key==='budget') {
    const price=customerMoney(text,true);
    if(/^(?:skip|not fixed|unknown|not sure|no budget)$/i.test(text))state.fields.budget=null;
    else if(price!==undefined)state.fields.budget=price;
    else {reply('Please enter your budget in rupees, such as 20000 or 20k, or reply skip.');return done();}
   } else if(key&&!(key in extracted)) {
    if(key==='model'&&!/\d/.test(text)&&!/unknown|not sure|photo|don.t know/i.test(text)){reply('Please share the full model, not only the brand. You can send a model-label photo or reply unknown.');return done();}
    if(key==='condition'&&state.kind==='buy'&&!/new|used|refurb|either|unknown|not sure/i.test(text)){reply('Would you prefer new, used/refurbished, or either? You can also reply not sure.');return done();}
    state.fields[key]=text;
   }
  }
 } else if(state.stage==='confirm') {
  if(!/^(?:yes|ok|okay|correct|confirm)$/i.test(text)) {
   const changes=customerExtract(state,text);
   if(Object.keys(changes).length){Object.assign(state.fields,changes);reply(`Updated details:\n${customerSummary(state)}\nIs this correct? Reply yes, or reply edit to correct another detail.`);return done();}
   state.stage='edit';reply('Which detail should we change? For example: model, quantity, budget or requirement.');return done();
  }
  if(!['parts','buy','accessory'].includes(state.kind)){state.fields.fulfilment='service_review';state.stage='name';reply('What name should we use for this enquiry?');return done();}
  state.stage='fulfilment';reply(state.kind==='parts'?'Would you prefer delivery, collection, or fitting at the CCTech store? Reply delivery, collect or store.':'Would you prefer delivery or collection from the CCTech store? Reply delivery or collect.');return done();
 } else if(state.stage==='edit') {
  const key=Object.keys(customerLabels).find(key=>text.toLowerCase().includes(key)||text.toLowerCase()===customerLabels[key].toLowerCase());
  if(!key||!customerFlow(state).some(([k])=>k===key)){reply('Please name a detail from your summary, such as model, quantity, budget or requirement. Reply new to start a separate enquiry.');return done();}
  delete state.fields[key];state.stage='collect';state.slot_key=key;state.slot=customerFlow(state).findIndex(([k])=>k===key);
  reply(customerFlow(state)[state.slot][1]);return done();
 } else if(state.stage==='fulfilment') {
  if(!/delivery|store|collect/i.test(text)){reply('Please reply delivery, collect, or store for part fitting.');return done();}
  state.fields.fulfilment=/delivery/i.test(text)?'delivery':state.kind==='parts'&&!/collect/i.test(text)?'store_fitting':'store_collection';
  if(state.fields.fulfilment==='delivery'){state.stage='address';reply('Which delivery area and PIN code? You can share the full address after accepting the quotation. You pay the courier directly.');return done();}
  state.stage='name';reply('What name should we use for this enquiry?');return done();
 } else if(state.stage==='address') {
  if(text.length<3){reply('Please send the delivery area and PIN code.');return done();}
  state.fields.area=text;state.stage='name';reply('What name should we use for this enquiry?');return done();
 } else if(state.stage==='name'||state.stage==='phone') {
  if(state.stage==='name') {
   state.fields.customer_name=text.slice(0,200);
   if(message.channel&&message.channel!=='whatsapp'&&!('phone' in state.fields)){state.stage='phone';reply('Please share your phone number with country code, or reply skip.');return done();}
   if(message.channel==='whatsapp')state.fields.phone=message.sender_id;
  } else {
   if(!/^skip$/i.test(text)&&!/^\+?\d{8,15}$/.test(text.replace(/[\s()-]/g,''))){reply('Please enter your phone number with country code, or reply skip.');return done();}
   state.fields.phone=/^skip$/i.test(text)?null:text.replace(/[+\s()-]/g,'');
  }
  const f=state.fields;state.stage='waiting';
  const product=['parts','buy','accessory'].includes(state.kind);
  const category=state.kind==='buy'?(/server|workstation/i.test(f.equipment||'')?'Servers / storage':/used|refurb|second hand/i.test(f.condition||'')?'Used / refurbished equipment':'Laptop / desktop / parts'):customerCategories[state.kind];
  // Only reviewed requirement fields go into vendor RFQs. Customer identity,
  // delivery location, budget, contact, and chat transcript remain internal.
  const excluded=['customer_name','budget','fulfilment','address','phone','photo_received','follow_up','order_reference'];
  if(product)excluded.push('area');
  const requirements=Object.entries(f).filter(([key,value])=>!excluded.includes(key)&&value!==null)
   .map(([key,value])=>`${customerLabels[key]||key}: ${customerVendorText(value,f)}`).join('\n');
  actions.push({type:'create_enquiry',category,requirements,customer_name:f.customer_name,
   pricing_mode:state.kind==='amc'?'amc_on_call':!product?'installation_project':state.kind==='buy'||state.kind==='accessory'?'complete_equipment':f.fulfilment==='store_fitting'?'parts_plus_replacement':'parts_only',
   budget:f.budget??null,fulfilment:f.fulfilment,fields:f});
  if(product)reply('Thank you. We will check suitable options, availability and warranty. Your quotation will be sent after approval by Chandrashekar or the team.');
  else if(state.kind==='buyback')reply('Thank you. The team will review your equipment. The final buyback value depends on inspection.');
  else reply('Thank you. Your service request is with the CCTech team. We will review the problem and confirm the next step and any charges before proceeding.');
  if(state.needs_review||Object.values(f).some(v=>typeof v==='string'&&/unknown|not sure|unsure|verification required/i.test(v)))alert('Customer details need team review before choosing a part, configuration or service.');
  if(f.fulfilment==='store_fitting'&&Number(f.quantity)>1)alert('Multiple-item fitting: team must set the fitting price.');
  if(state.kind==='buy'&&!f.configuration)alert('Customer needs a suitable configuration based on purpose/software and budget. Team must review options.');
  return done();
 }
 if(state.stage==='collect') {
  const flow=customerFlow(state);const next=flow.findIndex(([key])=>!(key in state.fields));
  if(next>=0){state.slot=next;state.slot_key=flow[next][0];reply((isStart?customerIntro+'\n':'')+flow[next][1]);}
  else {state.stage='confirm';reply(`Please confirm your requirement:\n${customerSummary(state)}\nIs this correct? Reply yes, or tell us what to change.`);}
 }
 return done();
}
