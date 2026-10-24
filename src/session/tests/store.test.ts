import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSceneRequest, startExpedition } from '../../engine/director';
import { generateOfflineScene } from '../../engine/offline';
import { defaultLab, runLab, type LabConfig } from '../../engine/lab';
import { labForCurrent } from '../../engine/project';
import {
  answerScene, applyRemote, beginExpedition, buildSavePayload, buildStudyContext, buyRunUpgrade, CAMP_INTERVAL, continueProjectGoal, currentProjectGoal,
  deferCurrentStep, deferProjectGoal, ensureRun, finishProjectRound, hasUnsavedChanges, loadDraft, markSaved, newSession, recordNote, startNewRun,
  startProject, submitGoal, type SessionState,
} from '../store';

afterEach(() => vi.unstubAllGlobals());

let clock = 0;
const tick = () => `2026-10-22T10:${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock++ % 60).padStart(2, '0')}Z`;
const rng = () => 0.3;

const play = (s: SessionState, correct: boolean) => {
  const req = buildSceneRequest(s.expedition!, (id) => s.progress[id]);
  const scene = generateOfflineScene(req, rng);
  const choice = scene.choices.find((c) => c.correct === correct)!;
  return answerScene(s, { req, scene, choice, risk: 1, explained: false, note: '', now: tick(), eventId: `e${clock}`, model: null });
};

const fresh = () => beginExpedition(newSession(tick(), 's1'), startExpedition('indicators', { lastKind: null, now: tick(), rng }));

