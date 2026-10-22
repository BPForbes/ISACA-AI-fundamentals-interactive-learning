// A scene is one beat of an expedition: narration, a decision, and choices whose
// consequences carry into the next beat. Scenes come from a language model or
// from the offline generator; both pass through sanitizeScene, the only path
// by which generated text reaches the game.

export type TeachingMode =
  | 'diagnostic'
  | 'explain'
  | 'guided'
  | 'contrast'
  | 'calculation'
  | 'integration'
  | 'remediation'
  | 'maintenance';

export const MODE_LABELS: Record<TeachingMode, string> = {
  diagnostic: 'Diagnostic',
  explain: 'Explain',
  guided: 'Guided practice',
  contrast: 'Contrast drill',
  calculation: 'Calculation drill',
  integration: 'Integration drill',
  remediation: 'Remediation',
  maintenance: 'Maintenance',
};

export type Choice = {
  id: string;
  text: string;
  correct: boolean;
  consequence: string;
  explanation: string;
};

/** How the discriminator judged an AI scene before it was shown. */
export type SceneReview = {
  rounds: number;
  rejected: number;
  score: number;
  critic: 'agreed' | 'skipped' | 'unavailable';
};

export type Scene = {
  narration: string;
  prompt: string;
  choices: Choice[];
  socratic: string;
  source: 'ai' | 'offline';
  review?: SceneReview;
};

const MAX_TEXT = 1200;
const MIN_CHOICES = 3;
const MAX_CHOICES = 4;

const text = (value: unknown, max = MAX_TEXT): string | null => {
  if (typeof value !== 'string') return null;
  // Drop control characters a model may emit; keep newlines for paragraphs.
  const cleaned = value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
  return cleaned ? cleaned.slice(0, max) : null;
};

const bool = (value: unknown): boolean => {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
  return false;
};

/**
 * Model output is untrusted. A scene is accepted only with 3–4 distinct choices
 * of which exactly one is correct; anything else returns null and the caller
 * falls back to the offline generator.
 */
export const sanitizeScene = (raw: unknown): Omit<Scene, 'source' | 'review'> | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const narration = text(r.narration);
  const prompt = text(r.prompt, 400);
  if (!narration || !prompt || !Array.isArray(r.choices)) return null;

  const seen = new Set<string>();
  const choices: Choice[] = [];
  for (const entry of r.choices.slice(0, MAX_CHOICES)) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    const choiceText = text(c.text, 300);
    if (!choiceText || seen.has(choiceText.toLowerCase())) continue;
    seen.add(choiceText.toLowerCase());
    choices.push({
      id: String.fromCharCode(97 + choices.length),
      text: choiceText,
      correct: bool(c.correct),
      consequence: text(c.consequence, 500) ?? '',
      explanation: text(c.explanation, 600) ?? '',
    });
  }

  if (choices.length < MIN_CHOICES) return null;
  if (choices.filter((c) => c.correct).length !== 1) return null;

  return {
    narration,
    prompt,
    choices,
    socratic: text(r.socratic, 300) ?? 'In your own words, what decided it?',
  };
};

/** Models tend to list the right answer first; shuffle so position carries no clue. */
export const shuffleChoices = (choices: Choice[], rng: () => number): Choice[] => {
  const out = [...choices];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.map((c, i) => ({ ...c, id: String.fromCharCode(97 + i) }));
};

/** Extracts the first JSON object from model text that may be wrapped in prose or fences. */
export const extractJson = (content: string): unknown => {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
};
