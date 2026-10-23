import { describe, expect, it } from 'vitest';
import { buildDataset, defaultData, MINORITY_SHARE, POPULATION, TEST_SIZE, VALIDATION_SIZE } from '../dataset';
import { defaultLab, diagnose, runLab } from '..';
import { confusion, groupAccuracy, type Scored } from '../metrics';
import { defaultModel, paramCount, trainModel, type TrainResult } from '../model';

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
    expect(augmented.train).toHaveLength(240);
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
    const r = trainModel(defaultModel(8), d.train, d.validation);
    expect(r.curve).toHaveLength(30);
    expect(r.curve[29].train).toBeLessThan(r.curve[0].train);
    expect(r.curve[29].val).toBeLessThan(0.45);
    expect(r.diverged).toBe(false);
    expect(trainModel(defaultModel(8), d.train, d.validation).curve).toEqual(r.curve);
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
