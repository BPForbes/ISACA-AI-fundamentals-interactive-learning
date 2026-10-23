// Deployment: the decided model meets six months of new cases. The world drifts,
// the business counts what the decisions are worth, and the controls the team
// chose decide what gets noticed, what gets handled, and what becomes an
// incident. Governance terms are the levers here: monitoring (a leading
// indicator) against waiting for the goal to slip (a lagging one), oversight,
// an audit trail, fairness testing, access control, backups, data minimization,
// and a risk appetite that bounds what the board will accept.

import { seededRng } from '../lstm';
import type { Point } from './dataset';
import { confusion, groupAccuracy, scoreAll, type Scored } from './metrics';
import type { TrainResult } from './model';
import { decide, decisionStats, type Routing } from './rules';

export type DeployConfig = {
  monitoring: boolean;
  retrainOnAlert: boolean;
  oversight: boolean;
  auditTrail: boolean;
  fairnessTesting: boolean;
  accessControl: boolean;
  backups: boolean;
  minimization: boolean;
  riskAppetite: 'low' | 'medium' | 'high';
};

export const defaultDeploy = (): DeployConfig => ({
  monitoring: false, retrainOnAlert: false, oversight: false, auditTrail: false, fairnessTesting: false,
  accessControl: false, backups: false, minimization: false, riskAppetite: 'medium',
});

export type IncidentKind = 'reputational' | 'confidentiality' | 'availability' | 'compliance' | 'operational';

export type Incident = { month: number; kind: IncidentKind; text: string; risk: number; trust: number; fine: number };

// What each incident costs the business in value: fines, lost customers, rework.
export const FINES: Record<IncidentKind, number> = { reputational: 120, confidentiality: 150, availability: 0, compliance: 200, operational: 80 };

export type MonthReport = {
  month: number;
  drift: number;
  accuracy: number;
  gap: number;
  recall: number;
  value: number;
  cost: number;
  alert: boolean;
  retrained: boolean;
  incidents: Incident[];
};

export type DeployResult = {
  months: MonthReport[];
  value: number;
  cost: number;
  roi: number;
  incidents: Incident[];
  // The business goal: value over the six months against the brief's target.
  kgiTarget: number;
  kgiMet: boolean;
  // When monitoring first raised a drift alert, if ever.
  alertMonth: number | null;
  withinAppetite: boolean;
};

export const MONTHS = 6;
export const CASES_PER_MONTH = 100;
export const DRIFT_ALERT = 0.25;

// What a decision is worth to the business, and what the controls and compute cost per month.
export const VALUE = { tp: 4, fn: -10, fp: -2 };
export const CONTROL_COST: Record<keyof Omit<DeployConfig, 'riskAppetite'>, number> = {
  monitoring: 8, retrainOnAlert: 10, oversight: 16, auditTrail: 5, fairnessTesting: 6, accessControl: 6, backups: 6, minimization: 2,
};
export const APPETITE_LIMIT: Record<DeployConfig['riskAppetite'], number> = { low: 0, medium: 1, high: 3 };

export type World = {
  draw: (n: number, drift: number, rng: () => number) => Point[];
  retrain: (recent: Point[]) => TrainResult;
  // Drift the world gains each month.
  driftPerMonth: number;
  // Value the business needs over the six months.
  kgiTarget: number;
  // Mean x of the training rows, for the drift score.
  trainMeanX: number;
};

export type Deployment = {
  config: DeployConfig;
  routing: Routing;
  model: TrainResult;
  paramCount: number;
  seed: number;
  // The accuracy gap between the groups as the system went live; a fairness test would have found it.
  launchGap: number;
};

export const monthlyCost = (config: DeployConfig, paramCount: number): number =>
  Math.round(paramCount / 5) + (Object.keys(CONTROL_COST) as (keyof typeof CONTROL_COST)[]).reduce((sum, k) => sum + (config[k] ? CONTROL_COST[k] : 0), 0);

