// Session state. Everything learned is kept here, in memory and in a local
// draft, and marked dirty; nothing goes to the cloud until the learner saves.
// A save sends only what changed since the last save, under a save id the
// Worker uses to make a retried save harmless.

import { CHAIN_BY_ID } from '../data/chains';
import { TERM_BY_ID } from '../data/terms';
import { applyDecision, deferStep, type Expedition, type SceneRequest } from '../engine/director';
import { creditExplanation, levelOf, mergeProgress, newProgress, recordAnswer, STAGE_NAMES, type TermProgress } from '../engine/progress';
import { scoreAnswer } from '../engine/scoring';
import { decideAdvance, type GateDecision, type HistoryEvent, type TrackerModel } from '../engine/tracker';
import type { Choice, Scene } from '../engine/scene';
import type { RemoteProgress, SavePayload, SceneEvent, SessionSummary } from '../sync/cloud';

export const CAMP_INTERVAL = 6;
export const TARGET_POINTS = 2500;

export type SessionStats = {
  points: number;
  answered: number;
  correct: number;
  streak: number;
  longestStreak: number;
  modesUsed: string[];
  expeditions: string[];
};

export type SessionState = {
  version: 1;
  sessionId: string;
  startedAt: string;
  progress: Record<string, TermProgress>;
  dirty: string[];
  events: SceneEvent[];
  remediation: string[];
  stats: SessionStats;
  expedition: Expedition | null;
  lastKind: 'familiar' | 'unfamiliar' | null;
  lastSavedAt: string | null;
  sinceCamp: number;
  notes: { anchor: string; note: string; verdict: string }[];
  // Every answer ever given, kept locally (and restored from the cloud) to train the progress model.
  history: HistoryEvent[];
};

export const HISTORY_CAP = 5000;

const emptyStats = (): SessionStats => ({
  points: 0, answered: 0, correct: 0, streak: 0, longestStreak: 0, modesUsed: [], expeditions: [],
});

export const newSession = (now: string, id: string, carry?: SessionState): SessionState => ({
  version: 1,
  sessionId: id,
  startedAt: now,
  progress: carry?.progress ?? {},
  // Unsaved work survives starting a new session; it is only cleared by a save.
  dirty: carry?.dirty ?? [],
  events: carry?.events ?? [],
  remediation: carry?.remediation ?? [],
  stats: emptyStats(),
  expedition: null,
  lastKind: carry?.lastKind ?? null,
  lastSavedAt: carry?.lastSavedAt ?? null,
  sinceCamp: 0,
  notes: [],
  history: carry?.history ?? [],
});

const addUnique = (list: string[], item: string) => (list.includes(item) ? list : [...list, item]);

export const beginExpedition = (s: SessionState, exp: Expedition): SessionState => ({
  ...s,
  expedition: exp,
  stats: { ...s.stats, expeditions: addUnique(s.stats.expeditions, exp.chainId) },
});

export type AnswerInput = {
  req: SceneRequest;
  scene: Scene;
  choice: Choice;
  risk: number;
  explained: boolean;
  note: string;
  now: string;
  eventId: string;
  model: TrackerModel | null;
};

export type AnswerOutcome = { state: SessionState; points: number; campDue: boolean; gate: GateDecision };

