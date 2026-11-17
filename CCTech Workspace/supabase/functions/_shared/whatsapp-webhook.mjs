const encoder = new TextEncoder();
export async function verifySignature(body, header, secret) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/i.test(header || '')) return false;
  const signature = Uint8Array.from(header.slice(7).match(/../g), pair => parseInt(pair, 16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, signature, body);
}
export async function readLimitedBody(request, limit = 1024 * 1024) {
  if (Number(request.headers.get('content-length')) > limit) throw new Error('Body too large');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('Body too large'); }
    parts.push(value);
  }
  const result = new Uint8Array(size); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
export function extractMessages(payload, phoneNumberId) {
  if (payload?.object !== 'whatsapp_business_account') return [];
  const rows = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change.value;
      if (change.field !== 'messages' || value?.metadata?.phone_number_id !== phoneNumberId) continue;
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        if (typeof message.id !== 'string' || !message.id || !/^\d{8,15}$/.test(message.from || '') || !/^\d{1,12}$/.test(message.timestamp || '')) throw new Error('Invalid message');
        const timestamp = new Date(Number(message.timestamp) * 1000);
        if (!Number.isFinite(timestamp.getTime())) throw new Error('Invalid timestamp');
        const content = message.text?.body ?? message.image?.caption ?? message.document?.caption ?? message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? null;
        rows.push({ provider_message_id: message.id, phone_number_id: phoneNumberId, sender_number: message.from,
          message_type: typeof message.type === 'string' ? message.type : 'unknown', message_text: typeof content === 'string' ? content : null,
          provider_timestamp: timestamp.toISOString(), raw_message: message });
      }
    }
  }
  return rows;
}
export function createWebhookHandler({ appSecret, verifyToken, phoneNumberId, storeMessages }) {
  return async request => {
    if (!appSecret || !verifyToken || !phoneNumberId) return new Response('Integration not configured', { status: 503 });
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      if (params.get('hub.mode') !== 'subscribe' || params.get('hub.verify_token') !== verifyToken || !params.has('hub.challenge')) return new Response('Verification failed', { status: 403 });
      return new Response(params.get('hub.challenge'), { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    let body;
    try { body = await readLimitedBody(request); } catch { return new Response('Payload too large', { status: 413 }); }
    if (!await verifySignature(body, request.headers.get('x-hub-signature-256'), appSecret)) return new Response('Invalid signature', { status: 401 });
    let rows;
    try { rows = extractMessages(JSON.parse(new TextDecoder().decode(body)), phoneNumberId); }
    catch { return new Response('Invalid payload', { status: 400 }); }
    try { if (rows.length) await storeMessages(rows); }
    catch { return new Response('Temporary storage failure', { status: 503 }); }
    return new Response('EVENT_RECEIVED', { status: 200 });
  };
}
