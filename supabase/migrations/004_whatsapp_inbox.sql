-- Incoming WhatsApp messages are written only by the signed server webhook.
create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  phone_number_id text not null,
  sender_number text not null,
  message_type text not null,
  message_text text,
  provider_timestamp timestamptz not null,
  raw_message jsonb not null,
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processed', 'needs_review')),
  enquiry_id uuid references public.enquiries(id),
  created_at timestamptz not null default now()
);
alter table public.whatsapp_messages enable row level security;
revoke all on public.whatsapp_messages from anon, authenticated;
grant select on public.whatsapp_messages to authenticated;
grant all on public.whatsapp_messages to service_role;
drop policy if exists "Staff read WhatsApp inbox" on public.whatsapp_messages;
create policy "Staff read WhatsApp inbox" on public.whatsapp_messages
for select to authenticated using (public.is_cctech_staff());
