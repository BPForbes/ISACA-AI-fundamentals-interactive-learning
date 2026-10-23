import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHAIN_BY_ID } from './data/chains';
import { buildSceneRequest, DEFER_AFTER_MISSES, recommendChain, startExpedition, type SceneRequest } from './engine/director';
import { fitAttention, masteryEvent, masteryMatrix, type AttentionModel, type MasteryEvent, type MasteryMatrix } from './engine/attention';
import { packMatrix, toBase64 } from './engine/matrix';
import { CONCEPTS, LIST_VERSION } from './engine/relations';
import type { Choice, Scene } from './engine/scene';
import { fitTracker, type GateDecision, type TrackerModel } from './engine/tracker';
import { loadLlmSettings, saveLlmSettings, type LlmSettings } from './llm/config';
import { activeBackend, evaluateNote, generateScene, type NoteVerdict } from './llm';
import { loadHostedConfig, saveHostedConfig, type HostedConfig } from './llm/hosted';
import { onBrowserModelChange, restoreCachedBrowserModel } from './llm/webllm';
import {
  answerScene, applyRemote, beginExpedition, buildSavePayload, buyRunUpgrade, concludeRound, deferCurrentStep, ensureRun,
  hasUnsavedChanges, leaveCamp, loadDraft, markSaved, newSession, recordNote, saveDraft, startNewRun, type SessionState,
} from './session/store';
import { isCloudConfigured, loadCloudConfig, pullProgress, pushSave, saveCloudConfig, type CloudConfig } from './sync/cloud';
import { Camp } from './components/Camp';
import { Header } from './components/Header';
import { Journal } from './components/Journal';
import { MapView } from './components/MapView';
import { SceneView } from './components/SceneView';
import { SettingsPanel } from './components/SettingsPanel';
import { ExpeditionEnd } from './components/ExpeditionEnd';

const nowIso = () => new Date().toISOString();
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

type View = 'map' | 'journal' | 'settings';

export type Answered = { choice: Choice; points: number; risk: number; gate: GateDecision };

export type SaveStatus = { kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string };

