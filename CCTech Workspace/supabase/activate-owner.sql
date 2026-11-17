-- Run in the Supabase SQL Editor after creating this Auth user.
-- Activates the owner's account using the current application's staff role.
-- This does not create an Auth user or change any password.
do $$
begin
  if not exists (
    select 1 from auth.users
    where lower(email) = 'cctechitsolutions@gmail.com'
  ) then
    raise exception 'Create cctechitsolutions@gmail.com in Authentication > Users first.';
  end if;
end;
$$;

insert into public.profiles (user_id, role, display_name)
select id, 'staff', 'CCTech owner'
from auth.users
where lower(email) = 'cctechitsolutions@gmail.com'
on conflict (user_id) do update
set role = excluded.role, display_name = excluded.display_name
returning user_id, role, display_name;
