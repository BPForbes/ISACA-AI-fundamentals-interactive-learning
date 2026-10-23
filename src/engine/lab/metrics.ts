// Evaluation: the model's scores on held-out cases, a decision threshold, and the
// confusion matrix and metrics that follow from it. Metric names and formulas are
// the term bank's (precision from predicted positives, recall from actual
// positives, specificity from actual negatives, accuracy from all cases).

import type { Point } from './dataset';

export type Scored = Point & { score: number };

export type Confusion = {
  tp: number;
  fn: number;
  fp: number;
  tn: number;
  precision: number;
  recall: number;
  specificity: number;
  accuracy: number;
};

export const scoreAll = (predict: (x: number, y: number) => number, points: Point[]): Scored[] =>
  points.map((p) => ({ ...p, score: predict(p.x, p.y) }));

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

export const confusion = (scored: Scored[], threshold: number): Confusion => {
  let tp = 0, fn = 0, fp = 0, tn = 0;
  for (const s of scored) {
    const predicted = s.score >= threshold;
    if (s.label === 1) predicted ? (tp += 1) : (fn += 1);
    else predicted ? (fp += 1) : (tn += 1);
  }
  return {
    tp, fn, fp, tn,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    specificity: ratio(tn, tn + fp),
    accuracy: ratio(tp + tn, tp + tn + fp + fn),
  };
};

/** Accuracy for each group, and the gap between them: the fairness test's reading. */
export const groupAccuracy = (scored: Scored[], threshold: number): { majority: number; minority: number; gap: number } => {
  const acc = (group: 0 | 1) => {
    const rows = scored.filter((s) => s.group === group);
    return rows.length ? rows.filter((s) => (s.score >= threshold) === (s.label === 1)).length / rows.length : 0;
  };
  const majority = acc(0);
  const minority = acc(1);
  return { majority, minority, gap: Math.abs(majority - minority) };
};

export const METRIC_IDS = ['precision', 'recall', 'specificity', 'accuracy'] as const;
export type MetricId = (typeof METRIC_IDS)[number];
