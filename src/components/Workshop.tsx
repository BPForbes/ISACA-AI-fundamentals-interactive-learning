// Between projects: the lab as the run has built it, the last project's report,
// the upgrades on offer, and the way into the next project. Each upgrade card
// quotes the term's exam definition from the bank and says, separately, what the
// upgrade gives the lab.
import { BRIEF_BY_ID } from '../data/briefs';
import { TERM_BY_ID } from '../data/terms';
import { UPGRADE_BY_ID } from '../data/upgrades';
import { canBuy, ENDINGS, RUN_GOAL, type RunState } from '../engine/run';
import { NetworkDiagram } from './NetworkDiagram';
import { PixelIcon } from './PixelIcon';

function RunBar({ run }: { run: RunState }) {
  return (
    <ul className="run-bar" aria-label="Run status">
      <li title="Credits to spend in the workshop"><PixelIcon name="coins" /> <strong className="mono">{run.credits}</strong> credits</li>
      <li title="Projects cleared toward shipping the model"><PixelIcon name="flag" /> <strong className="mono">{run.roundsCleared}/{RUN_GOAL}</strong> cleared</li>
      <li title="Team trust"><PixelIcon name="heart" /> <strong className="mono">{run.meters.trust}</strong> trust</li>
      <li title="Compute budget; the run ends at 0"><PixelIcon name="battery-medium" /> <strong className="mono">{run.meters.budget}</strong> budget</li>
      <li title="Risk exposure; governance halts the programme at 100"><PixelIcon name="warning-diamond" /> <strong className="mono">{run.meters.risk}</strong> risk</li>
    </ul>
  );
}

export function Workshop({ run, onBuy, onStart }: { run: RunState; onBuy: (id: string) => void; onStart: () => void }) {
  const brief = BRIEF_BY_ID.get(run.briefId)!;
  const report = run.lastReport;
  const roundNo = run.roundsCleared + run.roundsFailed + 1;
  return (
    <section className="card workshop">
      <p className="eyebrow"><PixelIcon name="cpu" /> Workshop · before project {roundNo}</p>
      <h1>{run.codename}</h1>
      <p>
        You are building a model to {brief.task}, for {brief.owner}. Each project runs the whole lifecycle in the lab: define the problem, build the data,
        train the model, decide how cases are decided, and deploy for six months. The project is cleared when the deployed model meets the business goal.
        Clear {RUN_GOAL} and the model ships. Run out of budget, or let risk reach 100, and the programme is stopped.
      </p>
      <RunBar run={run} />

      {report && (
        <div className={report.cleared ? 'report good' : 'report bad'}>
          <strong>{report.cleared ? 'Project cleared.' : 'Project failed.'}</strong>{' '}
          Value {report.value} against a target of {report.kgiTarget}, {report.incidents} incident{report.incidents === 1 ? '' : 's'}, {report.goalsMet} of {report.goalsTotal} goals met.
          {report.cleared
            ? ` Funding renewed: +${report.creditsEarned} credit${report.creditsEarned === 1 ? '' : 's'}${report.goalsMet === report.goalsTotal ? ' (every goal met)' : ''}.`
            : ` Governance review: budget ${report.metersAfter.budget - report.metersBefore.budget}, risk ${report.metersAfter.risk - report.metersBefore.risk >= 0 ? '+' : ''}${report.metersAfter.risk - report.metersBefore.risk}.`}
        </div>
      )}

      <NetworkDiagram run={run} />

      <h2>Upgrades on offer</h2>
      {run.offer.length === 0 && <p className="hint">Nothing left to buy before this project.</p>}
      <div className="offer">
        {run.offer.map((id) => {
          const u = UPGRADE_BY_ID.get(id)!;
          const term = TERM_BY_ID.get(id)!;
          const ok = canBuy(run, id);
          return (
            <article key={id} className="upgrade card">
              <header>
                <PixelIcon name={u.icon} />
                <h3>{term.term}</h3>
                <span className="badge">Ch. {term.chapter}</span>
              </header>
              <p className="definition-quote"><small>Exam definition</small>{term.definition}</p>
              <p><small>In the lab</small>{u.inRun}</p>
              <button className="primary" disabled={!ok} onClick={() => onBuy(id)} title={ok ? undefined : `Needs ${u.cost} credit${u.cost === 1 ? '' : 's'}`}>
                <PixelIcon name="coins" /> Buy for {u.cost}
              </button>
            </article>
          );
        })}
      </div>
      <p className="hint">
        <PixelIcon name="target" /> The next project's goals are chosen from what you are weakest on; the deployed world drifts a little more each project, and the business target rises.
      </p>
      <button className="primary" onClick={onStart}><PixelIcon name="zap" /> Start project {roundNo}</button>
    </section>
  );
}

export function RunOver({ run, onNewRun }: { run: RunState; onNewRun: () => void }) {
  const ending = ENDINGS[run.ending ?? 'defunded'];
  const owned = Object.keys(run.upgrades).filter((id) => run.upgrades[id] > 0);
  return (
    <section className="card workshop run-over">
      <p className="eyebrow"><PixelIcon name={run.ending === 'shipped' ? 'trophy' : run.ending === 'halted' ? 'castle' : 'battery-medium'} /> Run over</p>
      <h1>{ending.title}</h1>
      <p>{ending.text}</p>
      <RunBar run={run} />
      <p>
        <strong>{run.codename}</strong> cleared {run.roundsCleared} project{run.roundsCleared === 1 ? '' : 's'} and failed {run.roundsFailed}
        {owned.length ? `, with ${owned.map((id) => TERM_BY_ID.get(id)?.term ?? id).join(', ')}` : ', with no upgrades'}.
      </p>
      <NetworkDiagram run={run} />
      <p className="hint"><PixelIcon name="lightbulb" /> What you learned is not reset: mastery, the rematch queue and the progress models carry into the next run.</p>
      <button className="primary" onClick={onNewRun}><PixelIcon name="gamepad" /> Start a new run</button>
    </section>
  );
}
