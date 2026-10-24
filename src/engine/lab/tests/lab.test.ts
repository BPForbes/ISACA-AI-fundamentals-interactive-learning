import { describe, expect, it } from 'vitest';
import { buildDataset, defaultData, MINORITY_SHARE, POPULATION, TEST_SIZE, VALIDATION_SIZE } from '../dataset';
import { defaultLab, diagnose, runLab } from '..';
import { CONTROL_COST, FINES, monthlyCost } from '../deploy';
import { decide, decisionStats, induceRule, inference, KNOWLEDGE_BASE, ruleStats, type Rule } from '../rules';
import { confusion, groupAccuracy, type Scored } from '../metrics';
import { defaultFeatures, defaultModel, paramCount, trainModel, type TrainResult } from '../model';

describe('lab dataset', () => {
  it('is deterministic and holds its sets apart', () => {
    const a = buildDataset(defaultData(3));
    const b = buildDataset(defaultData(3));
    expect(a).toEqual(b);
    expect(a.population).toHaveLength(POPULATION);
    expect(a.train).toHaveLength(120);
    expect(a.validation).toHaveLength(VALIDATION_SIZE);
    expect(a.test).toHaveLength(TEST_SIZE);
    const sampled = new Set(a.sample.map((p) => `${p.x},${p.y}`));
    expect(a.validation.some((p) => sampled.has(`${p.x},${p.y}`))).toBe(false);
    expect(Math.abs(a.groupShare.population - MINORITY_SHARE)).toBeLessThan(0.08);
    expect(buildDataset(defaultData(4))).not.toEqual(a);
  });

  it('under-represents the minority under convenience sampling and matches it when stratified', () => {
    const convenience = buildDataset({ ...defaultData(5), sampling: 'convenience' });
    const stratified = buildDataset({ ...defaultData(5), sampling: 'stratified' });
    expect(convenience.groupShare.sample).toBeLessThan(0.06);
    expect(Math.abs(stratified.groupShare.sample - stratified.groupShare.population)).toBeLessThan(0.01);
  });

  it('corrupts the sample as asked, and the remedies undo exactly that', () => {
    const dirty = buildDataset({ ...defaultData(6), duplicates: 0.25, outliers: 10, labelNoise: 0.2 });
    expect(dirty.sample).toHaveLength(120 + 30 + 10);
    expect(dirty.removed).toBe(0);
    const checked = buildDataset({ ...defaultData(6), duplicates: 0.25, outliers: 10, labelNoise: 0.2, verifyLabels: true });
    expect(checked.corrected).toBe(Math.round(160 * 0.2));
    const cleaned = buildDataset({ ...defaultData(6), duplicates: 0.25, outliers: 10, labelNoise: 0.2, cleanse: true, verifyLabels: true });
    expect(cleaned.removed).toBe(40);
    // Cleansing runs first, so it takes some wrong-labelled rows with it; the check corrects the rest.
    expect(cleaned.corrected).toBeLessThanOrEqual(32);
    expect(cleaned.corrected).toBeGreaterThan(20);
    expect(cleaned.train.every((p) => Math.abs(p.x) <= 1.5 && Math.abs(p.y) <= 1.5)).toBe(true);
    const augmented = buildDataset({ ...defaultData(6), augment: true });
    expect(augmented.train).toHaveLength(360);
  });

  it('draws the test set from the drifted world, and the sample too when retraining on recent cases', () => {
    const stale = buildDataset({ ...defaultData(7), drift: 0.9 });
    const recent = buildDataset({ ...defaultData(7), drift: 0.9, recent: true });
    expect(stale.population).toEqual(recent.population);
    expect(stale.sample).not.toEqual(recent.sample);
  });
});

