-- First create chandra15031993@gmail.com in Supabase Authentication > Users.
-- This creates no password, changes no owner account, and sends no email.
insert into public.profiles(user_id,role,display_name,notification_phone)
select id,'staff','CCTech staff','916364253615' from auth.users where lower(email)='chandra15031993@gmail.com'
on conflict(user_id) do update set display_name=excluded.display_name,notification_phone=excluded.notification_phone
returning user_id,role,display_name;
