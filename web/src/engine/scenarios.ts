// Evaluation scenarios (S1–S5) and parameter sweeps.
// A scenario sets target, sea and weather on top of the current antenna and radar and
// produces a set of reference metrics; a sweep repeats the evaluation
// while varying one parameter.
import { C0, type RadarParams } from './config';
import { detectionRange, pdSwerling1, snrReqSwerling1 } from './radar';
import { WAVEFORMS, radarK, targetBin } from './waveform';
import {
  envContext, linkVsRange, patternFromCut, pointingErrorRmsDeg, pointingLossDb, shipMotion, twoRayGeometry,
  type EnvConfig,
} from './environment';

export interface Scenario {
  id: string; code: string; name: string;
  question: string;           // what it tests
  target: string;             // target description
  refRangeKm: number;         // range at which reference Pd and SINR are reported
  env: Partial<EnvConfig>; radar: Partial<RadarParams>;
  ready: boolean;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 's1', code: 'S1', name: 'Vigilancia aérea',
    question: 'Ecuación radar, ganancia y pérdida de barrido frente a un caza a gran distancia con mar en calma.',
    target: 'caza · 3 m² · 5 000 m', refRangeKm: 200,
    env: { windMs: 4, swellHm: 0.4, swellTs: 9, rhPct: 60, tempC: 17, seaTempC: 17, rainMmH: 0, speedKn: 14, pol: 'H' },
    radar: { rcsM2: 3, hTargetM: 5000, ...WAVEFORMS.lejana }, ready: true,
  },
  {
    id: 's2', code: 'S2', name: 'Misil rozaolas',
    question: 'Horizonte, multitrayecto sobre el mar y clutter frente a un misil a 7 m con mar de estado 4–5.',
    target: 'misil · 0,1 m² · 7 m', refRangeKm: 20,
    env: { windMs: 12, swellHm: 1.5, swellTs: 10, rhPct: 82, tempC: 18, seaTempC: 20, rainMmH: 0, speedKn: 18, pol: 'H' },
    radar: { rcsM2: 0.1, hTargetM: 7, ...WAVEFORMS.mtd }, ready: true,
  },
  {
    id: 's3', code: 'S3', name: 'Jammer de ruido',
    question: 'Lóbulos secundarios y anulación adaptativa frente a un jammer fuera del haz.',
    target: 'blanco + jammer', refRangeKm: 100, env: {}, radar: {}, ready: false,
  },
  {
    id: 's4', code: 'S4', name: 'Multifunción',
    question: 'Búsqueda más seguimiento de N blancos: haces simultáneos frente a canales digitales.',
    target: 'N blancos', refRangeKm: 100, env: {}, radar: {}, ready: false,
  },
  {
    id: 's5', code: 'S5', name: 'Dron a baja cota',
    question: 'Sensibilidad y clutter frente a un dron pequeño a 100 m sobre mar de estado 3.',
    target: 'dron · 0,01 m² · 100 m', refRangeKm: 10,
    env: { windMs: 8, swellHm: 0.8, swellTs: 9, rhPct: 75, tempC: 18, seaTempC: 19, rainMmH: 0, speedKn: 12, pol: 'H' },
    radar: { rcsM2: 0.01, hTargetM: 100, ...WAVEFORMS.mtd }, ready: true,
  },
];

/** What the evaluation needs from the antenna (serializable). */
export interface AntennaSummary {
  fHz: number; gtDbi: number; grDbi: number; nActive: number;
  hpbwAzDeg: number; hpbwElDeg: number;
  hpbwTxDeg?: number;         // transmit θ₃ (uniform); if missing, receive θ₃ / 1.34 (Taylor 35 dB)
  ang: Float64Array; gain: Float64Array; peakDbi: number;
  elSteerDeg: number; beamAzDeg: number;
}

export interface EvalOptions {
  envelope: boolean;          // one beam per elevation (search) or the fixed beam
  beamElDeg?: number;         // fixed-beam elevation (if no envelope)
  refRangeKm: number;
}

export type Limit = 'ruido' | 'clutter' | 'horizonte' | 'multitrayecto';

export interface ScenarioResult {
  rFsKm: number; rHorKm: number;
  rFirstKm: number;           // first detection (inbound target)
  rContKm: number;            // continuous coverage from the radar
  gaps: number;               // null-induced gaps between the two
  sinrRefDb: number; snrRefDb: number; cnrRefDb: number; fRefDb: number;
  pdRefPct: number; limit: Limit;
  pointingLossDb: number; reqDb: number;
  km: Float64Array; sinr: Float64Array; pd: Float64Array;
}

