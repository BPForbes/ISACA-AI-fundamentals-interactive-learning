import { describe, expect, it } from 'vitest';
import { CHAINS } from '../../data/chains';
import type { ConceptEstimate, MasteryMatrix } from '../attention';
import { SITUATIONS } from '../../data/situations';
import { applyDecision, bridgeFor, buildSceneRequest, chooseMode, deferStep, focusConcepts, pickSituation, recommendChain, startExpedition } from '../director';
import { newProgress, recordAnswer } from '../progress';

const rng = () => 0.42;
const est = (p: number, attempts: number, state: ConceptEstimate['state'], lastAt: string | null = null): ConceptEstimate => ({
  p, ownP: p, evidence: attempts, attempts, state, lastAt,
});
const now = '2026-10-22T00:00:00Z';

describe('director', () => {
  it('starts unknown anchors in diagnostic mode and missed ones in contrast or remediation', () => {
    expect(chooseMode(undefined, 'kpi', 0)).toBe('diagnostic');
    const once = recordAnswer(newProgress('kpi', now), { correct: false, settingId: 'emr', unfamiliarSetting: false, explained: false }, now);
    expect(chooseMode(once, 'kpi', 1)).toBe('contrast');
    expect(chooseMode(once, 'kpi', 2)).toBe('remediation');
    expect(chooseMode(once, 'precision', 1)).toBe('calculation');
  });

  it('keeps the same anchor after a miss and advances after a correct answer', () => {
    const exp = startExpedition('metrics-to-business', { lastKind: null, now, rng });
    const missed = applyDecision(exp, { anchor: 'confusion-matrix', choice: 'x', correct: false, consequence: 'c' });
    expect(missed.stepIndex).toBe(0);
    expect(missed.missesOnStep).toBe(1);
    expect(missed.meters.trust).toBeLessThan(exp.meters.trust);
    const hit = applyDecision(missed, { anchor: 'confusion-matrix', choice: 'y', correct: true, consequence: 'c' });
    expect(hit.stepIndex).toBe(1);
    expect(hit.missesOnStep).toBe(0);
  });

  it('completes the expedition after the last link and can defer a stuck one', () => {
    let exp = startExpedition('generalization', { lastKind: null, now, rng });
    for (let i = 0; i < 3; i += 1) exp = applyDecision(exp, { anchor: 'a', choice: 'x', correct: true, consequence: '' });
    exp = deferStep(exp);
    expect(exp.status).toBe('complete');
  });

  it('alternates familiar and unfamiliar settings between expeditions', () => {
    const a = startExpedition('cia-security', { lastKind: 'familiar', now, rng });
    const b = startExpedition('cia-security', { lastKind: 'unfamiliar', now, rng });
    expect(a.settingId).not.toBe(b.settingId);
  });

  it('builds a request for every link with a contrast partner when relevant', () => {
    for (const chain of CHAINS) {
      let exp = startExpedition(chain.id, { lastKind: null, now, rng });
      for (let i = 0; i < chain.steps.length; i += 1) {
        const req = buildSceneRequest(exp, () => undefined);
        expect(req.anchor.id).toBe(chain.steps[i].anchor);
        exp = applyDecision(exp, { anchor: req.anchor.id, choice: '', correct: true, consequence: '' });
      }
    }
  });

  it('recommends the expedition holding queued remediation', () => {
    const strong = (id: string) => {
      let p = newProgress(id, now);
      for (let i = 0; i < 8; i += 1) p = recordAnswer(p, { correct: true, settingId: `s${i}`, unfamiliarSetting: true, explained: false }, now);
      return p;
    };
    expect(recommendChain(strong, ['data-loss']).id).toBe('data-loss-resilience');
  });

  it('bridges a struggling anchor through a related concept the learner knows, never an orthogonal one', () => {
    const matrix: MasteryMatrix = new Map([
      ['tp', est(0.95, 4, 'mastered')],
      ['fn', est(0.6, 3, 'learning')],
      ['asi', est(0.99, 9, 'mastered')],
      ['confusion-matrix', est(0.3, 2, 'struggling')],
    ]);
    expect(bridgeFor('confusion-matrix', matrix)).toBe('tp');
    expect(bridgeFor('confusion-matrix', matrix, ['tp'])).toBeNull();
    const exp = startExpedition('metrics-to-business', { lastKind: null, now, rng });
    const missed = applyDecision(exp, { anchor: 'confusion-matrix', choice: 'x', correct: false, consequence: 'c' });
    expect(buildSceneRequest(missed, () => undefined, matrix).bridge?.id).toBe('tp');
    // Not struggling: no bridge, the anchor is taught as before.
    const calm: MasteryMatrix = new Map([...matrix, ['confusion-matrix', est(0.7, 2, 'learning')]]);
    expect(buildSceneRequest(exp, () => undefined, calm).bridge).toBeUndefined();
  });

  it('moves on toward topics related to a recent mastery, and ignores orthogonal ones', () => {
    const strong = (id: string) => {
      let p = newProgress(id, now);
      for (let i = 0; i < 8; i += 1) p = recordAnswer(p, { correct: true, settingId: `s${i}`, unfamiliarSetting: true, explained: false }, now);
      return p;
    };
    const mastered: MasteryMatrix = new Map([['precision', est(0.95, 6, 'mastered', now)]]);
    expect(focusConcepts(mastered)).toEqual(['precision']);
    expect(recommendChain(strong, [], mastered).id).toBe('metrics-to-business');
    // An old mastery no longer pulls; a struggle always does.
    const old: MasteryMatrix = new Map([
      ['precision', est(0.95, 6, 'mastered', '2026-09-01T00:00:00Z')],
      ['kpi', est(0.4, 3, 'learning', now)],
    ]);
    expect(focusConcepts(old)).toEqual([]);
    expect(focusConcepts(new Map([['recall', est(0.3, 3, 'struggling', '2026-01-01T00:00:00Z')]]))).toEqual(['recall']);
    expect(recommendChain(strong, []).id).toBe(recommendChain(strong, [], new Map()).id);
  });

  it('puts every scene of an expedition, including a re-ask after a miss, in a new situation', () => {
    let exp = startExpedition('metrics-to-business', { lastKind: null, now, rng });
    const seen: string[] = [];
    for (let k = 0; k < SITUATIONS.length; k += 1) {
      const req = buildSceneRequest(exp, () => undefined);
      expect(seen).not.toContain(req.situation.id);
      expect(req.usedSituations.map((u) => u.id)).toEqual(seen.slice(-5));
      seen.push(req.situation.id);
      // A miss keeps the anchor in play; the next scene still moves to a new moment.
      exp = applyDecision(exp, { anchor: req.anchor.id, choice: 'x', correct: false, consequence: 'c', situation: req.situation.id });
    }
    // Once every situation is used, the last three are still avoided.
    expect(seen.slice(-3)).not.toContain(pickSituation(exp).id);
  });
});