export const answerScene = (s: SessionState, a: AnswerInput): AnswerOutcome => {
  if (!s.expedition) throw new Error('No active expedition');
  const anchorId = a.req.anchor.id;
  const prev = s.progress[anchorId] ?? newProgress(anchorId, a.now);
  const progress = recordAnswer(prev, {
    correct: a.choice.correct,
    settingId: a.req.setting.id,
    unfamiliarSetting: a.req.setting.kind === 'unfamiliar',
    explained: a.explained,
  }, a.now);
  const score = scoreAnswer({ correct: a.choice.correct, risk: a.risk, mode: a.req.mode, streakBefore: s.stats.streak });

  const stats: SessionStats = {
    ...s.stats,
    points: s.stats.points + score.points,
    answered: s.stats.answered + 1,
    correct: s.stats.correct + (a.choice.correct ? 1 : 0),
    streak: score.streak,
    longestStreak: Math.max(s.stats.longestStreak, score.streak),
    modesUsed: addUnique(s.stats.modesUsed, a.req.mode),
  };

  // A miss queues the anchor for spaced repetition; two correct answers in a row clear it.
  const remediation = a.choice.correct
    ? s.remediation.filter((id) => id !== anchorId || progress.recent.slice(-2).some((r) => !r))
    : addUnique(s.remediation, anchorId);

  const event: SceneEvent = {
    id: a.eventId,
    sessionId: s.sessionId,
    at: a.now,
    chainId: a.req.chain.id,
    anchor: anchorId,
    mode: a.req.mode,
    settingId: a.req.setting.id,
    correct: a.choice.correct,
    risk: a.risk,
    points: score.points,
    source: a.scene.source,
    note: a.note.slice(0, 1000),
  };

  const historyEvent: HistoryEvent = {
    id: a.eventId,
    at: a.now,
    concept: anchorId,
    correct: a.choice.correct,
    risk: a.risk,
    mode: a.req.mode,
    settingId: a.req.setting.id,
    source: a.scene.source,
  };
  const history = [...(s.history ?? []), historyEvent].slice(-HISTORY_CAP);

  const exp = s.expedition;
  const gate = decideAdvance({
    correct: a.choice.correct,
    missesOnStep: exp.missesOnStep,
    confirmationsOnStep: exp.confirmationsOnStep ?? 0,
    previousOnStepCorrect: exp.lastOnStepCorrect ?? false,
    model: a.model,
    conceptHistory: history.filter((e) => e.concept === anchorId),
  });

  const expedition = applyDecision(exp, {
    anchor: anchorId,
    choice: a.choice.text,
    correct: a.choice.correct,
    consequence: a.choice.consequence,
  }, gate.advance);

  const sinceCamp = s.sinceCamp + 1;
  return {
    points: score.points,
    campDue: sinceCamp >= CAMP_INTERVAL,
    gate,
    state: {
      ...s,
      progress: { ...s.progress, [anchorId]: progress },
      dirty: addUnique(s.dirty, anchorId),
      events: [...s.events, event],
      remediation,
      stats,
      expedition,
      lastKind: expedition.status === 'complete' ? a.req.setting.kind : s.lastKind,
      sinceCamp,
      history,
    },
  };
};

export const deferCurrentStep = (s: SessionState): SessionState => {
  if (!s.expedition) return s;
  const anchor = CHAIN_BY_ID.get(s.expedition.chainId)!.steps[s.expedition.stepIndex].anchor;
  return { ...s, remediation: addUnique(s.remediation, anchor), expedition: deferStep(s.expedition) };
};

export const leaveCamp = (s: SessionState): SessionState => ({ ...s, sinceCamp: 0 });

/** Records a field note on the latest scene and credits a solid explanation. */
export const recordNote = (s: SessionState, anchor: string, note: string, verdict: string, now: string): SessionState => {
  const text = note.slice(0, 1000);
  const last = s.events[s.events.length - 1];
  const events = last && last.anchor === anchor ? [...s.events.slice(0, -1), { ...last, note: text }] : s.events;
  const before = s.progress[anchor];
  const after = before && verdict === 'solid' ? creditExplanation(before, now) : before;
  const changed = after !== before;
  return {
    ...s,
    events,
    notes: [...s.notes, { anchor, note: text, verdict }].slice(-50),
    progress: changed ? { ...s.progress, [anchor]: after } : s.progress,
    dirty: changed ? addUnique(s.dirty, anchor) : s.dirty,
  };
};

export const hasUnsavedChanges = (s: SessionState): boolean => s.dirty.length > 0 || s.events.length > 0;

export const summarize = (s: SessionState, now: string): SessionSummary => ({
  id: s.sessionId,
  startedAt: s.startedAt,
  endedAt: now,
  points: s.stats.points,
  answered: s.stats.answered,
  correct: s.stats.correct,
  longestStreak: s.stats.longestStreak,
  modesUsed: s.stats.modesUsed,
  expeditions: s.stats.expeditions,
});

export const buildSavePayload = (s: SessionState, now: string, saveId: string): SavePayload => ({
  saveId,
  session: summarize(s, now),
  terms: s.dirty.map((id) => s.progress[id]).filter((p): p is TermProgress => Boolean(p)),
  events: s.events,
  remediation: s.remediation,
});

/** Clears only what the payload carried, so answers given while a save was in flight stay dirty. */
export const markSaved = (s: SessionState, payload: SavePayload, now: string): SessionState => {
  const sentEvents = new Set(payload.events.map((e) => e.id));
  const sentTerms = new Map(payload.terms.map((t) => [t.id, t.updatedAt]));
  return {
    ...s,
    dirty: s.dirty.filter((id) => sentTerms.get(id) !== s.progress[id]?.updatedAt),
    events: s.events.filter((e) => !sentEvents.has(e.id)),
    lastSavedAt: now,
  };
};

