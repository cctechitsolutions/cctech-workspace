import { createWebhookHandler } from '../_shared/whatsapp-webhook.mjs';

// Secrets are read on the server. None belong in sourcing-config.mjs or Git.
const projectUrl = Deno.env.get('SUPABASE_URL');
const serverKey = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const handler = createWebhookHandler({
  appSecret: Deno.env.get('WHATSAPP_APP_SECRET'),
  verifyToken: Deno.env.get('WHATSAPP_VERIFY_TOKEN'),
  phoneNumberId: Deno.env.get('WHATSAPP_PHONE_NUMBER_ID'),
  async storeMessages(rows: Record<string, unknown>[]) {
    if (!projectUrl || !serverKey) throw new Error('Server database connection missing');
    const response = await fetch(`${projectUrl}/rest/v1/whatsapp_messages?on_conflict=provider_message_id`, {
      method: 'POST',
      headers: { apikey: serverKey, ...(serverKey.startsWith('eyJ') ? { Authorization: `Bearer ${serverKey}` } : {}), 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(rows), signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    if (!response.ok) throw new Error('Could not persist messages');
  },
});
Deno.serve(handler);
