import { useMemo, useState } from 'react';
import { CHAPTERS, TERMS, type ChapterId } from '../data/terms';
import { levelOf, recentAccuracy, STAGE_NAMES } from '../engine/progress';
import { buildStudyContext, hasUnsavedChanges, type SessionState } from '../session/store';

type Props = {
  session: SessionState;
  cloudReady: boolean;
  onSave: () => void;
  onEndSession: () => void;
};

export function Journal({ session, cloudReady, onSave, onEndSession }: Props) {
  const [chapter, setChapter] = useState<ChapterId>(1);
  const context = useMemo(() => buildStudyContext(session, new Date().toISOString()), [session]);
  const rows = TERMS.filter((t) => t.chapter === chapter);

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
              <tr><th>Concept</th><th>Level</th><th>Stage</th><th>Recent</th><th>Seen</th></tr>
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
