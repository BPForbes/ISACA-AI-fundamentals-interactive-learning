// The rules workbench: explicit rules over the case's features, an inference
// engine that applies them in order (first match wins), a knowledge base of
// facts the domain experts hold, rule induction from the data, and the routing
// between rules, the model and a human reviewer that makes an approach
// rule-based, machine-learned or hybrid. A human reviewer is accurate but has
// limited capacity, and shown the model's score, tends to agree with it.

import { seededRng } from '../lstm';
import type { Point } from './dataset';
import type { Scored } from './metrics';

export type Rule = {
  // Only cases of this group, when set.
  group?: 0 | 1;
  feature: 'x' | 'y';
  op: '>' | '<';
  value: number;
  outcome: 0 | 1;
  // Learned from the sample (inductive) rather than taken from the knowledge base (deductive).
  induced?: boolean;
};

export type Approach = 'rules' | 'ml' | 'hybrid';

export type Review = {
  // Cases the reviewer can look at per hundred.
  capacity: number;
  // Model scores within this distance of the threshold are uncertain and go to review.
  band: number;
  // Whether the reviewer sees the model's score (and tends to follow it).
  showScore: boolean;
};

export type Source = 'rule' | 'model' | 'human' | 'default';

export type Decision = { source: Source; predicted: 0 | 1; rule: number | null };

export const MAX_RULES = 5;
// Accuracy of a reviewer judging blind, and the share of reviews that just follow a shown score.
export const REVIEWER_ACCURACY = 0.96;
export const AUTOMATION_BIAS = 1;

export const defaultReview = (): Review => ({ capacity: 0, band: 0.2, showScore: true });

/** What the domain experts know, as rules a knowledge base holds; `inference` applies them. */
export const KNOWLEDGE_BASE: { fact: string; rule: Rule }[] = [
  { fact: 'A high first reading is a positive case in every group we have seen.', rule: { feature: 'x', op: '>', value: 0.45, outcome: 1 } },
  { fact: 'A low first reading with a low second reading has never been a positive case.', rule: { feature: 'y', op: '<', value: -0.55, outcome: 0 } },
  { fact: 'In the smaller group, a second reading above the middle is a positive case.', rule: { group: 1, feature: 'y', op: '>', value: 0, outcome: 1 } },
  { fact: 'In the larger group, a low first reading is a negative case.', rule: { group: 0, feature: 'x', op: '<', value: -0.1, outcome: 0 } },
];

export const fires = (rule: Rule, p: Point): boolean =>
  (rule.group === undefined || rule.group === p.group) && (rule.op === '>' ? p[rule.feature] > rule.value : p[rule.feature] < rule.value);

/** The inference engine: the first rule that fires decides. */
export const inference = (rules: Rule[], p: Point): { outcome: 0 | 1; rule: number } | null => {
  for (let i = 0; i < rules.length; i += 1) if (fires(rules[i], p)) return { outcome: rules[i].outcome, rule: i };
  return null;
};

export const describeRule = (r: Rule): string =>
  `${r.group === undefined ? '' : r.group === 1 ? 'smaller group, ' : 'larger group, '}${r.feature === 'x' ? 'first reading' : 'second reading'} ${r.op} ${r.value.toFixed(2)} → ${r.outcome ? 'positive' : 'negative'}`;

/** Each rule's coverage and accuracy over the cases it decides, in order. */
export const ruleStats = (rules: Rule[], points: Point[]): { covered: number; correct: number }[] => {
  const stats = rules.map(() => ({ covered: 0, correct: 0 }));
  for (const p of points) {
    const hit = inference(rules, p);
    if (!hit) continue;
    stats[hit.rule].covered += 1;
    if (hit.outcome === p.label) stats[hit.rule].correct += 1;
  }
  return stats;
};

/**
 * Inductive reasoning: the single rule that best fits the sample, found by trying
 * every threshold on each feature. It generalizes from examples, so it is only as
 * good as the sample.
 */
