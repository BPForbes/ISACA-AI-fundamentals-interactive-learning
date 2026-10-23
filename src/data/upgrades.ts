// The workshop's upgrade catalogue. Every upgrade is a Chapter 4 or 5 term from
// the term bank: its card shows the exam definition verbatim (read from
// TERM_BY_ID, never copied here) and, separately, what it does in a run. An
// upgrade changes only the run's numbers (how fast loss falls, what a miss costs,
// the team meters). It never touches mastery, the move-on gate or a scene.

import { TERM_BY_ID } from './terms';
import type { RunEffects } from '../engine/run';

export type Upgrade = {
  // The term the upgrade is named after; must exist in the term bank.
  id: string;
  // One of pixelarticons' icon names (MIT), see src/components/PixelIcon.tsx.
  icon: string;
  cost: number;
  maxTier: number;
  // What the upgrade does in this run, at the given tier.
  inRun: (tier: number) => string;
  apply: (fx: RunEffects, tier: number) => void;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const UPGRADES: Upgrade[] = [
  {
    id: 'learning-rate',
    icon: 'sliders',
    cost: 1,
    maxTier: 2,
    inRun: (t) => `Each correct answer removes ${pct(0.22 + 0.04 * t)} of the remaining loss instead of ${pct(0.22 + 0.04 * (t - 1))}.`,
    apply: (fx, t) => { fx.learningRate += 0.04 * t; },
  },
  {
    id: 'depth',
    icon: 'server',
    cost: 1,
    maxTier: 3,
    inRun: (t) => `Adds a hidden layer (${1 + t} in all). Correct answers remove ${pct(0.03 * t)} more loss, but a deeper network overfits: each miss costs ${pct(0.02 * t)} more.`,
    apply: (fx, t) => { fx.learningRate += 0.03 * t; fx.missPenalty += 0.02 * t; fx.hiddenLayers += t; },
  },
  {
    id: 'regularization',
    icon: 'shield',
    cost: 1,
    maxTier: 1,
    inRun: () => 'A miss adds 12% to the loss instead of 18%.',
    apply: (fx) => { fx.missPenalty -= 0.06; },
  },
  {
    id: 'normalization-network',
    icon: 'scale',
    cost: 1,
    maxTier: 1,
    inRun: () => 'Loss can never climb above 1.10, however many misses in a row (the cap is 1.50 without it).',
    apply: (fx) => { fx.lossCap = 1.1; },
  },
  {
    id: 'pretrained-model',
    icon: 'archive',
    cost: 2,
    maxTier: 1,
    inRun: () => 'Every round starts at a loss of 0.80 instead of 1.00.',
    apply: (fx) => { fx.startLoss = 0.8; },
  },
  {
    id: 'fine-tuning',
    icon: 'target',
    cost: 1,
    maxTier: 1,
    inRun: () => 'The first correct answer of each round counts twice.',
    apply: (fx) => { fx.firstStepTwice = true; },
  },
  {
    id: 'optimizer',
    icon: 'trending-up',
    cost: 2,
    maxTier: 1,
    inRun: () => 'Momentum: every consecutive correct answer removes 2% more loss than the one before.',
    apply: (fx) => { fx.momentum = 0.02; },
  },
  {
    id: 'attention',
    icon: 'eye',
    cost: 2,
    maxTier: 1,
    inRun: () => 'A correct answer right after a miss on the same link undoes that miss’s loss.',
    apply: (fx) => { fx.recoverOnFix = true; },
  },
  {
    id: 'data-augmentation',
    icon: 'repeat',
    cost: 2,
    maxTier: 1,
    inRun: () => 'The first miss of each round costs half.',
    apply: (fx) => { fx.augmentFirstMiss = true; },
  },
  {
    id: 'human-oversight',
    icon: 'human',
    cost: 1,
    maxTier: 1,
    inRun: () => 'A miss costs the team 5 trust and 5 risk instead of 10 and 10.',
    apply: (fx) => { fx.missTrust = 5; fx.missRisk = 5; },
  },
  {
    id: 'model-compression',
    icon: 'cpu',
    cost: 1,
    maxTier: 1,
    inRun: () => 'Each scene costs less budget: 1 instead of 2 for a correct answer, 5 instead of 8 for a miss.',
    apply: (fx) => { fx.correctBudget = 1; fx.missBudget = 5; },
  },
  {
    id: 'audit-trail',
    icon: 'notebook',
    cost: 1,
    maxTier: 1,
    inRun: () => 'A failed round raises risk by 8 instead of 15: the review finds the records in order.',
    apply: (fx) => { fx.failedRoundRisk = 8; },
  },
];

export const UPGRADE_BY_ID: ReadonlyMap<string, Upgrade> = new Map(UPGRADES.map((u) => [u.id, u]));

/** The term an upgrade is named after. Throws if the catalogue drifts from the term bank. */
export const upgradeTerm = (id: string) => {
  const term = TERM_BY_ID.get(id);
  if (!term) throw new Error(`Upgrade ${id} names no term in the bank`);
  return term;
};