describe('session store', () => {
  it('keeps answers in the session as dirty changes until saved', () => {
    let s = fresh();
    expect(hasUnsavedChanges(s)).toBe(false);
    s = play(s, true).state;
    s = play(s, false).state;
    expect(s.stats.answered).toBe(2);
    expect(s.dirty).toEqual(['model-assessment', 'leading-indicator']);
    expect(s.events).toHaveLength(2);
    expect(s.remediation).toEqual(['leading-indicator']);
  });

  it('clears only what a save carried, so answers made during the save stay dirty', () => {
    let s = play(fresh(), true).state;
    const payload = buildSavePayload(s, tick(), 'save-1');
    expect(payload.terms.map((t) => t.id)).toEqual(['model-assessment']);
    s = play(s, true).state;
    s = markSaved(s, payload, tick());
    expect(s.dirty).toEqual(['leading-indicator']);
    expect(s.events).toHaveLength(1);
    expect(s.lastSavedAt).not.toBeNull();
  });

  it('records the situation each scene was set in, so the next one differs', () => {
    const s = play(fresh(), false).state;
    const beat = s.expedition!.log[0];
    expect(beat.situation).toBeDefined();
    expect(buildSceneRequest(s.expedition!, (id) => s.progress[id]).situation.id).not.toBe(beat.situation);
  });

  it('carries the packed mastery matrix only when one is given', () => {
    const s = play(fresh(), true).state;
    expect(buildSavePayload(s, tick(), 'plain')).not.toHaveProperty('mastery');
    const mastery = { packed: 'AQAA', concepts: 1, listVersion: 0, reason: 'mastery' as const, updatedAt: tick() };
    expect(buildSavePayload(s, tick(), 'with', mastery).mastery).toEqual(mastery);
  });

  it('clears a remediation item after two correct answers in a row', () => {
    let s = play(fresh(), false).state;
    expect(s.remediation).toEqual(['model-assessment']);
    s = play(s, true).state;
    // The step advanced, so put the learner back on the same anchor for the confirmation.
    s = { ...s, expedition: { ...s.expedition!, stepIndex: 0 } };
    s = play(s, true).state;
    expect(s.remediation).toEqual([]);
  });

  it('signals camp every few scenes', () => {
    let s = fresh();
    let due = false;
    for (let i = 0; i < CAMP_INTERVAL; i += 1) {
      const out = play(s, false);
      s = out.state;
      due = out.campDue;
    }
    expect(due).toBe(true);
  });

  it('keeps every answer in history and asks for a confirmation after a miss', () => {
    let s = play(fresh(), false).state;
    const held = play(s, true);
    expect(held.gate.advance).toBe(false);
    expect(held.state.expedition!.stepIndex).toBe(0);
    s = held.state;
    expect(buildSceneRequest(s.expedition!, (id) => s.progress[id]).confirming).toBe(true);
    const moved = play(s, true);
    expect(moved.gate.advance).toBe(true);
    expect(moved.state.expedition!.stepIndex).toBe(1);
    expect(moved.state.history.map((e) => e.correct)).toEqual([false, true, true]);
    // History survives saving and a new session, because the progress model trains on it.
    const saved = markSaved(moved.state, buildSavePayload(moved.state, tick(), 'sv'), tick());
    expect(newSession(tick(), 's9', saved).history).toHaveLength(3);
  });

  it('defers a stuck link into the rematch queue', () => {
    const s = deferCurrentStep(fresh());
    expect(s.expedition!.stepIndex).toBe(1);
    expect(s.remediation).toEqual(['model-assessment']);
  });

  it('records field notes on the latest event', () => {
    let s = play(fresh(), true).state;
    s = recordNote(s, 'model-assessment', 'checks it works on the task', 'solid', tick());
    expect(s.events[0].note).toBe('checks it works on the task');
    expect(s.notes).toHaveLength(1);
  });

  it('merges cloud progress, keeping newer copies and unknown ids out', () => {
    let s = play(fresh(), true).state;
    const local = s.progress['model-assessment'];
    s = applyRemote(s, {
      terms: [{ ...local, attempts: 99, updatedAt: '2000-01-01T00:00:00Z' }, { ...local, id: 'kpi', updatedAt: '2030-01-01T00:00:00Z' }, { ...local, id: 'not-a-term' }],
      sessions: [],
      remediation: ['kgi', 'bogus'],
      events: [{ id: 'remote-1', sessionId: 'old', at: '2026-01-01T00:00:00Z', chainId: 'indicators', anchor: 'kpi', mode: 'guided', settingId: 'emr', correct: true, risk: 1, points: 10, source: 'offline', note: '' }],
    });
    expect(s.history[0].id).toBe('remote-1');
    expect(s.progress['model-assessment'].attempts).toBe(1);
    expect(s.progress.kpi).toBeDefined();
    expect(s.progress['not-a-term']).toBeUndefined();
    expect(s.remediation).toEqual(['kgi']);
  });

  it('exports the end-of-session study context', () => {
    const s = play(fresh(), true).state;
    const yaml = buildStudyContext(s, '2026-10-22T12:00:00Z');
    expect(yaml).toContain('session_date: 2026-10-22');
    expect(yaml).toContain('questions_answered: 1');
    expect(yaml).toContain('Leading and Lagging Indicators');
  });

  it('keeps progress and unsaved work when a new session starts', () => {
    const s = play(fresh(), true).state;
    const next = newSession(tick(), 's2', s);
    expect(next.stats.answered).toBe(0);
    expect(next.progress).toBe(s.progress);
    expect(next.events).toHaveLength(1);
  });
});

