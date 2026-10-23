import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { sha256Hex, type Env } from '../src/index';
import { fileURLToPath } from 'node:url';
import { createFakeD1 } from './fakeD1';
import type { MasteryMatrix } from '../../src/engine/attention';
import { packMatrix, toBase64 } from '../../src/engine/matrix';
import { CONCEPTS, LIST_VERSION } from '../../src/engine/relations';

const TOKEN = `tok-${Math.random().toString(36).slice(2)}`;
const ORIGIN = 'https://bpforbes.github.io';
let env: Env;
let fake: ReturnType<typeof createFakeD1>;

beforeEach(async () => {
  fake = createFakeD1(fileURLToPath(new URL('../migrations', import.meta.url)));
  env = {
    DB: fake.d1 as unknown as D1Database,
    SYNC_TOKEN_SHA256: await sha256Hex(TOKEN),
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
  };
});

const call = (path: string, init: RequestInit & { token?: string | null; origin?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  if (init.token !== null) headers.set('Authorization', `Bearer ${init.token ?? TOKEN}`);
  if (init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN);
  return worker.fetch(new Request(`https://api.test${path}`, { ...init, headers }), env);
};

const term = (id: string, updatedAt: string, attempts = 1) => ({
  id, attempts, correct: attempts, stage: 2, recent: [true], contexts: ['emr'], transferred: false, lastSeen: updatedAt, updatedAt,
});

const savePayload = (saveId: string, terms = [term('kpi', '2026-10-22T10:00:00Z')]) => ({
  saveId,
  session: {
    id: 'session-1', startedAt: '2026-10-22T09:00:00Z', endedAt: '2026-10-22T10:00:00Z',
    points: 120, answered: 5, correct: 4, longestStreak: 3, modesUsed: ['guided'], expeditions: ['indicators'],
  },
  terms,
  events: [{
    id: 'ev-1', sessionId: 'session-1', at: '2026-10-22T09:30:00Z', chainId: 'indicators', anchor: 'kpi', mode: 'guided',
    settingId: 'emr', correct: true, risk: 1, points: 10, source: 'offline', note: '',
  }],
  remediation: ['kgi'],
});

const post = (path: string, body: unknown, extra: { token?: string | null } = {}) =>
  call(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, ...extra });

