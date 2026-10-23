// Between rounds: the model so far, the last round's report, and the upgrades on
// offer. Each card quotes the term's exam definition from the bank and says,
// separately, what the upgrade does in this run.
import { BRIEF_BY_ID } from '../data/briefs';
import { CHAIN_BY_ID } from '../data/chains';
import { TERM_BY_ID } from '../data/terms';
import { UPGRADE_BY_ID } from '../data/upgrades';
import { canBuy, ENDINGS, RUN_GOAL, type RunState } from '../engine/run';
import { NetworkDiagram } from './NetworkDiagram';
import { PixelIcon } from './PixelIcon';

function RunBar({ run }: { run: RunState }) {
  return (
    <ul className="run-bar" aria-label="Run status">
      <li title="Compute credits to spend in the workshop"><PixelIcon name="coins" /> <strong className="mono">{run.credits}</strong> credits</li>
      <li title="Rounds cleared toward shipping the model"><PixelIcon name="flag" /> <strong className="mono">{run.roundsCleared}/{RUN_GOAL}</strong> cleared</li>
      <li title="Team trust"><PixelIcon name="heart" /> <strong className="mono">{run.meters.trust}</strong> trust</li>
      <li title="Compute budget; the run ends at 0"><PixelIcon name="battery-medium" /> <strong className="mono">{run.meters.budget}</strong> budget</li>
      <li title="Risk exposure; governance halts training at 100"><PixelIcon name="warning-diamond" /> <strong className="mono">{run.meters.risk}</strong> risk</li>
    </ul>
  );
}

export function Workshop({ run, onBuy }: { run: RunState; onBuy: (id: string) => void }) {
  const brief = BRIEF_BY_ID.get(run.briefId)!;
  const report = run.lastReport;
  const roundNo = run.roundsCleared + run.roundsFailed + 1;
  return (
    <section className="card workshop">
      <p className="eyebrow"><PixelIcon name="cpu" /> Workshop · before round {roundNo}</p>
      <h1>{run.codename}</h1>
      <p>You are training a model to {brief.task}, for {brief.owner}. Each round is one expedition; every decision in it is a training step. Clear {RUN_GOAL} rounds and the model ships. Run out of budget, or let risk reach 100, and the project is stopped.</p>
      <RunBar run={run} />

      {report && (
        <div className={report.cleared ? 'report good' : 'report bad'}>
          <strong>{report.cleared ? 'Round cleared.' : 'Round failed.'}</strong>{' '}
          {CHAIN_BY_ID.get(report.chainId)?.title}: loss {report.loss.toFixed(2)} against a target of {report.target.toFixed(2)}, {report.misses} miss{report.misses === 1 ? '' : 'es'}.
          {report.cleared
            ? ` Funding renewed: +${report.creditsEarned} credit${report.creditsEarned === 1 ? '' : 's'}${report.misses === 0 ? ' (clean round bonus)' : ''}, budget +10.`
            : ` Governance review: budget ${report.metersAfter.budget - report.metersBefore.budget}, risk +${report.metersAfter.risk - report.metersBefore.risk}.`}
        </div>
      )}

      <NetworkDiagram upgrades={run.upgrades} codename={run.codename} />

      <h2>Upgrades on offer</h2>
      {run.offer.length === 0 && <p className="hint">Nothing left to buy before this round.</p>}
      <div className="offer">
        {run.offer.map((id) => {
          const u = UPGRADE_BY_ID.get(id)!;
          const term = TERM_BY_ID.get(id)!;
          const tier = (run.upgrades[id] ?? 0) + 1;
          const ok = canBuy(run, id);
          return (
            <article key={id} className="upgrade card">
              <header>
                <PixelIcon name={u.icon} />
                <h3>{term.term}</h3>
                <span className="badge">Ch. {term.chapter}</span>
                {u.maxTier > 1 && <span className="badge subtle">tier {tier} of {u.maxTier}</span>}
              </header>
              <p className="definition-quote"><small>Exam definition</small>{term.definition}</p>
              <p><small>In this run</small>{u.inRun(tier)}</p>
              <button className="primary" disabled={!ok} onClick={() => onBuy(id)} title={ok ? undefined : `Needs ${u.cost} credit${u.cost === 1 ? '' : 's'}`}>
                <PixelIcon name="coins" /> Buy for {u.cost}
              </button>
            </article>
          );
        })}
      </div>
      <p className="hint">
        <PixelIcon name="target" /> Next: choose a training set below. Each chain shows the loss this round must reach; longer chains allow more training steps and expect a lower loss.
      </p>
    </section>
  );
}

export function RunOver({ run, onNewRun }: { run: RunState; onNewRun: () => void }) {
  const ending = ENDINGS[run.ending ?? 'defunded'];
  const owned = Object.entries(run.upgrades).filter(([, t]) => t > 0);
  return (
    <section className="card workshop run-over">
      <p className="eyebrow"><PixelIcon name={run.ending === 'shipped' ? 'trophy' : run.ending === 'halted' ? 'castle' : 'battery-medium'} /> Run over</p>
      <h1>{ending.title}</h1>
      <p>{ending.text}</p>
      <RunBar run={run} />
      <p>
        <strong>{run.codename}</strong> cleared {run.roundsCleared} round{run.roundsCleared === 1 ? '' : 's'} and failed {run.roundsFailed}
        {owned.length ? `, with ${owned.map(([id, t]) => `${TERM_BY_ID.get(id)?.term ?? id}${t > 1 ? ` ×${t}` : ''}`).join(', ')}` : ', with no upgrades'}.
      </p>
      <NetworkDiagram upgrades={run.upgrades} codename={run.codename} />
      <p className="hint"><PixelIcon name="lightbulb" /> What you learned is not reset: mastery, the rematch queue and the progress models carry into the next run.</p>
      <button className="primary" onClick={onNewRun}><PixelIcon name="gamepad" /> Start a new run</button>
    </section>
  );
}
