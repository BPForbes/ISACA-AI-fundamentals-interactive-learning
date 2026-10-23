// Session state. Everything learned is kept here, in memory and in a local
// draft, and marked dirty; nothing goes to the cloud until a save: the learner's,
// or the automatic one when a concept reaches mastery or a struggle is detected.
// A save sends only what changed since the last save, under a save id the
// Worker uses to make a retried save harmless.

import { BRIEF_BY_ID } from '../data/briefs';
import { CHAIN_BY_ID } from '../data/chains';
import { TERM_BY_ID } from '../data/terms';
import { applyDecision, deferStep, type Expedition, type SceneRequest } from '../engine/director';
import type { LabConfig, LabResult } from '../engine/lab';
import { creditExplanation, levelOf, mergeProgress, newProgress, recordAnswer, STAGE_NAMES, type TermProgress } from '../engine/progress';
import {
  advance, currentGoal, defer as deferGoal, planProject, recordSubmission, reportProject, type ProjectReport,
} from '../engine/project';
import { beginProject, buyUpgrade, capabilities, finishProject, newRun, type RunState } from '../engine/run';
import { scoreAnswer } from '../engine/scoring';
import { decideAdvance, type GateDecision, type HistoryEvent, type TrackerModel } from '../engine/tracker';
import type { Choice, Scene } from '../engine/scene';
import type { MasterySnapshot, RemoteProgress, SavePayload, SceneEvent, SessionSummary } from '../sync/cloud';

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
  // A story expedition (practice outside the run), if one is open.
  expedition: Expedition | null;
  lastKind: 'familiar' | 'unfamiliar' | null;
  lastSavedAt: string | null;
  sinceCamp: number;
  notes: { anchor: string; note: string; verdict: string }[];
  // Every answer ever given, kept locally (and restored from the cloud) to train the progress model.
  history: HistoryEvent[];
  // The roguelike run: the model being built, its project, upgrades and the team meters. Kept on this device only.
  run: RunState | null;
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
  run: carry?.run ?? null,
});

/** Starts a run if the session has none; the first visit and every "new run" come through here. */
export const ensureRun = (s: SessionState, now: string, id: string, seed: number): SessionState =>
  s.run && s.run.phase !== 'over' ? s : { ...s, run: newRun(now, id, seed) };

export const startNewRun = (s: SessionState, now: string, id: string, seed: number): SessionState =>
  ({ ...s, run: newRun(now, id, seed) });

export const buyRunUpgrade = (s: SessionState, id: string): SessionState =>
  s.run ? { ...s, run: buyUpgrade(s.run, id) } : s;

const addUnique = (list: string[], item: string) => (list.includes(item) ? list : [...list, item]);

const LEVEL_WEAKNESS: Record<string, number> = { Unknown: 2, Familiar: 1.5, Competent: 1, Proficient: 0.4, Mastered: 0.1 };

/** How much a concept needs work: queued for remediation first, then by level. */
export const priorityOf = (s: SessionState) => (anchor: string): number => {
  const p = s.progress[anchor];
  return (s.remediation.includes(anchor) ? 3 : 0) + LEVEL_WEAKNESS[p ? levelOf(p) : 'Unknown'];
};

/** Plans the run's next project and opens it. */
export const startProject = (s: SessionState, id: string, seed: number): SessionState => {
  if (!s.run || s.run.phase !== 'workshop') return s;
  const project = planProject({ id, round: s.run.roundsCleared + s.run.roundsFailed, seed, capabilities: capabilities(s.run), priority: priorityOf(s) });
  return { ...s, run: beginProject(s.run, project) };
};

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

// What a scene answer and a lab submission have in common once judged: the evidence recorded for the concept.
type Evidence = {
  anchorId: string;
  settingId: string;
  unfamiliar: boolean;
  chainId: string;
  correct: boolean;
  risk: number;
  explained: boolean;
  note: string;
  now: string;
  eventId: string;
  source: 'ai' | 'offline';
  mode: string;
};

const recordEvidence = (s: SessionState, e: Evidence): { state: SessionState; points: number } => {
  const prev = s.progress[e.anchorId] ?? newProgress(e.anchorId, e.now);
  const progress = recordAnswer(prev, { correct: e.correct, settingId: e.settingId, unfamiliarSetting: e.unfamiliar, explained: e.explained }, e.now);
  const score = scoreAnswer({ correct: e.correct, risk: e.risk, mode: e.mode, streakBefore: s.stats.streak });
  const stats: SessionStats = {
    ...s.stats,
    points: s.stats.points + score.points,
    answered: s.stats.answered + 1,
    correct: s.stats.correct + (e.correct ? 1 : 0),
    streak: score.streak,
    longestStreak: Math.max(s.stats.longestStreak, score.streak),
    modesUsed: addUnique(s.stats.modesUsed, e.mode),
  };
  // A miss queues the anchor for spaced repetition; two correct answers in a row clear it.
  const remediation = e.correct
    ? s.remediation.filter((id) => id !== e.anchorId || progress.recent.slice(-2).some((r) => !r))
    : addUnique(s.remediation, e.anchorId);
  const event: SceneEvent = {
    id: e.eventId, sessionId: s.sessionId, at: e.now, chainId: e.chainId, anchor: e.anchorId, mode: e.mode, settingId: e.settingId,
    correct: e.correct, risk: e.risk, points: score.points, source: e.source, note: e.note.slice(0, 1000),
  };
  const historyEvent: HistoryEvent = {
    id: e.eventId, at: e.now, concept: e.anchorId, correct: e.correct, risk: e.risk, mode: e.mode, settingId: e.settingId, source: e.source,
  };
  return {
    points: score.points,
    state: {
      ...s,
      progress: { ...s.progress, [e.anchorId]: progress },
      dirty: addUnique(s.dirty, e.anchorId),
      events: [...s.events, event],
      remediation,
      stats,
      history: [...(s.history ?? []), historyEvent].slice(-HISTORY_CAP),
      sinceCamp: s.sinceCamp + 1,
    },
  };
};

