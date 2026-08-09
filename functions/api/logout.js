export function onRequestPost() {
  return Response.json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': 'obelisk_sync=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
        'Cache-Control': 'no-store'
      }
    }
  );
}
