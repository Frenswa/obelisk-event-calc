const ALLOWED_PROFILES = new Set(['moom', 'frenswa']);
const MAX_STATE_BYTES = 200_000;

function apiResponse(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function validProfile(id) {
  return ALLOWED_PROFILES.has(String(id || '').toLowerCase());
}

async function readProfile(database, id) {
  return database
    .prepare('SELECT state_json, revision, updated_at FROM profiles WHERE id = ?')
    .bind(id)
    .first();
}

function parseState(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function onRequestGet({ env, params }) {
  const id = String(params.id || '').toLowerCase();
  if (!validProfile(id)) return apiResponse({ error: 'Unknown profile.' }, 404);
  if (!env.DB) return apiResponse({ error: 'D1 binding DB is missing.' }, 503);

  const row = await readProfile(env.DB, id);
  if (!row) return apiResponse({ profile: id, state: {}, revision: 0, updatedAt: null });
  return apiResponse({
    profile: id,
    state: parseState(row.state_json),
    revision: Number(row.revision) || 0,
    updatedAt: row.updated_at || null
  });
}

export async function onRequestPut({ request, env, params }) {
  const id = String(params.id || '').toLowerCase();
  if (!validProfile(id)) return apiResponse({ error: 'Unknown profile.' }, 404);
  if (!env.DB) return apiResponse({ error: 'D1 binding DB is missing.' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'Invalid JSON.' }, 400);
  }

  if (!body?.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
    return apiResponse({ error: 'Invalid profile state.' }, 400);
  }
  const stateJson = JSON.stringify(body.state);
  if (new TextEncoder().encode(stateJson).byteLength > MAX_STATE_BYTES) {
    return apiResponse({ error: 'Profile state is too large.' }, 413);
  }

  await env.DB
    .prepare(`
      INSERT INTO profiles (id, state_json, revision, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        state_json = excluded.state_json,
        revision = profiles.revision + 1,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(id, stateJson)
    .run();

  const updated = await readProfile(env.DB, id);
  return apiResponse({
    profile: id,
    revision: Number(updated?.revision) || 1,
    updatedAt: updated?.updated_at || null
  });
}