describe('auth and CORS', () => {
  it('serves health without a token', async () => {
    expect((await call('/api/health', { token: null })).status).toBe(200);
  });

  it('refuses everything when the token hash is not configured', async () => {
    env.SYNC_TOKEN_SHA256 = undefined;
    expect((await call('/api/progress')).status).toBe(503);
  });

  it('rejects a missing or wrong token', async () => {
    expect((await call('/api/progress', { token: null })).status).toBe(401);
    expect((await call('/api/progress', { token: 'wrong' })).status).toBe(401);
  });

  it('allows listed origins only', async () => {
    const ok = await call('/api/progress');
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect((await call('/api/progress', { origin: 'https://evil.example' })).status).toBe(403);
    const pre = await call('/api/save', { method: 'OPTIONS', token: null });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('admits one subdomain label under a wildcard entry, and never a shared host', async () => {
    env.ALLOWED_ORIGINS = `${ORIGIN},https://*.quest.pages.dev,https://*.pages.dev`;
    const status = async (origin: string) => (await call('/api/progress', { origin })).status;
    expect(await status('https://a1b2c3d4.quest.pages.dev')).toBe(200);
    expect(await status('https://my-branch.quest.pages.dev')).toBe(200);
    expect(await status('https://quest.pages.dev')).toBe(403);
    expect(await status('https://a.b.quest.pages.dev')).toBe(403);
    expect(await status('http://a1b2c3d4.quest.pages.dev')).toBe(403);
    expect(await status('https://a1b2c3d4.quest.pages.dev:8443')).toBe(403);
    expect(await status('https://evilquest.pages.dev')).toBe(403);
    expect(await status('https://someone-else.pages.dev')).toBe(403);
  });

  it('answers unknown routes with 404', async () => {
    expect((await call('/api/nope')).status).toBe(404);
  });
});

describe('save and progress', () => {
  it('stores a save and returns it as progress', async () => {
    const res = await post('/api/save', savePayload('save-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'saved', terms: 1, events: 1 });
    const progress = await (await call('/api/progress')).json() as { terms: { id: string }[]; sessions: unknown[]; remediation: string[]; events: { id: string; correct: boolean }[] };
    expect(progress.terms.map((t) => t.id)).toEqual(['kpi']);
    expect(progress.events).toEqual([expect.objectContaining({ id: 'ev-1', correct: true, note: '' })]);
    expect(progress.sessions).toHaveLength(1);
    expect(progress.remediation).toEqual(['kgi']);
  });

  it('treats a repeated save id as already saved without duplicating anything', async () => {
    await post('/api/save', savePayload('save-1'));
    const again = await post('/api/save', savePayload('save-1', [term('kpi', '2026-10-23T00:00:00Z', 9)]));
    expect(await again.json()).toEqual({ status: 'already_saved' });
    const row = fake.db.prepare('SELECT attempts FROM term_progress WHERE term_id = ?').get('kpi') as { attempts: number };
    expect(row.attempts).toBe(1);
    expect((fake.db.prepare('SELECT COUNT(*) AS n FROM scene_events').get() as { n: number }).n).toBe(1);
  });

  it('keeps the newer copy of a term when an older save arrives later', async () => {
    await post('/api/save', savePayload('save-new', [term('kpi', '2026-10-22T12:00:00Z', 5)]));
    await post('/api/save', savePayload('save-old', [term('kpi', '2026-10-22T08:00:00Z', 2)]));
    const row = fake.db.prepare('SELECT attempts FROM term_progress WHERE term_id = ?').get('kpi') as { attempts: number };
    expect(row.attempts).toBe(5);
  });

  it('rejects malformed payloads before writing', async () => {
    const bad = savePayload('save-bad', [{ ...term('kpi', 'x'), id: 'DROP TABLE' }]);
    expect((await post('/api/save', bad)).status).toBe(400);
    expect((await post('/api/save', { ...savePayload('s'), terms: 'nope' })).status).toBe(400);
    expect((fake.db.prepare('SELECT COUNT(*) AS n FROM saves').get() as { n: number }).n).toBe(0);
  });

  it('refuses oversized bodies', async () => {
    const res = await post('/api/save', { ...savePayload('big'), padding: 'x'.repeat(600 * 1024) });
    expect(res.status).toBe(413);
  });
});

const packed = toBase64(packMatrix(new Map([
  ['kpi', { p: 0.9, evidence: 4, attempts: 4, state: 'mastered', lastAt: null }],
]) as MasteryMatrix));
const mastery = (updatedAt: string, reason = 'mastery', extra: Record<string, unknown> = {}) => ({
  packed, concepts: CONCEPTS.length, listVersion: LIST_VERSION, reason, updatedAt, ...extra,
});

describe('mastery matrix', () => {
  it('stores the packed matrix with its save and returns it as progress', async () => {
    const res = await post('/api/save', { ...savePayload('save-m'), mastery: mastery('2026-10-22T10:00:00Z') });
    expect(await res.json()).toMatchObject({ status: 'saved', mastery: true });
    const progress = await (await call('/api/progress')).json() as { mastery: unknown };
    expect(progress.mastery).toEqual(mastery('2026-10-22T10:00:00Z'));
  });

  it('keeps the newer matrix and accepts saves without one', async () => {
    await post('/api/save', { ...savePayload('a'), mastery: mastery('2026-10-22T12:00:00Z', 'struggle') });
    await post('/api/save', { ...savePayload('b'), mastery: mastery('2026-10-22T08:00:00Z', 'manual') });
    await post('/api/save', savePayload('c'));
    const row = fake.db.prepare("SELECT reason FROM mastery_matrix WHERE id = 'current'").get() as { reason: string };
    expect(row.reason).toBe('struggle');
    expect((await (await call('/api/progress')).json() as { mastery: { reason: string } }).mastery.reason).toBe('struggle');
  });

  it('refuses a malformed matrix before writing anything', async () => {
    const at = '2026-10-22T10:00:00Z';
    const bad = [
      mastery(at, 'because'),
      mastery(at, 'manual', { packed: 'not base64!' }),
      mastery(at, 'manual', { packed: packed.slice(0, -4) }),
      mastery(at, 'manual', { listVersion: (LIST_VERSION + 1) & 0xffff }),
      mastery(at, 'manual', { concepts: CONCEPTS.length + 8 }),
      mastery(at, 'manual', { concepts: 0 }),
    ];
    for (const [k, m] of bad.entries()) expect((await post('/api/save', { ...savePayload(`bad-${k}`), mastery: m })).status).toBe(400);
    expect((fake.db.prepare('SELECT COUNT(*) AS n FROM saves').get() as { n: number }).n).toBe(0);
    expect(((await (await call('/api/progress')).json()) as { mastery: unknown }).mastery).toBeNull();
  });
});

describe('generate', () => {
  it('reports 501 without a Workers AI binding', async () => {
    expect((await post('/api/generate', { system: 's', user: 'u' })).status).toBe(501);
  });

  it('runs the configured model and returns its text', async () => {
    const run = vi.fn(async () => ({ response: '{"ok":true}' }));
    env.AI = { run } as unknown as Ai;
    env.AI_MODEL = '@cf/test/model';
    const res = await post('/api/generate', { system: 's', user: 'u', maxTokens: 50 });
    expect(await res.json()).toEqual({ response: '{"ok":true}' });
    expect(run).toHaveBeenCalledWith('@cf/test/model', expect.objectContaining({ max_tokens: 50 }));
  });

  it('requires the token', async () => {
    env.AI = { run: vi.fn() } as unknown as Ai;
    expect((await post('/api/generate', { system: 's', user: 'u' }, { token: null })).status).toBe(401);
  });
});
