import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseModel, completeWithHosted, isHostedConfigured, listHostedModels, type HostedConfig } from '../hosted';

const KEY = `k-${Math.random().toString(36).slice(2)}`;
const groq: HostedConfig = { provider: 'groq', baseUrl: '', model: '', apiKey: KEY };

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('hosted models', () => {
  it('needs a key; uses the provider default model', () => {
    expect(isHostedConfigured({ ...groq, apiKey: '' })).toBe(false);
    expect(isHostedConfigured(groq)).toBe(true);
    expect(isHostedConfigured({ provider: 'custom', baseUrl: '', model: 'm', apiKey: KEY })).toBe(false);
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
    const gemini: HostedConfig = { provider: 'gemini', baseUrl: '', model: '', apiKey: KEY };
    const list = await listHostedModels(gemini);
    expect(list).toEqual(['gemini-3.5-flash-lite', 'gemini-3.5-flash']);

    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { data: [{ id: 'paid/model' }, { id: 'meta/llama-3.3-70b:free' }, { id: 'qwen/qwen3-235b:free' }] })));
    expect(await listHostedModels({ provider: 'openrouter', baseUrl: '', model: '', apiKey: KEY })).toEqual(['qwen/qwen3-235b:free', 'meta/llama-3.3-70b:free']);
  });

  it('keeps the chosen model if still offered, else picks the best available', () => {
    expect(chooseModel(groq, ['qwen/x', 'openai/gpt-oss-120b'])).toBe('openai/gpt-oss-120b');
    expect(chooseModel({ ...groq, model: 'retired-model' }, ['qwen/x'])).toBe('qwen/x');
  });
});
