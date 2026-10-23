import { describe, expect, it } from 'vitest';
import { CHAINS } from '../chains';
import { CHALLENGES, challengeFor } from '../challenges';
import { SETTINGS } from '../settings';
import { TERM_BY_ID } from '../terms';
import { runLab } from '../../engine/lab';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const anchors = new Set(CHAINS.flatMap((c) => c.steps.map((s) => s.anchor)));

describe('lab challenges', () => {
  it('cover chain anchors only, name real terms, and keep their briefs hypothetical', () => {
    for (const c of CHALLENGES) {
      expect(anchors.has(c.anchor), c.anchor).toBe(true);
      expect(c.terms[0]).toBe(c.anchor);
      for (const t of c.terms) expect(TERM_BY_ID.has(t), `${c.anchor} names ${t}`).toBe(true);
      for (const setting of SETTINGS) {
        const brief = c.brief(setting);
        expect(brief).toContain('Suppose');
        expect(brief).toContain(setting.name);
        // The brief never hands over the exam definition.
        expect(brief).not.toContain(TERM_BY_ID.get(c.anchor)!.definition);
      }
    }
    expect(new Set(CHALLENGES.map((c) => c.anchor)).size).toBe(CHALLENGES.length);
    expect(challengeFor('recall')?.stage).toBe('evaluate');
    expect(challengeFor('no-such-anchor')).toBeUndefined();
  });

  it('start broken and are solved by the concept, on every seed', () => {
    for (const c of CHALLENGES) {
      const broken = SEEDS.filter((s) => c.goal.met(runLab(c.setup(s))));
      const solved = SEEDS.filter((s) => c.goal.met(runLab(c.solution(c.setup(s)))));
      // A tiny sample can get lucky; a setup that is already solved on more than one seed in eight is not broken.
      expect(broken.length, `${c.anchor} is already solved on seeds ${broken.join(', ')}`).toBeLessThanOrEqual(1);
      expect(solved, `${c.anchor} is not solved by its solution`).toEqual(SEEDS);
    }
  });

  it('re-seeds to a different setup, so a miss is retried on new data', () => {
    const c = challengeFor('recall')!;
    expect(runLab(c.setup(1)).validation).not.toEqual(runLab(c.setup(2)).validation);
  });
});
