import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSceneRequest, startExpedition } from '../../engine/director';
import { defaultLlmSettings } from '../config';
import { activeBackend, evaluateNote, generateScene } from '..';
import { buildScenePrompt } from '../prompt';

const rng = () => 0.5;
const req = buildSceneRequest(startExpedition('deepfakes', { lastKind: null, now: 'n', rng }), () => undefined);
const noCloud = { url: '', token: '' };
const ollama = { ...defaultLlmSettings(), mode: 'ollama' as const };

const ollamaReplies = (response: string) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ response }), { status: 200 })));

afterEach(() => vi.unstubAllGlobals());

const aiScene = {
  narration: 'A video of the mayor spreads overnight.',
  prompt: 'What kind of capability made it?',
  choices: [
    { text: 'Generative AI', correct: true, consequence: 'c', explanation: 'e' },
    { text: 'Discriminative AI', correct: false, consequence: 'c', explanation: 'e' },
    { text: 'Rule-based AI', correct: false, consequence: 'c', explanation: 'e' },
    { text: 'Anomaly detection', correct: false, consequence: 'c', explanation: 'e' },
  ],
  socratic: 'Why?',
};

describe('scene generation', () => {
  it('uses the offline engine in auto mode when no AI is ready', () => {
    expect(activeBackend(defaultLlmSettings(), noCloud)).toBe('offline');
    expect(activeBackend(defaultLlmSettings(), { url: 'https://w', token: 't' })).toBe('cloud');
  });

  it('accepts a valid model scene', async () => {
    ollamaReplies(JSON.stringify(aiScene));
    const { scene, fallbackReason } = await generateScene(req, ollama, noCloud, rng);
    expect(fallbackReason).toBeUndefined();
    expect(scene.source).toBe('ai');
    expect(scene.choices.filter((c) => c.correct)).toHaveLength(1);
  });

  it('falls back to the offline engine on an invalid or failed model answer', async () => {
    ollamaReplies(JSON.stringify({ ...aiScene, choices: aiScene.choices.map((c) => ({ ...c, correct: true })) }));
    const bad = await generateScene(req, ollama, noCloud, rng);
    expect(bad.scene.source).toBe('offline');
    expect(bad.fallbackReason).toBeDefined();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused'); }));
    const down = await generateScene(req, ollama, noCloud, rng);
    expect(down.scene.source).toBe('offline');
    expect(down.fallbackReason).toContain('connection refused');
  });

  it('keeps calculation scenes offline so the arithmetic is exact', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const calc = { ...req, mode: 'calculation' as const };
    await generateScene(calc, ollama, noCloud, rng);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('puts the anchor definition and the story so far in the prompt', () => {
    const { system, user } = buildScenePrompt({ ...req, storySoFar: ['The mayor video went viral.'] });
    expect(user).toContain(req.anchor.definition);
    expect(user).toContain('The mayor video went viral.');
    expect(system).toContain('Exactly one choice is correct');
  });

  it('judges a field note with the model, or offline when the answer is unusable', async () => {
    ollamaReplies(JSON.stringify({ verdict: 'partial', feedback: 'Close — it is a capability.' }));
    expect((await evaluateNote(req, 'Generative AI', 'it makes stuff', ollama, noCloud)).source).toBe('ai');
    ollamaReplies('garbage');
    const offline = await evaluateNote(req, 'Generative AI', 'creates new content from learned patterns in data', ollama, noCloud);
    expect(offline.source).toBe('offline');
    expect(offline.verdict).toBe('solid');
  });
});
