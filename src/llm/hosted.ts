// Free hosted models through OpenAI-compatible chat APIs, called straight from
// the browser with the learner's own API key. These are far larger than a model
// that fits in a browser, and each has a free tier. Free tiers and model names
// change often, so the model list is read live from the provider when possible.
//
// The key is kept one of two ways:
// - in this browser's localStorage, sent only to the chosen provider; or
// - uploaded to the learner's own Worker vault (worker/src/vault.ts), where it
//   is stored AES-GCM encrypted and never returned; the browser then keeps no
//   copy, and calls go through the Worker, which adds the key server-side.
import { isCloudConfigured, vaultChat, vaultModels, type CloudConfig } from '../sync/cloud';

export type HostedProviderId = 'groq' | 'gemini' | 'openrouter' | 'custom';

export type HostedProvider = {
  id: HostedProviderId;
  label: string;
  baseUrl: string;
  defaultModel: string;
  keyUrl: string;
  note: string;
  // Keeps only chat models worth offering from the provider's /models list.
  keep: (id: string) => boolean;
  // Preference order when the default model is not in the live list.
  prefer: RegExp[];
};

export const HOSTED_PROVIDERS: Record<HostedProviderId, HostedProvider> = {
  groq: {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    keyUrl: 'https://console.groq.com/keys',
    note: 'Free tier, no card. A 120B open model, very fast; roughly 1,000 requests a day.',
    keep: (id) => !/whisper|tts|guard|orpheus|playai|distil/i.test(id),
    prefer: [/gpt-oss-120b/, /qwen/i, /llama/i],
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.5-flash-lite',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Free tier, no card. Flash-Lite models get the most free requests; full Flash is stronger but has a small daily cap. Outside the EEA, UK and Switzerland, free-tier prompts may be used to improve Google products.',
    keep: (id) => /gemini/i.test(id) && !/embedding|image|tts|audio|live/i.test(id),
    prefer: [/flash-lite/i, /flash/i],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (free models)',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: '',
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Many models; only those ending in ":free" are listed. About 50 free requests a day without credits.',
    keep: (id) => id.endsWith(':free'),
    prefer: [/qwen.*(235|72|32)b/i, /deepseek/i, /llama.*70b/i, /gpt-oss/i],
  },
  custom: {
    id: 'custom',
    label: 'Other OpenAI-compatible API',
    baseUrl: '',
    defaultModel: '',
    keyUrl: '',
    note: 'Any service with an OpenAI-compatible /chat/completions endpoint that allows browser requests.',
    keep: () => true,
    prefer: [],
  },
};

export type HostedConfig = {
  provider: HostedProviderId;
  baseUrl: string;
  model: string;
  // Empty when the key lives in the cloud vault.
  apiKey: string;
  keyInCloud: boolean;
};

const STORAGE_KEY = 'isaca-quest-hosted-v1';
const TIMEOUT_MS = 60_000;

export const defaultHostedConfig = (): HostedConfig => ({ provider: 'groq', baseUrl: '', model: '', apiKey: '', keyInCloud: false });

export const loadHostedConfig = (): HostedConfig => {
  const d = defaultHostedConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<HostedConfig>) : {};
    return {
      provider: p.provider && p.provider in HOSTED_PROVIDERS ? p.provider : d.provider,
      baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : '',
      model: typeof p.model === 'string' ? p.model : '',
      apiKey: typeof p.apiKey === 'string' && p.keyInCloud !== true ? p.apiKey : '',
      keyInCloud: p.keyInCloud === true,
    };
  } catch {
    return d;
  }
};

export const saveHostedConfig = (c: HostedConfig) => {
  try {
    // A key held in the vault is never written to browser storage.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...c, apiKey: c.keyInCloud ? '' : c.apiKey.trim(), baseUrl: c.baseUrl.trim() }));
  } catch {
    // Without storage the settings last for the tab only.
  }
};

