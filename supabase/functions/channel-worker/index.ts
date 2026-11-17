import { outboundRequest } from '../_shared/meta-channels.mjs';
import { planConversation } from '../_shared/conversation.mjs';
import { workerAuthorised } from '../_shared/worker-auth.mjs';
const get = (key: string) => Deno.env.get(key);
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
Deno.serve(async request => {
  const workerSecret = get('AUTOMATION_WORKER_SECRET');
  if (!workerSecret || workerSecret.length < 32) return response({ error: 'Worker is not configured' }, 503);
  if (!workerAuthorised(request, workerSecret)) return response({ error: 'Unauthorised' }, 401);
  // No claims, sends or costs occur while the global switch is disabled.
  const processEnabled = get('AUTOMATION_PROCESS_ENABLED') === 'true';
  const sendEnabled = get('AUTOMATION_SEND_ENABLED') === 'true';
  if (!processEnabled && !sendEnabled) return response({ enabled: false, sent: 0 });
  const key = get('SUPABASE_SECRET_KEY') || get('SUPABASE_SERVICE_ROLE_KEY');
  const project = get('SUPABASE_URL');
  if (!key || !project) return response({ error: 'Server database credentials missing' }, 503);
  async function db(path: string, method = 'GET', body?: unknown) {
    const result = await fetch(`${project}/rest/v1/${path}`, { method,
      headers: { apikey: key!, ...(key!.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!result.ok) throw new Error('Database operation failed');
    return result.status === 204 ? null : result.json();
  }
  try {
    if (processEnabled) {
      const inbox = await db('channel_inbox?select=id&processing_status=eq.pending&order=provider_timestamp.asc&limit=20');
      for (const message of inbox) {
        const context = await db('rpc/get_conversation_context', 'POST', { p_message_id: message.id });
        if (!context) continue;
        const plan = planConversation(context);
        await db('rpc/commit_conversation_event', 'POST', { p_message_id: message.id, p_expected_version: context.session.version, p_state: plan.state, p_actions: plan.actions });
      }
    }
    if (!sendEnabled) return response({ sending_enabled: false, sent: 0 });
    await db('rpc/queue_due_vendor_reminders', 'POST', {});
    const connections = await db('channel_connections?select=*');
    const batch = await db('rpc/claim_channel_outbox', 'POST', { p_limit: 10 });
    let sent = 0, blocked = 0;
    for (const notice of batch) {
      if (notice.supplier_request_id) {
        const requests = await db(`supplier_requests?select=suppliers!inner(active,enquiry_consent,whatsapp_number)&id=eq.${encodeURIComponent(notice.supplier_request_id)}`);
        const vendor = requests[0]?.suppliers;
        if (!vendor?.active || !vendor.enquiry_consent || vendor.whatsapp_number !== notice.recipient) {
          await db(`channel_outbox?id=eq.${notice.id}`, 'PATCH', { status: 'blocked', blocked_reason: 'Vendor consent, contact or active status changed' }); blocked++; continue;
        }
      }
      const binding = connections.find((row: { channel: string }) => row.channel === notice.channel);
      const prefix = notice.channel === 'whatsapp' ? 'WHATSAPP' : notice.channel === 'facebook' ? 'FACEBOOK' : 'INSTAGRAM';
      const businessId = get(notice.channel === 'whatsapp' ? 'WHATSAPP_PHONE_NUMBER_ID' : notice.channel === 'facebook' ? 'FACEBOOK_PAGE_ID' : 'INSTAGRAM_ACCOUNT_ID');
      const inbound = binding?.business_account_id ? await db(`channel_inbox?select=provider_timestamp&channel=eq.${notice.channel}&business_account_id=eq.${encodeURIComponent(binding.business_account_id)}&sender_id=eq.${encodeURIComponent(notice.recipient)}&order=provider_timestamp.desc&limit=1`) : [];
      const plan = outboundRequest(notice, { sendEnabled: binding?.enabled === true && binding.business_account_id === businessId,
        businessId, token: get(`${prefix}_ACCESS_TOKEN`), graphVersion: get('META_GRAPH_VERSION'), senderPhone: get('WHATSAPP_SENDER_PHONE'),
        costsApproved: get('WHATSAPP_COSTS_APPROVED') === 'true', paidTemplatesEnabled: get('WHATSAPP_PAID_TEMPLATES_ENABLED') === 'true',
        approvedTemplates: (get('WHATSAPP_APPROVED_TEMPLATES') || '').split(',').filter(Boolean) }, inbound[0]?.provider_timestamp);
      if (plan.blocked) {
        await db(`channel_outbox?id=eq.${notice.id}`, 'PATCH', { status: 'blocked', blocked_reason: plan.blocked }); blocked++; continue;
      }
      // If sending times out or returns an ambiguous result, never automatically
      // send it again: that could duplicate customer messages and incur fees.
      try {
        const result = await fetch(plan.url, { ...plan.options, signal: AbortSignal.timeout(15000) });
        const provider = await result.json();
        const messageId = notice.channel === 'whatsapp' ? provider.messages?.[0]?.id : provider.message_id;
        if (!result.ok || !messageId) throw new Error('Provider did not confirm message acceptance');
        await db(`channel_outbox?id=eq.${notice.id}`, 'PATCH', { status: 'sent', provider_message_id: messageId, processed_at: new Date().toISOString(), blocked_reason: null });
        if (notice.order_notification_id) await db(`order_notifications?id=eq.${notice.order_notification_id}`, 'PATCH', { status: 'sent', provider_message_id: messageId });
        if (notice.team_notification_id) await db(`team_notifications?id=eq.${notice.team_notification_id}`, 'PATCH', { status: 'sent' });
        if (notice.supplier_request_id && notice.dedupe_key.startsWith('vendor-request:')) {
          await db(`supplier_requests?id=eq.${notice.supplier_request_id}`, 'PATCH', { status: 'sent', sent_at: new Date().toISOString(), provider_message_id: messageId });
        }
        sent++;
      } catch {
        await db(`channel_outbox?id=eq.${notice.id}`, 'PATCH', { status: 'needs_review', blocked_reason: 'Provider outcome needs checking before any resend' });
      }
    }
    return response({ sent, blocked });
  } catch { return response({ error: 'Worker interrupted; review processing jobs before retrying' }, 503); }
});
