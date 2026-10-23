import { describe, expect, it } from 'vitest';
import { BASELINE, fitAttention, masteryEvent, masteryMatrix, stateOf, type AttentionModel } from '../attention';
import { relation } from '../relations';
import type { HistoryEvent } from '../tracker';

const at = (hours: number) => new Date(Date.parse('2026-10-01T00:00:00Z') + hours * 3_600_000).toISOString();
let n = 0;
const ev = (concept: string, correct: boolean, hours: number): HistoryEvent => ({
  id: `e${(n += 1)}`, at: at(hours), concept, correct, risk: 1, mode: 'guided', settingId: 'emr', source: 'offline',
});
const trusted = (halfLifeHours: number | null, sharpness: number | null): AttentionModel => ({
  params: { halfLifeHours, sharpness },
  assessment: { trainTargets: 0, holdoutTargets: 0, loss: null, baselineLoss: null, trusted: true, reason: '' },
});

describe('attention tracker', () => {
  it('is the per-concept Laplace baseline until trusted', () => {
    const history = [ev('precision', true, 0), ev('precision', true, 1), ev('recall', false, 2)];
    const m = masteryMatrix(null, history, at(3));
    expect(m.get('precision')!.p).toBeCloseTo(3 / 4);
    expect(m.get('recall')!.p).toBeCloseTo(1 / 3);
    // Without trusted attention, a concept with no answers of its own has no entry.
    expect(m.has('specificity')).toBe(false);
  });

  it('lets related answers inform a concept, and masks orthogonal ones', () => {
    expect(relation('precision', 'recall')).toBeGreaterThan(0);
    const history = [0, 1, 2, 3].map((h) => ev('precision', true, h));
    const m = masteryMatrix(trusted(null, 1), history, at(4));
    expect(m.get('recall')!.p).toBeGreaterThan(0.5);
    expect(m.get('recall')!.state).toBe('unseen');
    const far = 'asi';
    expect(relation('precision', far)).toBe(0);
    expect(m.has(far)).toBe(false);
  });

  it('decays old evidence (temporal reasoning)', () => {
    const history = [0, 1, 2, 3].map((h) => ev('kpi', true, h));
    const fresh = masteryMatrix(trusted(24, null), history, at(4)).get('kpi')!;
    const stale = masteryMatrix(trusted(24, null), history, at(24 * 14)).get('kpi')!;
    expect(stale.evidence).toBeLessThan(fresh.evidence);
    expect(stale.p).toBeLessThan(fresh.p);
    expect(stale.p).toBeGreaterThan(0.5);
  });

  it('classifies mastered and struggling only on the concept’s own answers', () => {
    expect(stateOf(0.95, 0)).toBe('unseen');
    expect(stateOf(0.95, 2)).toBe('learning');
    expect(stateOf(0.9, 3)).toBe('mastered');
    expect(stateOf(0.3, 2)).toBe('struggling');
    expect(stateOf(0.6, 5)).toBe('learning');
  });

  it('never lets related answers master or rescue a concept', () => {
    const history = [
      ...Array.from({ length: 50 }, (_, k) => ev('precision', true, k)),
      ...[0, 1, 2].map((k) => ev('recall', false, 50 + k)),
    ];
    const recall = masteryMatrix(trusted(null, 1), history, at(60)).get('recall')!;
    expect(recall.p).toBeGreaterThan(0.85);
    expect(recall.ownP).toBeCloseTo(1 / 5);
    expect(recall.state).toBe('struggling');
  });

  it('reports a mastery or struggle transition as a save point', () => {
    const base = [ev('kgi', true, 0), ev('kgi', true, 1), ev('kgi', true, 2), ev('kgi', true, 3)];
    const before = masteryMatrix(null, base.slice(0, 3), at(3));
    const after = masteryMatrix(null, [...base, ev('kgi', true, 4)], at(5));
    expect(masteryEvent(before, after, 'kgi')).toBe('mastery');
    expect(masteryEvent(after, after, 'kgi')).toBeNull();
    const miss = [ev('tco', false, 0), ev('tco', false, 1)];
    expect(masteryEvent(masteryMatrix(null, miss.slice(0, 1), at(1)), masteryMatrix(null, miss, at(2)), 'tco')).toBe('struggle');
  });

  it('waits for evidence, and trusts fitted biases only when they beat the baseline on held-out answers', () => {
    expect(fitAttention([ev('kpi', true, 0)]).assessment.trusted).toBe(false);
    // Recall always follows precision: answers on the related concept predict it.
    const history: HistoryEvent[] = [];
    for (let k = 0; k < 40; k += 1) {
      const right = k % 4 < 2;
      history.push(ev('precision', right, k * 2), ev('recall', right, k * 2 + 1));
    }
    const model = fitAttention(history);
    expect(model.assessment.trusted).toBe(true);
    expect(model.params.sharpness).not.toBeNull();
    expect(model.assessment.loss!).toBeLessThan(model.assessment.baselineLoss!);
    // Orthogonal concepts carry nothing for each other, so the baseline stays.
    const unrelated = fitAttention(Array.from({ length: 60 }, (_, k) => ev(k % 2 ? 'asi' : 'precision', k % 3 === 0, k)));
    expect(unrelated.assessment.trusted).toBe(false);
  });
});
