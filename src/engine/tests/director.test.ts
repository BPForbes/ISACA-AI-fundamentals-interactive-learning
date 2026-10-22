import { describe, expect, it } from 'vitest';
import { CHAINS } from '../../data/chains';
import { applyDecision, buildSceneRequest, chooseMode, deferStep, recommendChain, startExpedition } from '../director';
import { newProgress, recordAnswer } from '../progress';

const rng = () => 0.42;
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
});