describe('lab model', () => {
  it('counts parameters by shape and learns the data', () => {
    expect(paramCount({ ...defaultModel(1), depth: 0 })).toBe(3);
    expect(paramCount({ ...defaultModel(1), depth: 1, hidden: 6 })).toBe(25);
    expect(paramCount({ ...defaultModel(1), depth: 2, hidden: 6 })).toBe(67);
    const d = buildDataset(defaultData(8));
    const r = trainModel(defaultModel(8), defaultFeatures(), d.train, d.validation);
    expect(r.curve).toHaveLength(30);
    expect(r.curve[29].train).toBeLessThan(r.curve[0].train);
    expect(r.curve[29].val).toBeLessThan(0.45);
    expect(r.diverged).toBe(false);
    expect(trainModel(defaultModel(8), defaultFeatures(), d.train, d.validation).curve).toEqual(r.curve);
    expect(r.predict(1, 1)).toBeGreaterThan(r.predict(-1, -1));
  });

  it('reads overfitting, underfitting and a short run from the curve', () => {
    const curve = (points: [number, number][]): TrainResult => ({ curve: points.map(([train, val]) => ({ train, val })), diverged: false, paramCount: 1, predict: () => 0.5 });
    expect(diagnose(curve([[0.7, 0.7], [0.4, 0.35], [0.2, 0.33], [0.1, 0.4], [0.05, 0.48], [0.04, 0.5]])).kind).toBe('overfitting');
    expect(diagnose(curve([[0.69, 0.7], [0.66, 0.68], [0.64, 0.66], [0.63, 0.65]])).kind).toBe('underfitting');
    expect(diagnose(curve([[0.7, 0.7], [0.6, 0.6], [0.5, 0.52]])).kind).toBe('undertrained');
    expect(diagnose(curve([[0.7, 0.7], [0.4, 0.4], [0.3, 0.31], [0.3, 0.31]])).kind).toBe('converged');
    expect(diagnose({ ...curve([[0.7, 0.7]]), diverged: true }).kind).toBe('diverged');
    expect(diagnose(curve([])).kind).toBe('empty');
  });
});

describe('lab metrics', () => {
  const scored: Scored[] = [
    { x: 0, y: 0, group: 0, label: 1, score: 0.9 },
    { x: 0, y: 0, group: 0, label: 1, score: 0.6 },
    { x: 0, y: 0, group: 1, label: 1, score: 0.2 },
    { x: 0, y: 0, group: 0, label: 0, score: 0.7 },
    { x: 0, y: 0, group: 1, label: 0, score: 0.3 },
    { x: 0, y: 0, group: 1, label: 0, score: 0.1 },
  ];

  it('fills the confusion matrix from the threshold and derives the four metrics', () => {
    const m = confusion(scored, 0.5);
    expect([m.tp, m.fn, m.fp, m.tn]).toEqual([2, 1, 1, 2]);
    expect(m.precision).toBeCloseTo(2 / 3);
    expect(m.recall).toBeCloseTo(2 / 3);
    expect(m.specificity).toBeCloseTo(2 / 3);
    expect(m.accuracy).toBeCloseTo(4 / 6);
    const loose = confusion(scored, 0.15);
    expect(loose.recall).toBe(1);
    expect(loose.specificity).toBeCloseTo(1 / 3);
    expect(confusion([], 0.5).precision).toBe(0);
  });

  it('reports accuracy per group and the gap', () => {
    const g = groupAccuracy(scored, 0.5);
    expect(g.majority).toBeCloseTo(2 / 3);
    expect(g.minority).toBeCloseTo(2 / 3);
    expect(g.gap).toBeCloseTo(0);
  });
});

describe('a lab run', () => {
  it('reports losses, metrics, compute and the loss on the rows chosen for assessment', () => {
    const r = runLab(defaultLab(9));
    expect(r.valLoss).toBeCloseTo(r.training.curve[r.training.curve.length - 1].val);
    expect(r.reportedLoss).toBe(r.valLoss);
    expect(r.compute).toBe(25 * 30);
    expect(r.metrics.tp + r.metrics.fn + r.metrics.fp + r.metrics.tn).toBe(VALIDATION_SIZE);
    expect(runLab({ ...defaultLab(9), assessOn: 'train' }).reportedLoss).toBeCloseTo(r.trainLoss);
  });
});

