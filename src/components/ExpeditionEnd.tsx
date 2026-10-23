import { CHAIN_BY_ID } from '../data/chains';
import { TERM_BY_ID } from '../data/terms';
import { expeditionOutcome, type Expedition } from '../engine/director';
import { ENDINGS, finishRound, type RunState } from '../engine/run';
import { PixelIcon } from './PixelIcon';

export function ExpeditionEnd({ expedition, run, onDone }: { expedition: Expedition; run: RunState | null; onDone: () => void }) {
  const chain = CHAIN_BY_ID.get(expedition.chainId)!;
  const outcome = expeditionOutcome(expedition.meters);
  const misses = expedition.log.filter((b) => !b.correct);
  // What closing the round will do, shown before it happens; finishRound is pure.
  const after = run?.round ? finishRound(run, expedition.meters) : null;
  const report = after?.lastReport ?? null;
  return (
    <section className="card end">
      <p className="eyebrow">Expedition complete</p>
      <h1>{outcome.title}</h1>
      <p>{outcome.text}</p>
      {report && (
        <div className={report.cleared ? 'report good' : 'report bad'}>
          <p className="result-head">
            <PixelIcon name={report.cleared ? 'check' : 'warning-diamond'} /> Training round {report.cleared ? 'cleared' : 'failed'}:
            loss <span className="mono">{report.loss.toFixed(2)}</span> against a target of <span className="mono">{report.target.toFixed(2)}</span>.
          </p>
          <p>
            {report.cleared
              ? `Funding renewed: +${report.creditsEarned} credit${report.creditsEarned === 1 ? '' : 's'}${report.misses === 0 ? ', including the clean-round bonus' : ''}, and budget +10.`
              : `Governance review: budget ${report.metersAfter.budget - report.metersBefore.budget}, trust −10, risk +${report.metersAfter.risk - report.metersBefore.risk}.`}
          </p>
          {after?.ending && <p><strong>{ENDINGS[after.ending].title}.</strong> {ENDINGS[after.ending].text}</p>}
        </div>
      )}
      <p className="cue"><strong>What this chain teaches:</strong> {chain.cue}</p>
      <h2>The story you wrote</h2>
      <ol className="recap">
        {expedition.log.map((b, i) => (
          <li key={i} className={b.correct ? 'good' : 'bad'}>
            <strong>{TERM_BY_ID.get(b.anchor)?.term}</strong> — you chose “{b.choice}”. {b.consequence}
          </li>
        ))}
      </ol>
      {misses.length > 0 && <p>Missed links go to the rematch queue and come back in new wording.</p>}
      <button className="primary" onClick={onDone}>{after?.ending ? 'See how the run ends' : report ? 'To the workshop' : 'Back to the map'}</button>
    </section>
  );
}
