// Scenarios tab: S1–S5 on the current antenna and radar, baseline, and sweeps.
import { useEffect, useMemo, useState } from 'react';
import type { BeamConfig, RadarParams } from '../engine/config';
import type { EnvConfig } from '../engine/environment';
import type { Sim } from '../App';
import {
  SCENARIOS, SERIES, SWEEP_METRICS, SWEEP_PARAMS, applyScenario, baselineCsv, evaluate, sweepCsv,
  type AntennaSummary, type EvalOptions, type ScenarioResult, type SeriesKey, type SweepResult,
} from '../engine/scenarios';
import type { SweepJob } from '../engine/sweep.worker';
import { Metric, Panel, Seg, Slider, Toggle, fmt } from '../ui/controls';
import { LinePlot } from './LinePlot';
import { useWorker } from './useWorker';
import { dict, tr } from '../i18n';
import { ENGINE_EN } from '../i18nEngine';

const E = (s: string) => dict(s, ENGINE_EN);

// tab settings persist across tab switches
const ui = {
  applied: false, id: 's2', refKm: { s1: 200, s2: 20, s5: 10 } as Record<string, number>, envelope: true,
  param: 'hRadarM', from: 5, to: 40, n: 21, metric: 'rFirst', series: 'pol' as SeriesKey,
};
function useUi<K extends keyof typeof ui>(k: K): [typeof ui[K], (v: typeof ui[K]) => void] {
  const [v, set] = useState(ui[k]);
  return [v, (x) => { ui[k] = x; set(x); }];
}

const COLORS = ['#59d8ff', '#ffc061', '#5fd8a2'];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const km = (v: number) => fmt(v, v < 100 ? 1 : 0);