export function evaluate(a: AntennaSummary, e: EnvConfig, r: RadarParams, o: EvalOptions, n = 600): ScenarioResult {
  const { K } = radarK(r, { f: a.fHz, gtDbi: a.gtDbi, grDbi: a.grDbi, nActive: a.nActive }, a.hpbwTxDeg ?? a.hpbwAzDeg / 1.34, a.hpbwAzDeg);
  const req = snrReqSwerling1(r.pdReq, r.pfa), reqDb = 10 * Math.log10(req);
  const ruM = C0 / (2 * r.prfHz), blindM = C0 * r.tauS / 2;
  const motion = shipMotion(e);
  const ptLoss = pointingLossDb(pointingErrorRmsDeg(motion, a.beamAzDeg, e.beamStab), a.hpbwElDeg);
  const pat = patternFromCut(a.ang, a.gain, o.beamElDeg ?? a.elSteerDeg, a.peakDbi, o.envelope);
  const ctx = envContext({
    K, fHz: a.fHz, hRadar: r.hRadarM, hpbwAzDeg: a.hpbwAzDeg, hpbwElDeg: a.hpbwElDeg,
    extraLossDb: ptLoss, tauS: r.tauS, rcs: r.rcsM2, grDbi: a.grDbi, gtDbi: a.gtDbi, nPulses: r.nPulses,
    prfHz: r.prfHz, dopplerSllDb: r.dopplerSllDb, dopplerBin: targetBin(r, a.fHz),
  }, e, pat, o.envelope);
  const ae = ctx.ae;
  const rHor = Math.sqrt(2 * ae * r.hRadarM) + Math.sqrt(2 * ae * r.hTargetM);
  const rFs = detectionRange(K, req);
  // with multipath enhancement (F⁴ up to +12 dB) detection is possible out to ~2·R free space
  const rMax = Math.min(450e3, Math.max(20e3, Math.min(rHor * 1.05, rFs * 2.1), o.refRangeKm * 1e3 * 1.1));
  const R = new Float64Array(n);
  for (let i = 0; i < n; i++) R[i] = rMax * (i + 1) / n;
  const pts = linkVsRange(ctx, R, r.hTargetM);
  const km = Float64Array.from(R, x => x / 1e3);
  const sinr = Float64Array.from(pts, q => q.sinrDb);
  const pd = Float64Array.from(sinr, s => s < -150 ? 0 : 100 * pdSwerling1(Math.pow(10, s / 10), r.pfa));

  // only detections within the unambiguous range count (beyond it the measured range is false)
  let rFirst = 0, rCont = 0, gaps = 0, iLast = -1;
  for (let i = 0; i < n; i++) if (sinr[i] >= reqDb && R[i] <= ruM) { rFirst = R[i]; iLast = i; }
  for (let i = 0; i < n; i++) {
    const ok = R[i] <= blindM || (sinr[i] >= reqDb && R[i] <= ruM);   // the blind zone does not break continuity
    if (!ok && rCont === 0 && i > 0) rCont = R[i - 1];
    if (!ok && i === 0) rCont = -1;                 // no detection from the first sample
    if (i > 0 && i <= iLast && !ok && sinr[i - 1] >= reqDb) gaps++;
  }
  if (rCont === 0) rCont = R[n - 1];
  if (rCont < 0) rCont = 0;

  // reference point evaluated exactly
  const Rref = o.refRangeKm * 1e3;
  const ref = linkVsRange(ctx, [Rref], r.hTargetM)[0];
  const visible = twoRayGeometry(r.hRadarM, r.hTargetM, Rref, ae).visible;
  const fRefDb = ref.F > 0 ? 20 * Math.log10(ref.F) : -Infinity;
  const limit: Limit = !visible ? 'horizonte' : ref.cnrDb > 0 ? 'clutter' : fRefDb < -6 ? 'multitrayecto' : 'ruido';
  const sinrRef = visible ? ref.sinrDb : -Infinity;
  return {
    rFsKm: rFs / 1e3, rHorKm: rHor / 1e3, rFirstKm: rFirst / 1e3, rContKm: rCont / 1e3, gaps,
    sinrRefDb: sinrRef, snrRefDb: visible ? ref.snrDb : -Infinity, cnrRefDb: ref.cnrDb, fRefDb,
    pdRefPct: visible ? 100 * pdSwerling1(Math.pow(10, sinrRef / 10), r.pfa) : 0,
    limit, pointingLossDb: ptLoss, reqDb, km, sinr, pd,
  };
}