export const simulate = (d: Deployment, world: World): DeployResult => {
  const rng = seededRng(d.seed + 977);
  let model = d.model;
  let paramCount = d.paramCount;
  let alertMonth: number | null = null;
  let previous: Point[] = [];
  const months: MonthReport[] = [];
  const incidents: Incident[] = [];
  for (let month = 1; month <= MONTHS; month += 1) {
    const drift = world.driftPerMonth * month;
    const cases = world.draw(CASES_PER_MONTH, drift, rng);
    const meanX = cases.reduce((s, p) => s + p.x, 0) / cases.length;
    const driftScore = Math.abs(meanX - world.trainMeanX);
    const alert = d.config.monitoring && driftScore >= DRIFT_ALERT;
    if (alert && alertMonth === null) alertMonth = month;
    let retrained = false;
    // Retraining uses the last two months of cases: the world as it is now.
    if (alert && d.config.retrainOnAlert) {
      model = world.retrain([...previous, ...cases]);
      paramCount = model.paramCount;
      retrained = true;
    }
    previous = cases;
    const scored: Scored[] = scoreAll(model.predict, cases);
    const decisions = decide({ ...d.routing, seed: d.seed + month }, scored);
    const stats = decisionStats(decisions, scored);
    const asScored = decisions.map((dec, i) => ({ ...scored[i], score: dec.predicted }));
    const m = confusion(asScored, 0.5);
    const gap = groupAccuracy(asScored, 0.5).gap;
    const monthIncidents: Incident[] = [];
    let value = m.tp * VALUE.tp + m.fn * VALUE.fn + m.fp * VALUE.fp;
    // Oversight: a person checks the costliest calls, which catches a share of the misses.
    if (d.config.oversight) value += Math.round(m.fn * 0.5) * -VALUE.fn * 0.8;
    if (month === 2 && d.launchGap > 0.15 && !d.config.fairnessTesting) {
      monthIncidents.push({ month, kind: 'reputational', text: 'A complaint that the smaller group is treated worse reaches the press; nobody had tested for it.', risk: 10, trust: -8, fine: FINES.reputational });
    }
    if (month === 3 && !d.config.accessControl) {
      monthIncidents.push({ month, kind: 'confidentiality', text: d.config.minimization ? 'An intruder reaches the case store; with only the needed fields kept, little is exposed.' : 'An intruder reaches the case store and copies every field it holds.', risk: d.config.minimization ? 6 : 15, trust: d.config.minimization ? -2 : -6, fine: d.config.minimization ? 40 : FINES.confidentiality });
    }
    if (month === 4 && !d.config.backups) {
      monthIncidents.push({ month, kind: 'availability', text: 'A storage failure takes the service down for the month; the month’s cases are lost.', risk: 8, trust: -5, fine: FINES.availability });
      value = 0;
    }
    if (month === 5 && !(d.config.auditTrail && d.config.oversight)) {
      monthIncidents.push({ month, kind: 'compliance', text: 'The regulator asks who approved what, and when. The records and the oversight it expects are not there.', risk: 15, trust: -4, fine: FINES.compliance });
    }
    if (!d.config.monitoring && !retrained && stats.accuracy < 0.78 && !incidents.some((i) => i.kind === 'operational')) {
      monthIncidents.push({ month, kind: 'operational', text: 'Decisions have quietly slipped below the acceptable mark; nobody was watching the model.', risk: 6, trust: -4, fine: FINES.operational });
    }
    value -= monthIncidents.reduce((s, i) => s + i.fine, 0);
    const cost = monthlyCost(d.config, paramCount);
    incidents.push(...monthIncidents);
    months.push({ month, drift, accuracy: stats.accuracy, gap, recall: m.recall, value, cost, alert, retrained, incidents: monthIncidents });
  }
  const value = months.reduce((s, m) => s + m.value, 0);
  const cost = months.reduce((s, m) => s + m.cost, 0);
  return {
    months,
    value,
    cost,
    roi: cost ? (value - cost) / cost : 0,
    incidents,
    kgiTarget: world.kgiTarget,
    kgiMet: value >= world.kgiTarget,
    alertMonth,
    withinAppetite: incidents.length <= APPETITE_LIMIT[d.config.riskAppetite],
  };
};
