import { describe, expect, it } from 'vitest';
import { BRIEF_BY_ID } from '../../data/briefs';
import { TERM_BY_ID } from '../../data/terms';
import { UPGRADES, UPGRADE_BY_ID, upgradeTerm, capabilitiesOf } from '../../data/upgrades';
import { defaultLab, runLab } from '../lab';
import { planProject, recordSubmission, reportProject, type ProjectState } from '../project';
import { beginProject, buyUpgrade, canBuy, capabilities, draftOffer, finishProject, newRun, OFFER_SIZE, RUN_GOAL, START_CREDITS, type RunState } from '../run';

const now = '2026-10-23T00:00:00Z';
const fresh = (seed = 11) => newRun(now, `run-${seed}`, seed);

/** A completed project whose lab is sound and fully governed, every goal met (or none). */
const soundProject = (run: RunState, allMet = true): ProjectState => {
  let p = planProject({ id: 'p', round: run.roundsCleared + run.roundsFailed, seed: 5, capabilities: capabilities(run), priority: () => 1 });
  const lab = { ...defaultLab(5), world: p.lab.world, deploy: { ...p.lab.deploy, monitoring: true, retrainOnAlert: true, backups: true, accessControl: true, oversight: true, auditTrail: true, fairnessTesting: true } };
  for (let i = 0; i < p.goals.length; i += 1) {
    p = recordSubmission(p, lab, allMet);
    p = { ...p, index: Math.min(p.index + 1, p.goals.length - 1) };
  }
  return { ...p, status: 'complete' };
};

describe('upgrade catalogue', () => {
  it('names only terms in the bank, whose definitions the card quotes verbatim', () => {
    for (const u of UPGRADES) {
      expect(TERM_BY_ID.has(u.id), u.id).toBe(true);
      expect(upgradeTerm(u.id).definition).toBe(TERM_BY_ID.get(u.id)!.definition);
      expect(u.inRun.length).toBeGreaterThan(10);
      expect(u.cost).toBeGreaterThan(0);
    }
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(UPGRADES.length);
    expect(new Set(UPGRADES.map((u) => u.gives)).size).toBe(UPGRADES.length);
  });

  it('turns owned upgrades into lab capabilities', () => {
    expect(capabilitiesOf({})).toEqual(new Set());
    expect(capabilitiesOf({ depth: 1, optimizer: 1, 'no-such': 1 })).toEqual(new Set(['depth2', 'momentum']));
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

  it('sells an offered upgrade for credits, once, and nothing else', () => {
    const run = { ...fresh(), credits: 5 };
    const [first] = run.offer;
    const bought = buyUpgrade(run, first);
    expect(bought.upgrades[first]).toBe(1);
    expect(bought.credits).toBe(5 - UPGRADE_BY_ID.get(first)!.cost);
    expect(bought.offer).not.toContain(first);
    expect(capabilities(bought).has(UPGRADE_BY_ID.get(first)!.gives)).toBe(true);
    expect(buyUpgrade(bought, first)).toBe(bought);
    const notOffered = UPGRADES.map((u) => u.id).find((id) => !run.offer.includes(id))!;
    expect(canBuy(run, notOffered)).toBe(false);
    expect(canBuy({ ...run, credits: 0 }, first)).toBe(false);
    expect(canBuy({ ...run, phase: 'project' }, first)).toBe(false);
  });

  it('never offers an owned upgrade, and redraws per round', () => {
    const all = Object.fromEntries(UPGRADES.map((u) => [u.id, 1]));
    expect(draftOffer({ seed: 3, roundsCleared: 0, roundsFailed: 0, upgrades: all })).toEqual([]);
    const butOne = { ...all, depth: 0 };
    expect(draftOffer({ seed: 3, roundsCleared: 0, roundsFailed: 0, upgrades: butOne })).toEqual(['depth']);
    const a = draftOffer({ seed: 3, roundsCleared: 0, roundsFailed: 0, upgrades: {} });
    const b = draftOffer({ seed: 3, roundsCleared: 1, roundsFailed: 0, upgrades: {} });
    expect(a).not.toEqual(b);
  });

  it('opens a project from the workshop only', () => {
    const run = fresh();
    const project = soundProject(run);
    expect(beginProject(run, project).phase).toBe('project');
    expect(beginProject({ ...run, phase: 'over' }, project).phase).toBe('over');
  });
});

describe('finishing a project', () => {
  it('pays credits and funding for a cleared project, more when every goal was met', () => {
    const run = beginProject(fresh(), soundProject(fresh()));
    const report = reportProject(run.project!);
    expect(report.cleared).toBe(true);
    const done = finishProject(run, report);
    expect(done.phase).toBe('workshop');
    expect(done.roundsCleared).toBe(1);
    expect(done.credits).toBe(START_CREDITS + 3);
    expect(done.meters.budget).toBe(Math.min(100, fresh().meters.budget - report.budgetSpent + 15));
    expect(done.lastReport).toMatchObject({ cleared: true, goalsMet: report.goalsTotal, creditsEarned: 3 });
    expect(done.offer).toHaveLength(OFFER_SIZE);
    expect(done.project).toBeNull();
    const partly = finishProject(run, { ...report, goalsMet: Math.ceil(report.goalsTotal / 2) });
    expect(partly.credits).toBe(START_CREDITS + 2);
  });

  it('charges a failed project and brings a governance review', () => {
    const run = beginProject(fresh(), soundProject(fresh(), false));
    const report = { ...reportProject(run.project!), cleared: false, goalsMet: 0 };
    const failed = finishProject(run, report);
    expect(failed.roundsFailed).toBe(1);
    expect(failed.credits).toBe(START_CREDITS);
    expect(failed.meters.risk).toBe(fresh().meters.risk + report.riskGained + 10);
    expect(failed.meters.trust).toBe(Math.max(0, fresh().meters.trust + report.trustGained - 10));
  });

  it('ends the run when the budget is spent, risk hits the limit, or enough projects are cleared', () => {
    const run = beginProject(fresh(), soundProject(fresh()));
    const report = reportProject(run.project!);
    const defunded = finishProject({ ...run, meters: { trust: 20, budget: report.budgetSpent - 20, risk: 50 } }, { ...report, cleared: false, goalsMet: 0 });
    expect(defunded.phase).toBe('over');
    expect(defunded.ending).toBe('defunded');
    expect(defunded.offer).toEqual([]);
    const halted = finishProject({ ...run, meters: { trust: 20, budget: 90, risk: 95 } }, { ...report, cleared: false, goalsMet: 0, riskGained: 0 });
    expect(halted.ending).toBe('halted');
    const shipped = finishProject({ ...run, roundsCleared: RUN_GOAL - 1 }, report);
    expect(shipped.ending).toBe('shipped');
    expect(finishProject(fresh(), report)).toEqual(fresh());
  });

  it('judges a project by its deployment: a lab left ungoverned is not cleared', () => {
    const run = fresh();
    let p = planProject({ id: 'p', round: 0, seed: 5, capabilities: capabilities(run), priority: () => 1 });
    const bare = { ...defaultLab(5), world: p.lab.world };
    p = recordSubmission(p, bare, false);
    expect(runLab(bare).deploy.kgiMet).toBe(false);
    expect(reportProject({ ...p, status: 'complete' }).cleared).toBe(false);
  });
});
