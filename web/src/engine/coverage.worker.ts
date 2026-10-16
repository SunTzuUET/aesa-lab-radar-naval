// Computes the coverage diagram off the main thread.
import { runCoverageJob, type CoverageJob } from './environment';

self.onmessage = (ev: MessageEvent<{ id: number; job: CoverageJob }>) => {
  const grid = runCoverageJob(ev.data.job);
  (self as unknown as Worker).postMessage({ id: ev.data.id, grid }, [grid.buffer]);
};
