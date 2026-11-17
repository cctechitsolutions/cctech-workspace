// Keep the gateway JWT when one is available; the private worker secret is
// checked independently by the worker and is never sent to a browser.
export function workerHeaders(workerSecret, serviceRoleKey) {
  return {
    Authorization: `Bearer ${serviceRoleKey?.startsWith('eyJ') ? serviceRoleKey : workerSecret}`,
    'x-automation-worker-secret': workerSecret,
    'Content-Type': 'application/json',
  };
}

export function workerAuthorised(request, secret) {
  if (!secret || secret.length < 32 || request.method !== 'POST') return false;
  const supplied = request.headers.get('x-automation-worker-secret');
  // If the private header is present, never fall back to a different header.
  return supplied !== null ? supplied === secret : request.headers.get('Authorization') === `Bearer ${secret}`;
}
