// Points = Base × Risk × Topic Bonus × Streak Multiplier, Streak = √(consecutive correct).
// Points never override topic lock or the mastery gate; they only make the
// adventure feel like a game.

export const BASE_POINTS = 10;
export const MIN_RISK = 0.25;
export const MAX_RISK = 4;
export const RISK_STEPS = [0.25, 0.5, 1, 1.5, 2, 3, 4] as const;

export const clampRisk = (risk: number): number =>
  Number.isFinite(risk) ? Math.min(MAX_RISK, Math.max(MIN_RISK, risk)) : 1;

export const streakMultiplier = (streak: number): number => (streak <= 0 ? 1 : Math.sqrt(streak));

/**
 * Remediation and first-contact scenes are worth more so the learner is not
 * rewarded for avoiding weak topics.
 */
export const topicBonus = (mode: string): number =>
  mode === 'remediation' || mode === 'diagnostic' ? 1.5 : mode === 'maintenance' ? 0.75 : 1;

export type ScoreResult = { points: number; streak: number };

/**
 * A miss breaks the streak. Staking more than 1× has a cost on a miss (the
 * part of the stake above 1×), so the risk choice means something; staking
 * 1× or less is always safe, which keeps low-confidence play stress-free.
 */
export const scoreAnswer = (input: {
  correct: boolean;
  risk: number;
  mode: string;
  streakBefore: number;
}): ScoreResult => {
  const risk = clampRisk(input.risk);
  if (!input.correct) {
    const penalty = Math.round(BASE_POINTS * Math.max(0, risk - 1));
    return { points: penalty === 0 ? 0 : -penalty, streak: 0 };
  }
  const streak = input.streakBefore + 1;
  const points = BASE_POINTS * risk * topicBonus(input.mode) * streakMultiplier(streak);
  return { points: Math.round(points), streak };
};

export const suggestedRisk = (level: string): [number, number] => {
  switch (level) {
    case 'Proficient':
    case 'Mastered':
      return [2, 4];
    case 'Competent':
      return [1, 2];
    default:
      return [0.5, 1];
  }
};
