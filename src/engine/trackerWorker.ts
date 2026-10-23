// Trains the progress models off the main thread so the page stays responsive.
import { fitAttention } from './attention';
import { fitTracker, type HistoryEvent } from './tracker';

self.onmessage = (event: MessageEvent<{ id: number; history: HistoryEvent[] }>) => {
  const { id, history } = event.data;
  self.postMessage({ id, model: fitTracker(history), attention: fitAttention(history) });
};