describe('features and the optimizer', () => {
  it('standardizing rescues badly scaled inputs, the interaction lets a line bend, momentum converges faster', () => {
    const scaled = { ...defaultLab(3), features: { scale: 40, interaction: false, normalize: false } };
    const standardized = { ...scaled, features: { ...scaled.features, normalize: true } };
    expect(runLab(scaled).valLoss).toBeGreaterThan(runLab(standardized).valLoss);
    const bent = { ...defaultLab(3), data: { ...defaultLab(3).data, curvature: 6 }, model: { ...defaultLab(3).model, depth: 0 as const, epochs: 60 } };
    const withInteraction = { ...bent, features: { ...bent.features, interaction: true } };
    expect(runLab(withInteraction).valLoss).toBeLessThan(runLab(bent).valLoss - 0.1);
    expect(runLab(withInteraction).training.paramCount).toBe(4);
    const slow = { ...defaultLab(3), model: { ...defaultLab(3).model, learningRate: 0.03, epochs: 20 } };
    const momentum = { ...slow, model: { ...slow.model, momentum: 0.9 } };
    expect(runLab(momentum).valLoss).toBeLessThan(runLab(slow).valLoss);
  });
});

describe('the rules workbench', () => {
  const d = buildDataset(defaultData(4));
  const kb: Rule[] = KNOWLEDGE_BASE.map((k) => k.rule);

  it('applies rules in order, first match wins, with group conditions', () => {
    const p = { x: 0.9, y: -0.9, label: 1 as const, group: 0 as const };
    expect(inference([kb[1], kb[0]], p)).toEqual({ outcome: 0, rule: 0 });
    expect(inference([kb[0], kb[1]], p)).toEqual({ outcome: 1, rule: 0 });
    expect(inference([kb[2]], { ...p, group: 1, y: 0.5 })).toEqual({ outcome: 1, rule: 0 });
    expect(inference([kb[2]], { ...p, group: 0, y: 0.5 })).toBeNull();
    expect(inference([], p)).toBeNull();
    const stats = ruleStats(kb, d.validation);
    expect(stats).toHaveLength(kb.length);
    expect(stats.reduce((n, s) => n + s.covered, 0)).toBeLessThanOrEqual(d.validation.length);
  });

  it('induces a precise rule from the sample, marked as induced', () => {
    const rule = induceRule(d.train)!;
    expect(rule.induced).toBe(true);
    const [stat] = ruleStats([rule], d.train);
    expect(stat.covered).toBeGreaterThanOrEqual(d.train.length * 0.15);
    expect(stat.correct / stat.covered).toBeGreaterThan(0.8);
    expect(induceRule([])).toBeNull();
  });

  it('routes cases by approach, and a reviewer shown the score follows it', () => {
    const r = runLab(defaultLab(4));
    const base = { approach: 'ml' as const, rules: kb, review: { capacity: 0, band: 0.2, showScore: false }, threshold: 0.5, seed: 4 };
    expect(decide(base, r.validation).every((x) => x.source === 'model')).toBe(true);
    const rulesOnly = decide({ ...base, approach: 'rules', rules: [] }, r.validation);
    expect(rulesOnly.every((x) => x.source === 'default' && x.predicted === 0)).toBe(true);
    const hybrid = decisionStats(decide({ ...base, approach: 'hybrid' }, r.validation), r.validation);
    expect(hybrid.bySource.rule).toBeGreaterThan(0);
    expect(hybrid.bySource.model).toBeGreaterThan(0);
    expect(hybrid.explained).toBeCloseTo(hybrid.bySource.rule / 100);
    const blind = decisionStats(decide({ ...base, review: { capacity: 30, band: 0.8, showScore: false } }, r.validation), r.validation);
    const biased = decisionStats(decide({ ...base, review: { capacity: 30, band: 0.8, showScore: true } }, r.validation), r.validation);
    expect(blind.bySource.human).toBe(30);
    expect(blind.reviewerAccuracy).toBeGreaterThan(biased.reviewerAccuracy);
    expect(blind.accuracy).toBeGreaterThanOrEqual(biased.accuracy);
    // Following the score is visible as never overruling the model.
    expect(biased.reviewerOverrules).toBe(0);
    expect(blind.reviewerOverrules).toBeGreaterThan(0);
  });
});

