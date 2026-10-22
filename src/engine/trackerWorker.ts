// Trains the progress model off the main thread so the page stays responsive.
import { fitTracker, type HistoryEvent } from './tracker';

self.onmessage = (event: MessageEvent<{ id: number; history: HistoryEvent[] }>) => {
  const { id, history } = event.data;
  self.postMessage({ id, model: fitTracker(history) });
};
