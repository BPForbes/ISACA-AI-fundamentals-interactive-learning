// Study-progress backend for the ISACA AI Fundamentals adventure.
//
// The site keeps learning in the browser session and calls POST /api/save only
// when the learner saves. Every route except /api/health needs the learner's
// bearer token, whose SHA-256 is the SYNC_TOKEN_SHA256 secret; with no secret
// set the API refuses everything. Only origins in ALLOWED_ORIGINS get CORS.

export interface Env {
  DB: D1Database;
  AI?: Ai;
  SYNC_TOKEN_SHA256?: string;
  ALLOWED_ORIGINS?: string;
  AI_MODEL?: string;
}

const MAX_BODY_BYTES = 512 * 1024;
const MAX_TERMS = 500;
const MAX_EVENTS = 2000;
const MAX_PROMPT_CHARS = 20_000;
const ID = /^[A-Za-z0-9._:-]{1,80}$/;
const TERM_ID = /^[a-z0-9-]{1,64}$/;
const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const allowedOrigins = (env: Env) =>
  (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);

const corsHeaders = (origin: string | null, env: Env): Record<string, string> =>
  origin && allowedOrigins(env).includes(origin)
    ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    }
    : { Vary: 'Origin' };

const json = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors },
  });

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const sha256Hex = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const authorize = async (request: Request, env: Env) => {
  const expected = env.SYNC_TOKEN_SHA256?.trim().toLowerCase();
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) throw new HttpError(503, 'Sync token is not configured on the Worker.');
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !timingSafeEqual(await sha256Hex(token), expected)) throw new HttpError(401, 'Unauthorized.');
};

const readJson = async (request: Request): Promise<unknown> => {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'Body too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new HttpError(413, 'Body too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Body is not JSON.');
  }
};

// ---------- validation ----------

const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, `${what} must be an object.`);
  return v as Record<string, unknown>;
};
const str = (v: unknown, what: string, max = 200, pattern?: RegExp): string => {
  if (typeof v !== 'string' || v.length > max || (pattern && !pattern.test(v))) throw new HttpError(400, `${what} is invalid.`);
  return v;
};
const iso = (v: unknown, what: string) => {
  const s = str(v, what, 40);
  if (Number.isNaN(Date.parse(s))) throw new HttpError(400, `${what} is not a date.`);
  return s;
};
const num = (v: unknown, what: string, min = -1e9, max = 1e9): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, `${what} is invalid.`);
  return v;
};
const arr = (v: unknown, what: string, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length > max) throw new HttpError(400, `${what} is invalid.`);
  return v;
};
const strList = (v: unknown, what: string, max: number, pattern: RegExp) => arr(v, what, max).map((x) => str(x, what, 80, pattern));

export type TermRow = { id: string; attempts: number; correct: number; stage: number; updatedAt: string; raw: string };

const parseTerm = (v: unknown): TermRow => {
  const t = obj(v, 'term');
  const recent = arr(t.recent, 'term.recent', 32).map((r) => {
    if (typeof r !== 'boolean') throw new HttpError(400, 'term.recent is invalid.');
    return r;
  });
  const clean = {
    id: str(t.id, 'term.id', 64, TERM_ID),
    attempts: num(t.attempts, 'term.attempts', 0, 1e6),
    correct: num(t.correct, 'term.correct', 0, 1e6),
    stage: num(t.stage, 'term.stage', 1, 5),
    recent,
    contexts: strList(t.contexts, 'term.contexts', 32, TERM_ID),
    transferred: t.transferred === true,
    lastSeen: t.lastSeen === null ? null : iso(t.lastSeen, 'term.lastSeen'),
    updatedAt: iso(t.updatedAt, 'term.updatedAt'),
  };
  return { id: clean.id, attempts: clean.attempts, correct: clean.correct, stage: clean.stage, updatedAt: clean.updatedAt, raw: JSON.stringify(clean) };
};

const parseEvent = (v: unknown) => {
  const e = obj(v, 'event');
  return {
    id: str(e.id, 'event.id', 80, ID),
    sessionId: str(e.sessionId, 'event.sessionId', 80, ID),
    at: iso(e.at, 'event.at'),
    chainId: str(e.chainId, 'event.chainId', 64, TERM_ID),
    anchor: str(e.anchor, 'event.anchor', 64, TERM_ID),
    mode: str(e.mode, 'event.mode', 32, TERM_ID),
    settingId: str(e.settingId, 'event.settingId', 64, TERM_ID),
    correct: e.correct === true ? 1 : 0,
    risk: num(e.risk, 'event.risk', 0, 10),
    points: Math.round(num(e.points, 'event.points', -1e6, 1e6)),
    source: e.source === 'ai' ? 'ai' : 'offline',
    note: typeof e.note === 'string' ? e.note.slice(0, 1000) : '',
  };
};

const parseSession = (v: unknown) => {
  const s = obj(v, 'session');
  const clean = {
    id: str(s.id, 'session.id', 80, ID),
    startedAt: iso(s.startedAt, 'session.startedAt'),
    endedAt: iso(s.endedAt, 'session.endedAt'),
    points: Math.round(num(s.points, 'session.points', -1e7, 1e7)),
    answered: num(s.answered, 'session.answered', 0, 1e6),
    correct: num(s.correct, 'session.correct', 0, 1e6),
    longestStreak: num(s.longestStreak, 'session.longestStreak', 0, 1e6),
    modesUsed: strList(s.modesUsed, 'session.modesUsed', 16, TERM_ID),
    expeditions: strList(s.expeditions, 'session.expeditions', 64, TERM_ID),
  };
  return { ...clean, raw: JSON.stringify(clean) };
};