describe('the run inside a session', () => {
  const withRun = () => ensureRun(newSession(tick(), 's1'), tick(), 'run-1', 5);
  const submit = (state: SessionState, lab: LabConfig, id: string) => submitGoal(state, { lab, result: runLab(lab), now: tick(), eventId: id, model: null });

  it('starts one run, keeps it across sessions, and replaces only a finished one', () => {
    const s = withRun();
    expect(s.run?.phase).toBe('workshop');
    expect(ensureRun(s, tick(), 'run-2', 6).run).toBe(s.run);
    expect(newSession(tick(), 'next', s).run).toBe(s.run);
    const over = { ...s, run: { ...s.run!, phase: 'over' as const } };
    expect(ensureRun(over, tick(), 'run-3', 7).run?.id).toBe('run-3');
    expect(startNewRun(s, tick(), 'run-4', 8).run?.id).toBe('run-4');
    expect(newSession(tick(), 'plain').run).toBeNull();
  });

  it('plans a project from the workshop and records each goal like an answer', () => {
    const s = startProject(withRun(), 'p1', 7);
    expect(s.run?.phase).toBe('project');
    expect(startProject(s, 'p2', 8).run?.project?.id).toBe('p1');
    const cur = currentProjectGoal(s)!;
    const lab = labForCurrent(s.run!.project!)!;
    const miss = submit(s, lab, 'g1');
    expect(miss.met).toBe(false);
    expect(miss.gate.advance).toBe(false);
    expect(miss.state.events[0]).toMatchObject({ id: 'g1', mode: 'lab', chainId: 'project', settingId: s.run!.briefId, correct: false, risk: 1 });
    expect(miss.state.history[0]).toMatchObject({ concept: cur.goal.anchor, correct: false, mode: 'lab' });
    expect(miss.state.progress[cur.goal.anchor].attempts).toBe(1);
    expect(miss.state.remediation).toContain(cur.goal.anchor);
    expect(miss.state.run!.project!.index).toBe(0);
    expect(miss.state.run!.project!.goals[0]).toMatchObject({ attempts: 1, misses: 1, outcome: 'missed' });
    const fixed = cur.goal.solution(lab);
    const hit = submit(miss.state, fixed, 'g2');
    expect(hit.met).toBe(true);
    expect(hit.points).toBeGreaterThan(0);
    // Right after a miss, one more from a new setup confirms the fix.
    expect(hit.gate.advance).toBe(false);
    expect(hit.state.run!.project!.index).toBe(0);
    const again = submit(hit.state, fixed, 'g3');
    expect(again.gate.advance).toBe(true);
    // The debrief still shows the goal it judged; the project moves on when the learner continues.
    expect(again.state.run!.project).toMatchObject({ index: 0, advanceDue: true });
    expect(continueProjectGoal(hit.state).run!.project).toBe(hit.state.run!.project);
    const moved = continueProjectGoal(again.state);
    expect(moved.run!.project).toMatchObject({ index: 1, advanceDue: false });
    expect(moved.run!.project!.lab).toBe(fixed);
    expect(continueProjectGoal(moved)).toBe(moved);
    expect(again.state.stats.modesUsed).toEqual(['lab']);
  });

  it('resumes a draft saved during a debrief at the goal the gate had moved on to', () => {
    const s = startProject(withRun(), 'p1', 7);
    const cur = currentProjectGoal(s)!;
    const fixed = cur.goal.solution(labForCurrent(s.run!.project!)!);
    const due = submit(submit(s, fixed, 'g1').state, fixed, 'g2').state;
    expect(due.run!.project!.advanceDue).toBe(true);
    const store: Record<string, string> = { 'isaca-quest-session-v1': JSON.stringify(due) };
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null });
    expect(loadDraft()!.run!.project).toMatchObject({ index: 1, advanceDue: false });
    store['isaca-quest-session-v1'] = JSON.stringify(s);
    expect(loadDraft()!.run!.project).toMatchObject({ index: 0, advanceDue: false });
  });

  it('defers a goal into the rematch queue and closes the project into the run', () => {
    let s = startProject(withRun(), 'p1', 7);
    const anchor = currentProjectGoal(s)!.goal.anchor;
    s = deferProjectGoal(s);
    expect(s.remediation).toContain(anchor);
    expect(s.run!.project!.index).toBe(1);
    const { state, report } = finishProjectRound(s);
    expect(report).not.toBeNull();
    expect(state.run!.project).toBeNull();
    expect(state.run!.roundsCleared + state.run!.roundsFailed).toBe(1);
    expect(['workshop', 'over']).toContain(state.run!.phase);
    expect(finishProjectRound(state).report).toBeNull();
  });

  it('spends credits on an offered upgrade and lets a session with no run alone', () => {
    const s = { ...withRun(), run: { ...withRun().run!, credits: 5 } };
    const bought = buyRunUpgrade(s, s.run.offer[0]);
    expect(Object.values(bought.run!.upgrades)).toEqual([1]);
    expect(buyRunUpgrade(newSession(tick(), 'x'), 'depth').run).toBeNull();
    expect(() => submit(withRun(), defaultLab(1), 'none')).toThrow();
  });
});
