import { describe, expect, it } from 'vitest';
import { buildSceneRequest, startExpedition } from '../../engine/director';
import { generateOfflineScene } from '../../engine/offline';
import { newRun, RUN_GOAL, START_CREDITS } from '../../engine/run';
import {
  answerScene, applyRemote, beginExpedition, buildSavePayload, buildStudyContext, buyRunUpgrade, CAMP_INTERVAL, concludeRound,
  deferCurrentStep, ensureRun, hasUnsavedChanges, markSaved, newSession, recordNote, startNewRun, type SessionState,
} from '../store';

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
  const withRun = () => ensureRun(fresh(), tick(), 'run-1', 5);

  it('starts one run, keeps it across sessions, and replaces only a finished one', () => {
    const s = withRun();
    expect(s.run?.phase).toBe('workshop');
    expect(ensureRun(s, tick(), 'run-2', 6).run).toBe(s.run);
    expect(newSession(tick(), 'next', s).run).toBe(s.run);
    const over = { ...s, run: { ...s.run!, phase: 'over' as const } };
    expect(ensureRun(over, tick(), 'run-3', 7).run?.id).toBe('run-3');
    expect(startNewRun(s, tick(), 'run-4', 8).run?.id).toBe('run-4');
    expect(fresh().run).toBeNull();
  });

  it('treats an expedition as a training round and never lets the run touch mastery', () => {
    const plain = fresh();
    const s = withRun();
    const expedition = (state: SessionState) => beginExpedition(state, startExpedition('indicators', { lastKind: null, now: tick(), rng, meters: state.run?.meters }));
    let a = expedition(plain);
    let b = expedition(s);
    expect(b.run?.phase).toBe('training');
    expect(b.run?.round?.chainId).toBe('indicators');
    for (const correct of [true, false, true, true]) {
      a = play(a, correct).state;
      b = play(b, correct).state;
    }
    expect(b.run?.round?.steps.map((x) => x.correct)).toEqual([true, false, true, true]);
    expect(b.run?.round?.loss).toBeLessThan(1);
    // Same answers, same learning: progress, remediation and history do not depend on the run.
    const learned = (state: SessionState) => Object.values(state.progress).map(({ lastSeen, updatedAt, ...rest }) => rest);
    expect(learned(b)).toEqual(learned(a));
    expect(b.remediation).toEqual(a.remediation);
    expect(b.history.map((e) => [e.concept, e.correct])).toEqual(a.history.map((e) => [e.concept, e.correct]));
    expect(b.expedition!.stepIndex).toBe(a.expedition!.stepIndex);
  });

  it('closes the round when the learner leaves, failed if the chain was not completed', () => {
    let s = beginExpedition(withRun(), startExpedition('indicators', { lastKind: null, now: tick(), rng }));
    s = play(s, true).state;
    const left = concludeRound(s);
    expect(left.expedition).toBeNull();
    expect(left.run?.phase).toBe('workshop');
    expect(left.run?.roundsFailed).toBe(1);
    expect(left.run?.lastReport?.cleared).toBe(false);
    expect(concludeRound(left)).toBe(left);
  });

  it('clears a round when the chain completes under the target, and carries the meters on', () => {
    let s = beginExpedition(withRun(), startExpedition('indicators', { lastKind: null, now: tick(), rng, meters: withRun().run!.meters }));
    while (s.expedition!.status === 'active') s = play(s, true).state;
    const done = concludeRound(s);
    expect(done.run?.roundsCleared).toBe(1);
    expect(done.run?.credits).toBe(START_CREDITS + 3);
    expect(done.run?.meters.budget).toBeGreaterThan(withRun().run!.meters.budget);
    expect(done.run?.roundsCleared).toBeLessThan(RUN_GOAL);
  });

  it('spends credits on an offered upgrade and lets a run with none alone', () => {
    const s = { ...withRun(), run: { ...withRun().run!, credits: 5 } };
    const bought = buyRunUpgrade(s, s.run.offer[0]);
    expect(Object.values(bought.run!.upgrades)).toEqual([1]);
    expect(buyRunUpgrade(fresh(), 'depth').run).toBeNull();
    expect(newRun(tick(), 'x', 1).upgrades).toEqual({});
  });
});
