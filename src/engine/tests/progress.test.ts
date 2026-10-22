import { describe, expect, it } from 'vitest';
import { creditExplanation, levelOf, meetsMasteryGate, mergeProgress, newProgress, recordAnswer, type Evidence } from '../progress';

const at = (n: number) => `2026-10-22T00:00:${String(n).padStart(2, '0')}Z`;
const ok = (settingId: string, unfamiliar = false): Evidence => ({ correct: true, settingId, unfamiliarSetting: unfamiliar, explained: false });
const miss: Evidence = { correct: false, settingId: 'emr', unfamiliarSetting: false, explained: false };

describe('terminology ladder', () => {
  it('moves Introduce → Scaffold → Conversational once used correctly in two contexts', () => {
    let p = newProgress('recall', at(0));
    p = recordAnswer(p, ok('emr'), at(1));
    expect(p.stage).toBe(2);
    p = recordAnswer(p, ok('emr'), at(2));
    expect(p.stage).toBe(2);
    p = recordAnswer(p, ok('hospital', true), at(3));
    expect(p.stage).toBe(3);
  });

  it('backs up to Recovery when a conversational term is missed, and returns after a correct answer', () => {
    let p = newProgress('kpi', at(0));
    for (const [i, e] of [ok('emr'), ok('hospital', true)].entries()) p = recordAnswer(p, e, at(i + 1));
    p = recordAnswer(p, miss, at(5));
    expect(p.stage).toBe(5);
    p = recordAnswer(p, ok('emr'), at(6));
    expect(p.stage).toBe(3);
  });

  it('credits a solid explanation only after transfer', () => {
    let p = newProgress('kpi', at(0));
    p = recordAnswer(p, ok('emr'), at(1));
    p = recordAnswer(p, ok('hospital', true), at(2));
    expect(creditExplanation(p, at(3)).stage).toBe(4);
    const notTransferred = recordAnswer(recordAnswer(newProgress('kgi', at(0)), ok('emr'), at(1)), ok('keyquorum'), at(2));
    expect(creditExplanation(notTransferred, at(3)).stage).toBe(3);
  });
});

describe('mastery', () => {
  it('needs ~85% recent accuracy, two contexts and a correct latest answer', () => {
    let p = newProgress('precision', at(0));
    p = recordAnswer(p, ok('emr'), at(1));
    p = recordAnswer(p, ok('emr'), at(2));
    p = recordAnswer(p, ok('emr'), at(3));
    expect(meetsMasteryGate(p)).toBe(false);
    p = recordAnswer(p, ok('bank', true), at(4));
    expect(meetsMasteryGate(p)).toBe(true);
    expect(levelOf(p)).toBe('Proficient');
    p = recordAnswer(p, miss, at(5));
    expect(meetsMasteryGate(p)).toBe(false);
  });

  it('keeps the newer copy when merging cloud progress', () => {
    const older = newProgress('kpi', at(1));
    const newer = { ...newProgress('kpi', at(2)), attempts: 3 };
    expect(mergeProgress(older, newer).attempts).toBe(3);
    expect(mergeProgress(newer, older).attempts).toBe(3);
  });
});
