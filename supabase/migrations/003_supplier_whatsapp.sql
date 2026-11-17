-- Keeps existing suppliers. Add their WhatsApp number through the directory.
alter table public.suppliers
  add column if not exists whatsapp_number text
  check (whatsapp_number is null or whatsapp_number ~ '^[1-9][0-9]{7,14}$');
