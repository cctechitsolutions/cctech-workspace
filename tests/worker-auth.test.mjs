import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerHeaders, workerAuthorised } from '../supabase/functions/_shared/worker-auth.mjs';

test('gateway JWT alone cannot authorise the automation worker', () => {
  const secret = 'private-worker-secret'.repeat(3);
  const jwt = 'eyJ.fake-server-token';
  const request = headers => new Request('https://example.test/worker', { method: 'POST', headers });
  assert.equal(workerAuthorised(request({ Authorization: `Bearer ${jwt}` }), secret), false);
  assert.equal(workerAuthorised(request(workerHeaders(secret, jwt)), secret), true);
  assert.equal(workerHeaders(secret, jwt).Authorization, `Bearer ${jwt}`);
  assert.equal(workerAuthorised(request({ ...workerHeaders(secret, jwt), 'x-automation-worker-secret': 'wrong' }), secret), false);
  assert.equal(workerAuthorised(request({ Authorization: `Bearer ${secret}`, 'x-automation-worker-secret': 'wrong' }), secret), false);
});

test('worker fallback still requires the private secret and POST', () => {
  const secret = 'private-worker-secret'.repeat(3);
  const headers = workerHeaders(secret, undefined);
  assert.equal(workerAuthorised(new Request('https://example.test', { method: 'POST', headers }), secret), true);
  assert.equal(workerAuthorised(new Request('https://example.test', { headers }), secret), false);
  assert.equal(workerAuthorised(new Request('https://example.test', { method: 'POST', headers }), ''), false);
});
