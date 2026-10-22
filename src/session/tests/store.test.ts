import { describe, expect, it } from 'vitest';
import { buildSceneRequest, startExpedition } from '../../engine/director';
import { generateOfflineScene } from '../../engine/offline';
import {
  answerScene, applyRemote, beginExpedition, buildSavePayload, buildStudyContext, CAMP_INTERVAL, deferCurrentStep,
  hasUnsavedChanges, markSaved, newSession, recordNote, type SessionState,
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
