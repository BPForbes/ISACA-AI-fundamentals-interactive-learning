// The model being trained, drawn from the run's upgrades: an input layer, one hidden
// layer per unit of depth, an output, and a chip for every upgrade owned. It is a
// picture of the run's numbers, not a model of anything.
import { TERM_BY_ID } from '../data/terms';
import { UPGRADE_BY_ID } from '../data/upgrades';
import { effectsOf } from '../engine/run';
import { PixelIcon } from './PixelIcon';

const W = 360;
const H = 150;
const R = 7;

export function NetworkDiagram({ upgrades, codename }: { upgrades: Record<string, number>; codename: string }) {
  const fx = effectsOf(upgrades);
  const layers = [3, ...Array.from({ length: fx.hiddenLayers }, () => 4), 1];
  const xs = layers.map((_, i) => 30 + (i * (W - 60)) / (layers.length - 1));
  const pos = (layer: number, k: number) => ({ x: xs[layer], y: H / 2 + (k - (layers[layer] - 1) / 2) * 30 });
  const owned = Object.entries(upgrades).filter(([id, tier]) => tier > 0 && UPGRADE_BY_ID.has(id));
  return (
    <figure className="net">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${codename}: ${layers.length - 2} hidden layer${layers.length === 3 ? '' : 's'}, ${owned.length} upgrade${owned.length === 1 ? '' : 's'}`}>
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
        <text x={xs[0]} y={H - 6} className="net-label" textAnchor="middle">input</text>
        {xs.slice(1, -1).map((x, i) => <text key={i} x={x} y={H - 6} className="net-label" textAnchor="middle">hidden {i + 1}</text>)}
        <text x={xs[xs.length - 1]} y={H - 6} className="net-label" textAnchor="middle">output</text>
      </svg>
      <figcaption>
        <strong>{codename}</strong>
        {owned.length === 0
          ? <span className="small"> — a bare network. Learning rate {Math.round(fx.learningRate * 100)}%, a miss adds {Math.round(fx.missPenalty * 100)}%.</span>
          : (
            <ul className="chips net-chips" aria-label="Upgrades owned">
              {owned.map(([id, tier]) => (
                <li key={id} title={UPGRADE_BY_ID.get(id)!.inRun(tier)}>
                  <PixelIcon name={UPGRADE_BY_ID.get(id)!.icon} /> {TERM_BY_ID.get(id)?.term ?? id}{UPGRADE_BY_ID.get(id)!.maxTier > 1 ? ` ×${tier}` : ''}
                </li>
              ))}
            </ul>
          )}
      </figcaption>
    </figure>
  );
}
