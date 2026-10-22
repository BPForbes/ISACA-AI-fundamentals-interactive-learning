import { describe, expect, it } from 'vitest';
import { initLstm, seededRng } from '../lstm';
import { ADVANCE_THRESHOLD, decideAdvance, FEATURES, fitTracker, forecast, MAX_CONFIRMATIONS, type HistoryEvent, type TrackerModel } from '../tracker';

let n = 0;
const ev = (concept: string, correct: boolean, minute: number): HistoryEvent => ({
  id: `e${n++}`,
  at: new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString(),
  concept,
  correct,
  risk: 1,
  mode: 'guided',
  settingId: 'emr',
  source: 'offline',
});

// A learner who misses each concept a few times, then gets it; on some
// concepts they later lapse for a while. Running accuracy lags behind each
// switch; a sequence model should not.
const learner = (concepts: number, seed: number): HistoryEvent[] => {
  const rng = seededRng(seed);
  const out: HistoryEvent[] = [];
  let minute = 0;
  for (let c = 0; c < concepts; c += 1) {
    const misses = 2 + Math.floor(rng() * 3);
    const lapse = c % 3 === 0 ? misses + 3 : Infinity;
    for (let t = 0; t < 12; t += 1) {
      const correct = t >= misses && !(t >= lapse && t < lapse + 3);
      out.push(ev(`c${c}`, correct, (minute += 1)));
    }
  }
  return out;
};

describe('progress tracker', () => {
  it('stays out of decisions until it has enough answers', () => {
    const model = fitTracker(learner(2, 1));
    expect(model.assessment.trusted).toBe(false);
    expect(model.assessment.reason).toMatch(/Learning/);
  });

  it('is trusted only after beating the running-accuracy baseline on held-out answers', () => {
    const model = fitTracker(learner(16, 2));
    const a = model.assessment;
    expect(a.holdoutTargets).toBeGreaterThanOrEqual(12);
    expect(a.lstmLoss!).toBeLessThan(a.baselineLoss!);
    expect(a.trusted).toBe(true);
  });

  it('reads a concept that just turned around as improving', () => {
    const model = fitTracker(learner(16, 3));
    const turning = [false, false, false, true, true].map((c, i) => ev('x', c, i));
    const f = forecast(model, turning)!;
    expect(f.trend).toBe('improving');
    expect(f.pNext).toBeGreaterThan(ADVANCE_THRESHOLD);
    const sliding = [true, true, true, false, false].map((c, i) => ev('y', c, i));
    expect(forecast(model, sliding)!.trend).toBe('declining');
  });
});

describe('move-on gate (hybrid)', () => {
  const base = { missesOnStep: 0, confirmationsOnStep: 0, previousOnStepCorrect: false, model: null, conceptHistory: [] };

  it('never advances on a miss', () => {
    expect(decideAdvance({ ...base, correct: false }).advance).toBe(false);
  });

  it('uses the rules alone while the model is untrusted', () => {
    const d = decideAdvance({ ...base, correct: true });
    expect(d).toMatchObject({ advance: true, decidedBy: 'rules' });
  });

  it('wants two correct in a row after a miss on the same link', () => {
    expect(decideAdvance({ ...base, correct: true, missesOnStep: 1 }).advance).toBe(false);
    expect(decideAdvance({ ...base, correct: true, missesOnStep: 1, previousOnStepCorrect: true, confirmationsOnStep: 1 }).advance).toBe(true);
  });

  it('holds a correct answer when the trusted model is not convinced, up to a cap', () => {
    // A trusted model whose output bias makes every prediction pessimistic.
    const params = initLstm({ input: FEATURES, hidden: 8 }, 1);
    params.bOut = -8;
    const pessimist = { params, trainedOn: 100, assessment: { trusted: true } } as TrackerModel;
    const history = [ev('z', true, 0)];
    const held = decideAdvance({ ...base, correct: true, model: pessimist, conceptHistory: history });
    expect(held).toMatchObject({ advance: false, decidedBy: 'rules+lstm' });
    expect(held.forecast!.pNext).toBeLessThan(ADVANCE_THRESHOLD);
    const capped = decideAdvance({ ...base, correct: true, model: pessimist, conceptHistory: history, confirmationsOnStep: MAX_CONFIRMATIONS });
    expect(capped.advance).toBe(true);
    // An untrusted model is shown but never decides.
    const untrusted = { ...pessimist, assessment: { trusted: false } } as TrackerModel;
    expect(decideAdvance({ ...base, correct: true, model: untrusted, conceptHistory: history })).toMatchObject({ advance: true, decidedBy: 'rules' });
  });

  it('advances a correct answer when the trusted model predicts the next one right', () => {
    const model = fitTracker(learner(16, 5));
    const strong = [false, true, true, true, true].map((c, i) => ev('s', c, i));
    expect(decideAdvance({ ...base, correct: true, model, conceptHistory: strong }).advance).toBe(true);
  });
});
