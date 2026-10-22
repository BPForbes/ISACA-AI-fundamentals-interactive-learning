import { useMemo, useState } from 'react';
import { CHAPTERS, TERMS, type ChapterId } from '../data/terms';
import { levelOf, recentAccuracy, STAGE_NAMES } from '../engine/progress';
import { forecast, sequencesByConcept, type TrackerModel } from '../engine/tracker';
import { buildStudyContext, hasUnsavedChanges, type SessionState } from '../session/store';

type Props = {
  session: SessionState;
  tracker: TrackerModel | null;
  cloudReady: boolean;
  onSave: () => void;
  onEndSession: () => void;
};

export function Journal({ session, tracker, cloudReady, onSave, onEndSession }: Props) {
  const [chapter, setChapter] = useState<ChapterId>(1);
  const context = useMemo(() => buildStudyContext(session, new Date().toISOString()), [session]);
  const rows = TERMS.filter((t) => t.chapter === chapter);
  const byConcept = useMemo(() => sequencesByConcept(session.history), [session.history]);
  const a = tracker?.assessment;
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

  const download = () => {
    const blob = new Blob([context], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `study-context-${new Date().toISOString().slice(0, 10)}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="journal">
      <section className="card">
        <h1>Progress model</h1>
        <p>
          An LSTM reads each concept's answer history and predicts whether your next answer will be right. It only
          helps decide when to move on after it beats a simple running-accuracy baseline on your newest answers, which
          it was not trained on; until then the mastery rules decide alone.
        </p>
        {!a ? <p className="hint">Training…</p> : (
          <>
            <p className={a.trusted ? 'gate go' : 'gate hold'}><strong>{a.trusted ? 'In use' : 'Not in use yet'}</strong> — {a.reason}</p>
            <dl className="camp-stats">
              <div><dt>Answers learned from</dt><dd>{a.trainTargets}</dd></div>
              <div><dt>Held-out accuracy (LSTM / baseline)</dt><dd>{pct(a.lstmAccuracy)} / {pct(a.baselineAccuracy)}</dd></div>
              <div><dt>Held-out log-loss (LSTM / baseline)</dt><dd>{a.lstmLoss?.toFixed(3) ?? '—'} / {a.baselineLoss?.toFixed(3) ?? '—'}</dd></div>
            </dl>
          </>
        )}
      </section>

      <section className="card">
        <h1>Journal</h1>
        <p>
          Every concept from the term bank, with its mastery level and where it sits on the terminology ladder
          (Introduce → Scaffold → Conversational use → Transfer, or Recovery when it slipped).
        </p>
        <div className="tabs chapter-tabs" role="tablist">
          {([1, 2, 3, 4, 5] as ChapterId[]).map((c) => (
            <button key={c} role="tab" aria-selected={chapter === c} className={chapter === c ? 'tab active' : 'tab'} onClick={() => setChapter(c)}>
              Ch. {c}
            </button>
          ))}
        </div>
        <h2>{CHAPTERS[chapter].title}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Concept</th><th>Level</th><th>Stage</th><th>Recent</th><th>Seen</th><th>Next (LSTM)</th></tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const p = session.progress[t.id];
                return (
                  <tr key={t.id}>
                    <td><details><summary>{t.term}</summary><p>{t.definition}</p></details></td>
                    <td className={`lvl-${(p ? levelOf(p) : 'Unknown').toLowerCase()}`}>{p ? levelOf(p) : 'Unknown'}</td>
                    <td>{p ? STAGE_NAMES[p.stage] : '—'}</td>
                    <td>{p && p.recent.length ? `${Math.round(recentAccuracy(p) * 100)}%` : '—'}</td>
                    <td>{p?.attempts ?? 0}</td>
                    <td>{(() => {
                      // An untrained model's output is just its random starting weights.
                      const f = tracker && tracker.trainedOn > 0 && byConcept.get(t.id) ? forecast(tracker, byConcept.get(t.id)!) : null;
                      return f ? `${Math.round(f.pNext * 100)}% · ${f.trend}` : '—';
                    })()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Study context</h2>
        <p>The end-of-session update from your study guide, filled in from this session. Download it to keep using it with any tutor.</p>
        <pre className="context">{context}</pre>
        <div className="row">
          <button onClick={download}>Download YAML</button>
          {cloudReady && <button onClick={onSave} disabled={!hasUnsavedChanges(session)}>Save to cloud</button>}
          <button
            className="ghost"
            onClick={() => {
              if (window.confirm('Start a new session? Mastery and unsaved changes are kept; session score resets.')) onEndSession();
            }}
          >
            End session
          </button>
        </div>
      </section>
    </div>
  );
}
