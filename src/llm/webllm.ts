// In-browser model through WebLLM, kept lazy and singleton-scoped like the QPU
// lab so the multi-gigabyte download only starts when the learner asks for it.
//
// Caching: WebLLM keeps the downloaded weights in the browser's Cache Storage.
// This module remembers which model the learner chose, asks the browser to keep
// that storage persistent, and on later visits reloads the model from the cache
// automatically, so the download happens once per device.
import type { MLCEngine } from '@mlc-ai/web-llm';

let enginePromise: Promise<MLCEngine> | null = null;
let loadedModelId: string | null = null;
let readyModelId: string | null = null;

const REMEMBER_KEY = 'isaca-quest-browser-model-v1';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Subscribes to "a browser model became ready or was removed"; returns the unsubscribe. */
export const onBrowserModelChange = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const hasWebGpu = (): boolean => typeof navigator !== 'undefined' && 'gpu' in navigator;

export const isBrowserModelReady = (modelId: string): boolean => readyModelId === modelId;

export const rememberedBrowserModel = (): string | null => {
  try {
    return localStorage.getItem(REMEMBER_KEY);
  } catch {
    return null;
  }
};

const remember = (modelId: string | null) => {
  try {
    if (modelId) localStorage.setItem(REMEMBER_KEY, modelId);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // Without storage the model is still cached; it just will not auto-load.
  }
};

/** Asks the browser not to evict the cached weights under storage pressure. */
const persistStorage = async (): Promise<boolean> => {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
};

export const isModelCached = async (modelId: string): Promise<boolean> => {
  try {
    const { hasModelInCache } = await import('@mlc-ai/web-llm');
    return await hasModelInCache(modelId);
  } catch {
    return false;
  }
};

const getEngine = (modelId: string, onProgress?: (text: string) => void): Promise<MLCEngine> => {
  if (enginePromise && loadedModelId !== modelId) {
    enginePromise = null;
    readyModelId = null;
  }
  if (!enginePromise) {
    loadedModelId = modelId;
    enginePromise = (async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
      const engine = await CreateMLCEngine(modelId, {
        initProgressCallback: (p) => {
          const pct = typeof p.progress === 'number' ? ` (${Math.round(p.progress * 100)}%)` : '';
          onProgress?.(`${p.text ?? 'Loading browser model…'}${pct}`);
        },
      });
      readyModelId = modelId;
      notify();
      return engine;
    })().catch((error) => {
      enginePromise = null;
      loadedModelId = null;
      throw error;
    });
  }
  return enginePromise;
};

// The first load is an explicit learner action because the download is large.
export const preloadBrowserModel = async (modelId: string, onProgress?: (text: string) => void): Promise<boolean> => {
  if (!hasWebGpu()) return false;
  await getEngine(modelId, onProgress);
  remember(modelId);
  await persistStorage();
  return true;
};

/**
 * On page load: if the learner loaded a model before and its weights are still
 * cached, load it again from the cache (no download). Returns the model id
 * restored, or null when there was nothing cached to restore.
 */
export const restoreCachedBrowserModel = async (onProgress?: (text: string) => void): Promise<string | null> => {
  const modelId = rememberedBrowserModel();
  if (!modelId || !hasWebGpu() || !(await isModelCached(modelId))) return null;
  await getEngine(modelId, onProgress);
  return modelId;
};

/** Removes the model from this device's cache and stops auto-loading it. */
export const removeCachedBrowserModel = async (modelId: string): Promise<void> => {
  if (loadedModelId === modelId) {
    const engine = enginePromise;
    enginePromise = null;
    loadedModelId = null;
    readyModelId = null;
    await engine?.then((e) => e.unload()).catch(() => undefined);
  }
  if (rememberedBrowserModel() === modelId) remember(null);
  const { deleteModelAllInfoInCache } = await import('@mlc-ai/web-llm');
  await deleteModelAllInfoInCache(modelId);
  notify();
};

export const completeWithWebLlm = async (
  modelId: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string | null> => {
  if (!hasWebGpu() || !isBrowserModelReady(modelId)) return null;
  const engine = await getEngine(modelId);
  const response = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.8,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  });
  return response.choices[0]?.message?.content ?? null;
};
