import { describe, expect, it } from 'vitest';
import { CHAINS } from '../../data/chains';
import { buildSceneRequest, startExpedition } from '../director';
import { judgeRules, parseCritic } from '../discriminator';
import { generateOfflineScene } from '../offline';
import type { Scene } from '../scene';

const rng = () => 0.37;
const req = buildSceneRequest(startExpedition('deepfakes', { lastKind: null, now: 'n', rng }), () => undefined);
const template = generateOfflineScene(req, rng);

const good: Scene = {
  narration: 'A clip of the mayor admitting to fraud spreads overnight. Raj notices the lighting shifts between frames and the audio was never recorded at any event. Tess needs to brief the newsroom on what kind of system could have produced it.',
  prompt: 'How should Tess describe the capability behind the clip?',
  choices: [
    { id: 'a', text: 'Generative AI', correct: true, consequence: 'The newsroom frames the story around synthetic content and checks provenance.', explanation: 'Generative AI creates new content based on patterns learned from data, which is what the clip is.' },
    { id: 'b', text: 'Discriminative / Classification AI', correct: false, consequence: 'The team looks for a classifier and misses the point.', explanation: 'Discriminative AI labels or classifies inputs rather than creating new content.' },
    { id: 'c', text: 'Transformer', correct: false, consequence: 'The brief names an architecture, not a capability.', explanation: 'A Transformer is an architecture often used for generation; generative AI is the capability.' },
    { id: 'd', text: 'Anomaly Detection', correct: false, consequence: 'The brief describes detection, not creation.', explanation: 'Anomaly detection identifies unusual patterns; it does not create media.' },
  ],
  socratic: 'What made this creation rather than classification?',
  source: 'ai',
};

describe('rule discriminator', () => {
  it('accepts every offline template as a real sample', () => {
    for (const chain of CHAINS) {
      const exp = startExpedition(chain.id, { lastKind: null, now: 'n', rng });
      for (let i = 0; i < chain.steps.length; i += 1) {
        const r = buildSceneRequest({ ...exp, stepIndex: i }, () => undefined);
        if (r.mode === 'calculation') continue;
        const t = generateOfflineScene(r, rng);
        expect(judgeRules(t, r, t).checks.filter((c) => c.hard && !c.ok), r.anchor.id).toEqual([]);
      }
    }
  });

  it('accepts a faithful AI scene', () => {
    const v = judgeRules(good, req, template);
    expect(v.pass).toBe(true);
    expect(v.score).toBe(1);
  });

  it('rejects a scene that names the answer before the learner knows the term', () => {
    const leak = { ...good, narration: `${good.narration} Clearly this is generative AI at work.` };
    const v = judgeRules(leak, req, template);
    expect(v.pass).toBe(false);
    expect(v.issues.join(' ')).toMatch(/no giveaway/);
  });

  it('rejects a mis-keyed scene and one with two right answers', () => {
    const miskeyed = { ...good, choices: good.choices.map((c) => ({ ...c, correct: c.id === 'd' })) };
    expect(judgeRules(miskeyed, req, template).issues.join(' ')).toMatch(/answer key/);
    const twoRight = { ...good, choices: good.choices.map((c) => (c.id === 'c' ? { ...c, text: 'Generative AI built on a Transformer' } : c)) };
    expect(judgeRules(twoRight, req, template).issues.join(' ')).toMatch(/single right answer/);
  });

  it('rejects a model draft that recites the definition instead of applying it', () => {
    const recital = { ...good, narration: `Tess reads from the glossary: ${req.anchor.definition} Which term is that?` };
    expect(judgeRules(recital, req, template).pass).toBe(true);
    const v = judgeRules(recital, req, template, { applied: true });
    expect(v.pass).toBe(false);
    expect(v.issues.join(' ')).toMatch(/applied situation/);
    expect(judgeRules(good, req, template, { applied: true }).pass).toBe(true);
    // Explain scenes may teach the definition first.
    expect(judgeRules(recital, { ...req, mode: 'explain' }, template, { applied: true }).checks.map((c) => c.name)).not.toContain('applied situation');
  });
});

describe('critic parsing', () => {
  it('accepts a known choice id and ignores junk', () => {
    expect(parseCritic({ answer: 'B', contradicts_definition: false, issues: ['ok'] }, ['a', 'b'])).toEqual({ answer: 'b', contradicts: false, issues: ['ok'] });
    expect(parseCritic({ answer: 'z' }, ['a', 'b'])).toBeNull();
    expect(parseCritic('nope', ['a'])).toBeNull();
  });
});