export const baseUrlOf = (c: HostedConfig): string =>
  (c.provider === 'custom' ? c.baseUrl : HOSTED_PROVIDERS[c.provider].baseUrl).trim().replace(/\/+$/, '');

export const modelOf = (c: HostedConfig): string => c.model.trim() || HOSTED_PROVIDERS[c.provider].defaultModel;

/** The vault serves the preset providers only, never a custom URL. */
export const vaultSupports = (provider: HostedProviderId): boolean => provider !== 'custom';

export const isHostedConfigured = (c: HostedConfig, cloud?: CloudConfig): boolean =>
  c.keyInCloud
    ? vaultSupports(c.provider) && Boolean(cloud && isCloudConfigured(cloud) && modelOf(c))
    : Boolean(c.apiKey.trim() && baseUrlOf(c) && modelOf(c));

export class HostedError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const describe = (c: HostedConfig, status: number, body: string): string => {
  const name = HOSTED_PROVIDERS[c.provider].label;
  if (status === 401 || status === 403) return `${name} rejected the API key.`;
  if (status === 429) return `${name}'s free-tier limit was reached; try again later or switch provider.`;
  if (status === 404) return `${name} does not know the model "${modelOf(c)}". Load the model list in Settings.`;
  const detail = body.replace(/[\u0000-\u001f]/g, ' ').slice(0, 160);
  return `${name} answered ${status}${detail ? `: ${detail}` : ''}`;
};

const post = async (c: HostedConfig, body: Record<string, unknown>): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${baseUrlOf(c)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey.trim()}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * One chat completion. JSON mode is requested first; a few models reject that
 * option, so a 400 is retried once without it (sanitizeScene validates either way).
 */
export const completeWithHosted = async (
  c: HostedConfig,
  system: string,
  user: string,
  maxTokens: number,
  cloud?: CloudConfig,
): Promise<string | null> => {
  if (c.keyInCloud) {
    if (!cloud || !isCloudConfigured(cloud)) throw new HostedError(0, 'The key is in your cloud vault; connect cloud sync in Settings.');
    return vaultChat(cloud, c.provider, { model: modelOf(c), system, user, maxTokens });
  }
  const base = {
    model: modelOf(c),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.8,
    max_tokens: maxTokens,
  };
  let response = await post(c, { ...base, response_format: { type: 'json_object' } });
  if (response.status === 400) response = await post(c, base);
  if (!response.ok) throw new HostedError(response.status, describe(c, response.status, await response.text()));
  const data = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
  return data.choices?.[0]?.message?.content ?? null;
};

/** The provider's live model list, filtered to chat models and sorted with the preferred ones first. */
export const listHostedModels = async (c: HostedConfig, cloud?: CloudConfig): Promise<string[]> => {
  let raw: string[];
  if (c.keyInCloud) {
    if (!cloud || !isCloudConfigured(cloud)) throw new HostedError(0, 'The key is in your cloud vault; connect cloud sync in Settings.');
    raw = await vaultModels(cloud, c.provider);
  } else {
    const response = await fetch(`${baseUrlOf(c)}/models`, { headers: { Authorization: `Bearer ${c.apiKey.trim()}` } });
    if (!response.ok) throw new HostedError(response.status, describe(c, response.status, await response.text()));
    const data = (await response.json()) as { data?: { id?: unknown }[] };
    raw = (data.data ?? []).map((m) => (typeof m.id === 'string' ? m.id : ''));
  }
  const provider = HOSTED_PROVIDERS[c.provider];
  const ids = raw
    .map((id) => id.replace(/^models\//, ''))
    .filter((id) => id && provider.keep(id));
  const rank = (id: string) => {
    const i = provider.prefer.findIndex((r) => r.test(id));
    return i < 0 ? provider.prefer.length : i;
  };
  return [...new Set(ids)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
};

/** Picks the configured model if the provider still offers it, else its best available one. */
export const chooseModel = (c: HostedConfig, available: string[]): string => {
  const wanted = modelOf(c);
  if (wanted && available.includes(wanted)) return wanted;
  return available[0] ?? wanted;
};