export const induceRule = (sample: Point[], exclude: Rule[] = []): Rule | null => {
  if (sample.length === 0) return null;
  let best: { rule: Rule; score: number } | null = null;
  for (const feature of ['x', 'y'] as const) {
    const values = [...new Set(sample.map((p) => Math.round(p[feature] * 20) / 20))];
    for (const value of values) {
      for (const op of ['>', '<'] as const) {
        for (const outcome of [0, 1] as const) {
          const rule: Rule = { feature, op, value, outcome, induced: true };
          if (exclude.some((e) => e.feature === feature && e.op === op && e.outcome === outcome && Math.abs(e.value - value) < 0.051)) continue;
          const covered = sample.filter((p) => fires(rule, p));
          if (covered.length < sample.length * 0.15) continue;
          const correct = covered.filter((p) => p.label === outcome).length;
          // Precision over the cases it covers, weighted a little toward covering more.
          const score = (correct / covered.length) * Math.min(1, 0.6 + covered.length / sample.length);
          if (!best || score > best.score) best = { rule, score };
        }
      }
    }
  }
  return best?.rule ?? null;
};

export type Routing = { approach: Approach; rules: Rule[]; review: Review; threshold: number; seed: number };

/** Decides every scored case the way the chosen approach routes it. */
export const decide = (routing: Routing, scored: Scored[]): Decision[] => {
  const rng = seededRng(routing.seed + 101);
  let reviews = Math.round((routing.review.capacity / 100) * scored.length);
  const human = (s: Scored): 0 | 1 => {
    const modelSays: 0 | 1 = s.score >= routing.threshold ? 1 : 0;
    if (routing.review.showScore && rng() < AUTOMATION_BIAS) return modelSays;
    return rng() < REVIEWER_ACCURACY ? s.label : s.label === 1 ? 0 : 1;
  };
  return scored.map((s): Decision => {
    if (routing.approach !== 'ml') {
      const hit = inference(routing.rules, s);
      if (hit) return { source: 'rule', predicted: hit.outcome, rule: hit.rule };
      if (routing.approach === 'rules') {
        if (reviews > 0) {
          reviews -= 1;
          return { source: 'human', predicted: human(s), rule: null };
        }
        return { source: 'default', predicted: 0, rule: null };
      }
    }
    const uncertain = Math.abs(s.score - routing.threshold) < routing.review.band / 2;
    if (uncertain && reviews > 0) {
      reviews -= 1;
      return { source: 'human', predicted: human(s), rule: null };
    }
    return { source: 'model', predicted: s.score >= routing.threshold ? 1 : 0, rule: null };
  });
};

export type DecisionStats = {
  accuracy: number;
  // Decisions a person can follow: a rule's trace or a reviewer's call.
  explained: number;
  bySource: Record<Source, number>;
  // Accuracy of the reviewer's own decisions.
  reviewerAccuracy: number;
  minorityAccuracy: number;
};

export const decisionStats = (decisions: Decision[], scored: Scored[]): DecisionStats => {
  const n = Math.max(1, decisions.length);
  const bySource: Record<Source, number> = { rule: 0, model: 0, human: 0, default: 0 };
  let correct = 0, reviewed = 0, reviewedRight = 0, minority = 0, minorityRight = 0;
  decisions.forEach((d, i) => {
    bySource[d.source] += 1;
    const right = d.predicted === scored[i].label;
    if (right) correct += 1;
    if (d.source === 'human') {
      reviewed += 1;
      if (right) reviewedRight += 1;
    }
    if (scored[i].group === 1) {
      minority += 1;
      if (right) minorityRight += 1;
    }
  });
  return {
    accuracy: correct / n,
    explained: (bySource.rule + bySource.human) / n,
    bySource,
    reviewerAccuracy: reviewed ? reviewedRight / reviewed : 0,
    minorityAccuracy: minority ? minorityRight / minority : 0,
  };
};
