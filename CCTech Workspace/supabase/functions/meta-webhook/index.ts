import { createMetaWebhook } from '../_shared/meta-channels.mjs';
import { workerHeaders } from '../_shared/worker-auth.mjs';
const get = (key: string) => Deno.env.get(key);
const receiver = createMetaWebhook({ verifyToken: get('META_VERIFY_TOKEN'),
  whatsappVerifyToken: get('WHATSAPP_VERIFY_TOKEN'),
  secrets: { whatsapp: get('WHATSAPP_APP_SECRET'), facebook: get('FACEBOOK_APP_SECRET'), instagram: get('INSTAGRAM_APP_SECRET') },
  bindings: { whatsapp: get('WHATSAPP_PHONE_NUMBER_ID'), facebook: get('FACEBOOK_PAGE_ID'), instagram: get('INSTAGRAM_ACCOUNT_ID') },
  async storeMessages(rows: unknown[]) {
    const key = get('SUPABASE_SECRET_KEY') || get('SUPABASE_SERVICE_ROLE_KEY');
    if (!key) throw new Error('Server database key missing');
    const response = await fetch(`${get('SUPABASE_URL')}/rest/v1/channel_inbox?on_conflict=channel,business_account_id,provider_message_id`, {
      method: 'POST', headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(rows), redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Message persistence failed');
    const workerSecret = get('AUTOMATION_WORKER_SECRET');
    if (get('AUTOMATION_PROCESS_ENABLED') === 'true' && workerSecret && workerSecret.length >= 32) {
      // Wake only our own project's worker after a signed message is stored.
      // A worker failure must not make Meta redeliver an already stored message.
      const wake = fetch(`${get('SUPABASE_URL')}/functions/v1/channel-worker`, {
        method: 'POST', headers: workerHeaders(workerSecret, get('SUPABASE_SERVICE_ROLE_KEY')),
        body: '{}', redirect: 'error', signal: AbortSignal.timeout(25000),
      }).then(result => {
        console.info(JSON.stringify({ event: 'meta_worker_wake', status: result.status }));
      }).catch(() => console.warn(JSON.stringify({ event: 'meta_worker_wake', outcome: 'Worker unreachable' })));
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(wake);
      else await wake;
    }
  },
});
Deno.serve(async request => {
  const result = await receiver(request);
  // Log only controlled diagnostic labels, never chat contents, IDs, headers,
  // URL query strings (which contain verification tokens), or server secrets.
  if (request.method === 'POST') {
    const outcome = await result.clone().text();
    console.info(JSON.stringify({ event: 'meta_webhook_post', status: result.status,
      outcome: ['EVENT_RECEIVED','Not configured','Channel not configured','Invalid signature','Invalid JSON','Invalid event','Storage unavailable','Payload too large'].includes(outcome) ? outcome : 'Unexpected response' }));
  }
  return result;
});
