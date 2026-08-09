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

  const baseRevision = Number.isInteger(body.baseRevision) && body.baseRevision >= 0
    ? body.baseRevision
    : 0;
  const existing = await readProfile(env.DB, id);

  if (!existing) {
    if (baseRevision !== 0) return apiResponse({ error: 'Save conflict.', revision: 0, state: {} }, 409);
    await env.DB
      .prepare("INSERT INTO profiles (id, state_json, revision, updated_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP)")
      .bind(id, stateJson)
      .run();
    const created = await readProfile(env.DB, id);
    return apiResponse({ profile: id, revision: 1, updatedAt: created?.updated_at || null });
  }

  const currentRevision = Number(existing.revision) || 0;
  if (baseRevision !== currentRevision) {
    return apiResponse({
      error: 'Save conflict.',
      revision: currentRevision,
      state: parseState(existing.state_json),
      updatedAt: existing.updated_at || null
    }, 409);
  }

  const result = await env.DB
    .prepare("UPDATE profiles SET state_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?")
    .bind(stateJson, id, currentRevision)
    .run();

  if (!result.success || Number(result.meta?.changes || 0) !== 1) {
    const latest = await readProfile(env.DB, id);
    return apiResponse({
      error: 'Save conflict.',
      revision: Number(latest?.revision) || 0,
      state: parseState(latest?.state_json),
      updatedAt: latest?.updated_at || null
    }, 409);
  }

  const updated = await readProfile(env.DB, id);
  return apiResponse({
    profile: id,
    revision: Number(updated?.revision) || currentRevision + 1,
    updatedAt: updated?.updated_at || null
  });
}
