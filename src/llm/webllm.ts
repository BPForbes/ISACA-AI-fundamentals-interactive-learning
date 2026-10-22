// In-browser model through WebLLM, kept lazy and singleton-scoped like the QPU
// lab so the multi-gigabyte download only starts when the learner asks for it.
import type { MLCEngine } from '@mlc-ai/web-llm';

let enginePromise: Promise<MLCEngine> | null = null;
let loadedModelId: string | null = null;
let readyModelId: string | null = null;

export const hasWebGpu = (): boolean => typeof navigator !== 'undefined' && 'gpu' in navigator;

export const isBrowserModelReady = (modelId: string): boolean => readyModelId === modelId;

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
      return engine;
    })().catch((error) => {
      enginePromise = null;
      loadedModelId = null;
      throw error;
    });
  }
  return enginePromise;
};

// Loading is an explicit learner action because the first download is large.
export const preloadBrowserModel = async (modelId: string, onProgress?: (text: string) => void): Promise<boolean> => {
  if (!hasWebGpu()) return false;
  await getEngine(modelId, onProgress);
  return true;
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
