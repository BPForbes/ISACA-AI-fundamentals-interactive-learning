// The director plays the tutor from the integration guide: it keeps one active
// expedition (topic lock), picks the teaching mode from the anchor's evidence,
// keeps a missed anchor in play until it is answered, and advances the story.

import { CHAINS, CHAIN_BY_ID, contrastPartners, distinctionFor, type Chain, type ChainStep } from '../data/chains';
import { SETTINGS, SETTING_BY_ID, type StorySetting } from '../data/settings';
import { TERM_BY_ID, type Term } from '../data/terms';
import { consecutiveMisses, levelOf, type Stage, type TermProgress } from './progress';
import type { TeachingMode } from './scene';

export const CALCULATION_TERMS = new Set(['confusion-matrix', 'tp', 'fn', 'fp', 'tn', 'precision', 'recall', 'specificity', 'accuracy']);

// After this many misses on one step the learner may defer the anchor to the
// remediation queue instead of being stuck (the guide's "genuinely stuck" rule).
export const DEFER_AFTER_MISSES = 3;

export type Meters = { trust: number; budget: number; risk: number };

export type StoryBeat = {
  stepIndex: number;
  anchor: string;
  choice: string;
  correct: boolean;
  consequence: string;
};

export type Expedition = {
  id: string;
  chainId: string;
  settingId: string;
  stepIndex: number;
  missesOnStep: number;
  // Correct answers on this link that the move-on gate held for confirmation.
  confirmationsOnStep: number;
  lastOnStepCorrect: boolean;
  meters: Meters;
  log: StoryBeat[];
  status: 'active' | 'complete';
  startedAt: string;
};

