// Per-term learning state. Two separate measures, as the guide asks:
// - `stage` is the terminology ladder (Introduce → Scaffold → Conversational →
//   Transfer, with Recovery when meaning is lost). It decides whether a scene
//   defines the term or uses it naturally.
// - `level` (Unknown … Mastered) is the accuracy-based mastery from the
//   quickstart, and the mastery gate decides when an expedition may move on.

export type Stage = 1 | 2 | 3 | 4 | 5;

export const STAGE_NAMES: Record<Stage, string> = {
  1: 'Introduce',
  2: 'Scaffold',
  3: 'Conversational use',
  4: 'Transfer',
  5: 'Recovery',
};

export type Level = 'Unknown' | 'Familiar' | 'Competent' | 'Proficient' | 'Mastered';

export type TermProgress = {
  id: string;
  attempts: number;
  correct: number;
  stage: Stage;
  // Most recent results, newest last, capped at RECENT_WINDOW.
  recent: boolean[];
  // Settings in which the term was answered correctly: transfer evidence.
  contexts: string[];
  // Whether any correct answer came from an unfamiliar (non-personal) setting.
  transferred: boolean;
  lastSeen: string | null;
  updatedAt: string;
};

export const RECENT_WINDOW = 8;
export const PROFICIENT_ACCURACY = 0.85;

export const newProgress = (id: string, now: string): TermProgress => ({
  id,
  attempts: 0,
  correct: 0,
  stage: 1,
  recent: [],
  contexts: [],
  transferred: false,
  lastSeen: null,
  updatedAt: now,
});

export const recentAccuracy = (p: TermProgress): number =>
  p.recent.length === 0 ? 0 : p.recent.filter(Boolean).length / p.recent.length;

export const levelOf = (p: TermProgress): Level => {
  if (p.attempts === 0) return 'Unknown';
  const acc = recentAccuracy(p);
  if (p.attempts >= 8 && acc >= 0.95) return 'Mastered';
  if (p.attempts >= 4 && acc >= PROFICIENT_ACCURACY) return 'Proficient';
  if (acc >= 0.7) return 'Competent';
  return 'Familiar';
};

/**
 * The guide's mastery gate: ~85% across recent questions, at least two later
 * confirmations, at least one application in a second context, and no open
 * misconception (the last answer was correct).
 */
export const meetsMasteryGate = (p: TermProgress): boolean =>
  p.recent.length >= 3
  && recentAccuracy(p) >= PROFICIENT_ACCURACY
  && p.recent[p.recent.length - 1] === true
  && p.correct >= 2
  && p.contexts.length >= 2;

/**
 * An expedition step is cleared once its anchor has been answered correctly in
 * this scene and the latest answer is not a miss. Full mastery is tracked
 * separately; the expedition only refuses to move past an unresolved miss.
 */
export const consecutiveMisses = (p: TermProgress): number => {
  let n = 0;
  for (let i = p.recent.length - 1; i >= 0 && !p.recent[i]; i -= 1) n += 1;
  return n;
};

export type Evidence = {
  correct: boolean;
  settingId: string;
  unfamiliarSetting: boolean;
  // A good free-text explanation in the learner's own words.
  explained: boolean;
};

export const recordAnswer = (prev: TermProgress, e: Evidence, now: string): TermProgress => {
  const recent = [...prev.recent, e.correct].slice(-RECENT_WINDOW);
  const contexts = e.correct && !prev.contexts.includes(e.settingId)
    ? [...prev.contexts, e.settingId]
    : prev.contexts;
  const transferred = prev.transferred || (e.correct && e.unfamiliarSetting);
  const next: TermProgress = {
    ...prev,
    attempts: prev.attempts + 1,
    correct: prev.correct + (e.correct ? 1 : 0),
    recent,
    contexts,
    transferred,
    lastSeen: now,
    updatedAt: now,
  };
  next.stage = nextStage(prev.stage, next, e);
  return next;
};

const nextStage = (stage: Stage, p: TermProgress, e: Evidence): Stage => {
  if (!e.correct) {
    // Losing a term that had reached natural use means backing up to rebuild it.
    return stage >= 3 ? 5 : stage;
  }
  switch (stage) {
    case 1:
      return 2;
    case 2:
      return p.contexts.length >= 2 ? 3 : 2;
    case 3:
      return p.transferred && (e.explained || recentAccuracy(p) >= PROFICIENT_ACCURACY) ? 4 : 3;
    case 5:
      // Recovery is confirmed by a correct answer after the miss.
      return 3;
    default:
      return stage;
  }
};

/**
 * A solid free-text explanation after a correct answer is the guide's evidence
 * that a term is used in the learner's own words; with transfer already shown,
 * it completes the move from conversational use to transfer.
 */
export const creditExplanation = (p: TermProgress, now: string): TermProgress =>
  p.stage === 3 && p.transferred && p.recent[p.recent.length - 1] === true
    ? { ...p, stage: 4, updatedAt: now }
    : p;

/** Last-writer-wins merge used when cloud progress is loaded into a session. */
export const mergeProgress = (local: TermProgress | undefined, remote: TermProgress): TermProgress =>
  !local || remote.updatedAt > local.updatedAt ? remote : local;
