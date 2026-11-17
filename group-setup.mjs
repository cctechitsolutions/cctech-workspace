document.getElementById('copyGroupSql').addEventListener('click',async()=>{
 const sql=document.getElementById('groupSql');const status=document.getElementById('copyStatus');
 try{await navigator.clipboard.writeText(sql.value);status.textContent='Copied. Paste into a new Supabase query, review and click Run.';}
 catch{sql.focus();sql.select();status.textContent='SQL selected. Press Ctrl+C to copy, then paste into a new Supabase query.';}
});