export type SceneRequest = {
  chain: Chain;
  step: ChainStep;
  stepIndex: number;
  setting: StorySetting;
  anchor: Term;
  supporting: Term[];
  mode: TeachingMode;
  stage: Stage;
  contrast?: { partner: Term; clue: string };
  storySoFar: string[];
  meters: Meters;
  missesOnStep: number;
  // The last answer on this link was right, but the move-on gate wants one more.
  confirming: boolean;
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export const chooseMode = (progress: TermProgress | undefined, anchorId: string, missesOnStep: number): TeachingMode => {
  if (!progress || progress.attempts === 0) return 'diagnostic';
  const misses = Math.max(missesOnStep, consecutiveMisses(progress));
  if (misses >= 2) return 'remediation';
  if (CALCULATION_TERMS.has(anchorId)) return 'calculation';
  if (misses === 1) return contrastPartners(anchorId).length > 0 ? 'contrast' : 'explain';
  if (progress.stage === 5) return 'remediation';
  const level = levelOf(progress);
  if (level === 'Proficient' || level === 'Mastered') return 'maintenance';
  if (progress.stage >= 3) return 'integration';
  return 'guided';
};

/** Picks a story setting for a new expedition, alternating familiar and unfamiliar for transfer. */
export const chooseSetting = (chain: Chain, lastKind: 'familiar' | 'unfamiliar' | null, rng: () => number): StorySetting => {
  const anchors = new Set(chain.steps.flatMap((s) => [s.anchor, ...s.supporting]));
  const wantKind = lastKind === 'familiar' ? 'unfamiliar' : lastKind === 'unfamiliar' ? 'familiar' : null;
  const scored = SETTINGS
    .filter((s) => !wantKind || s.kind === wantKind)
    .map((s) => ({ s, score: s.fits.filter((f) => anchors.has(f)).length + rng() * 0.5 }))
    .sort((a, b) => b.score - a.score);
  return scored[0].s;
};

export const startExpedition = (
  chainId: string,
  opts: { lastKind: 'familiar' | 'unfamiliar' | null; now: string; rng: () => number; settingId?: string },
): Expedition => {
  const chain = CHAIN_BY_ID.get(chainId);
  if (!chain) throw new Error(`Unknown expedition ${chainId}`);
  const setting = (opts.settingId && SETTING_BY_ID.get(opts.settingId)) || chooseSetting(chain, opts.lastKind, opts.rng);
  return {
    id: `${chainId}-${opts.now}`,
    chainId,
    settingId: setting.id,
    stepIndex: 0,
    missesOnStep: 0,
    confirmationsOnStep: 0,
    lastOnStepCorrect: false,
    meters: { trust: 60, budget: 70, risk: 30 },
    log: [],
    status: 'active',
    startedAt: opts.now,
  };
};

export const buildSceneRequest = (exp: Expedition, progress: (id: string) => TermProgress | undefined): SceneRequest => {
  const chain = CHAIN_BY_ID.get(exp.chainId)!;
  const step = chain.steps[exp.stepIndex];
  const anchor = TERM_BY_ID.get(step.anchor)!;
  const p = progress(anchor.id);
  const confirming = exp.lastOnStepCorrect === true;
  const mode: TeachingMode = !confirming
    ? chooseMode(p, anchor.id, exp.missesOnStep)
    : CALCULATION_TERMS.has(anchor.id)
      ? 'calculation'
      : p && p.stage >= 3 && p.stage !== 5 ? 'integration' : 'guided';
  const partners = contrastPartners(anchor.id);
  let contrast: SceneRequest['contrast'];
  if (partners.length > 0 && (mode === 'contrast' || mode === 'remediation' || mode === 'integration')) {
    const partner = TERM_BY_ID.get(partners[exp.missesOnStep % partners.length])!;
    contrast = { partner, clue: distinctionFor(anchor.id, partner.id)!.clue };
  }
  return {
    chain,
    step,
    stepIndex: exp.stepIndex,
    setting: SETTING_BY_ID.get(exp.settingId)!,
    anchor,
    supporting: step.supporting.map((id) => TERM_BY_ID.get(id)).filter((t): t is Term => Boolean(t)),
    mode,
    stage: p?.stage ?? 1,
    contrast,
    storySoFar: exp.log.slice(-3).map((b) => b.consequence).filter(Boolean),
    meters: exp.meters,
    missesOnStep: exp.missesOnStep,
    confirming,
  };
};

/**
 * Applies a decision to the expedition. A miss keeps the same anchor in play
 * (re-asked in new wording) and costs the team trust and budget, so mistakes
 * have story consequences. A correct answer clears the link only when the
 * move-on gate (rules, plus the progress model once trusted) says `advance`;
 * otherwise the link is confirmed once more from a new angle.
 */
export const applyDecision = (exp: Expedition, beat: Omit<StoryBeat, 'stepIndex'>, advance = beat.correct): Expedition => {
  const chain = CHAIN_BY_ID.get(exp.chainId)!;
  const m = exp.meters;
  const meters: Meters = beat.correct
    ? { trust: clamp(m.trust + 8), budget: clamp(m.budget - 2), risk: clamp(m.risk - 6) }
    : { trust: clamp(m.trust - 10), budget: clamp(m.budget - 8), risk: clamp(m.risk + 10) };
  const log = [...exp.log, { ...beat, stepIndex: exp.stepIndex }];
  if (!beat.correct) return { ...exp, meters, log, missesOnStep: exp.missesOnStep + 1, lastOnStepCorrect: false };
  if (!advance) {
    return { ...exp, meters, log, confirmationsOnStep: (exp.confirmationsOnStep ?? 0) + 1, lastOnStepCorrect: true };
  }
  const stepIndex = exp.stepIndex + 1;
  const done = stepIndex >= chain.steps.length;
  return {
    ...exp,
    meters,
    log,
    stepIndex: done ? exp.stepIndex : stepIndex,
    missesOnStep: 0,
    confirmationsOnStep: 0,
    lastOnStepCorrect: false,
    status: done ? 'complete' : 'active',
  };
};

/** Moves past a step the learner is stuck on; the caller queues the anchor for remediation. */
export const deferStep = (exp: Expedition): Expedition => {
  const chain = CHAIN_BY_ID.get(exp.chainId)!;
  const stepIndex = exp.stepIndex + 1;
  const done = stepIndex >= chain.steps.length;
  return {
    ...exp,
    stepIndex: done ? exp.stepIndex : stepIndex,
    missesOnStep: 0,
    confirmationsOnStep: 0,
    lastOnStepCorrect: false,
    status: done ? 'complete' : 'active',
  };
};

const WEAKNESS: Record<string, number> = { Unknown: 1, Familiar: 0.8, Competent: 0.5, Proficient: 0.2, Mastered: 0 };

/** Recommends the expedition whose anchors are weakest, boosting anything queued for remediation. */
export const recommendChain = (progress: (id: string) => TermProgress | undefined, remediation: string[]): Chain => {
  let best = CHAINS[0];
  let bestScore = -1;
  for (const chain of CHAINS) {
    const score = chain.steps.reduce((sum, s) => {
      const p = progress(s.anchor);
      const weak = WEAKNESS[p ? levelOf(p) : 'Unknown'];
      return sum + weak + (remediation.includes(s.anchor) ? 1 : 0);
    }, 0) / chain.steps.length;
    if (score > bestScore + 1e-9) {
      best = chain;
      bestScore = score;
    }
  }
  return best;
};

export const expeditionOutcome = (m: Meters): { title: string; text: string } => {
  if (m.trust >= 70 && m.risk <= 30) {
    return { title: 'Trusted advisor', text: 'Leadership adopts your recommendation with clear owners, measures and controls.' };
  }
  if (m.trust >= 45) {
    return { title: 'Approved with conditions', text: 'The initiative goes ahead, but governance asks for another review before scaling.' };
  }
  return { title: 'Sent back for rework', text: 'The board pauses the initiative. The missed concepts are queued so you can return stronger.' };
};
