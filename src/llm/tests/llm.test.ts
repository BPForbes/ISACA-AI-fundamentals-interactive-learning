import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSceneRequest, startExpedition } from '../../engine/director';
import { defaultLlmSettings } from '../config';
import { activeBackend, evaluateNote, generateScene } from '..';
import { buildScenePrompt } from '../prompt';

const rng = () => 0.5;
const req = buildSceneRequest(startExpedition('deepfakes', { lastKind: null, now: 'n', rng }), () => undefined);
const noCloud = { cloud: { url: '', token: '' }, hosted: { provider: 'groq' as const, baseUrl: '', model: '', apiKey: '', keyInCloud: false } };
const ollama = { ...defaultLlmSettings(), mode: 'ollama' as const };

const ollamaReplies = (response: string) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ response }), { status: 200 })));

// Replies in order, one per model call (generator, then critic, then generator…).
const ollamaSequence = (responses: string[]) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ response: responses.shift() ?? '{}' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => vi.unstubAllGlobals());

const aiScene = {
  narration: 'A video of the mayor confessing spreads overnight. Nobody filmed it, yet every frame looks real, and the newsroom needs to say what kind of system made it.',
  prompt: 'What kind of capability made it?',
  choices: [
    { text: 'Generative AI', correct: true, consequence: 'The newsroom investigates synthetic media.', explanation: 'Generative AI creates new content based on patterns learned from data.' },
    { text: 'Discriminative / Classification AI', correct: false, consequence: 'The team hunts for a classifier.', explanation: 'Discriminative AI classifies inputs rather than creating new content.' },
    { text: 'Rule-Based AI', correct: false, consequence: 'The team looks for hand-written rules.', explanation: 'Rule-based AI applies explicit IF/THEN rules; it does not create media.' },
    { text: 'Anomaly Detection', correct: false, consequence: 'The team describes detection.', explanation: 'Anomaly detection identifies unusual patterns rather than creating content.' },
  ],
  socratic: 'Why?',
};
const leaky = { ...aiScene, narration: `${aiScene.narration} It is obviously generative AI.` };
const rulesOnly = { ...ollama, discriminator: 'rules' as const };

describe('scene generation', () => {
  it('uses the offline engine in auto mode when no AI is ready', () => {
    expect(activeBackend(defaultLlmSettings(), noCloud)).toBe('offline');
    expect(activeBackend(defaultLlmSettings(), { ...noCloud, cloud: { url: 'https://w', token: 't' } })).toBe('cloud');
    // A free hosted model outranks Cloudflare, which is the last resort.
    expect(activeBackend(defaultLlmSettings(), { cloud: { url: 'https://w', token: 't' }, hosted: { ...noCloud.hosted, apiKey: 'k' } })).toBe('hosted');
  });

  it('accepts a valid model scene', async () => {
    ollamaReplies(JSON.stringify(aiScene));
    const { scene, fallbackReason } = await generateScene(req, ollama, noCloud, rng);
    expect(fallbackReason).toBeUndefined();
    expect(scene.source).toBe('ai');
    expect(scene.choices.filter((c) => c.correct)).toHaveLength(1);
  });

  it('sends a rejected draft back with the reasons and accepts the corrected one', async () => {
    const fetchMock = ollamaSequence([JSON.stringify(leaky), JSON.stringify(aiScene)]);
    const { scene } = await generateScene(req, rulesOnly, noCloud, rng);
    expect(scene.source).toBe('ai');
    expect(scene.review).toMatchObject({ rounds: 2, rejected: 1, critic: 'skipped' });
    const secondPrompt = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, { body: string }])[1].body).prompt as string;
    expect(secondPrompt).toContain('A reviewer rejected your previous draft');
    expect(secondPrompt).toContain('no giveaway');
    expect(secondPrompt).toContain('Reference template');
  });

  it('rejects a draft the blind critic answers differently, then accepts one it agrees with', async () => {
    // An unparseable critic answer does not block a scene that passed the rules.
    const replies = [JSON.stringify(aiScene), JSON.stringify({ answer: 'z' }), JSON.stringify(aiScene)];
    ollamaSequence(replies);
    const unsure = await generateScene(req, ollama, noCloud, rng);
    expect(unsure.scene.review?.critic).toBe('unavailable');

    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const prompt = JSON.parse(init.body).prompt as string;
      if (!prompt.includes('Which choice id is correct')) return new Response(JSON.stringify({ response: JSON.stringify(aiScene) }));
      const shown = JSON.parse(prompt.slice(prompt.indexOf('{'), prompt.lastIndexOf('}') + 1)) as { choices: { id: string; text: string }[] };
      // First critic call disagrees, second agrees.
      const pick = fetchMock.mock.calls.length <= 2
        ? shown.choices.find((c) => c.text !== 'Generative AI')!.id
        : shown.choices.find((c) => c.text === 'Generative AI')!.id;
      return new Response(JSON.stringify({ response: JSON.stringify({ answer: pick, contradicts_definition: false, issues: [] }) }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { scene } = await generateScene(req, ollama, noCloud, rng);
    expect(scene.review).toMatchObject({ rounds: 2, rejected: 1, critic: 'agreed' });
  });

  it('uses the template after every draft is rejected', async () => {
    ollamaSequence([JSON.stringify(leaky), JSON.stringify(leaky), JSON.stringify(leaky)]);
    const { scene, fallbackReason } = await generateScene(req, rulesOnly, noCloud, rng);
    expect(scene.source).toBe('offline');
    expect(fallbackReason).toMatch(/rejected 3 AI drafts/);
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

describe('free hosted backend', () => {
  it('writes scenes through the hosted model in auto mode', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiScene) } }] })));
    vi.stubGlobal('fetch', fetchMock);
    const b = { ...noCloud, hosted: { ...noCloud.hosted, apiKey: 'test-key' } };
    const { scene } = await generateScene(req, { ...defaultLlmSettings(), discriminator: 'rules' }, b, rng);
    expect(scene.source).toBe('ai');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('api.groq.com');
  });
});