/** Applies a scenario to the current configuration. */
export function applyScenario(s: Scenario, e: EnvConfig, r: RadarParams): { env: EnvConfig; radar: RadarParams } {
  return { env: { ...e, ...s.env }, radar: { ...r, ...s.radar } };
}

// ───────────────────────────── sweeps ─────────────────────────────

interface State { env: EnvConfig; radar: RadarParams; opt: EvalOptions; }

export interface SweepParam {
  key: string; label: string; unit: string; min: number; max: number; step: number;
  get(s: State): number;
  set(s: State, v: number): State;
}

const envP = (key: keyof EnvConfig, label: string, unit: string, min: number, max: number, step: number, scale = 1): SweepParam => ({
  key, label, unit, min, max, step,
  get: s => (s.env[key] as number) / scale,
  set: (s, v) => ({ ...s, env: { ...s.env, [key]: v * scale } }),
});
const radP = (key: keyof RadarParams, label: string, unit: string, min: number, max: number, step: number, scale = 1): SweepParam => ({
  key, label, unit, min, max, step,
  get: s => (s.radar[key] as number) / scale,
  set: (s, v) => ({ ...s, radar: { ...s.radar, [key]: v * scale } }),
});

export const SWEEP_PARAMS: SweepParam[] = [
  radP('hRadarM', 'Altura de la antena', 'm', 5, 40, 1),
  radP('hTargetM', 'Altura del blanco', 'm', 2, 15000, 1),
  {
    key: 'rcsDb', label: 'RCS del blanco', unit: 'dBsm', min: -30, max: 30, step: 1,
    get: s => 10 * Math.log10(s.radar.rcsM2),
    set: (s, v) => ({ ...s, radar: { ...s.radar, rcsM2: Math.pow(10, v / 10) } }),
  },
  envP('windMs', 'Viento (estado del mar)', 'm/s', 0, 25, 0.5),
  envP('swellHm', 'Mar de fondo', 'm', 0, 6, 0.1),
  envP('rhPct', 'Humedad relativa', '%', 10, 100, 1),
  envP('rainMmH', 'Lluvia', 'mm/h', 0, 50, 0.5),
  envP('bandwidthHz', 'Ancho de banda', 'MHz', 0.5, 50, 0.5, 1e6),
  { ...envP('cancelDb', 'Cancelación de clutter (fija)', 'dB', 0, 60, 1),
    set: (s, v) => ({ ...s, env: { ...s.env, cancelPhys: false, cancelDb: v } }) },
  envP('jitterDeg', 'Inestabilidad del transmisor', '°', 0, 1, 0.01),

  envP('headingDeg', 'Rumbo (respecto al viento)', '°', 0, 359, 1),
  radP('pElemW', 'Potencia por elemento', 'W', 1, 40, 1),
  radP('nPulses', 'Pulsos integrados', '', 1, 128, 1),
  radP('prfHz', 'PRF', 'kHz', 0.2, 10, 0.05, 1e3),
  radP('dopplerSllDb', 'Ventana Doppler (lóbulos)', 'dB', 30, 80, 1),
  radP('beamSpacing', 'Paso de la rejilla de búsqueda', 'θ₃', 0.4, 1.2, 0.05),
  {
    key: 'beamEl', label: 'Elevación del haz fijo', unit: '°', min: -2, max: 6, step: 0.1,
    get: s => s.opt.beamElDeg ?? 0,
    set: (s, v) => ({ ...s, opt: { ...s.opt, envelope: false, beamElDeg: v } }),
  },
];

export interface SweepMetric { key: string; label: string; unit: string; get(r: ScenarioResult): number; }
export const SWEEP_METRICS: SweepMetric[] = [
  { key: 'rFirst', label: 'Primera detección', unit: 'km', get: r => r.rFirstKm },
  { key: 'rCont', label: 'Cobertura continua', unit: 'km', get: r => r.rContKm },
  { key: 'gaps', label: 'Huecos por nulos', unit: '', get: r => r.gaps },
  { key: 'pdRef', label: 'Pd a la distancia de referencia', unit: '%', get: r => r.pdRefPct },
  { key: 'sinrRef', label: 'SINR a la distancia de referencia', unit: 'dB', get: r => r.sinrRefDb },
  { key: 'cnrRef', label: 'CNR a la distancia de referencia', unit: 'dB', get: r => r.cnrRefDb },
];

