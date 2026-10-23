import { describe, expect, it } from 'vitest';
import { BRIEFS } from '../briefs';
import { GOALS, goalFor, STAGES } from '../goals';
import { TERM_BY_ID } from '../terms';
import { UPGRADES } from '../upgrades';
import { defaultLab, runLab } from '../../engine/lab';

const SEEDS = [1, 2, 3, 4, 5];

describe('lab goals', () => {
  it('name real terms, cover every stage, and keep their briefs hypothetical', () => {
    for (const g of GOALS) {
      expect(TERM_BY_ID.has(g.anchor), g.anchor).toBe(true);
      expect(g.terms[0]).toBe(g.anchor);
      for (const t of g.terms) expect(TERM_BY_ID.has(t), `${g.anchor} names ${t}`).toBe(true);
      for (const c of g.needs ?? []) expect(UPGRADES.some((u) => u.gives === c), `${g.anchor} needs ${c}`).toBe(true);
      for (const brief of BRIEFS) {
        const text = g.brief(brief);
        expect(text).toContain('Suppose');
        expect(text.toLowerCase()).toContain(brief.owner.toLowerCase());
        // The brief never hands over the exam definition.
        expect(text).not.toContain(TERM_BY_ID.get(g.anchor)!.definition);
      }
    }
    expect(new Set(GOALS.map((g) => g.anchor)).size).toBe(GOALS.length);
    for (const stage of STAGES) expect(GOALS.filter((g) => g.stage === stage).length).toBeGreaterThanOrEqual(5);
    expect(goalFor('recall')?.stage).toBe('decide');
    expect(goalFor('no-such-anchor')).toBeUndefined();
  });

  for (const stage of STAGES) {
    it(`${stage}: every goal starts broken and is solved by its concept, on every seed`, () => {
      for (const g of GOALS.filter((x) => x.stage === stage)) {
        const broken = SEEDS.filter((s) => g.goal.met(runLab(g.setup(defaultLab(s), s))));
        const solved = SEEDS.filter((s) => g.goal.met(runLab(g.solution(g.setup(defaultLab(s), s)))));
        // A lucky seed is tolerated once; a setup that is already solved more often is not broken.
        expect(broken.length, `${g.anchor} is already solved on seeds ${broken.join(', ')}`).toBeLessThanOrEqual(1);
        expect(solved, `${g.anchor} is not solved by its solution`).toEqual(SEEDS);
      }
    }, 90000);
  }

  it('re-seeds to a different setup, so a miss is retried on new data', () => {
    const g = goalFor('recall')!;
    expect(runLab(g.setup(defaultLab(1), 1)).validation).not.toEqual(runLab(g.setup(defaultLab(1), 2)).validation);
  });
});
