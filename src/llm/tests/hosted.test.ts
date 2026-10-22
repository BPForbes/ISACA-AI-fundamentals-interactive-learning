import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseModel, completeWithHosted, isHostedConfigured, listHostedModels, loadHostedConfig, saveHostedConfig, type HostedConfig } from '../hosted';

const KEY = `k-${Math.random().toString(36).slice(2)}`;
const groq: HostedConfig = { provider: 'groq', baseUrl: '', model: '', apiKey: KEY, keyInCloud: false };

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('hosted models', () => {
  it('needs a key; uses the provider default model', () => {
    expect(isHostedConfigured({ ...groq, apiKey: '' })).toBe(false);
    expect(isHostedConfigured(groq)).toBe(true);
    expect(isHostedConfigured({ provider: 'custom', baseUrl: '', model: 'm', apiKey: KEY, keyInCloud: false })).toBe(false);
  });

  it('posts to the provider with the key and JSON mode', async () => {
    const fetchMock = vi.fn(async () => reply(200, { choices: [{ message: { content: '{"ok":true}' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await completeWithHosted(groq, 's', 'u', 50)).toBe('{"ok":true}');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'openai/gpt-oss-120b', max_tokens: 50, response_format: { type: 'json_object' } });
  });

  it('retries once without JSON mode when the model rejects it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(400, { error: 'response_format not supported' }))
      .mockResolvedValueOnce(reply(200, { choices: [{ message: { content: '{}' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await completeWithHosted(groq, 's', 'u', 50)).toBe('{}');
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).response_format).toBeUndefined();
  });

  it('explains rate limits and bad keys without echoing the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(429, { error: 'slow down' })));
    await expect(completeWithHosted(groq, 's', 'u', 50)).rejects.toThrow(/free-tier limit/);
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: 'bad key' })));
    const error = await completeWithHosted(groq, 's', 'u', 50).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/rejected the API key/);
    expect((error as Error).message).not.toContain(KEY);
  });

  it('lists only usable models, preferred first, and strips Gemini prefixes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { data: [
      { id: 'models/gemini-embedding-001' }, { id: 'models/gemini-3.5-flash' }, { id: 'models/gemini-3.5-flash-lite' },
    ] })));
    const gemini: HostedConfig = { provider: 'gemini', baseUrl: '', model: '', apiKey: KEY, keyInCloud: false };
    const list = await listHostedModels(gemini);
    expect(list).toEqual(['gemini-3.5-flash-lite', 'gemini-3.5-flash']);

    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { data: [{ id: 'paid/model' }, { id: 'meta/llama-3.3-70b:free' }, { id: 'qwen/qwen3-235b:free' }] })));
    expect(await listHostedModels({ provider: 'openrouter', baseUrl: '', model: '', apiKey: KEY, keyInCloud: false })).toEqual(['qwen/qwen3-235b:free', 'meta/llama-3.3-70b:free']);
  });

  it('keeps the chosen model if still offered, else picks the best available', () => {
    expect(chooseModel(groq, ['qwen/x', 'openai/gpt-oss-120b'])).toBe('openai/gpt-oss-120b');
    expect(chooseModel({ ...groq, model: 'retired-model' }, ['qwen/x'])).toBe('qwen/x');
  });
});

describe('hosted key in the cloud vault', () => {
  const cloud = { url: 'https://sync.example.workers.dev', token: `sync-${Math.random().toString(36).slice(2)}` };
  const inVault: HostedConfig = { ...groq, apiKey: '', keyInCloud: true };

  it('is usable only with cloud sync connected, and never for custom URLs', () => {
    expect(isHostedConfigured(inVault)).toBe(false);
    expect(isHostedConfigured(inVault, cloud)).toBe(true);
    expect(isHostedConfigured({ ...inVault, provider: 'custom', model: 'm' }, cloud)).toBe(false);
  });

  it('sends requests to the Worker vault with the sync token, not a provider key', async () => {
    const fetchMock = vi.fn(async () => reply(200, { response: '{"ok":true}' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await completeWithHosted(inVault, 's', 'u', 40, cloud)).toBe('{"ok":true}');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${cloud.url}/api/vault/groq/chat`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${cloud.token}`);
    expect(JSON.parse(init.body as string)).toEqual({ model: 'openai/gpt-oss-120b', system: 's', user: 'u', maxTokens: 40 });
    await expect(completeWithHosted(inVault, 's', 'u', 40)).rejects.toThrow(/cloud vault/);
  });

  it('lists models through the vault', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { models: ['whisper-large', 'openai/gpt-oss-120b'] })));
    expect(await listHostedModels(inVault, cloud)).toEqual(['openai/gpt-oss-120b']);
  });

  it('never writes a vaulted key to browser storage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    saveHostedConfig({ ...groq, keyInCloud: true });
    expect([...store.values()].join()).not.toContain(KEY);
    expect(loadHostedConfig()).toMatchObject({ keyInCloud: true, apiKey: '' });
  });
});
