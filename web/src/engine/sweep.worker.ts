// Runs scenario sweeps off the main thread.
import type { EnvConfig } from './environment';
import type { RadarParams } from './config';
import { SWEEP_PARAMS, runSweep, type AntennaSummary, type EvalOptions, type SeriesKey } from './scenarios';

export interface SweepJob {
  a: AntennaSummary; env: EnvConfig; radar: RadarParams; opt: EvalOptions;
  paramKey: string; from: number; to: number; n: number; series: SeriesKey;
}

self.onmessage = (ev: MessageEvent<{ id: number; job: SweepJob }>) => {
  const j = ev.data.job;
  const param = SWEEP_PARAMS.find(p => p.key === j.paramKey)!;
  const r = runSweep(j.a, { env: j.env, radar: j.radar, opt: j.opt }, param, j.from, j.to, j.n, j.series);
  (self as unknown as Worker).postMessage({ id: ev.data.id, x: r.x, series: r.series });
};