export const answerScene = (s: SessionState, a: AnswerInput): AnswerOutcome => {
  const exp = s.expedition;
  if (!exp) throw new Error('No active expedition');
  const anchorId = a.req.anchor.id;
  const { state, points } = recordEvidence(s, {
    anchorId, settingId: a.req.setting.id, unfamiliar: a.req.setting.kind === 'unfamiliar', chainId: a.req.chain.id,
    correct: a.choice.correct, risk: a.risk, explained: a.explained, note: a.note, now: a.now, eventId: a.eventId, source: a.scene.source, mode: a.req.mode,
  });
  const gate = decideAdvance({
    correct: a.choice.correct,
    missesOnStep: exp.missesOnStep,
    confirmationsOnStep: exp.confirmationsOnStep ?? 0,
    previousOnStepCorrect: exp.lastOnStepCorrect ?? false,
    model: a.model,
    conceptHistory: state.history.filter((e) => e.concept === anchorId),
  });
  const expedition = applyDecision(exp, {
    anchor: anchorId, choice: a.choice.text, correct: a.choice.correct, consequence: a.choice.consequence, situation: a.req.situation.id,
  }, gate.advance);
  return {
    points,
    campDue: state.sinceCamp >= CAMP_INTERVAL,
    gate,
    state: { ...state, expedition, lastKind: expedition.status === 'complete' ? a.req.setting.kind : s.lastKind },
  };
};

export type GoalInput = { lab: LabConfig; result: LabResult; now: string; eventId: string; model: TrackerModel | null };

export type GoalOutcome = AnswerOutcome & { met: boolean; readout: string };

/**
 * A lab submission on the project's current goal. The simulation judged it; the
 * evidence is recorded exactly as for a scene answer, and the move-on gate
 * decides whether the project moves to the next goal.
 */
export const submitGoal = (s: SessionState, g: GoalInput): GoalOutcome => {
  const run = s.run;
  const project = run?.project;
  const cur = project ? currentGoal(project) : null;
  if (!run || !project || !cur) throw new Error('No active project goal');
  const met = cur.goal.goal.met(g.result);
  const readout = cur.goal.readout(g.result);
  const { state, points } = recordEvidence(s, {
    anchorId: cur.goal.anchor, settingId: run.briefId, unfamiliar: true, chainId: 'project', correct: met, risk: 1, explained: false,
    note: readout, now: g.now, eventId: g.eventId, source: 'offline', mode: 'lab',
  });
  const gate = decideAdvance({
    correct: met,
    missesOnStep: cur.state.misses,
    confirmationsOnStep: cur.state.confirmations,
    previousOnStepCorrect: cur.state.lastCorrect,
    model: g.model,
    conceptHistory: state.history.filter((e) => e.concept === cur.goal.anchor),
  });
  let next = recordSubmission(project, g.lab, met);
  if (gate.advance) next = advance(next);
  return { points, campDue: state.sinceCamp >= CAMP_INTERVAL, gate, met, readout, state: { ...state, run: { ...run, project: next } } };
};

/** Parks the project's current goal in the rematch queue and moves on. */
export const deferProjectGoal = (s: SessionState): SessionState => {
  const project = s.run?.project;
  const cur = project ? currentGoal(project) : null;
  if (!s.run || !project || !cur) return s;
  return { ...s, remediation: addUnique(s.remediation, cur.goal.anchor), run: { ...s.run, project: deferGoal(project) } };
};

/** Closes the project: the deployment's result decides the round, and the run moves on or ends. */
export const finishProjectRound = (s: SessionState): { state: SessionState; report: ProjectReport | null } => {
  const project = s.run?.project;
  if (!s.run || !project) return { state: s, report: null };
  const report = reportProject(project);
  return { state: { ...s, run: finishProject(s.run, report) }, report };
};

export const currentProjectGoal = (s: SessionState) => (s.run?.project ? currentGoal(s.run.project) : null);

export const briefOf = (s: SessionState) => (s.run ? BRIEF_BY_ID.get(s.run.briefId) ?? null : null);

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

export const buildSavePayload = (s: SessionState, now: string, saveId: string, mastery?: MasterySnapshot): SavePayload => ({
  saveId,
  session: summarize(s, now),
  terms: s.dirty.map((id) => s.progress[id]).filter((p): p is TermProgress => Boolean(p)),
  events: s.events,
  remediation: s.remediation,
  ...(mastery ? { mastery } : {}),
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
    // Drafts written before the progress model or the run existed lack those fields, and a run saved
    // before projects existed is finished: a new one starts.
    const run = parsed.run && 'project' in parsed.run ? parsed.run : null;
    return { ...parsed, history: parsed.history ?? [], run, expedition: parsed.expedition ?? null };
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
