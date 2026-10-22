import { describe, expect, it } from 'vitest';
import { CHAINS } from '../../data/chains';
import { TERM_BY_ID } from '../../data/terms';
import { buildSceneRequest, startExpedition, type SceneRequest } from '../director';
import { drawMatrix, generateOfflineScene, keywordOverlap, mentionsTerm } from '../offline';
import { sanitizeScene, type TeachingMode } from '../scene';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const MODES: TeachingMode[] = ['diagnostic', 'explain', 'guided', 'contrast', 'integration', 'remediation', 'maintenance'];

const requests = (): SceneRequest[] => CHAINS.flatMap((chain) => chain.steps.map((_, i) => {
  const exp = { ...startExpedition(chain.id, { lastKind: null, now: 'n', rng: seeded(1) }), stepIndex: i };
  return buildSceneRequest(exp, () => undefined);
}));

describe('offline scene generator', () => {
  it('produces a valid scene with the anchor as the one right answer for every link and mode', () => {
    for (const req of requests()) {
      for (const mode of MODES) {
        for (const stage of [1, 3] as const) {
          const scene = generateOfflineScene({ ...req, mode, stage }, seeded(7));
          expect(sanitizeScene(scene), `${req.anchor.id}/${mode}`).not.toBeNull();
          const right = scene.choices.find((c) => c.correct)!;
          expect([req.anchor.term, req.anchor.definition]).toContain(right.text);
        }
      }
    }
  });

  it('does not name the anchor in a scaffold scene', () => {
    for (const req of requests()) {
      const scene = generateOfflineScene({ ...req, mode: 'diagnostic', stage: 1 }, seeded(5));
      expect(mentionsTerm(scene.narration, req.anchor), req.anchor.id).toBe(false);
    }
    expect(mentionsTerm('whether it is current ANI', TERM_BY_ID.get('ani')!)).toBe(true);
    expect(mentionsTerm('CNNs can classify images', TERM_BY_ID.get('cnn')!)).toBe(true);
  });

  it('never offers a synonym of the anchor as a distractor', () => {
    const req = requests().find((r) => r.anchor.id === 'parameter-update')!;
    const scene = generateOfflineScene({ ...req, mode: 'guided', stage: 1 }, seeded(3));
    const terms = scene.choices.map((c) => c.text);
    expect(terms).not.toContain(TERM_BY_ID.get('training')!.term);
    expect(terms).not.toContain(TERM_BY_ID.get('model-training')!.term);
  });

  it('computes confusion-matrix metrics with distinct values', () => {
    for (let seed = 1; seed < 40; seed += 1) {
      const m = drawMatrix(seeded(seed));
      const values = [m.tp / (m.tp + m.fp), m.tp / (m.tp + m.fn), m.tn / (m.tn + m.fp)];
      expect(new Set(values.map((v) => v.toFixed(3))).size).toBe(3);
    }
    const req = requests().find((r) => r.anchor.id === 'recall')!;
    const scene = generateOfflineScene({ ...req, mode: 'calculation' }, seeded(11));
    const counts = scene.narration.match(/\d+/g)!.map(Number);
    const [, actualPos, flagged, rightFlags] = counts;
    const right = scene.choices.find((c) => c.correct)!;
    expect(right.text).toBe(`${Math.round((rightFlags / actualPos) * 1000) / 10}%`);
    expect(flagged).toBeGreaterThanOrEqual(rightFlags);
  });

  it('terminates with a valid matrix even when the random source is constant', () => {
    const m = drawMatrix(() => 0.5);
    expect(new Set([m.tp, m.fn, m.fp, m.tn]).size).toBe(4);
  });

  it('scores explanation overlap against the definition', () => {
    const def = TERM_BY_ID.get('recall')!.definition;
    expect(keywordOverlap('of all the actual positives, the fraction the model correctly found', def)).toBeGreaterThan(0.4);
    expect(keywordOverlap('something about money', def)).toBeLessThan(0.2);
  });
});