export type SeriesKey = 'none' | 'pol' | 'stab' | 'fins' | 'envelope';
export const SERIES: { key: SeriesKey; label: string; variants: { label: string; apply: (s: State) => State }[] }[] = [
  { key: 'none', label: 'ninguna', variants: [{ label: 'actual', apply: s => s }] },
  { key: 'pol', label: 'polarización', variants: [
    { label: 'H', apply: s => ({ ...s, env: { ...s.env, pol: 'H' } }) },
    { label: 'V', apply: s => ({ ...s, env: { ...s.env, pol: 'V' } }) }] },
  { key: 'stab', label: 'estabilización del haz', variants: [
    { label: 'estabilizado', apply: s => ({ ...s, env: { ...s.env, beamStab: true } }) },
    { label: 'sin estabilizar', apply: s => ({ ...s, env: { ...s.env, beamStab: false } }) }] },
  { key: 'fins', label: 'aletas', variants: [
    { label: 'con aletas', apply: s => ({ ...s, env: { ...s.env, finStab: true } }) },
    { label: 'sin aletas', apply: s => ({ ...s, env: { ...s.env, finStab: false } }) }] },
  { key: 'envelope', label: 'haz', variants: [
    { label: 'barrido en elevación', apply: s => ({ ...s, opt: { ...s.opt, envelope: true } }) },
    { label: 'haz fijo', apply: s => ({ ...s, opt: { ...s.opt, envelope: false } }) }] },
];

export interface SweepResult {
  param: SweepParam; x: number[];
  series: { label: string; res: ScenarioResult[] }[];
}

export function runSweep(a: AntennaSummary, base: State, param: SweepParam, from: number, to: number, n: number, series: SeriesKey): SweepResult {
  const x = Array.from({ length: n }, (_, i) => n > 1 ? from + (to - from) * i / (n - 1) : from);
  const def = SERIES.find(s => s.key === series)!;
  return {
    param, x,
    series: def.variants.map(v => ({
      label: v.label,
      res: x.map(xv => {
        const s = param.set(v.apply(base), xv);
        return evaluate(a, s.env, s.radar, s.opt, 400);
      }),
    })),
  };
}

const num = (v: number, d = 3) => Number.isFinite(v) ? v.toFixed(d) : '';

/** CSV with all metrics for each sweep point (comma separator, dot decimal). */
export function sweepCsv(s: SweepResult, scenario: string): string {
  const head = [`${s.param.label} (${s.param.unit})`, 'serie', 'primera_deteccion_km', 'cobertura_continua_km', 'huecos',
    'pd_ref_pct', 'sinr_ref_dB', 'snr_ref_dB', 'cnr_ref_dB', 'F2_ref_dB', 'limitado_por', 'perdida_apuntamiento_dB'];
  const rows = [`# escenario: ${scenario}`, head.join(',')];
  for (const se of s.series) se.res.forEach((r, i) => rows.push([
    num(s.x[i], 4), se.label, num(r.rFirstKm, 2), num(r.rContKm, 2), r.gaps, num(r.pdRefPct, 2), num(r.sinrRefDb, 2),
    num(r.snrRefDb, 2), num(r.cnrRefDb, 2), num(r.fRefDb, 2), r.limit, num(r.pointingLossDb, 3),
  ].join(',')));
  return rows.join('\n') + '\n';
}

/** CSV of the baseline table (one row per scenario). */
export function baselineCsv(rows: { s: Scenario; r: ScenarioResult }[]): string {
  const out = ['escenario,blanco,distancia_ref_km,alcance_espacio_libre_km,horizonte_km,primera_deteccion_km,cobertura_continua_km,huecos,pd_ref_pct,sinr_ref_dB,limitado_por'];
  for (const { s, r } of rows) out.push([s.code, `"${s.target}"`, s.refRangeKm, num(r.rFsKm, 1), num(r.rHorKm, 1), num(r.rFirstKm, 1),
    num(r.rContKm, 1), r.gaps, num(r.pdRefPct, 1), num(r.sinrRefDb, 1), r.limit].join(','));
  return out.join('\n') + '\n';
}