export const applyRemote = (s: SessionState, remote: RemoteProgress): SessionState => {
  const progress = { ...s.progress };
  for (const t of remote.terms) {
    if (!TERM_BY_ID.has(t.id)) continue;
    progress[t.id] = mergeProgress(progress[t.id], t);
  }
  const remediation = [...s.remediation];
  for (const id of remote.remediation) if (TERM_BY_ID.has(id) && !remediation.includes(id)) remediation.push(id);
  const known = new Set((s.history ?? []).map((e) => e.id));
  const incoming = (remote.events ?? []).filter((e) => !known.has(e.id) && TERM_BY_ID.has(e.anchor)).map((e): HistoryEvent => ({
    id: e.id, at: e.at, concept: e.anchor, correct: e.correct, risk: e.risk, mode: e.mode, settingId: e.settingId, source: e.source,
  }));
  const history = [...(s.history ?? []), ...incoming].sort((x, y) => x.at.localeCompare(y.at)).slice(-HISTORY_CAP);
  return { ...s, progress, remediation, history };
};

const DRAFT_KEY = 'isaca-quest-session-v1';

export const saveDraft = (s: SessionState) => {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(s));
  } catch {
    // A full or blocked storage only loses the reload safety net, not the session.
  }
};

export const loadDraft = (): SessionState | null => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionState;
    if (parsed.version !== 1 || !parsed.progress || !parsed.stats) return null;
    // Drafts written before the progress model existed have no history yet.
    return { ...parsed, history: parsed.history ?? [] };
  } catch {
    return null;
  }
};

const yamlList = (items: string[], indent = '') =>
  items.length === 0 ? ' []' : `\n${items.map((i) => `${indent}  - ${JSON.stringify(i)}`).join('\n')}`;

/**
 * The guide's End-of-Session Update Template, filled from evidence, so the
 * learner can keep using it with any other tutor as before.
 */
export const buildStudyContext = (s: SessionState, now: string): string => {
  const terms = Object.values(s.progress);
  const byStage = (stage: number) => terms.filter((t) => t.stage === stage).map((t) => TERM_BY_ID.get(t.id)?.term ?? t.id);
  const confirmed = terms.filter((t) => ['Proficient', 'Mastered'].includes(levelOf(t))).map((t) => TERM_BY_ID.get(t.id)?.term ?? t.id);
  const exp = s.expedition ? CHAIN_BY_ID.get(s.expedition.chainId) : null;
  const accuracy = s.stats.answered ? Math.round((s.stats.correct / s.stats.answered) * 100) : 0;
  const mastery = terms
    .filter((t) => t.attempts > 0)
    .map((t) => `${TERM_BY_ID.get(t.id)?.term ?? t.id}: ${levelOf(t)} (${STAGE_NAMES[t.stage]})`);
  return `session_date: ${now.slice(0, 10)}
study_mode: adaptive_topic_locked
teaching_modes_used:${yamlList(s.stats.modesUsed)}
conversation_tone: casual_collaborative_friend
dialogue_style: socratic_scaffolded_back_and_forth
active_topic: ${JSON.stringify(exp?.title ?? '')}
topic_locked: true
questions_answered: ${s.stats.answered}
correct_answers: ${s.stats.correct}
accuracy: ${accuracy}
points: ${s.stats.points}
current_streak: ${s.stats.streak}
longest_streak: ${s.stats.longestStreak}
integration_chain_used: ${JSON.stringify(exp?.path ?? '')}
expeditions:${yamlList(s.stats.expeditions)}
terminology_fluency:
  introduced:${yamlList(byStage(1), '  ')}
  scaffolded:${yamlList(byStage(2), '  ')}
  conversational_use:${yamlList(byStage(3), '  ')}
  transferred:${yamlList(byStage(4), '  ')}
  recovery_needed:${yamlList(byStage(5), '  ')}
confirmed_learning_outcomes:${yamlList(confirmed)}
remediation_queue:${yamlList(s.remediation.map((id) => TERM_BY_ID.get(id)?.term ?? id))}
mastery_changes:${yamlList(mastery)}
notes:${yamlList(s.notes.slice(-10).map((n) => `${TERM_BY_ID.get(n.anchor)?.term ?? n.anchor} (${n.verdict}): ${n.note}`))}
`;
};
