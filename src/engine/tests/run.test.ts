import { describe, expect, it } from 'vitest';
import { BRIEF_BY_ID } from '../../data/briefs';
import { CHAIN_BY_ID } from '../../data/chains';
import { TERM_BY_ID } from '../../data/terms';
import { UPGRADES, UPGRADE_BY_ID, upgradeTerm } from '../../data/upgrades';
import {
  BASE_LEARNING_RATE, BASE_MISS_PENALTY, baseEffects, beginRound, buyUpgrade, canBuy, draftOffer, effectsOf, finishRound,
  newRun, OFFER_SIZE, roundTarget, RUN_GOAL, START_CREDITS, stepsToTarget, trainingStep, type RunState,
} from '../run';

const now = '2026-10-23T00:00:00Z';
const fresh = (seed = 11) => newRun(now, `run-${seed}`, seed);
const training = (run: RunState, upgrades: Record<string, number> = {}) =>
  beginRound({ ...run, upgrades, offer: [] }, 'metrics-to-business');
const answer = (run: RunState, pattern: string) =>
  [...pattern].reduce((r, ch) => trainingStep(r, { correct: ch === '1', fixingMiss: false }), run);

describe('upgrade catalogue', () => {
  it('names only terms in the bank, whose definitions the card quotes verbatim', () => {
    for (const u of UPGRADES) {
      expect(TERM_BY_ID.has(u.id), u.id).toBe(true);
      expect(upgradeTerm(u.id).definition).toBe(TERM_BY_ID.get(u.id)!.definition);
      expect(u.inRun(1).length).toBeGreaterThan(10);
      expect(u.cost).toBeGreaterThan(0);
    }
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(UPGRADES.length);
  });

  it('changes only the run’s numbers', () => {
    const base = baseEffects();
    expect(Object.keys(effectsOf({ 'learning-rate': 1 })).sort()).toEqual(Object.keys(base).sort());
    expect(effectsOf({ 'learning-rate': 2 }).learningRate).toBeCloseTo(BASE_LEARNING_RATE + 0.08);
    expect(effectsOf({ 'learning-rate': 9 }).learningRate).toBeCloseTo(BASE_LEARNING_RATE + 0.08);
    expect(effectsOf({ regularization: 1 }).missPenalty).toBeCloseTo(BASE_MISS_PENALTY - 0.06);
    expect(effectsOf({ depth: 2 }).hiddenLayers).toBe(3);
    expect(effectsOf({ 'no-such-upgrade': 1 })).toEqual(base);
  });
});

describe('a run', () => {
  it('starts in the workshop with a brief, a codename, seed credits and an offer', () => {
    const run = fresh();
    expect(run.phase).toBe('workshop');
    expect(BRIEF_BY_ID.has(run.briefId)).toBe(true);
    expect(run.codename).toMatch(/^[A-Z]+-\d$/);
    expect(run.credits).toBe(START_CREDITS);
    expect(run.offer).toHaveLength(OFFER_SIZE);
    expect(new Set(run.offer).size).toBe(OFFER_SIZE);
    expect(newRun(now, 'run-11', 11)).toEqual(run);
    expect(newRun(now, 'x', 12, 'pumps').briefId).toBe('pumps');
  });

  it('sells one tier of an offered upgrade for credits, and nothing else', () => {
    const run = { ...fresh(), credits: 5 };
    const [first] = run.offer;
    const bought = buyUpgrade(run, first);
    expect(bought.upgrades[first]).toBe(1);
    expect(bought.credits).toBe(5 - UPGRADE_BY_ID.get(first)!.cost);
    expect(bought.offer).not.toContain(first);
    expect(buyUpgrade(bought, first)).toBe(bought);
    const notOffered = UPGRADES.map((u) => u.id).find((id) => !run.offer.includes(id))!;
    expect(canBuy(run, notOffered)).toBe(false);
    expect(canBuy({ ...run, credits: 0 }, first)).toBe(false);
    expect(canBuy({ ...run, phase: 'training' }, first)).toBe(false);
  });

  it('never offers an upgrade at its top tier, and redraws per round', () => {
    const maxed = Object.fromEntries(UPGRADES.map((u) => [u.id, u.maxTier]));
    expect(draftOffer({ seed: 3, roundsCleared: 0, roundsFailed: 0, upgrades: maxed })).toEqual([]);
    const one = { ...maxed, depth: 1 };
    expect(draftOffer({ seed: 3, roundsCleared: 0, roundsFailed: 0, upgrades: one })).toEqual(['depth']);
    const a = draftOffer({ seed: 3, roundsCleared: 0, roundsFailed: 0, upgrades: {} });
    const b = draftOffer({ seed: 3, roundsCleared: 1, roundsFailed: 0, upgrades: {} });
    expect(a).not.toEqual(b);
  });

  it('sets the target from the chain length and tightens it as rounds are cleared, down to a floor', () => {
    expect(roundTarget(0, 5)).toBe(0.36);
    expect(roundTarget(0, 3)).toBe(0.59);
    expect(roundTarget(3, 5)).toBe(0.29);
    expect(roundTarget(20, 5)).toBe(0.17);
    const links = CHAIN_BY_ID.get('generalization')!.steps.length;
    expect(beginRound({ ...fresh(), offer: [] }, 'generalization').round!.target).toBe(roundTarget(0, links));
  });
});