describe('deployment', () => {
  const bare = defaultLab(5);
  const governed = { ...bare, deploy: { ...bare.deploy, monitoring: true, retrainOnAlert: true, backups: true, accessControl: true, oversight: true, auditTrail: true, fairnessTesting: true } };

  it('runs six months, drifts, and only monitoring sees it', () => {
    const r = runLab(bare);
    expect(r.deploy.months).toHaveLength(6);
    expect(r.deploy.alertMonth).toBeNull();
    expect(r.deploy.months[5].accuracy).toBeLessThan(r.deploy.months[0].accuracy);
    const g = runLab(governed);
    expect(g.deploy.alertMonth).not.toBeNull();
    expect(g.deploy.months.some((m) => m.retrained)).toBe(true);
    expect(g.deploy.months[5].accuracy).toBeGreaterThan(r.deploy.months[5].accuracy);
  });

  it('turns missing controls into incidents that cost value, and sums the cost of ownership', () => {
    const r = runLab(bare);
    const kinds = r.deploy.incidents.map((i) => i.kind);
    expect(kinds).toContain('confidentiality');
    expect(kinds).toContain('availability');
    expect(kinds).toContain('compliance');
    expect(r.deploy.months[3].value).toBeLessThanOrEqual(0);
    expect(r.deploy.value).toBeLessThan(runLab(governed).deploy.value);
    expect(runLab(governed).deploy.incidents).toEqual([]);
    expect(r.deploy.cost).toBe(monthlyCost(bare.deploy, r.training.paramCount) * 6);
    expect(FINES.compliance).toBeGreaterThan(FINES.operational);
    const minimized = runLab({ ...bare, deploy: { ...bare.deploy, minimization: true } });
    expect(minimized.deploy.incidents.find((i) => i.kind === 'confidentiality')!.risk).toBeLessThan(r.deploy.incidents.find((i) => i.kind === 'confidentiality')!.risk);
  });

  it('prices the deployment by what the run has bought: cheaper compute, controls made free', () => {
    const r = runLab(governed);
    const priced = runLab({ ...governed, pricing: { compute: 0.5, free: ['monitoring', 'backups'] } });
    expect(priced.monthlyCompute).toBe(Math.round(r.training.paramCount / 10));
    expect(monthlyCost(governed.deploy, r.training.paramCount, priced.config.pricing))
      .toBe(priced.monthlyCompute + CONTROL_COST.retrainOnAlert + CONTROL_COST.oversight + CONTROL_COST.auditTrail + CONTROL_COST.fairnessTesting + CONTROL_COST.accessControl);
    expect(priced.deploy.months[0].cost).toBe(monthlyCost(governed.deploy, r.training.paramCount, priced.config.pricing));
    expect(priced.deploy.cost).toBeLessThan(r.deploy.cost);
    // Pricing changes what the deployment costs, never what the decisions are worth.
    expect(priced.deploy.value).toBe(r.deploy.value);
    expect(priced.deploy.incidents).toEqual(r.deploy.incidents);
  });

  it('judges the business goal and the appetite', () => {
    expect(runLab(bare).deploy.kgiMet).toBe(false);
    expect(runLab(governed).deploy.kgiMet).toBe(true);
    expect(runLab(governed).deploy.withinAppetite).toBe(true);
    expect(runLab({ ...bare, deploy: { ...bare.deploy, riskAppetite: 'low' } }).deploy.withinAppetite).toBe(false);
    expect(runLab({ ...bare, problem: { ...bare.problem, scope: 'general' } }).monthlyCompute).toBe(runLab(bare).monthlyCompute * 10);
  });
});