export const parseSave = (v: unknown) => {
  const p = obj(v, 'save');
  return {
    saveId: str(p.saveId, 'saveId', 80, ID),
    session: parseSession(p.session),
    terms: arr(p.terms, 'terms', MAX_TERMS).map(parseTerm),
    events: arr(p.events, 'events', MAX_EVENTS).map(parseEvent),
    remediation: strList(p.remediation, 'remediation', MAX_TERMS, TERM_ID),
  };
};

// ---------- routes ----------

const save = async (env: Env, body: unknown, now: string) => {
  const p = parseSave(body);
  const s = p.session;
  // One D1 batch is one transaction: the saves row and the data land together,
  // and a repeated save id fails the whole batch on the primary key.
  const statements = [
    env.DB.prepare('INSERT INTO saves (save_id, saved_at, session_id) VALUES (?, ?, ?)').bind(p.saveId, now, s.id),
    env.DB.prepare(
      `INSERT INTO sessions (id, started_at, ended_at, points, answered, correct, longest_streak, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET ended_at = excluded.ended_at, points = excluded.points, answered = excluded.answered,
         correct = excluded.correct, longest_streak = excluded.longest_streak, data = excluded.data`,
    ).bind(s.id, s.startedAt, s.endedAt, s.points, s.answered, s.correct, s.longestStreak, s.raw),
    ...p.terms.map((t) => env.DB.prepare(
      `INSERT INTO term_progress (term_id, attempts, correct, stage, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(term_id) DO UPDATE SET attempts = excluded.attempts, correct = excluded.correct, stage = excluded.stage,
         data = excluded.data, updated_at = excluded.updated_at
       WHERE excluded.updated_at > term_progress.updated_at`,
    ).bind(t.id, t.attempts, t.correct, t.stage, t.raw, t.updatedAt)),
    ...p.events.map((e) => env.DB.prepare(
      `INSERT OR IGNORE INTO scene_events (id, session_id, at, chain_id, anchor, mode, setting_id, correct, risk, points, source, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(e.id, e.sessionId, e.at, e.chainId, e.anchor, e.mode, e.settingId, e.correct, e.risk, e.points, e.source, e.note)),
    env.DB.prepare(
      `INSERT INTO learner_state (key, value, updated_at) VALUES ('remediation', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(JSON.stringify(p.remediation), now),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const known = await env.DB.prepare('SELECT 1 AS hit FROM saves WHERE save_id = ?').bind(p.saveId).first<{ hit: number }>();
    if (known) return { status: 'already_saved' as const };
    throw error;
  }
  return { status: 'saved' as const, terms: p.terms.length, events: p.events.length };
};

const progress = async (env: Env) => {
  const [terms, sessions, state] = await Promise.all([
    env.DB.prepare('SELECT data FROM term_progress').all<{ data: string }>(),
    env.DB.prepare('SELECT data FROM sessions ORDER BY ended_at DESC LIMIT 20').all<{ data: string }>(),
    env.DB.prepare("SELECT value FROM learner_state WHERE key = 'remediation'").first<{ value: string }>(),
  ]);
  return {
    terms: terms.results.map((r) => JSON.parse(r.data)),
    sessions: sessions.results.map((r) => JSON.parse(r.data)),
    remediation: state ? JSON.parse(state.value) : [],
  };
};

const generate = async (env: Env, body: unknown) => {
  if (!env.AI) throw new HttpError(501, 'Workers AI is not bound on this Worker.');
  const b = obj(body, 'request');
  const system = str(b.system, 'system', MAX_PROMPT_CHARS);
  const user = str(b.user, 'user', MAX_PROMPT_CHARS);
  const maxTokens = Math.round(num(b.maxTokens ?? 900, 'maxTokens', 1, 1500));
  const result = await env.AI.run((env.AI_MODEL || DEFAULT_MODEL) as Parameters<Ai['run']>[0], {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
    temperature: 0.8,
  } as never) as { response?: unknown };
  const response = result?.response;
  return { response: typeof response === 'string' ? response : JSON.stringify(response ?? '') };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);
    const url = new URL(request.url);

    if (origin && !allowedOrigins(env).includes(origin)) return json({ error: 'Origin not allowed.' }, 403, cors);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true }, 200, cors);
      const route = `${request.method} ${url.pathname}`;
      if (!['GET /api/progress', 'POST /api/save', 'POST /api/generate'].includes(route)) {
        return json({ error: 'Not found.' }, 404, cors);
      }
      await authorize(request, env);
      if (route === 'GET /api/progress') return json(await progress(env), 200, cors);
      const body = await readJson(request);
      if (route === 'POST /api/save') return json(await save(env, body, new Date().toISOString()), 200, cors);
      return json(await generate(env, body), 200, cors);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status, cors);
      console.error('request failed', request.method, url.pathname, error instanceof Error ? error.message : 'unknown');
      return json({ error: 'Internal error.' }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;
