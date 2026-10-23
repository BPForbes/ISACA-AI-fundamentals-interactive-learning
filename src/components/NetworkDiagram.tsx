// The lab as the run has built it, drawn from its capabilities: an input layer,
// the hidden layers it can train, an output, and a chip for every upgrade owned.
// It is a picture of what the lab can do, not a model of anything.
import { TERM_BY_ID } from '../data/terms';
import { UPGRADE_BY_ID } from '../data/upgrades';
import { capabilities, type RunState } from '../engine/run';
import { PixelIcon } from './PixelIcon';

const W = 360;
const H = 150;
const R = 7;

export function NetworkDiagram({ run }: { run: RunState }) {
  const caps = capabilities(run);
  const hiddenLayers = caps.has('depth2') ? 2 : 1;
  const units = caps.has('wide') ? 6 : 4;
  const inputs = caps.has('interaction') ? 3 : 2;
  const layers = [inputs, ...Array.from({ length: hiddenLayers }, () => units), 1];
  const xs = layers.map((_, i) => 30 + (i * (W - 60)) / (layers.length - 1));
  const pos = (layer: number, k: number) => ({ x: xs[layer], y: H / 2 + (k - (layers[layer] - 1) / 2) * (units > 4 ? 22 : 30) });
  const owned = Object.keys(run.upgrades).filter((id) => run.upgrades[id] > 0 && UPGRADE_BY_ID.has(id));
  return (
    <figure className="net">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${run.codename}: ${hiddenLayers} hidden layer${hiddenLayers === 1 ? '' : 's'}, ${owned.length} upgrade${owned.length === 1 ? '' : 's'}`}>
        {layers.slice(0, -1).map((n, layer) =>
          Array.from({ length: n }, (_, a) =>
            Array.from({ length: layers[layer + 1] }, (_, b) => {
              const p = pos(layer, a);
              const q = pos(layer + 1, b);
              return <line key={`${layer}-${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="net-edge" />;
            })),
        )}
        {layers.map((n, layer) =>
          Array.from({ length: n }, (_, k) => {
            const p = pos(layer, k);
            const kind = layer === 0 ? 'in' : layer === layers.length - 1 ? 'out' : 'hid';
            return <rect key={`${layer}-${k}`} x={p.x - R} y={p.y - R} width={R * 2} height={R * 2} className={`net-node ${kind}`} />;
          }))}
        <text x={xs[0]} y={H - 6} className="net-label" textAnchor="middle">input{inputs === 3 ? ' + x·y' : ''}</text>
        {xs.slice(1, -1).map((x, i) => <text key={i} x={x} y={H - 6} className="net-label" textAnchor="middle">hidden {i + 1}</text>)}
        <text x={xs[xs.length - 1]} y={H - 6} className="net-label" textAnchor="middle">output</text>
      </svg>
      <figcaption>
        <strong>{run.codename}</strong>
        {owned.length === 0
          ? <span className="small"> — the basic lab: one hidden layer of up to eight units, plain gradient descent, reviewers for thirty cases in a hundred, every control at full cost.</span>
          : (
            <ul className="chips net-chips" aria-label="Upgrades owned">
              {owned.map((id) => (
                <li key={id} title={UPGRADE_BY_ID.get(id)!.inRun}>
                  <PixelIcon name={UPGRADE_BY_ID.get(id)!.icon} /> {TERM_BY_ID.get(id)?.term ?? id}
                </li>
              ))}
            </ul>
          )}
      </figcaption>
    </figure>
  );
}
