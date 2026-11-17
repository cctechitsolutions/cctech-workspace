import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourcingClient, validateConfig, CATEGORIES } from '../sourcing-client.mjs';

const config = { url: 'https://test-project.supabase.co', key: 'sb_publishable_test' };
const ok = data => ({ ok: true, status: 200, json: async () => data });
const auth = { access_token: 'test-user-token', user: { id: 'user-1' }, expires_in: 3600 };
test('manual group sending keeps its audit separate from individual contact sending', async () => {
  const calls=[];
  const client=new SourcingClient(config,async (...args)=>{calls.push(args);return ok([]);});
  client.session={...auth,expiresAt:Date.now()+60000};
  await client.saveVendorContact('vendor-1',null,true,' Star and CCTech ');
  assert.equal(JSON.parse(calls[0][1].body).whatsapp_group_name,'Star and CCTech');
  await client.markRequestSent('request-1','group','Star and CCTech');
  assert.deepEqual(JSON.parse(calls[1][1].body),{status:'sent',manual_delivery_method:'group',manual_group_name:'Star and CCTech'});
  await client.markRequestSent('request-2','individual','Star and CCTech');
  assert.equal(JSON.parse(calls[2][1].body).manual_group_name,null);
  assert.throws(()=>client.markRequestSent('request-3','automatic_group'),/Choose individual/);
});
function mock(responses) {
  const calls = [];
  const client = new SourcingClient(config, async (...args) => { calls.push(args); return responses.shift(); });
  return { client, calls };
}
test('accepts only project HTTPS URLs and publishable keys', () => {
  assert.deepEqual(validateConfig(config.url + '/', config.key), config);
  for (const url of ['http://test-project.supabase.co', 'https://test-project.supabase.co.evil.com', 'https://x.supabase.co/path', 'https://user:pass@x.supabase.co', 'https://x.supabase.co?redirect=evil']) {
    assert.throws(() => validateConfig(url, config.key));
  }
  for (const key of ['sb_secret_test', 'eyJservice_role', '', 'service_role']) assert.throws(() => validateConfig(config.url, key));
});
test('unauthenticated reads and writes never reach the network', async () => {
  const { client, calls } = mock([]);
  await assert.rejects(client.list('enquiries'), /sign in/i);
  await assert.rejects(client.create('suppliers', { name: 'Private supplier' }), /sign in/i);
  assert.equal(calls.length, 0);
});
test('staff login validates role and sends user JWT separately from app key', async () => {
  const { client, calls } = mock([ok(auth), ok([{ role: 'staff' }]), ok([]), ok([{ id: 'new' }])]);
  await client.signIn('owner@example.test', 'password');
  assert.equal(calls[0][1].headers.Authorization, undefined);
  assert.equal(calls[1][1].headers.Authorization, 'Bearer test-user-token');
  assert.equal(calls[1][1].headers.apikey, config.key);
  await client.list('enquiries');
  await client.create('enquiries', { customer_name: 'Demo', created_by: 'spoofed' });
  assert.equal(JSON.parse(calls[3][1].body).created_by, 'user-1');
  assert.equal(calls[3][1].headers.Prefer, 'return=representation');
});
test('supplier and unprovisioned users are locked out of staff workspace', async () => {
  for (const profiles of [[], [{ role: 'supplier' }]]) {
    const { client } = mock([ok(auth), ok(profiles)]);
    await assert.rejects(client.signIn('supplier@example.test', 'password'), /staff account/);
    assert.equal(client.session, null);
  }
});
test('expired sessions stop calls and clear in-memory auth', async () => {
  const { client, calls } = mock([ok(auth), ok([{ role: 'staff' }])]);
  await client.signIn('owner@example.test', 'password');
  client.session.expiresAt = 0;
  await assert.rejects(client.list('suppliers'), /expired/);
  assert.equal(client.session, null); assert.equal(calls.length, 2);
});
test('logout clears local auth even if the network fails', async () => {
  const { client } = mock([ok(auth), ok([{ role: 'staff' }])]);
  await client.signIn('owner@example.test', 'password');
  client.fetcher = async () => { throw new TypeError('offline'); };
  await assert.rejects(client.signOut()); assert.equal(client.session, null);
});
test('401 clears auth and server messages cannot echo confidential data', async () => {
  const { client } = mock([ok(auth), ok([{ role: 'staff' }]), { ok: false, status: 401, json: async () => ({ message: 'private vendor cost' }) }]);
  await client.signIn('owner@example.test', 'password');
  await assert.rejects(client.list('suppliers'), error => !error.message.includes('private vendor cost'));
  assert.equal(client.session, null);
});
test('supports all fifteen agreed business categories', () => {
  assert.equal(CATEGORIES.length, 15); assert.equal(new Set(CATEGORIES).size, 15);
});
test('owner sessions are accepted and connection status sorts by its actual channel column', async () => {
  const { client, calls } = mock([ok(auth), ok([{ role: 'owner' }]), ok([])]);
  await client.signIn('owner@example.test','password');
  assert.equal(client.session.profile.role,'owner');
  await client.list('channel_connections');
  assert.match(calls[2][0],/order=channel.asc/);
});
test('default browser fetch receives the global receiver rather than the client instance', async () => {
  const originalFetch = globalThis.fetch;
  try {
    // Browser-native fetch can reject an incompatible receiver with TypeError.
    globalThis.fetch = function () {
      assert.equal(this, globalThis);
      return Promise.resolve(ok({ external: { email: true } }));
    };
    const client = new SourcingClient(config);
    const result = await client.request('/auth/v1/settings', { authenticated: false });
    assert.equal(result.external.email, true);
  } finally { globalThis.fetch = originalFetch; }
});
test('failed profile verification clears an otherwise valid auth token', async () => {
  const { client } = mock([ok(auth), { ok: false, status: 503 }]);
  await assert.rejects(client.signIn('owner@example.test', 'password'));
  assert.equal(client.session, null);
});
test('failed writes report failure rather than pretending data was saved', async () => {
  const { client } = mock([ok(auth), ok([{ role: 'staff' }]), { ok: false, status: 403 }]);
  await client.signIn('owner@example.test', 'password');
  await assert.rejects(client.create('suppliers', { name: 'Demo' }), /Access denied/);
});
test('transport omits browser credentials and prevents credential-bearing redirects', async () => {
  const { client, calls } = mock([ok(auth), ok([{ role: 'staff' }])]);
  await client.signIn('owner@example.test', 'password');
  for (const [, options] of calls) {
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
  }
});
test('RFQ creation stamps the staff identity and marking sent changes only status', async () => {
  const { client, calls } = mock([ok(auth), ok([{ role: 'staff' }]), ok([{ id: 'request-1' }]), ok([{ id: 'request-1', status: 'sent' }])]);
  await client.signIn('owner@example.test', 'password');
  await client.create('supplier_requests', { enquiry_id: 'enquiry-1', supplier_id: 'supplier-1', request_message: 'Specs', created_by: 'spoofed' });
  assert.equal(JSON.parse(calls[2][1].body).created_by, 'user-1');
  await client.markRequestSent('request-1');
  assert.equal(calls[3][1].method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[3][1].body), { status: 'sent' });
});
