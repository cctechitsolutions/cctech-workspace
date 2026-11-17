-- Run this small upgrade once on the existing project. No messages are sent.
begin;
alter table public.suppliers add column if not exists whatsapp_group_name text
  check (whatsapp_group_name is null or char_length(whatsapp_group_name) between 1 and 200);
alter table public.supplier_requests add column if not exists manual_delivery_method text
  check (manual_delivery_method is null or manual_delivery_method in ('individual','group'));
alter table public.supplier_requests add column if not exists manual_group_name text;
commit;
