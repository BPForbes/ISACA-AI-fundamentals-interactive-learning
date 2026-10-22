import { CHAIN_BY_ID } from '../data/chains';
import { TERM_BY_ID } from '../data/terms';
import { expeditionOutcome, type Expedition } from '../engine/director';

export function ExpeditionEnd({ expedition, onDone }: { expedition: Expedition; onDone: () => void }) {
  const chain = CHAIN_BY_ID.get(expedition.chainId)!;
  const outcome = expeditionOutcome(expedition.meters);
  const misses = expedition.log.filter((b) => !b.correct);
  return (
    <section className="card end">
      <p className="eyebrow">Expedition complete</p>
      <h1>{outcome.title}</h1>
      <p>{outcome.text}</p>
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
      <button className="primary" onClick={onDone}>Back to the map</button>
    </section>
  );
}
