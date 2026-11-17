import { verifySignature, extractMessages, readLimitedBody } from './whatsapp-webhook.mjs';

export function normalizeMetaMessages(payload, bindings) {
  if (payload?.object === 'whatsapp_business_account') {
    return extractMessages(payload, bindings.whatsapp).map(row => ({ channel: 'whatsapp', business_account_id: row.phone_number_id,
      provider_message_id: row.provider_message_id, sender_id: row.sender_number, message_text: row.message_text,
      message_type: row.message_type, reply_to_message_id: row.raw_message.context?.id || null,
      provider_timestamp: row.provider_timestamp, raw_message: row.raw_message }));
  }
  const channel = payload?.object === 'page' ? 'facebook' : payload?.object === 'instagram' ? 'instagram' : null;
  if (!channel || !bindings[channel]) return [];
  const messages = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    if (entry.id !== bindings[channel]) continue;
    for (const event of Array.isArray(entry.messaging) ? entry.messaging : []) {
      if (event.message?.is_echo || event.sender?.id === bindings[channel]) continue;
      if (!event.message?.mid || event.recipient?.id !== bindings[channel]) continue;
      if (!/^\d+$/.test(event.sender?.id || '') || !Number.isSafeInteger(event.timestamp)) throw new Error('Invalid channel message');
      const date = new Date(event.timestamp);
      if (!Number.isFinite(date.getTime())) throw new Error('Invalid event timestamp');
      messages.push({ channel, business_account_id: entry.id, provider_message_id: event.message.mid,
        sender_id: event.sender.id, message_text: typeof event.message.text === 'string' ? event.message.text : null,
        message_type: typeof event.message.text === 'string' ? 'text' : 'attachment',
        reply_to_message_id: event.message.reply_to?.mid || null, provider_timestamp: date.toISOString(), raw_message: event });
    }
  }
  return messages;
}
export function createMetaWebhook({ verifyToken, whatsappVerifyToken, secrets, bindings, storeMessages }) {
  // Subscription challenges may use a new WhatsApp-only setup value while
  // Facebook retains its original value. POST events still require the
  // channel App Secret signature; neither verify token grants message access.
  const verifyTokens = new Set([
    typeof verifyToken === 'string' && verifyToken.length ? verifyToken : null,
    typeof whatsappVerifyToken === 'string' && whatsappVerifyToken.length >= 32 ? whatsappVerifyToken : null,
  ].filter(Boolean));
  return async request => {
    if (!verifyTokens.size) return new Response('Not configured', { status: 503 });
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      return params.get('hub.mode') === 'subscribe' && verifyTokens.has(params.get('hub.verify_token')) && params.has('hub.challenge') ?
        new Response(params.get('hub.challenge'), { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' } }) : new Response('Verification failed', { status: 403 });
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    let body; try { body = await readLimitedBody(request); } catch { return new Response('Payload too large', { status: 413 }); }
    let payload; try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { return new Response('Invalid JSON', { status: 400 }); }
    const channel = payload.object === 'whatsapp_business_account' ? 'whatsapp' : payload.object === 'page' ? 'facebook' : payload.object === 'instagram' ? 'instagram' : null;
    if (!channel || !secrets[channel] || !bindings[channel]) return new Response('Channel not configured', { status: 403 });
    if (!await verifySignature(body, request.headers.get('x-hub-signature-256'), secrets[channel])) return new Response('Invalid signature', { status: 401 });
    let messages; try { messages = normalizeMetaMessages(payload, bindings); } catch { return new Response('Invalid event', { status: 400 }); }
    try { if (messages.length) await storeMessages(messages); } catch { return new Response('Storage unavailable', { status: 503 }); }
    return new Response('EVENT_RECEIVED');
  };
}

export function outboundRequest(notice, config, lastInboundAt, now = Date.now()) {
  if (!config.sendEnabled) return { blocked: 'Sending is disabled' };
  if (!config.businessId || !config.token || !/^v\d+\.\d+$/.test(config.graphVersion || '')) return { blocked: 'Channel credentials are missing' };
  if (!/^\d+$/.test(notice.recipient || '')) return { blocked: 'Recipient is invalid' };
  if (notice.recipient === config.senderPhone) return { blocked: 'Use workspace staff alert; sender cannot be its own notification recipient' };
  const age = lastInboundAt ? now - Date.parse(lastInboundAt) : Infinity;
  const openWindow = Number.isFinite(age) && age >= 0 && age < 24 * 60 * 60 * 1000;
  let payload;
  if (notice.channel === 'whatsapp') {
    if (!config.costsApproved) return { blocked: 'Messaging costs have not been approved' };
    payload = { messaging_product: 'whatsapp', to: notice.recipient, type: 'text', text: { body: notice.message } };
    if (!openWindow) {
      if (!config.paidTemplatesEnabled || !config.approvedTemplates?.includes(notice.template_name) || !Array.isArray(notice.template_parameters)) return { blocked: 'An approved message template and cost authorisation are required' };
      payload = { messaging_product: 'whatsapp', to: notice.recipient, type: 'template', template: { name: notice.template_name, language: { code: 'en_US' },
        components: [{ type: 'body', parameters: notice.template_parameters.map(value => ({ type: 'text', text: String(value) })) }] } };
    }
  } else {
    if (!['facebook','instagram'].includes(notice.channel)) return { blocked: 'Unsupported channel' };
    if (!openWindow) return { blocked: 'Customer reply window is closed' };
    payload = { recipient: { id: notice.recipient }, message: { text: notice.message } };
    if (notice.channel === 'facebook') payload.messaging_type = 'RESPONSE';
  }
  const host = notice.channel === 'instagram' ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
  return { url: `${host}/${config.graphVersion}/${config.businessId}/messages`, options: { method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', credentials: 'omit' } };
}
