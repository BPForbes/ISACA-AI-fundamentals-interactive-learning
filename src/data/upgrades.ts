// The workshop's upgrade catalogue. Every upgrade is a term from the term bank:
// its card shows the exam definition verbatim (read from TERM_BY_ID, never
// copied here) and, separately, what it gives the lab. An upgrade is a
// capability the lab gains for the rest of the run (a control unlocked, a cost
// reduced, a control made free). It never touches mastery, the move-on gate, or
// what a goal judges; a goal that needs a capability is posed only once the run
// has it.

import { TERM_BY_ID } from './terms';

export type Capability =
  // Two hidden layers, sixteen units a layer, a momentum optimizer, the interaction feature, augmentation.
  | 'depth2' | 'wide' | 'momentum' | 'interaction' | 'augment'
  // Reviewers can take sixty cases in a hundred.
  | 'review60'
  // The model's monthly compute is halved.
  | 'cheapCompute'
  // These deployment controls cost nothing.
  | 'freeMonitoring' | 'freeAudit' | 'freeFairness' | 'freeBackups';

export type Upgrade = {
  // The term the upgrade is named after; must exist in the term bank.
  id: string;
  // One of pixelarticons' icon names (MIT), see src/components/PixelIcon.tsx.
  icon: string;
  cost: number;
  inRun: string;
  gives: Capability;
};

export const UPGRADES: Upgrade[] = [
  { id: 'depth', icon: 'server', cost: 2, inRun: 'The lab can train a second hidden layer.', gives: 'depth2' },
  { id: 'width', icon: 'sliders', cost: 1, inRun: 'Hidden layers can have up to sixteen units.', gives: 'wide' },
  { id: 'optimizer', icon: 'trending-up', cost: 2, inRun: 'The optimizer can carry momentum, so small, safe steps still converge quickly.', gives: 'momentum' },
  { id: 'feature-engineering', icon: 'target', cost: 2, inRun: 'An interaction feature (x·y) can be added, which lets a straight line follow a bend.', gives: 'interaction' },
  { id: 'data-augmentation', icon: 'repeat', cost: 1, inRun: 'Training rows can be augmented with jittered copies.', gives: 'augment' },
  { id: 'human-oversight', icon: 'human', cost: 2, inRun: 'Reviewers can take up to sixty cases in a hundred instead of thirty.', gives: 'review60' },
  { id: 'model-compression', icon: 'cpu', cost: 2, inRun: 'The deployed model costs half as much compute each month.', gives: 'cheapCompute' },
  { id: 'monitoring', icon: 'eye', cost: 1, inRun: 'Monitoring costs nothing to run.', gives: 'freeMonitoring' },
  { id: 'audit-trail', icon: 'notebook', cost: 1, inRun: 'The audit trail costs nothing to keep.', gives: 'freeAudit' },
  { id: 'fairness-testing', icon: 'scale', cost: 1, inRun: 'Fairness testing costs nothing to run.', gives: 'freeFairness' },
  { id: 'backup', icon: 'archive', cost: 1, inRun: 'Backups cost nothing to keep.', gives: 'freeBackups' },
];

export const UPGRADE_BY_ID: ReadonlyMap<string, Upgrade> = new Map(UPGRADES.map((u) => [u.id, u]));

/** The term an upgrade is named after. Throws if the catalogue drifts from the term bank. */
export const upgradeTerm = (id: string) => {
  const term = TERM_BY_ID.get(id);
  if (!term) throw new Error(`Upgrade ${id} names no term in the bank`);
  return term;
};

export const capabilitiesOf = (upgrades: Record<string, number>): Set<Capability> =>
  new Set(UPGRADES.filter((u) => (upgrades[u.id] ?? 0) > 0).map((u) => u.gives));
