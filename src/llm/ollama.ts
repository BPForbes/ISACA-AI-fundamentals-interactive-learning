// Local Ollama backend. Same prompts as the browser model; a timeout keeps the
// game responsive by falling back to the offline generator.
const OLLAMA_TIMEOUT_MS = 60_000;

export const completeWithOllama = async (
  url: string,
  model: string,
  system: string,
  user: string,
): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model, system, prompt: user, stream: false, format: 'json', options: { temperature: 0.8 } }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { response?: string };
    return data.response ?? null;
  } finally {
    clearTimeout(timer);
  }
};
