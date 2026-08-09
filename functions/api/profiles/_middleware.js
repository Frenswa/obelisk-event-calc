const encoder = new TextEncoder();

function cookieValue(request, name) {
  const cookies = request.headers.get('Cookie') || '';
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return '';
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function equalText(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
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

export async function onRequest(context) {
  if (!context.env.SYNC_PASSWORD) {
    return Response.json({ error: 'Cloud sync is not configured.' }, { status: 503 });
  }

  const token = cookieValue(context.request, 'obelisk_sync');
  const separator = token.indexOf('.');
  if (separator < 1) return Response.json({ error: 'Authentication required.' }, { status: 401 });

  const expiresAt = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Math.floor(Date.now() / 1000)) {
    return Response.json({ error: 'Session expired.' }, { status: 401 });
  }

  const expected = await sign(expiresAt, context.env.SYNC_PASSWORD);
  if (!equalText(signature, expected)) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }

  return context.next();
}
