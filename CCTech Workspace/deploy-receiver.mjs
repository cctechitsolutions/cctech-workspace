document.getElementById('copyGroupSql').addEventListener('click',async()=>{
 const code=document.getElementById('groupSql');const status=document.getElementById('copyStatus');
 try{await navigator.clipboard.writeText(code.value);status.textContent='Function code copied. Replace all code in the matching Supabase function’s index.ts and deploy.';}
 catch{code.focus();code.select();status.textContent='Code selected. Press Ctrl+C, then replace all code in Supabase index.ts.';}
});
