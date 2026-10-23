// The director plays the tutor from the integration guide: it keeps one active
// expedition (topic lock), picks the teaching mode from the anchor's evidence,
// keeps a missed anchor in play until it is answered, and advances the story.
// With the mastery matrix (attention.ts) it also remaps around the anchor: a
// struggling learner gets a related concept they already know as a bridge, and
// the next expedition leans toward topics related to what was just mastered or
// is being struggled with. Orthogonal topics get no such pull.

import { CHAINS, CHAIN_BY_ID, contrastPartners, distinctionFor, type Chain, type ChainStep } from '../data/chains';
import { SETTINGS, SETTING_BY_ID, type StorySetting } from '../data/settings';
import { SITUATIONS, SITUATION_BY_ID, type Situation } from '../data/situations';
import { TERM_BY_ID, type Term } from '../data/terms';
import type { MasteryMatrix } from './attention';
import { consecutiveMisses, levelOf, type Stage, type TermProgress } from './progress';
import { neighbours, relation, REL_ADJACENT_STEP } from './relations';
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
  // The situation the scene was set in (data/situations.ts); older saves lack it.
  situation?: string;
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
  // The moment this scene happens in, different from every earlier scene of the expedition.
  situation: Situation;
  // Situations already used in this expedition, newest last, so a model does not repeat them.
  usedSituations: Situation[];
  anchor: Term;
  supporting: Term[];
  mode: TeachingMode;
  stage: Stage;
  contrast?: { partner: Term; clue: string };
  // A related concept the learner already answers well, used to explain the anchor they are struggling with.
  bridge?: Term;
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

// A bridge must be answered this well, on the learner's own answers.
export const BRIDGE_MIN_P = 0.7;

/**
 * The related concept to explain a struggling anchor with: linked at least as
 * closely as adjacent chain steps, answered by the learner, not itself shaky,
 * and the strongest by relation × estimate. Orthogonal concepts never qualify.
 */
export const bridgeFor = (anchorId: string, matrix: MasteryMatrix, exclude: string[] = []): string | null => {
  let best: string | null = null;
  let bestScore = 0;
  for (const { id, weight } of neighbours(anchorId, REL_ADJACENT_STEP)) {
    const e = matrix.get(id);
    if (!e || exclude.includes(id) || e.attempts === 0 || e.state === 'struggling' || e.p < BRIDGE_MIN_P) continue;
    const score = weight * e.p;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
};

const hash = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

/**
 * The next scene's situation: one not yet used in this expedition (once all are used,
 * any but the last three), picked deterministically from the expedition and its log so
 * a re-asked link after a miss lands in a new moment.
 */
export const pickSituation = (exp: Expedition): Situation => {
  const used = exp.log.map((b) => b.situation).filter((id): id is string => Boolean(id));
  const fresh = SITUATIONS.filter((s) => !used.includes(s.id));
  const pool = fresh.length > 0 ? fresh : SITUATIONS.filter((s) => !used.slice(-3).includes(s.id));
  return pool[hash(`${exp.id}:${exp.log.length}`) % pool.length];
};

export const buildSceneRequest = (
  exp: Expedition,
  progress: (id: string) => TermProgress | undefined,
  matrix?: MasteryMatrix,
): SceneRequest => {
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
  const struggling = exp.missesOnStep > 0 || matrix?.get(anchor.id)?.state === 'struggling';
  const bridgeId = struggling && matrix ? bridgeFor(anchor.id, matrix, contrast ? [contrast.partner.id] : []) : null;
  return {
    chain,
    step,
    stepIndex: exp.stepIndex,
    setting: SETTING_BY_ID.get(exp.settingId)!,
    situation: pickSituation(exp),
    usedSituations: exp.log
      .map((b) => (b.situation ? SITUATION_BY_ID.get(b.situation) : undefined))
      .filter((x): x is Situation => Boolean(x))
      .slice(-5),
    anchor,
    supporting: step.supporting.map((id) => TERM_BY_ID.get(id)).filter((t): t is Term => Boolean(t)),
    mode,
    stage: p?.stage ?? 1,
    contrast,
    bridge: bridgeId ? TERM_BY_ID.get(bridgeId) : undefined,
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

// Concepts mastered this recently pull related topics forward.
export const RECENT_MASTERY_HOURS = 24;
const RELATED_PULL = 0.5;

/** Concepts that should pull related topics forward: just mastered, or being struggled with. */
export const focusConcepts = (matrix: MasteryMatrix): string[] => {
  let newest = 0;
  for (const e of matrix.values()) if (e.lastAt) newest = Math.max(newest, Date.parse(e.lastAt));
  const since = newest - RECENT_MASTERY_HOURS * 3_600_000;
  return [...matrix.entries()]
    .filter(([, e]) => e.state === 'struggling' || (e.state === 'mastered' && e.lastAt !== null && Date.parse(e.lastAt) >= since))
    .map(([id]) => id);
};

/**
 * Recommends the expedition whose anchors are weakest, boosting anything queued for
 * remediation. With the mastery matrix, a decayed estimate counts as weakness (temporal),
 * and unmastered anchors related to a focus concept are pulled forward in proportion
 * to the relation; orthogonal anchors are not.
 */
export const recommendChain = (
  progress: (id: string) => TermProgress | undefined,
  remediation: string[],
  matrix?: MasteryMatrix,
): Chain => {
  const focus = matrix ? focusConcepts(matrix) : [];
  let best = CHAINS[0];
  let bestScore = -1;
  for (const chain of CHAINS) {
    const score = chain.steps.reduce((sum, s) => {
      const p = progress(s.anchor);
      const level = p ? levelOf(p) : 'Unknown';
      const e = matrix?.get(s.anchor);
      const weak = e && e.attempts > 0 ? Math.max(WEAKNESS[level], 1 - e.p) : WEAKNESS[level];
      const pull = e?.state === 'mastered' ? 0 : Math.max(0, ...focus.filter((f) => f !== s.anchor).map((f) => relation(s.anchor, f)));
      return sum + weak + (remediation.includes(s.anchor) ? 1 : 0) + RELATED_PULL * pull;
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
