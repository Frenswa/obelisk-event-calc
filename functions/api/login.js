const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function onRequestPost({ request, env }) {
  if (!env.SYNC_PASSWORD) {
    return Response.json({ error: 'Cloud sync is not configured.' }, { status: 503 });
  }

  let password = '';
  try {
    const body = await request.json();
    password = typeof body.password === 'string' ? body.password : '';
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const [providedHash, expectedHash] = await Promise.all([
    sha256(password),
    sha256(env.SYNC_PASSWORD)
  ]);
  if (!password || !equalBytes(providedHash, expectedHash)) {
    return Response.json({ error: 'Incorrect password.' }, { status: 401 });
  }

  const lifetimeSeconds = 60 * 60 * 24 * 30;
  const expiresAt = Math.floor(Date.now() / 1000) + lifetimeSeconds;
  const signature = await sign(String(expiresAt), env.SYNC_PASSWORD);
  const cookie = `obelisk_sync=${expiresAt}.${signature}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${lifetimeSeconds}`;
  return Response.json(
    { ok: true, expiresAt },
    { headers: { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } }
  );
}