describe('training steps', () => {
  it('lower the loss on a correct answer and raise it on a miss, up to the cap', () => {
    let run = training(fresh());
    expect(run.round!.loss).toBe(1);
    run = trainingStep(run, { correct: true, fixingMiss: false });
    expect(run.round!.loss).toBeCloseTo(0.78, 3);
    run = trainingStep(run, { correct: false, fixingMiss: false });
    expect(run.round!.loss).toBeCloseTo(0.96, 3);
    run = answer(run, '0000');
    expect(run.round!.loss).toBe(1.5);
    expect(run.round!.misses).toBe(5);
    expect(run.round!.steps).toHaveLength(6);
  });

  it('clears a five-link chain with every answer right, and not with a late miss', () => {
    const clean = answer(training(fresh()), '11111');
    expect(clean.round!.loss).toBeLessThanOrEqual(clean.round!.target);
    const lateMiss = answer(training(fresh()), '111101');
    expect(lateMiss.round!.loss).toBeGreaterThan(lateMiss.round!.target);
  });

  it('applies the upgrades: regularization, normalization, pre-training, fine-tuning, momentum, augmentation', () => {
    expect(answer(training(fresh(), { regularization: 1 }), '0').round!.loss).toBeCloseTo(1.12, 3);
    expect(answer(training(fresh(), { 'normalization-network': 1 }), '000').round!.loss).toBe(1.1);
    expect(training(fresh(), { 'pretrained-model': 1 }).round!.loss).toBe(0.8);
    expect(answer(training(fresh(), { 'fine-tuning': 1 }), '1').round!.loss).toBeCloseTo(0.78 ** 2, 3);
    expect(answer(training(fresh(), { 'fine-tuning': 1 }), '11').round!.loss).toBeCloseTo(0.78 ** 3, 2);
    const momentum = answer(training(fresh(), { optimizer: 1 }), '111').round!.loss;
    expect(momentum).toBeCloseTo(0.78 * 0.76 * 0.74, 2);
    expect(answer(training(fresh(), { 'data-augmentation': 1 }), '00').round!.loss).toBeCloseTo(1 + 0.09 + 0.18, 3);
  });

  it('attention undoes a miss when the next answer on that link is right', () => {
    const without = trainingStep(answer(training(fresh()), '10'), { correct: true, fixingMiss: true });
    expect(without.round!.loss).toBeCloseTo(0.96 * 0.78, 3);
    const run = trainingStep(answer(training(fresh(), { attention: 1 }), '10'), { correct: true, fixingMiss: true });
    expect(run.round!.loss).toBeCloseTo(0.78 * 0.78, 3);
    // Only when the correct answer is on the same link, right after the miss.
    const other = trainingStep(answer(training(fresh(), { attention: 1 }), '10'), { correct: true, fixingMiss: false });
    expect(other.round!.loss).toBeCloseTo(0.96 * 0.78, 3);
  });

  it('counts the correct answers still needed', () => {
    const run = training(fresh());
    expect(stepsToTarget(run)).toBe(5);
    expect(stepsToTarget(answer(run, '111'))).toBe(2);
    expect(stepsToTarget(answer(run, '11111'))).toBe(0);
    expect(stepsToTarget(fresh())).toBeNull();
  });

  it('ignores steps outside a round', () => {
    const run = fresh();
    expect(trainingStep(run, { correct: true, fixingMiss: false })).toBe(run);
  });
});

describe('finishing a round', () => {
  const meters = { trust: 70, budget: 60, risk: 25 };

  it('pays credits and funding for a cleared round, more for a clean one', () => {
    const clean = finishRound(answer(training(fresh()), '11111'), meters);
    expect(clean.phase).toBe('workshop');
    expect(clean.roundsCleared).toBe(1);
    expect(clean.credits).toBe(START_CREDITS + 3);
    expect(clean.meters).toEqual({ trust: 75, budget: 70, risk: 25 });
    expect(clean.lastReport).toMatchObject({ cleared: true, misses: 0, creditsEarned: 3, target: 0.36 });
    expect(clean.offer).toHaveLength(OFFER_SIZE);
    expect(clean.round).toBeNull();
    const messy = finishRound(answer(training(fresh()), '0111111'), meters);
    expect(messy.lastReport!.cleared).toBe(true);
    expect(messy.credits).toBe(START_CREDITS + 2);
  });

  it('charges a failed or abandoned round and brings a governance review', () => {
    const failed = finishRound(answer(training(fresh()), '01010'), meters);
    expect(failed.roundsFailed).toBe(1);
    expect(failed.credits).toBe(START_CREDITS);
    expect(failed.meters).toEqual({ trust: 60, budget: 45, risk: 40 });
    const audited = finishRound(answer(training(fresh(), { 'audit-trail': 1 }), '01010'), meters);
    expect(audited.meters.risk).toBe(33);
    const abandoned = finishRound(answer(training(fresh()), '11111'), meters, { abandoned: true });
    expect(abandoned.lastReport!.cleared).toBe(false);
  });

  it('ends the run when the budget is spent, risk hits the limit, or enough rounds are cleared', () => {
    const defunded = finishRound(answer(training(fresh()), '00000'), { trust: 20, budget: 12, risk: 50 });
    expect(defunded.phase).toBe('over');
    expect(defunded.ending).toBe('defunded');
    expect(defunded.offer).toEqual([]);
    const halted = finishRound(answer(training(fresh()), '00000'), { trust: 20, budget: 50, risk: 90 });
    expect(halted.ending).toBe('halted');
    // The sixth round's target is 0.25, out of reach for a bare network.
    const nearlyDone = { ...fresh(), roundsCleared: RUN_GOAL - 1 };
    expect(finishRound(answer(training(nearlyDone), '11111'), meters).ending).toBeNull();
    const shipped = finishRound(answer(training(nearlyDone, { 'learning-rate': 2 }), '11111'), meters);
    expect(shipped.ending).toBe('shipped');
    expect(finishRound(fresh(), meters)).toEqual(fresh());
  });
});
