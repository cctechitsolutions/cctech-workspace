import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createWebhookHandler, extractMessages } from '../supabase/functions/_shared/whatsapp-webhook.mjs';

const secret = 'test-secret';
const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
  metadata: { phone_number_id: 'phone-1' }, messages: [{ id: 'wamid.test-1', from: '919876543210', timestamp: '1793700000', type: 'text', text: { body: 'Need HP ProBook display' } }],
} }] }] };
function signedRequest(value = payload, signingSecret = secret) {
  const body = JSON.stringify(value);
  return new Request('https://example.test/webhook', { method: 'POST', body,
    headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', signingSecret).update(body).digest('hex') } });
}
function setup(storeMessages = async () => {}) {
  return createWebhookHandler({ appSecret: secret, verifyToken: 'verify-me', phoneNumberId: 'phone-1', storeMessages });
}
test('Meta subscription challenge requires the configured verification token', async () => {
  const handler = setup();
  const good = await handler(new Request('https://example.test/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=123'));
  assert.equal(good.status, 200); assert.equal(await good.text(), '123');
  const bad = await handler(new Request('https://example.test/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123'));
  assert.equal(bad.status, 403);
});
test('unsigned or forged messages never reach storage', async () => {
  let calls = 0; const handler = setup(async () => { calls++; });
  assert.equal((await handler(new Request('https://example.test/webhook', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal((await handler(signedRequest(payload, 'wrong-secret'))).status, 401);
  assert.equal(calls, 0);
});
test('signed messages are acknowledged only after durable storage succeeds', async () => {
  let rows;
  const handler = setup(async values => { rows = values; });
  assert.equal((await handler(signedRequest())).status, 200);
  assert.equal(rows[0].provider_message_id, 'wamid.test-1');
  assert.equal(rows[0].message_text, 'Need HP ProBook display');
  assert.equal(rows[0].sender_number, '919876543210');
  const unavailable = setup(async () => { throw new Error('database unavailable'); });
  assert.equal((await unavailable(signedRequest())).status, 503);
});
test('events for another business number and delivery receipts are not imported as customer messages', () => {
  assert.deepEqual(extractMessages(payload, 'another-phone'), []);
  assert.deepEqual(extractMessages({ object: 'page', entry: [] }, 'phone-1'), []);
  assert.deepEqual(extractMessages({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'phone-1' }, statuses: [{ status: 'delivered' }] } }] }] }, 'phone-1'), []);
});
test('non-text messages retain their media reference for later handling', () => {
  const image = structuredClone(payload);
  image.entry[0].changes[0].value.messages = [{ id: 'wamid.photo', from: '919876543210', timestamp: '1793700000', type: 'image', image: { id: 'media-1', caption: 'Model label' } }];
  const rows = extractMessages(image, 'phone-1');
  assert.equal(rows[0].message_text, 'Model label'); assert.equal(rows[0].raw_message.image.id, 'media-1');
});
test('unconfigured endpoint cannot accept incoming messages', async () => {
  const handler = createWebhookHandler({});
  assert.equal((await handler(signedRequest())).status, 503);
});
test('oversized requests are rejected before signature or storage processing', async () => {
  const request = new Request('https://example.test/webhook', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) });
  assert.equal((await setup()(request)).status, 413);
});
