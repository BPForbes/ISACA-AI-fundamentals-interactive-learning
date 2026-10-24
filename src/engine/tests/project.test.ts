import { describe, expect, it } from 'vitest';
import { GOALS, STAGES } from '../../data/goals';
import { defaultLab, runLab } from '../lab';
import { advance, currentGoal, defer, GOALS_PER_STAGE, labForCurrent, planProject, pricingFor, recordSubmission, reportProject, stageOf, worldFor } from '../project';

const plan = (priority: (anchor: string) => number = () => 1, caps = new Set<never>()) =>
  planProject({ id: 'p', round: 0, seed: 9, capabilities: caps, priority });

describe('a project', () => {
  it('plans the stages in order with the goals the run can pose, weakest concept first', () => {
    const p = plan();
    expect(p.goals.map((g) => g.stage)).toEqual(STAGES.flatMap((s) => Array(GOALS_PER_STAGE[s]).fill(s)));
    expect(p.goals.every((g) => !GOALS.find((x) => x.anchor === g.anchor)?.needs?.length)).toBe(true);
    expect(planProject({ id: 'p', round: 0, seed: 9, capabilities: new Set(), priority: () => 1 })).toEqual(p);
    expect(p.advanceDue).toBe(false);
    expect(p.lab.pricing).toEqual({ compute: 1, free: [] });
    const weak = plan((a) => (a === 'recall' ? 10 : 1));
    expect(weak.goals.some((g) => g.anchor === 'recall')).toBe(true);
    const strong = plan((a) => (a === 'recall' ? -10 : 1));
    expect(strong.goals.some((g) => g.anchor === 'recall')).toBe(false);
  });

  it('poses a goal that needs a capability only once the run has it', () => {
    const needsMomentum = GOALS.find((g) => g.needs?.includes('momentum'))!;
    const favour = (a: string) => (a === needsMomentum.anchor ? 10 : 1);
    expect(plan(favour).goals.map((g) => g.anchor)).not.toContain(needsMomentum.anchor);
    expect(planProject({ id: 'p', round: 0, seed: 9, capabilities: new Set(['momentum']), priority: favour }).goals.map((g) => g.anchor)).toContain(needsMomentum.anchor);
  });

  it("prices the lab by the run's upgrades: half-price compute, controls made free", () => {
    expect(pricingFor(new Set())).toEqual({ compute: 1, free: [] });
    expect(pricingFor(new Set(['freeBackups', 'cheapCompute', 'freeMonitoring', 'depth2']))).toEqual({ compute: 0.5, free: ['monitoring', 'backups'] });
    const cheap = planProject({ id: 'p', round: 0, seed: 9, capabilities: new Set(['cheapCompute']), priority: () => 1 });
    expect(cheap.lab.pricing).toEqual({ compute: 0.5, free: [] });
    expect(runLab(cheap.lab).monthlyCompute).toBe(Math.round(runLab(plan().lab).training.paramCount / 10));
    // A goal's setup keeps the pricing the project was planned with.
    expect(labForCurrent(cheap)!.pricing).toEqual(cheap.lab.pricing);
  });

  it('hardens the world round by round', () => {
    expect(worldFor(0).driftPerMonth).toBeLessThan(worldFor(3).driftPerMonth);
    expect(worldFor(0).kgiTarget).toBeLessThan(worldFor(3).kgiTarget);
    expect(plan().lab.world).toEqual(worldFor(0));
  });

  it('carries the lab forward, re-seeds a goal on each attempt, and completes after the last goal', () => {
    let p = plan();
    const first = currentGoal(p)!;
    expect(stageOf(p)).toBe('define');
    const start = labForCurrent(p)!;
    expect(start).not.toEqual(p.lab);
    const submitted = { ...start, threshold: 0.35 };
    p = recordSubmission(p, submitted, false);
    expect(p.goals[0]).toMatchObject({ outcome: 'missed', attempts: 1, misses: 1, lastCorrect: false });
    expect(p.lab).toBe(submitted);
    // The same goal again, on a new seed, from the lab as submitted.
    expect(currentGoal(p)!.goal.anchor).toBe(first.goal.anchor);
    expect(labForCurrent(p)).not.toEqual(start);
    p = recordSubmission(p, submitted, true);
    expect(p.goals[0]).toMatchObject({ outcome: 'met', attempts: 2, misses: 1, lastCorrect: true });
    p = advance({ ...p, advanceDue: true });
    expect(p.index).toBe(1);
    expect(p.advanceDue).toBe(false);
    expect(labForCurrent(p)!.threshold).toBe(0.35);
    p = defer(p);
    expect(p.goals[1].outcome).toBe('deferred');
    expect(p.index).toBe(2);
    while (p.status === 'active') p = advance(p);
    expect(p.index).toBe(p.goals.length - 1);
    expect(currentGoal(p)).toBeNull();
    expect(labForCurrent(p)).toBeNull();
  });

  it('reports the round from the deployment of the lab as finally submitted', () => {
    let p = plan();
    const good = { ...defaultLab(9), world: p.lab.world, deploy: { ...p.lab.deploy, monitoring: true, retrainOnAlert: true, backups: true, accessControl: true, oversight: true, auditTrail: true, fairnessTesting: true } };
    p = recordSubmission(p, good, true);
    const report = reportProject({ ...p, status: 'complete' });
    expect(report.cleared).toBe(true);
    expect(report.goalsMet).toBe(1);
    expect(report.goalsTotal).toBe(p.goals.length);
    expect(report.budgetSpent).toBeGreaterThan(0);
    expect(report.riskGained).toBe(0);
    expect(report.trustGained).toBe(10);
  });
});