export function ScenariosTab(p: {
  env: EnvConfig; updEnv: (p: Partial<EnvConfig>) => void;
  radar: RadarParams; updRadar: (p: Partial<RadarParams>) => void;
  sim: Sim; beam: BeamConfig;
}) {
  const { env, radar, sim } = p;
  const [id, setId] = useUi('id');
  const [refKmMap, setRefKmMap] = useUi('refKm');
  const [envelope, setEnvelope] = useUi('envelope');
  const [paramKey, setParamKey] = useUi('param');
  const [from, setFrom] = useUi('from');
  const [to, setTo] = useUi('to');
  const [n, setN] = useUi('n');
  const [metricKey, setMetricKey] = useUi('metric');
  const [series, setSeries] = useUi('series');

  // the first visit applies the selected scenario so state and scenario match
  useEffect(() => {
    if (ui.applied) return;
    ui.applied = true;
    const s = SCENARIOS.find(x => x.id === ui.id)!;
    p.updEnv(s.env); p.updRadar(s.radar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const sc = SCENARIOS.find(s => s.id === id)!;
  const refKm = refKmMap[id] ?? sc.refRangeKm;
  const opt: EvalOptions = useMemo(() => ({ envelope, refRangeKm: refKm }), [envelope, refKm]);

  const ant = useMemo<AntennaSummary>(() => {
    let pk = -Infinity; for (const g of sim.elCut.gainDbi) if (g > pk) pk = g;
    return {
      fHz: sim.f, gtDbi: sim.gtSteerDbi, grDbi: sim.grSteerDbi, nActive: sim.nActive,
      hpbwAzDeg: Math.max(sim.mAz.hpbwDeg, 0.3), hpbwElDeg: Math.max(sim.mEl.hpbwDeg, 0.3),
      ang: sim.elCut.angDeg, gain: sim.elCut.gainDbi, peakDbi: pk,
      elSteerDeg: Math.asin(sim.v0) * 180 / Math.PI, beamAzDeg: p.beam.azDeg,
    };
  }, [sim, p.beam.azDeg]);

  const base = useMemo(() => evaluate(ant, env, radar, opt), [ant, env, radar, opt]);

  const baseline = useMemo(() => SCENARIOS.filter(s => s.ready).map(s => {
    const a = applyScenario(s, env, radar);
    return { s, r: evaluate(ant, a.env, a.radar, { envelope, refRangeKm: refKmMap[s.id] ?? s.refRangeKm }) };
  }), [ant, env, radar, envelope, refKmMap]);

  const param = SWEEP_PARAMS.find(q => q.key === paramKey)!;
  const metric = SWEEP_METRICS.find(m => m.key === metricKey)!;
  const job = useMemo<SweepJob>(() => ({ a: ant, env, radar, opt, paramKey, from, to, n, series }), [ant, env, radar, opt, paramKey, from, to, n, series]);
  const { res, busy } = useWorker<SweepJob, Omit<SweepResult, 'param'>>(
    () => new Worker(new URL('../engine/sweep.worker.ts', import.meta.url), { type: 'module' }), job);

  const select = (sid: string) => {
    const s = SCENARIOS.find(x => x.id === sid)!;
    if (!s.ready) return;
    setId(sid);
    p.updEnv(s.env); p.updRadar(s.radar);
  };
  const pickParam = (k: string) => {
    const q = SWEEP_PARAMS.find(x => x.key === k)!;
    setParamKey(k); setFrom(q.min); setTo(q.max);
  };

  // sweep plot
  const plot = useMemo(() => {
    if (!res) return null;
    const ser = res.series.map((s, i) => ({ x: res.x, y: s.res.map(r => metric.get(r)), color: COLORS[i % 3], width: 1.8, label: E(s.label) }));
    let lo = Infinity, hi = -Infinity;
    for (const s of ser) for (const v of s.y) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (metric.key === 'pdRef') { lo = 0; hi = 100; }
    const pad = Math.max((hi - lo) * 0.12, metric.key === 'gaps' ? 1 : 0.5);
    const y0 = metric.key === 'pdRef' ? 0 : Math.floor(lo - pad), y1 = metric.key === 'pdRef' ? 100 : Math.ceil(hi + pad);
    return { ser, y0, y1 };
  }, [res, metric]);

  const conclusion = useMemo(() => {
    if (!res || !res.series.length) return '';
    const v = res.series[0].res.map(r => metric.get(r));
    let iMax = 0, iMin = 0;
    v.forEach((x, i) => { if (x > v[iMax]) iMax = i; if (x < v[iMin]) iMin = i; });
    const u = metric.unit ? ' ' + metric.unit : '';
    const pu = param.unit ? ' ' + param.unit : '';
    const f = (x: number) => fmt(x, Math.abs(x) < 10 ? 1 : 0);
    let s = tr(`${metric.label}: de ${f(v[0])}${u} (${f(res.x[0])}${pu}) a ${f(v[v.length - 1])}${u} (${f(res.x[res.x.length - 1])}${pu}); máximo ${f(v[iMax])}${u} con ${param.label.toLowerCase()} = ${f(res.x[iMax])}${pu}.`,
      `${E(metric.label)}: from ${f(v[0])}${u} (${f(res.x[0])}${pu}) to ${f(v[v.length - 1])}${u} (${f(res.x[res.x.length - 1])}${pu}); maximum ${f(v[iMax])}${u} at ${E(param.label).toLowerCase()} = ${f(res.x[iMax])}${pu}.`);
    if (res.series.length > 1) {
      const w = res.series[1].res.map(r => metric.get(r));
      const d = v.map((x, i) => x - w[i]).filter(Number.isFinite);
      const mean = d.reduce((a, b) => a + b, 0) / Math.max(d.length, 1);
      s += tr(` «${res.series[0].label}» frente a «${res.series[1].label}»: ${mean >= 0 ? '+' : ''}${f(mean)}${u} de media.`,
        ` «${E(res.series[0].label)}» versus «${E(res.series[1].label)}»: ${mean >= 0 ? '+' : ''}${f(mean)}${u} on average.`);
    }
    return s;
  }, [res, metric, param]);

  const sweepResult: SweepResult | null = res ? { ...res, param } : null;

  return (
    <main className="grid scen-grid">
      {/* ───────── selection and settings ───────── */}
      <div className="col">
        <Panel title={tr('Escenarios', 'Scenarios')}>
          <div className="chips">
            {SCENARIOS.map(s => (
              <button key={s.id} className={'chip' + (s.id === id ? ' on' : '')} disabled={!s.ready} onClick={() => select(s.id)}>
                <span><b className="code">{s.code}</b>{E(s.name)}{!s.ready && <em> · {tr('próximamente', 'coming soon')}</em>}</span>
                <small>{E(s.target)}</small>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title={tr('Ajustes del escenario', 'Scenario settings')}>
          <Slider label={tr('Distancia de referencia', 'Reference range')} value={refKm} min={2} max={400} step={1}
            onChange={v => setRefKmMap({ ...refKmMap, [id]: v })} fmt={v => `${v} km`} />
          <Slider label={tr('Altura del blanco', 'Target height')} value={radar.hTargetM} min={2} max={15000} step={1} onChange={v => p.updRadar({ hTargetM: v })} fmt={v => `${fmt(v, 0)} m`} />
          <Slider label="RCS" value={10 * Math.log10(radar.rcsM2)} min={-30} max={30} step={1} onChange={v => p.updRadar({ rcsM2: Math.pow(10, v / 10) })} fmt={v => `${fmt(v, 0)} dBsm`} />
          <Slider label={tr('Viento', 'Wind')} value={env.windMs} min={0} max={25} step={0.5} onChange={v => p.updEnv({ windMs: v })} fmt={v => `${fmt(v, 1)} m/s`} />
          <Slider label={tr('Lluvia', 'Rain')} value={env.rainMmH} min={0} max={50} step={0.5} onChange={v => p.updEnv({ rainMmH: v })} fmt={v => v === 0 ? tr('sin lluvia', 'no rain') : `${fmt(v, 1)} mm/h`} />
          <Slider label={tr('Altura de la antena', 'Antenna height')} value={radar.hRadarM} min={5} max={40} step={1} onChange={v => p.updRadar({ hRadarM: v })} fmt={v => `${v} m`} />
          <Toggle label={tr('Barrido en elevación (búsqueda)', 'Elevation scan (search)')} on={envelope} onChange={setEnvelope} />
          <p className="note">{tr('El resto de parámetros (meteorología, buque, forma de onda, antena) se toma de las pestañas Antena, Radar y Entorno.', 'The remaining parameters (weather, ship, waveform, antenna) are taken from the Antenna, Radar and Environment tabs.')}</p>
        </Panel>
      </div>

      {/* ───────── scenario, sweep, and baseline ───────── */}
      <div className="col">
        <header className="scen-head">
          <span className="scen-code">{sc.code}</span>
          <div>
            <h2>{E(sc.name)}</h2>
            <p>{E(sc.question)}</p>
          </div>
        </header>

        <Panel title={tr('Probabilidad de detección frente a distancia', 'Probability of detection versus range')} hint={`${tr('blanco a', 'target at')} ${fmt(radar.hTargetM, 0)} m · ${fmt(radar.rcsM2, radar.rcsM2 < 1 ? 2 : 0)} m² · Swerling 1`}>
          <LinePlot
            series={[{ x: base.km, y: base.pd, color: '#ffc061', width: 1.6, label: 'Pd' }]}
            xRange={[0, base.km[base.km.length - 1]]} yRange={[0, 100]} xLabel={tr('distancia (km)', 'range (km)')} yLabel="Pd (%)" aspect={0.32} xTicks={8} yTicks={5}
            hMarks={[{ at: radar.pdReq * 100, color: '#ffffff66', label: `${tr('Pd requerida', 'required Pd')} ${fmt(radar.pdReq * 100, 0)} %` }]}
            vMarks={[
              { at: refKm, color: '#6b8cff', label: tr('referencia', 'reference') },
              { at: base.rHorKm, color: '#ff6b6b', label: tr('horizonte', 'horizon') },
            ]}
            xFmt={v => fmt(v, 0)} />
        </Panel>

        <Panel title={tr('Barrido de parámetros', 'Parameter sweep')} hint={busy ? tr('calculando…', 'computing…') : `${n} ${tr('puntos', 'points')}${res && res.series.length > 1 ? ` × ${res.series.length} series` : ''}`}>
          <div className="sweep-form">
            <label>{tr('Parámetro', 'Parameter')}
              <select value={paramKey} onChange={e => pickParam(e.target.value)}>
                {SWEEP_PARAMS.map(q => <option key={q.key} value={q.key}>{E(q.label)}</option>)}
              </select>
            </label>
            <label>{tr('Desde', 'From')}
              <span className="num"><input type="number" value={from} step={param.step} onChange={e => setFrom(Number(e.target.value))} /><i>{param.unit}</i></span>
            </label>
            <label>{tr('Hasta', 'To')}
              <span className="num"><input type="number" value={to} step={param.step} onChange={e => setTo(Number(e.target.value))} /><i>{param.unit}</i></span>
            </label>
            <label>{tr('Métrica', 'Metric')}
              <select value={metricKey} onChange={e => setMetricKey(e.target.value)}>
                {SWEEP_METRICS.map(m => <option key={m.key} value={m.key}>{E(m.label)}</option>)}
              </select>
            </label>
            <label>{tr('Comparar', 'Compare')}
              <select value={series} onChange={e => setSeries(e.target.value as SeriesKey)}>
                {SERIES.map(s => <option key={s.key} value={s.key}>{E(s.label)}</option>)}
              </select>
            </label>
            <label>{tr('Puntos', 'Points')}
              <Seg value={n} onChange={setN} options={[{ v: 11, label: '11' }, { v: 21, label: '21' }, { v: 41, label: '41' }]} />
            </label>
          </div>
          <div className={'view' + (busy ? ' is-busy' : '')}>
            {plot
              ? <LinePlot series={plot.ser} xRange={[Math.min(from, to), Math.max(from, to)]} yRange={[plot.y0, plot.y1]}
                  xLabel={`${E(param.label).toLowerCase()}${param.unit ? ` (${param.unit})` : ''}`} yLabel={metric.unit || E(metric.label).toLowerCase()}
                  aspect={0.4} xTicks={8} yTicks={6} xFmt={v => fmt(v, Math.abs(to - from) < 10 ? 1 : 0)} />
              : <div className="placeholder">{tr('calculando…', 'computing…')}</div>}
          </div>
          <div className="sweep-foot">
            <p className="conclusion">{conclusion}</p>
            <button className="btn" disabled={!sweepResult}
              onClick={() => sweepResult && download(`barrido_${sc.code}_${paramKey}.csv`, sweepCsv(sweepResult, `${sc.code} ${sc.name}`))}>{tr('Exportar CSV', 'Export CSV')}</button>
          </div>
        </Panel>

        <Panel title={tr('Línea base', 'Baseline')} hint={tr('antena y radar actuales · cada escenario con su blanco y su mar', 'current antenna and radar · each scenario with its own target and sea')}>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>{tr('escenario', 'scenario')}</th><th>{tr('blanco', 'target')}</th><th>ref.</th><th>{tr('esp. libre', 'free space')}</th><th>{tr('horizonte', 'horizon')}</th><th>{tr('1ª detección', '1st detection')}</th><th>{tr('continua', 'continuous')}</th><th>{tr('huecos', 'gaps')}</th><th>Pd ref.</th><th>{tr('limitado por', 'limited by')}</th></tr>
              </thead>
              <tbody>
                {baseline.map(({ s, r }) => (
                  <tr key={s.id} className={s.id === id ? 'on' : ''} onClick={() => select(s.id)}>
                    <td><b>{s.code}</b> {E(s.name)}</td><td>{E(s.target)}</td><td>{refKmMap[s.id] ?? s.refRangeKm} km</td>
                    <td>{km(r.rFsKm)} km</td><td>{km(r.rHorKm)} km</td><td>{km(r.rFirstKm)} km</td><td>{km(r.rContKm)} km</td>
                    <td className={r.gaps ? 'warn' : ''}>{r.gaps}</td>
                    <td className={r.pdRefPct >= radar.pdReq * 100 ? 'good' : 'bad'}>{fmt(r.pdRefPct, 0)} %</td>
                    <td>{E(r.limit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn" style={{ flex: 'none' }} onClick={() => download('linea_base.csv', baselineCsv(baseline))}>{tr('Exportar CSV', 'Export CSV')}</button>
          </div>
          <p className="note">{tr('Valores puntuales de un modelo analítico sin incertidumbre: los IC95 % de la fase 3 requieren la simulación a nivel de señal (Monte Carlo).', 'Point values from an analytical model without uncertainty: the 95 % CIs of phase 3 require the signal-level simulation (Monte Carlo).')}</p>
        </Panel>
      </div>

      {/* ───────── scenario results ───────── */}
      <div className="col">
        <Panel title={`${tr('Resultado', 'Result')} · ${sc.code}`} pad={false}>
          <ResultMetrics r={base} pdReq={radar.pdReq} refKm={refKm} />
        </Panel>
        <Panel title={tr('Lectura', 'Reading')}>
          <p className="note" style={{ marginTop: 0 }}>{reading(base, refKm, radar.pdReq)}</p>
        </Panel>
      </div>
    </main>
  );
}

function ResultMetrics({ r, pdReq, refKm }: { r: ScenarioResult; pdReq: number; refKm: number }) {
  return (
    <div className="metrics">
      <Metric k={tr('alcance espacio libre', 'free-space range')} v={km(r.rFsKm)} unit="km" />
      <Metric k={tr('horizonte radar', 'radar horizon')} v={km(r.rHorKm)} unit="km" />
      <Metric k={tr('primera detección', 'first detection')} v={km(r.rFirstKm)} unit="km" tone="good" />
      <Metric k={tr('cobertura continua', 'continuous coverage')} v={km(r.rContKm)} unit="km" tone={r.gaps ? 'warn' : undefined} />
      <Metric k={tr('huecos por nulos', 'gaps from nulls')} v={String(r.gaps)} tone={r.gaps ? 'bad' : 'good'} />
      <Metric k={`Pd ${tr('a', 'at')} ${refKm} km`} v={fmt(r.pdRefPct, 0)} unit="%" tone={r.pdRefPct >= pdReq * 100 ? 'good' : 'bad'} />
      <Metric k={`SINR ${tr('a', 'at')} ${refKm} km`} v={fmt(r.sinrRefDb, 1)} unit="dB" />
      <Metric k={`CNR ${tr('a', 'at')} ${refKm} km`} v={r.cnrRefDb < -100 ? '—' : fmt(r.cnrRefDb, 1)} unit="dB" tone={r.cnrRefDb > 0 ? 'warn' : undefined} />
      <Metric k={tr('limitado por', 'limited by')} v={E(r.limit)} />
      <Metric k={tr('pérdida apuntamiento', 'pointing loss')} v={fmt(r.pointingLossDb, 2)} unit="dB" />
    </div>
  );
}

/** Plain-language readout of the result. */
function reading(r: ScenarioResult, refKm: number, pdReq: number): string {
  return tr(readingEs(r, refKm, pdReq), readingEn(r, refKm, pdReq));
}
function readingEn(r: ScenarioResult, refKm: number, pdReq: number): string {
  const ok = r.pdRefPct >= pdReq * 100;
  const lim = r.limit === 'horizonte' ? `the target is below the radar horizon (${km(r.rHorKm)} km)`
    : r.limit === 'clutter' ? 'residual clutter dominates over noise'
    : r.limit === 'multitrayecto' ? `multipath takes away ${fmt(-r.fRefDb * 2, 0)} dB (interference region over the sea)`
    : 'thermal noise dominates';
  let s = `At ${refKm} km Pd is ${fmt(r.pdRefPct, 0)} % (${ok ? 'meets' : 'does not meet'} the ${fmt(pdReq * 100, 0)} %): ${lim}. `;
  s += `The target is first detected at ${km(r.rFirstKm)} km`;
  s += r.gaps ? `, but there ${r.gaps > 1 ? 'are' : 'is'} ${r.gaps} gap${r.gaps > 1 ? 's' : ''} from nulls and coverage is only continuous up to ${km(r.rContKm)} km.` : ' and coverage is continuous from there.';
  if (r.rFirstKm > 0 && Math.abs(r.rFirstKm - r.rHorKm) / r.rHorKm < 0.05) s += ' First detection coincides with the horizon: more power does not help, only more height.';
  return s;
}
function readingEs(r: ScenarioResult, refKm: number, pdReq: number): string {
  const ok = r.pdRefPct >= pdReq * 100;
  const lim = r.limit === 'horizonte' ? `el blanco está por debajo del horizonte radar (${km(r.rHorKm)} km)`
    : r.limit === 'clutter' ? 'domina el clutter residual sobre el ruido'
    : r.limit === 'multitrayecto' ? `el multitrayecto le resta ${fmt(-r.fRefDb * 2, 0)} dB (zona de interferencia sobre el mar)`
    : 'manda el ruido térmico';
  let s = `A ${refKm} km la Pd es del ${fmt(r.pdRefPct, 0)} % (${ok ? 'cumple' : 'no cumple'} el ${fmt(pdReq * 100, 0)} %): ${lim}. `;
  s += `El blanco se detecta por primera vez a ${km(r.rFirstKm)} km`;
  s += r.gaps ? `, pero hay ${r.gaps} hueco${r.gaps > 1 ? 's' : ''} por nulos y la cobertura solo es continua hasta ${km(r.rContKm)} km.` : ' y la cobertura es continua desde ahí.';
  if (r.rFirstKm > 0 && Math.abs(r.rFirstKm - r.rHorKm) / r.rHorKm < 0.05) s += ' La primera detección coincide con el horizonte: más potencia no ayuda, solo más altura.';
  return s;
}
