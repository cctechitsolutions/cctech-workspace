import { createGuidedIntake } from './guided-intake.mjs';
const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const n=document.createElement(tag); if(text)n.textContent=text; if(cls)n.className=cls; return n; };
const icons={overview:'◈',intake:'✦',inbox:'◫',enquiries:'▤',vendors:'◇',sourcing:'⇄',quotes:'▧',orders:'▣',connections:'⌘',settings:'⚙'};
const views={overview:['Overview','Your business, at a glance.'],inbox:['Channel inbox','Customer conversations across your connected channels.'],enquiries:['Customer enquiries','Capture requirements. Keep every opportunity in view.'],vendors:['Vendor network','Your suppliers and service partners, in one place.'],sourcing:['Vendor price requests','Find the right partner and prepare a clear request.'],quotes:['Quotations','Compare offers, set your margin and prepare an approved price.'],orders:['Orders & payments','Track fulfilment, verify payments and close orders.'],connections:['Connections & alerts','Manage channel connections and review queued messages.'],settings:['Business settings','Payment instructions, completion links and customer reviews.']};
const workspace=$('workspace');
views.intake=['Guided intake','Turn a real customer conversation into a clear enquiry.'];
document.body.classList.add('dashboard-app','signed-out');
const sidebar=el('aside',null,'app-sidebar');
const brand=el('div',null,'app-brand');brand.append(el('span','CC','brand-mark'),el('div','CCTech','brand-name'));brand.lastChild.append(el('small','BUSINESS WORKSPACE'));sidebar.append(brand,el('p','WORKSPACE','nav-label'));
const nav=el('nav');nav.setAttribute('aria-label','Workspace navigation');sidebar.append(nav);
for(const [key,[name]] of Object.entries(views)){const b=el('button',null,'nav-item');b.dataset.route=key;b.append(el('span',icons[key],'nav-icon'),el('span',name));b.addEventListener('click',()=>navigate(key));nav.append(b);}
const footer=el('div',null,'sidebar-footer');footer.append(el('span','C','team-avatar'),el('div','CCTech IT Solutions'));footer.lastChild.append(el('small','Owner & staff workspace'));sidebar.append(footer);document.body.prepend(sidebar);
const header=document.querySelector('body > header');header.replaceChildren();const headLeft=el('div');headLeft.append(el('span','WORKSPACE / OVERVIEW','eyebrow'),el('h1','Overview'));const today=el('div',new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date()),'header-date');header.append(headLeft,today);
const main=document.querySelector('main');const toolbar=workspace.querySelector('.toolbar');toolbar.classList.add('account-toolbar');
const pageIntro=el('p',views.overview[1],'page-intro');workspace.insertBefore(pageIntro,toolbar.nextSibling);
const panels=new Map();
function panel(key){const p=el('div',null,'view-panel');p.dataset.view=key;workspace.append(p);panels.set(key,p);return p;}
for(const key of Object.keys(views))panel(key);
createGuidedIntake(panels.get('intake'),navigate);
function containing(id){return $(id).closest('.card');}
panels.get('inbox').append(containing('whatsappInbox'));
panels.get('enquiries').append(containing('enquiryForm'),containing('enquiryList'));
panels.get('vendors').append(containing('supplierForm'),containing('supplierList'));
panels.get('sourcing').append($('sourcingPanel'));
const workflow=$('orderWorkflow');
panels.get('quotes').append(workflow);
// Preserve existing forms and IDs so all pricing, approval and payment handlers stay attached.
function moveRange(start, end, destination){let n=start;while(n&&n!==end){const next=n.nextSibling;destination.append(n);n=next;}}
const orderHeading=$('orderList').previousElementSibling;
const queueHeading=$('notificationList').previousElementSibling;
const settings=$('workflowSettingsForm').closest('details');
const alertHeading=$('teamAlerts').previousElementSibling;
const orderCard=el('section',null,'card');panels.get('orders').append(orderCard);moveRange(orderHeading,queueHeading,orderCard);
const settingsCard=el('section',null,'card');settingsCard.append(el('h2','Payment & review settings'),settings);settings.open=true;panels.get('settings').append(settingsCard);
const connectionsCard=el('section',null,'card');panels.get('connections').append(connectionsCard);moveRange(queueHeading,alertHeading,connectionsCard);moveRange(alertHeading,null,connectionsCard);
const groupSetup=el('a','Enable vendor group fields →');groupSetup.href='group-setup.html';panels.get('vendors').prepend(groupSetup);
const viewTools=el('div',null,'view-tools');const search=el('input');search.type='search';search.placeholder='Search customer, reference, vendor or requirement…';search.setAttribute('aria-label','Search displayed records');viewTools.append(search);pageIntro.after(viewTools);
let active='overview';let data={enquiries:[],suppliers:[],orders:[],alerts:[],channels:[],outbox:[]};
function filter(){const term=search.value.trim().toLowerCase();const p=panels.get(active);for(const r of p.querySelectorAll('.record'))r.hidden=!!term&&!r.textContent.toLowerCase().includes(term);}
search.addEventListener('input',filter);
function navigate(key){if(!views[key])key='overview';active=key;for(const [name,p]of panels)p.hidden=name!==key;for(const b of nav.children){const selected=b.dataset.route===key;b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}header.querySelector('h1').textContent=views[key][0];header.querySelector('.eyebrow').textContent='WORKSPACE / '+views[key][0].toUpperCase();pageIntro.textContent=views[key][1];viewTools.hidden=!['enquiries','vendors','orders','inbox'].includes(key);search.value='';filter();history.replaceState(null,'','#'+key);window.scrollTo({top:0,behavior:'instant'});}
function action(label,route,cls='secondary'){const b=el('button',label,cls);b.addEventListener('click',()=>navigate(route));return b;}
function metric(label,value,caption,route){const c=el('button',null,'metric');c.append(el('span',label,'metric-label'),el('strong',String(value)),el('small',caption));c.addEventListener('click',()=>navigate(route));return c;}
function overview(){const p=panels.get('overview');p.replaceChildren();const hero=el('section',null,'overview-hero');const text=el('div');text.append(el('span','YOUR OPERATIONS, CONNECTED','hero-kicker'),el('h2','A clearer view of every order.'),el('p','From the first customer enquiry to the final handover.'));const actions=el('div',null,'hero-actions');actions.append(action('+ New enquiry','enquiries','primary'),action('View orders →','orders'));hero.append(text,actions);p.append(hero);
const metrics=el('div',null,'metrics-grid');metrics.append(metric('Customer enquiries',data.enquiries.length,'Latest loaded records','enquiries'),metric('Active vendors',data.suppliers.filter(x=>x.active).length,'In your supplier network','vendors'),metric('Open orders',data.orders.filter(x=>!['completed','cancelled'].includes(x.status)).length,'Awaiting fulfilment','orders'),metric('Needs approval',data.orders.filter(x=>x.quote_status==='pending').length,'Quotations for your review','orders'));p.append(metrics);
const grid=el('div',null,'overview-grid');const recent=el('section',null,'card');const top=el('div',null,'section-heading');top.append(el('h2','Recent enquiries'),action('View all →','enquiries'));recent.append(top);if(!data.enquiries.length)recent.append(el('p','No enquiries loaded yet. Create your first enquiry to start sourcing.','empty-state'));
for(const row of data.enquiries.slice(0,5)){const r=el('button',null,'overview-row');const left=el('div');left.append(el('strong',row.customer_name),el('small',row.requirements));r.append(el('span',(row.customer_name||'C').slice(0,1).toUpperCase(),'row-avatar'),left,el('span',(row.status||'new').replaceAll('_',' '),'status-pill'));r.addEventListener('click',()=>navigate('enquiries'));recent.append(r);}grid.append(recent);
const next=el('section',null,'card');next.append(el('h2','Your daily workflow'));for(const [i,title,detail,route]of [['01','Capture a requirement','Customer, item and exact specifications','enquiries'],['02','Find the best offer','Request prices and confirm vendor details','sourcing'],['03','Approve & fulfil','Review quotation, payment and handover','orders']]){const r=el('button',null,'workflow-step');const copy=el('div');copy.append(el('strong',title),el('small',detail));r.append(el('span',i),copy,el('span','↗'));r.addEventListener('click',()=>navigate(route));next.append(r);}grid.append(next);p.append(grid);
const status=el('section',null,'card channel-overview');const connected=data.channels.filter(c=>c.enabled&&c.connected_at).length;status.append(el('div',null,'connection-dot'),el('div',`${connected} of 3 channels activated`));status.lastChild.append(el('small','Manual sourcing is available. Automatic messaging requires authorised connections.'));status.append(action('Manage connections →','connections'));p.append(status);}
document.addEventListener('workspace:records',e=>{Object.assign(data,e.detail);overview();});document.addEventListener('workspace:orders',e=>{Object.assign(data,e.detail);overview();});
const syncAuth=()=>{const locked=workspace.hidden;document.body.classList.toggle('signed-out',locked);if(locked){data={enquiries:[],suppliers:[],orders:[],alerts:[],channels:[],outbox:[]};overview();}};new MutationObserver(syncAuth).observe(workspace,{attributes:true,attributeFilter:['hidden']});syncAuth();overview();navigate(location.hash.slice(1));
