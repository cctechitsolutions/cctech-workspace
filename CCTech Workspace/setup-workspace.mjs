const button=document.getElementById('copyUpgrade');
const status=document.getElementById('setupStatus');
const sql=document.getElementById('upgradeSql');
button.addEventListener('click',async()=>{
 button.disabled=true;
 try {
  if(!sql.value){const response=await fetch('./supabase/upgrade-workspace.sql',{cache:'no-store'});if(!response.ok)throw new Error('Could not load the SQL file.');sql.value=await response.text();}
  sql.closest('details').open=true;
  try {await navigator.clipboard.writeText(sql.value);button.textContent='SQL copied — paste in Supabase';status.textContent='Copied successfully. Open Supabase SQL Editor, click inside a new query and press Ctrl+V. Review it before clicking Run once.';}
  catch {sql.closest('details').open=true;sql.focus();sql.select();status.textContent='SQL selected. Press Ctrl+C, then paste it into a new Supabase query and run it once.';}
 }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
});