export default function App() {
  // A run is always in progress: the first visit starts one, and a finished run is replaced on request.
  const [session, setSession] = useState<SessionState>(() => ensureRun(loadDraft() ?? newSession(nowIso(), newId()), nowIso(), newId(), newSeed()));
  const [llm, setLlm] = useState<LlmSettings>(loadLlmSettings);
  const [cloud, setCloud] = useState<CloudConfig>(loadCloudConfig);
  const [hosted, setHosted] = useState<HostedConfig>(loadHostedConfig);
  const [view, setView] = useState<View>('map');
  const [scene, setScene] = useState<Scene | null>(null);
  const [req, setReq] = useState<SceneRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [verdict, setVerdict] = useState<NoteVerdict | null>(null);
  const [campOpen, setCampOpen] = useState(false);
  const [save, setSave] = useState<SaveStatus>({ kind: 'idle' });
  const [tracker, setTracker] = useState<TrackerModel | null>(null);
  const [attention, setAttention] = useState<AttentionModel | null>(null);
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  const [, setModelVersion] = useState(0);
  const sceneToken = useRef(0);
  // A mastery or struggle save waits until the learner leaves the scene, so the field note goes with it.
  const pendingSave = useRef<MasteryEvent | null>(null);
  const trainedAt = useRef(-1);

  useEffect(() => saveDraft(session), [session]);

  // Retrain the progress model in a Web Worker whenever enough new answers arrived.
  const historyLength = session.history.length;
  const trainer = useRef<Worker | null>(null);
  const trainRequest = useRef(0);
  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    const worker = new Worker(new URL('./engine/trackerWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; model: TrackerModel; attention: AttentionModel }>) => {
      if (e.data.id !== trainRequest.current) return;
      setTracker(e.data.model);
      setAttention(e.data.attention);
    };
    trainer.current = worker;
    return () => {
      worker.terminate();
      trainer.current = null;
      // A request sent to this worker is lost; let the next worker train again.
      trainedAt.current = -1;
    };
  }, []);
  useEffect(() => {
    if (trainedAt.current >= 0 && historyLength - trainedAt.current < 5) return;
    trainedAt.current = historyLength;
    const id = ++trainRequest.current;
    if (trainer.current) trainer.current.postMessage({ id, history: session.history });
    else {
      setTracker(fitTracker(session.history));
      setAttention(fitAttention(session.history));
    }
    // session.history is read when the length changes; the length is the trigger.
  }, [historyLength]);
  useEffect(() => saveLlmSettings(llm), [llm]);
  useEffect(() => saveCloudConfig(cloud), [cloud]);

  // Re-render when the in-browser model becomes ready or is removed, so "auto" picks it up.
  useEffect(() => onBrowserModelChange(() => setModelVersion((v) => v + 1)), []);

  // A model loaded on an earlier visit comes back from this device's cache, with no download.
  useEffect(() => {
    let active = true;
    restoreCachedBrowserModel((text) => active && setModelStatus(`Loading your cached model: ${text}`))
      .then((id) => {
        if (!active || !id) return;
        setLlm((s) => (s.browserModel === id ? s : { ...s, browserModel: id }));
        setModelStatus(null);
      })
      .catch(() => active && setModelStatus(null));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => saveHostedConfig(hosted), [hosted]);
  const backends = useMemo(() => ({ cloud, hosted }), [cloud, hosted]);

  // Warn before leaving with work that has not been saved to the cloud.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isCloudConfigured(cloud) && hasUnsavedChanges(session)) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [cloud, session]);

  const progressOf = useCallback((id: string) => session.progress[id], [session.progress]);
  const backend = activeBackend(llm, backends);
  // The mastery matrix is recomputed from the history after every answer; the history is
  // already in the local draft, so the matrix needs no storage of its own until a save.
  const matrixOf = useCallback((state: SessionState): MasteryMatrix => masteryMatrix(attention, state.history, nowIso()), [attention]);
  const matrix = useMemo(() => matrixOf(session), [matrixOf, session.history]);
  const recommended = useMemo(
    () => recommendChain(progressOf, session.remediation, matrix),
    [progressOf, session.remediation, matrix],
  );

  const loadScene = useCallback(async (state: SessionState) => {
    if (!state.expedition || state.expedition.status !== 'active') return;
    const token = ++sceneToken.current;
    const request = buildSceneRequest(state.expedition, (id) => state.progress[id], matrixOf(state));
    setReq(request);
    setScene(null);
    setAnswered(null);
    setVerdict(null);
    setLoading(true);
    const result = await generateScene(request, llm, backends);
    if (token !== sceneToken.current) return;
    setScene(result.scene);
    setNotice(result.fallbackReason ? `Using the offline story engine for this scene. ${result.fallbackReason}` : null);
    setLoading(false);
  }, [llm, backends, matrixOf]);

  const start = (chainId: string) => {
    if (session.run?.phase === 'over') return;
    // The team meters carry over from the run's earlier rounds.
    const exp = startExpedition(chainId, { lastKind: session.lastKind, now: nowIso(), rng: Math.random, meters: session.run?.meters });
    const next = beginExpedition(session, exp);
    setSession(next);
    setView('map');
    void loadScene(next);
  };

  const choose = (choice: Choice, risk: number) => {
    if (!req || !scene || answered) return;
    const outcome = answerScene(session, {
      req, scene, choice, risk, explained: false, note: '', now: nowIso(), eventId: newId(), model: tracker,
    });
    setSession(outcome.state);
    setAnswered({ choice, points: outcome.points, risk, gate: outcome.gate });
    if (outcome.campDue) setCampOpen(true);
    // Reaching mastery or starting to struggle is a save point, as is a manual save.
    const after = matrixOf(outcome.state);
    const event = masteryEvent(matrix, after, req.anchor.id);
    if (event && isCloudConfigured(cloud)) pendingSave.current = event;
  };

  const flushPendingSave = (state: SessionState) => {
    const reason = pendingSave.current;
    pendingSave.current = null;
    if (reason && isCloudConfigured(cloud)) void pushToCloud(state, reason, matrixOf(state));
  };

  const submitNote = async (note: string) => {
    if (!req || !answered || !note.trim()) return;
    const v = await evaluateNote(req, answered.choice.text, note, llm, backends);
    setVerdict(v);
    setSession((s) => recordNote(s, req.anchor.id, note, v.verdict, nowIso()));
  };

  const proceed = () => {
    flushPendingSave(session);
    if (session.expedition?.status === 'active') void loadScene(session);
    else {
      setScene(null);
      setReq(null);
      setAnswered(null);
    }
  };

  const defer = () => {
    const next = deferCurrentStep(session);
    setSession(next);
    void loadScene(next);
    // Deferring means the learner is stuck: save that, as the matrix does for a detected struggle.
    pendingSave.current = 'struggle';
    flushPendingSave(next);
  };

  // Leaving the expedition closes the round: cleared if the chain completed under the target, failed otherwise.
  const abandon = () => {
    flushPendingSave(session);
    sceneToken.current += 1;
    setSession((s) => concludeRound(s));
    setScene(null);
    setReq(null);
    setAnswered(null);
    setLoading(false);
  };

  const saveToCloud = async () => {
    if (!isCloudConfigured(cloud)) {
      // Progress is already kept on this device after every answer; the cloud copy is an optional backup.
      saveDraft(session);
      setSave({ kind: 'saved', message: 'Saved on this device. Add a sync token in Settings to also back it up to the cloud.' });
      return;
    }
    // A manual save carries everything, the pending mastery or struggle included.
    const reason = pendingSave.current ?? 'manual';
    pendingSave.current = null;
    await pushToCloud(session, reason, matrix);
  };

  async function pushToCloud(state: SessionState, reason: 'manual' | MasteryEvent, m: MasteryMatrix) {
    const at = nowIso();
    const payload = buildSavePayload(state, at, newId(), {
      packed: toBase64(packMatrix(m)), concepts: CONCEPTS.length, listVersion: LIST_VERSION, reason, updatedAt: at,
    });
    setSave({ kind: 'saving' });
    try {
      const result = await pushSave(cloud, payload);
      setSession((s) => markSaved(s, payload, at));
      const why = reason === 'mastery' ? ' (a concept reached mastery)' : reason === 'struggle' ? ' (a struggle was detected)' : '';
      setSave({ kind: 'saved', message: result.status === 'already_saved' ? 'Already saved.' : `Saved ${payload.terms.length} concepts and ${payload.events.length} scenes${why}.` });
    } catch (error) {
      setSave({ kind: 'error', message: error instanceof Error ? error.message : 'Save failed.' });
    }
  }

  const loadFromCloud = async () => {
    try {
      const remote = await pullProgress(cloud);
      setSession((s) => applyRemote(s, remote));
      setSave({ kind: 'saved', message: `Loaded ${remote.terms.length} concepts from the cloud.` });
    } catch (error) {
      setSave({ kind: 'error', message: error instanceof Error ? error.message : 'Load failed.' });
    }
  };

  const buy = (id: string) => setSession((s) => buyRunUpgrade(s, id));
  const newRun = () => setSession((s) => startNewRun(s, nowIso(), newId(), newSeed()));

  const endSession = () => {
    flushPendingSave(session);
    sceneToken.current += 1;
    setSession((s) => newSession(nowIso(), newId(), s));
    setScene(null);
    setReq(null);
    setAnswered(null);
  };

  const exp = session.expedition;
  const inExpedition = exp !== null && view === 'map';
  const missesOnStep = exp?.missesOnStep ?? 0;

  return (
    <div className="app">
      <Header
        stats={session.stats}
        run={session.run}
        backend={backend}
        modelStatus={modelStatus}
        unsaved={session.dirty.length + session.events.length}
        cloudReady={isCloudConfigured(cloud)}
        save={save}
        view={view}
        onView={setView}
        onSave={saveToCloud}
      />
      <main className="main">
        {view === 'settings' && (
          <SettingsPanel
            llm={llm}
            onLlm={setLlm}
            cloud={cloud}
            onCloud={setCloud}
            hosted={hosted}
            onHosted={setHosted}
            onLoadCloud={loadFromCloud}
            save={save}
          />
        )}
        {view === 'journal' && (
          <Journal session={session} tracker={tracker} onEndSession={endSession} onSave={saveToCloud} cloudReady={isCloudConfigured(cloud)} />
        )}
        {view === 'map' && !exp && (
          <MapView session={session} recommendedId={recommended.id} run={session.run} onStart={start} onBuy={buy} onNewRun={newRun} backend={backend} onSettings={() => setView('settings')} />
        )}
        {inExpedition && exp.status === 'complete' && !answered && (
          <ExpeditionEnd expedition={exp} run={session.run} onDone={abandon} />
        )}
        {inExpedition && (exp.status === 'active' || answered) && (
          <SceneView
            expedition={exp}
            run={session.run}
            chain={CHAIN_BY_ID.get(exp.chainId)!}
            req={req}
            scene={scene}
            loading={loading}
            notice={notice}
            answered={answered}
            verdict={verdict}
            progress={req ? session.progress[req.anchor.id] : undefined}
            canDefer={missesOnStep >= DEFER_AFTER_MISSES && !answered}
            onChoose={choose}
            onNote={submitNote}
            onContinue={proceed}
            onDefer={defer}
            onLeave={abandon}
            onRetry={() => loadScene(session)}
          />
        )}
      </main>
      {campOpen && (
        <Camp
          session={session}
          cloudReady={isCloudConfigured(cloud)}
          save={save}
          onSave={saveToCloud}
          onClose={() => {
            setCampOpen(false);
            setSession((s) => leaveCamp(s));
          }}
        />
      )}
    </div>
  );
}
