// Environment tab: weather, sea state, ship motion, and propagation.
// Connects the antenna engine (elevation pattern, gains) with environment.ts.
import { useMemo, useState } from 'react';
import type { BeamConfig, RadarParams } from '../engine/config';
import type { Sim } from '../App';
import { radarHorizon, snrReqSwerling1, detectionRange } from '../engine/radar';
import { radarK, targetBin, txBeamwidthDeg } from '../engine/waveform';
import {
  DOUGLAS_NAME, absHumidity, attitudeAt, beaufort, douglas, envContext, evapDuct, gasAttenDbKm, kFactor,
  cancelFns, linkVsRange, patternFromCut, pointingErrorRmsDeg, pointingLossDb, rainAttenDbKm, refractivity, seaSigma0Db,
  shapeK, shipMotion, totalHs, visibilityKm, windSea, type EnvConfig,
} from '../engine/environment';
import { Metric, Panel, Seg, Slider, Toggle, fmt } from '../ui/controls';
import { LinePlot } from './LinePlot';
import { Radar3D } from './Radar3D';
import { CoverageView } from './CoverageView';
import { SCENARIOS as SCEN_DEFS } from '../engine/scenarios';
import { dict, tr } from '../i18n';
import { ENGINE_EN } from '../i18nEngine';

interface Scenario {
  id: string; label: string; title: string;
  env: Partial<EnvConfig>; radar: Partial<RadarParams>;
}
const SCENARIOS = (): Scenario[] => [
  ...SCEN_DEFS.filter(d => d.ready).map(d => ({ id: d.id, label: `${d.code} · ${dict(d.name, ENGINE_EN).toLowerCase()}`, title: dict(d.target, ENGINE_EN), env: d.env, radar: d.radar })),
  { id: 'temp', label: tr('temporal', 'storm'), title: tr('Temporal con chubascos: viento fuerte, lluvia intensa', 'Storm with showers: strong wind, heavy rain'),
    env: { windMs: 19, swellHm: 3, swellTs: 12, rhPct: 96, tempC: 12, seaTempC: 14, rainMmH: 16, speedKn: 12 },
    radar: { rcsM2: 1, hTargetM: 300 } },
  { id: 'duct', label: tr('conducto', 'duct'), title: tr('Aire seco y cálido sobre mar templado: conducto de evaporación intenso', 'Warm dry air over a temperate sea: strong evaporation duct'),
    env: { windMs: 6, swellHm: 0.8, swellTs: 9, rhPct: 70, tempC: 26, seaTempC: 27, rainMmH: 0, speedKn: 16 },
    radar: { rcsM2: 0.1, hTargetM: 7 } },
];

export function EnvironmentTab(p: {
  env: EnvConfig; updEnv: (p: Partial<EnvConfig>) => void;
  radar: RadarParams; updRadar: (p: Partial<RadarParams>) => void;
  sim: Sim; beam: BeamConfig; failed: Uint8Array;
}) {
  const { env: e, radar: r, sim, beam } = p;
  const [envelope, setEnvelope] = useState(true);
  const [hMaxSel, setHMaxSel] = useState<'auto' | number>('auto');
  const [autoRotate, setAutoRotate] = useState(false);

  // ── sea, atmosphere, and ship ──
  const sea = useMemo(() => {
    const ws = windSea(e.windMs), hs = totalHs(e), ss = douglas(hs);
    const Ns = refractivity(e.tempC, e.pressHpa, e.rhPct);
    const kf = kFactor(Ns);
    const duct = evapDuct(e);
    const rho = absHumidity(e.tempC, e.rhPct);
    const gas = gasAttenDbKm(sim.f, e.tempC, e.pressHpa, rho);
    return { ws, hs, ss, Ns, kf, duct, rho, gas, rain: rainAttenDbKm(sim.f, e.rainMmH, e.pol), vis: visibilityKm(e) };
  }, [e, sim.f]);

  const motion = useMemo(() => shipMotion(e), [e]);
  const hpbwEl = Math.max(sim.mEl.hpbwDeg, 0.3), hpbwAz = Math.max(sim.mAz.hpbwDeg, 0.3);
  const errRms = pointingErrorRmsDeg(motion, beam.azDeg, e.beamStab);
  const errRaw = pointingErrorRmsDeg(motion, beam.azDeg, false);
  const ptLoss = pointingLossDb(errRms, hpbwEl);

  // ── radar chain with environment ──
  const chain = useMemo(() => {
    const th3Tx = txBeamwidthDeg(sim.g.Nx, sim.face.dLambda * sim.f / sim.face.f0, beam.azDeg);
    const { K } = radarK(r, { f: sim.f, gtDbi: sim.gtSteerDbi, grDbi: sim.grSteerDbi, nActive: sim.nActive }, th3Tx, hpbwAz);
    const ruM = 299_792_458 / (2 * r.prfHz), blindM = 299_792_458 * r.tauS / 2;
    const req = snrReqSwerling1(r.pdReq, r.pfa), reqDb = 10 * Math.log10(req);
    const cut = sim.elCut;
    let pk = -Infinity; for (const gv of cut.gainDbi) if (gv > pk) pk = gv;
    const elSteer = Math.asin(sim.v0) * 180 / Math.PI;
    const pat = patternFromCut(cut.angDeg, cut.gainDbi, elSteer, pk, envelope);
    const link = {
      K, fHz: sim.f, hRadar: r.hRadarM, hpbwAzDeg: hpbwAz, hpbwElDeg: hpbwEl,
      extraLossDb: ptLoss, tauS: r.tauS, rcs: r.rcsM2, grDbi: sim.grSteerDbi, gtDbi: sim.gtSteerDbi, nPulses: r.nPulses,
      prfHz: r.prfHz, dopplerSllDb: r.dopplerSllDb, dopplerBin: targetBin(r, sim.f),
    };
    const ctx = envContext(link, e, pat, envelope);
    const rHor = radarHorizon(r.hRadarM, r.hTargetM, ctx.ae / 6_371_000);
    const rFs = detectionRange(K, req);
    const rMaxRaw = Math.min(450e3, Math.max(20e3, Math.min(rHor * 1.12, Math.max(rFs * 1.3, 30e3))));
    const tick = rMaxRaw > 250e3 ? 50e3 : rMaxRaw > 120e3 ? 20e3 : rMaxRaw > 50e3 ? 10e3 : 5e3;
    const rMax = Math.ceil(rMaxRaw / tick) * tick;
    const n = 700;
    const R = new Float64Array(n);
    for (let i = 0; i < n; i++) R[i] = rMax * (i + 1) / n;
    const pts = linkVsRange(ctx, R, r.hTargetM);
    const km = Float64Array.from(R, x => x / 1e3);
    const col = (k: 'snrFsDb' | 'snrDb' | 'cnrDb' | 'sinrDb') => Float64Array.from(pts, q => q[k] < -150 ? NaN : q[k]);
    const Fdb = Float64Array.from(pts, q => q.F > 0 ? 20 * Math.log10(q.F) : NaN);
    // first-detection range (last crossing) and continuous coverage (first gap)
    // gaps: stretches without detection between the first and last detected range
    let rFirst = 0, rCont = 0, gaps = 0, iLast = -1;
    // only detections within the unambiguous range count
    for (let i = 0; i < n; i++) if (pts[i].sinrDb >= reqDb && R[i] <= ruM) { rFirst = R[i]; iLast = i; }
    for (let i = 0; i < n; i++) {
      const ok = R[i] <= blindM || (pts[i].sinrDb >= reqDb && R[i] <= ruM);   // the blind zone does not break continuity
      if (!ok && rCont === 0 && i > 0) rCont = R[i - 1];
    if (!ok && i === 0) rCont = -1;                 // no detection from the first sample
      if (i > 0 && i <= iLast && !ok && pts[i - 1].sinrDb >= reqDb) gaps++;
    }
    if (rCont === 0) rCont = R[n - 1];
    if (rCont < 0) rCont = 0;
    return { K, ruM, reqDb, ctx, link, pk, elSteer, rHor, rFs, rMax, nTicks: Math.round(rMax / tick), km, Fdb, pts, rFirst, rCont, gaps,
      snrFs: col('snrFsDb'), snr: col('snrDb'), cnr: col('cnrDb'), sinr: col('sinrDb') };
  }, [r, sim, e, envelope, hpbwAz, hpbwEl, ptLoss, beam.azDeg]);

  const hMax = hMaxSel === 'auto' ? (r.hTargetM < 150 ? 300 : r.hTargetM < 2500 ? 3000 : 15000) : hMaxSel;
  const covJob = useMemo(() => ({
    L: chain.link, e, ang: sim.elCut.angDeg, gain: sim.elCut.gainDbi, beamElDeg: chain.elSteer, peakDbi: chain.pk,
    envelope, rMax: chain.rMax, hMax,
  }), [chain, e, sim.elCut, envelope, hMax]);

  // ── auxiliary series ──
  const motionSeries = useMemo(() => {
    const n = 600, T = 120;
    const t = new Float64Array(n), roll = new Float64Array(n), pitch = new Float64Array(n), err = new Float64Array(n);
    const az = beam.azDeg * Math.PI / 180;
    for (let i = 0; i < n; i++) {
      t[i] = T * i / (n - 1);
      const a = attitudeAt(motion, t[i]);
      roll[i] = a.roll * 180 / Math.PI; pitch[i] = a.pitch * 180 / Math.PI;
      err[i] = (a.pitch * Math.cos(az) + a.roll * Math.sin(az)) * 180 / Math.PI;
    }
    let m = 1; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(roll[i]), Math.abs(pitch[i]));
    return { t, roll, pitch, err, lim: Math.ceil(m * 1.15) };
  }, [motion, beam.azDeg]);

  const sigma0 = useMemo(() => {
    const n = 160, x = new Float64Array(n), h = new Float64Array(n), v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = -1 + 2.5 * i / (n - 1);
      const g = Math.pow(10, x[i]);
      h[i] = seaSigma0Db(g, sim.f, sea.ss, 'H'); v[i] = seaSigma0Db(g, sim.f, sea.ss, 'V');
    }
    return { x, h, v };
  }, [sim.f, sea.ss]);

  const applyScenario = (s: Scenario) => { p.updEnv(s.env); p.updRadar(s.radar); };
  // K shape at 5 km: grazing angle and resolved cell with effective beamwidth θ3/1.33
  const kAt5km = (() => {
    const R = 5e3, ae = sea.kf.k * 6_371_000;
    const psi = Math.asin(Math.max(1e-4, r.hRadarM / R - R / (2 * ae)));
    const area = R * (1.7 * Math.PI / 180 / 1.33) * (3e8 / (2 * e.bandwidthHz)) / Math.cos(psi);
    return shapeK(psi * 180 / Math.PI, area, e.pol);
  })();
  // MTD cancellation (sea at 5 km, rain at 20 km), or the fixed value
  const canc = e.cancelPhys ? (() => { const f = cancelFns(chain.link, e); return { sea: f.sea(5e3), rain: f.rain(20e3) }; })()
    : { sea: e.cancelDb, rain: Math.max(0, e.cancelDb - 15) };
  const trapped = sea.duct.heightM > 0 && sim.f > sea.duct.minFreqHz;
  const radarInDuct = r.hRadarM < sea.duct.heightM * 2;

  return (
    <main className="grid env-grid">
      {/* ───────── controls ───────── */}
      <div className="col">
        <Panel title={tr('Escenario', 'Scenario')}>
          <div className="chips">
            {SCENARIOS().map(s => <button key={s.id} className="chip" onClick={() => applyScenario(s)}>{s.label}<small>{s.title}</small></button>)}
          </div>
        </Panel>

        <Panel title={tr('Viento y mar', 'Wind and sea')} hint={`Beaufort ${beaufort(e.windMs)} · Douglas ${sea.ss}`}>
          <Slider label={tr('Viento', 'Wind')} value={e.windMs} min={0} max={30} step={0.5} onChange={v => p.updEnv({ windMs: v })} fmt={v => `${fmt(v, 1)} m/s · ${fmt(v * 1.944, 0)} kn`} />
          <Slider label={tr('Viento desde', 'Wind from')} value={e.windDirDeg} min={0} max={359} step={1} onChange={v => p.updEnv({ windDirDeg: v })} fmt={v => `${fmt(v, 0)}° ${cardinal(v)}`} />
          <Slider label={tr('Mar de fondo · altura', 'Swell · height')} value={e.swellHm} min={0} max={6} step={0.1} onChange={v => p.updEnv({ swellHm: v })} fmt={v => `${fmt(v, 1)} m`} />
          <Slider label={tr('Mar de fondo · periodo', 'Swell · period')} value={e.swellTs} min={6} max={18} step={0.5} onChange={v => p.updEnv({ swellTs: v })} fmt={v => `${fmt(v, 1)} s`} />
          <Slider label={tr('Mar de fondo desde', 'Swell from')} value={e.swellDirDeg} min={0} max={359} step={1} onChange={v => p.updEnv({ swellDirDeg: v })} fmt={v => `${fmt(v, 0)}° ${cardinal(v)}`} />
        </Panel>

        <Panel title={tr('Atmósfera', 'Atmosphere')}>
          <Slider label={tr('Humedad relativa', 'Relative humidity')} value={e.rhPct} min={10} max={100} step={1} onChange={v => p.updEnv({ rhPct: v })} fmt={v => `${v} %`} />
          <Slider label={tr('Temperatura del aire', 'Air temperature')} value={e.tempC} min={-5} max={40} step={0.5} onChange={v => p.updEnv({ tempC: v })} fmt={v => `${fmt(v, 1)} °C`} />
          <Slider label={tr('Temperatura del agua', 'Sea temperature')} value={e.seaTempC} min={0} max={32} step={0.5} onChange={v => p.updEnv({ seaTempC: v })} fmt={v => `${fmt(v, 1)} °C`} />
          <Slider label={tr('Presión', 'Pressure')} value={e.pressHpa} min={960} max={1045} step={1} onChange={v => p.updEnv({ pressHpa: v })} fmt={v => `${v} hPa`} />
          <Slider label={tr('Lluvia', 'Rain')} value={e.rainMmH} min={0} max={50} step={0.5} onChange={v => p.updEnv({ rainMmH: v })} fmt={v => v === 0 ? tr('sin lluvia', 'no rain') : `${fmt(v, 1)} mm/h`} />
          <Toggle label={tr('Capa de inversión (conducto elevado o de superficie)', 'Inversion layer (elevated or surface duct)')} on={e.layerOn} onChange={v => p.updEnv({ layerOn: v })} />
          {e.layerOn && <>
            <Slider label={tr('Base de la capa', 'Layer base')} value={e.layerBaseM} min={0} max={600} step={10} onChange={v => p.updEnv({ layerBaseM: v })} fmt={v => `${v} m`} />
            <Slider label={tr('Espesor', 'Thickness')} value={e.layerThickM} min={10} max={200} step={5} onChange={v => p.updEnv({ layerThickM: v })} fmt={v => `${v} m`} />
            <Slider label={tr('Caída de M en la capa', 'M deficit in the layer')} value={e.layerDeficitM} min={0} max={80} step={1} onChange={v => p.updEnv({ layerDeficitM: v })} fmt={v => `${v} M · ${e.layerDeficitM > 0.118 * e.layerBaseM ? tr('llega al mar', 'reaches the sea') : tr('elevado', 'elevated')}`} />
            {!e.propPE && <p className="note">{tr('La capa solo actúa con la ecuación parabólica activada.', 'The layer only acts with the parabolic equation enabled.')}</p>}
          </>}
        </Panel>

        <Panel title={tr('Buque', 'Ship')}>
          <Slider label={tr('Rumbo', 'Heading')} value={e.headingDeg} min={0} max={359} step={1} onChange={v => p.updEnv({ headingDeg: v })} fmt={v => `${fmt(v, 0)}° ${cardinal(v)}`} />
          <Slider label={tr('Velocidad', 'Speed')} value={e.speedKn} min={0} max={30} step={1} onChange={v => p.updEnv({ speedKn: v })} fmt={v => `${v} kn`} />
          <Toggle label={tr('Aletas estabilizadoras', 'Stabilizer fins')} on={e.finStab} onChange={v => p.updEnv({ finStab: v })} />
          <Toggle label={tr('Estabilización electrónica del haz', 'Electronic beam stabilization')} on={e.beamStab} onChange={v => p.updEnv({ beamStab: v })} />
          <p className="note">{tr('El haz apunta a', 'The beam points')} {fmt(beam.azDeg, 0)}° {tr('de la proa (cara frontal). Sin estabilizar, la actitud del buque desvía el haz en elevación.', 'off the bow (front face). Without stabilization, ship attitude deflects the beam in elevation.')}</p>
        </Panel>

        <Panel title={tr('Radar frente al entorno', 'Radar versus environment')}>
          <Seg label={tr('Polarización', 'Polarization')} value={e.pol} onChange={v => p.updEnv({ pol: v })} options={[{ v: 'H', label: 'horizontal' }, { v: 'V', label: 'vertical' }]} />
          <Slider label={tr('Ancho de banda', 'Bandwidth')} value={e.bandwidthHz / 1e6} min={0.5} max={50} step={0.5} onChange={v => p.updEnv({ bandwidthHz: v * 1e6 })} fmt={v => `${fmt(v, 1)} MHz · ${fmt(150 / v, 0)} m`} />
          <Toggle label={tr('Cancelación calculada (MTD)', 'Computed cancellation (MTD)')} on={e.cancelPhys} onChange={v => p.updEnv({ cancelPhys: v })} />
          {e.cancelPhys ? <>
            <Seg label={tr('Oscilador', 'Oscillator')} value={e.osc} onChange={v => p.updEnv({ osc: v })} options={[{ v: 'bueno', label: tr('bueno', 'good') }, { v: 'tipico', label: tr('típico', 'typical') }, { v: 'pobre', label: tr('pobre', 'poor') }]} />
            <Slider label={tr('Inestabilidad del transmisor', 'Transmitter instability')} value={e.jitterDeg} min={0} max={1} step={0.01} onChange={v => p.updEnv({ jitterDeg: v })} fmt={v => `${fmt(v, 2)}° rms`} />
          </> : <Slider label={tr('Cancelación de clutter (fija)', 'Clutter cancellation (fixed)')} value={e.cancelDb} min={0} max={60} step={1} onChange={v => p.updEnv({ cancelDb: v })} fmt={v => `${v} dB`} />}
          <Slider label={tr('Altura del blanco', 'Target height')} value={r.hTargetM} min={2} max={15000} step={1} onChange={v => p.updRadar({ hTargetM: v })} fmt={v => `${fmt(v, 0)} m`} />
          <Slider label="RCS" value={10 * Math.log10(r.rcsM2)} min={-30} max={30} step={1} onChange={v => p.updRadar({ rcsM2: Math.pow(10, v / 10) })} fmt={v => `${fmt(v, 0)} dBsm`} />
          <Slider label={tr('Altura de la antena', 'Antenna height')} value={r.hRadarM} min={5} max={40} step={1} onChange={v => p.updRadar({ hRadarM: v })} fmt={v => `${v} m`} />
        </Panel>
      </div>

      {/* ───────── scene and propagation ───────── */}
      <div className="col">
        <section className="panel stage">
          <Radar3D face={sim.face} g={sim.g} w={sim.wRx} failed={p.failed} u0={sim.u0} v0={sim.v0}
            hpbwDeg={hpbwAz} showBeam autoRotate={autoRotate} allFacesLive={false} technical={false} env={e} className="env3d" />
          <div className="stage-ctl">
            <Toggle label={tr('Giro automático', 'Auto-rotate')} on={autoRotate} onChange={setAutoRotate} />
          </div>
        </section>

        <Panel title={tr('Diagrama de cobertura vertical', 'Vertical coverage diagram')} hint={
          <span className="hint-ctl">
            <Seg value={hMaxSel} onChange={setHMaxSel} options={[{ v: 'auto', label: 'auto' }, { v: 300, label: '300 m' }, { v: 3000, label: '3 km' }, { v: 15000, label: '15 km' }]} />
          </span>}>
          <CoverageView job={covJob} reqDb={chain.reqDb} hTarget={r.hTargetM} />
          <Toggle label={tr('Barrido en elevación (un haz por elevación)', 'Elevation scan (one beam per elevation)')} on={envelope} onChange={setEnvelope} />
          <Toggle label={tr('Ecuación parabólica (difracción y conducto)', 'Parabolic equation (diffraction and ducting)')} on={e.propPE} onChange={v => p.updEnv({ propPE: v })} />
          <Toggle label={tr('Clutter de mar K (espigas)', 'K-distributed sea clutter (spikes)')} on={e.clutterK} onChange={v => p.updEnv({ clutterK: v })} />
          <p className="note">{tr('Lóbulos de interferencia entre el rayo directo y el reflejado en el mar (dos rayos sobre tierra de radio', 'Interference lobes between the direct and the sea-reflected ray (two-ray over an Earth of radius')} {fmt(sea.kf.k, 2)}·a).
            {e.propPE ? tr(' Cerca y más allá del horizonte, por debajo de 1 km, manda la ecuación parabólica: difracción y conducto de evaporación.', ' Near and beyond the horizon, below 1 km, the parabolic equation takes over: diffraction and evaporation duct.') : tr(' Sin la ecuación parabólica la señal cae a cero en el horizonte geométrico.', ' Without the parabolic equation the signal drops to zero at the geometric horizon.')}
            {tr(' Con el barrido desactivado se usa solo el haz actual de la pestaña Antena. La línea blanca es el umbral de detección', ' With the scan disabled, only the current beam of the Antenna tab is used. The white line is the detection threshold')} (Pd = {fmt(r.pdReq, 2)}, Swerling 1).</p>
        </Panel>

        <Panel title={tr('SNR, clutter y SINR frente a distancia', 'SNR, clutter and SINR versus range')} hint={`${tr('blanco a', 'target at')} ${fmt(r.hTargetM, 0)} m · ${fmt(r.rcsM2, r.rcsM2 < 1 ? 2 : 0)} m²`}>
          <LinePlot
            series={[
              { x: chain.km, y: chain.snrFs, color: '#5c6f86', width: 1.2, dash: [4, 4], label: tr('SNR espacio libre', 'free-space SNR') },
              { x: chain.km, y: chain.cnr, color: '#ff8f6b', width: 1.3, label: tr('CNR residual', 'residual CNR') },
              { x: chain.km, y: chain.snr, color: '#59d8ff', width: 1.3, label: tr('SNR entorno', 'SNR with environment') },
              { x: chain.km, y: chain.sinr, color: '#ffc061', width: 1.9, label: 'SINR' },
            ]}
            xRange={[0, chain.rMax / 1e3]} yRange={[-20, 70]} xLabel={tr('distancia (km)', 'range (km)')} yLabel="dB" aspect={0.46} xTicks={chain.nTicks} yTicks={9}
            hMarks={[{ at: chain.reqDb, color: '#ffffff99', label: `${tr('umbral', 'threshold')} ${fmt(chain.reqDb)} dB` }]}
            vMarks={[{ at: chain.rHor / 1e3, color: '#ff6b6b', label: tr('horizonte', 'horizon') },
              ...(chain.ruM < chain.rMax ? [{ at: chain.ruM / 1e3, color: '#c99bff', label: tr('R no ambiguo', 'unambiguous R') }] : [])]}
            xFmt={v => fmt(v, 0)} />
        </Panel>

        <Panel title={tr('Factor de propagación', 'Propagation factor')} hint={tr('F² en dB · 0 dB = espacio libre · +6 dB = refuerzo máximo', 'F² in dB · 0 dB = free space · +6 dB = maximum enhancement')}>
          <LinePlot
            series={[{ x: chain.km, y: chain.Fdb, color: '#7be0b0', width: 1.4 }]}
            xRange={[0, chain.rMax / 1e3]} yRange={[-40, 10]} xLabel={tr('distancia (km)', 'range (km)')} yLabel="dB" aspect={0.3} xTicks={chain.nTicks} yTicks={5}
            hMarks={[{ at: 0, color: '#ffffff55' }]}
            vMarks={[{ at: chain.rHor / 1e3, color: '#ff6b6b' }]}
            xFmt={v => fmt(v, 0)} />
        </Panel>
      </div>

      {/* ───────── results ───────── */}
      <div className="col col-right">
        <Panel title={tr('Situación', 'Conditions')} pad={false}>
          <div className="rose-wrap">
            <WindRose e={e} />
            <div className="rose-txt">
              <b>{dict(DOUGLAS_NAME[sea.ss], ENGINE_EN)}</b>
              <span>Hs {fmt(sea.hs, 1)} m · Tp {fmt(sea.ws.tp, 1)} s</span>
              <span>{tr('visibilidad', 'visibility')} {fmt(sea.vis, sea.vis < 10 ? 1 : 0)} km</span>
              <span>{e.rainMmH > 0 ? `${tr('lluvia', 'rain')} ${fmt(e.rainMmH, 1)} mm/h` : tr('sin precipitación', 'no precipitation')}</span>
            </div>
          </div>
        </Panel>

        <Panel title={tr('Detección con entorno', 'Detection with environment')} pad={false}>
          <div className="metrics">
            <Metric k={tr('alcance espacio libre', 'free-space range')} v={fmt(chain.rFs / 1e3, 0)} unit="km" />
            <Metric k={tr('primera detección', 'first detection')} v={fmt(chain.rFirst / 1e3, 0)} unit="km" tone={chain.rFirst < 0.6 * Math.min(chain.rFs, chain.rHor) ? 'warn' : 'good'} />
            <Metric k={tr('cobertura continua', 'continuous coverage')} v={fmt(chain.rCont / 1e3, 0)} unit="km" tone={chain.gaps > 0 ? 'warn' : undefined} />
            <Metric k={tr('huecos por nulos', 'gaps from nulls')} v={String(chain.gaps)} tone={chain.gaps > 0 ? 'bad' : 'good'} />
            <Metric k={tr('horizonte (k actual)', 'horizon (current k)')} v={fmt(chain.rHor / 1e3, 0)} unit="km" />
            <Metric k={tr('umbral SNR', 'SNR threshold')} v={fmt(chain.reqDb)} unit="dB" />
          </div>
        </Panel>

        <Panel title={tr('Movimiento del buque', 'Ship motion')} hint={e.finStab ? tr('con aletas', 'with fins') : tr('sin aletas', 'without fins')} pad={false}>
          <div className="metrics">
            <Metric k={tr('balance (sig.)', 'roll (sig.)')} v={'±' + fmt(motion.rollSigDeg, 1)} unit="°" tone={motion.rollSigDeg > 10 ? 'bad' : motion.rollSigDeg > 4 ? 'warn' : undefined} />
            <Metric k={tr('cabeceo (sig.)', 'pitch (sig.)')} v={'±' + fmt(motion.pitchSigDeg, 1)} unit="°" />
            <Metric k={tr('arfada (sig.)', 'heave (sig.)')} v={'±' + fmt(motion.heaveSigM, 1)} unit="m" />
            <Metric k={tr('periodo de balance', 'roll period')} v={fmt(motion.rollPeakPeriodS, 1)} unit="s" />
            <Metric k={tr('error de apuntamiento', 'pointing error')} v={fmt(errRms, 2)} unit="° rms" tone={errRms > hpbwEl / 4 ? 'bad' : errRms > hpbwEl / 10 ? 'warn' : 'good'} />
            <Metric k={tr('pérdida de apuntamiento', 'pointing loss')} v={fmt(ptLoss, 2)} unit="dB" tone={ptLoss > 1 ? 'bad' : ptLoss > 0.2 ? 'warn' : 'good'} />
          </div>
          <div className="body">
            <LinePlot
              series={[
                { x: motionSeries.t, y: motionSeries.roll, color: '#59d8ff', width: 1.4, label: tr('balance', 'roll') },
                { x: motionSeries.t, y: motionSeries.pitch, color: '#ffc061', width: 1.4, label: tr('cabeceo', 'pitch') },
              ]}
              xRange={[0, 120]} yRange={[-motionSeries.lim, motionSeries.lim]} xLabel={tr('tiempo (s)', 'time (s)')} yLabel="°" aspect={0.5} xTicks={6} yTicks={4}
              hMarks={e.beamStab ? [] : [{ at: hpbwEl / 2, color: '#ff6b6b88', label: 'θ₃/2' }, { at: -hpbwEl / 2, color: '#ff6b6b88' }]} />
            <p className="note">{tr('Sin estabilizar, el error en elevación sería de', 'Without stabilization, the elevation error would be')} {fmt(errRaw, 2)}° rms {tr('frente a un haz de', 'against a beam of')} {fmt(hpbwEl, 2)}°.</p>
          </div>
        </Panel>

        <Panel title={tr('Refracción y atmósfera', 'Refraction and atmosphere')} pad={false}>
          <div className="metrics">
            <Metric k={tr('refractividad Ns', 'refractivity Ns')} v={fmt(sea.Ns, 0)} unit="N" />
            <Metric k={tr('factor k', 'k factor')} v={fmt(sea.kf.k, 2)} tone={sea.kf.k > 1.6 ? 'warn' : undefined} />
            <Metric k={tr('conducto evaporación', 'evaporation duct')} v={fmt(sea.duct.heightM, 1)} unit="m" tone={trapped && radarInDuct ? 'warn' : undefined} />
            <Metric k={tr('banda S atrapada', 'S-band trapped')} v={trapped ? tr('sí', 'yes') : 'no'} tone={trapped ? 'warn' : undefined} />
            <Metric k={tr('gases (ida)', 'gases (one-way)')} v={fmt((sea.gas.o2 + sea.gas.h2o) * 1e3, 1)} unit="mdB/km" />
            <Metric k={tr('lluvia (ida)', 'rain (one-way)')} v={fmt(sea.rain * 1e3, 1)} unit="mdB/km" tone={sea.rain > 0.01 ? 'warn' : undefined} />
            <Metric k={tr('humedad absoluta', 'absolute humidity')} v={fmt(sea.rho, 1)} unit="g/m³" />
            <Metric k={tr('σ⁰ a 1° (mar)', 'σ⁰ at 1° (sea)')} v={fmt(seaSigma0Db(1, sim.f, sea.ss, e.pol), 1)} unit="dB" />
            <Metric k={tr('forma K del mar a 5 km', 'sea K shape at 5 km')} v={fmt(kAt5km, 2)} unit="ν" tone={e.clutterK && kAt5km < 1 ? 'warn' : undefined} />
            <Metric k={tr('cancelación mar a 5 km', 'sea cancellation at 5 km')} v={fmt(canc.sea, 1)} unit="dB" />
            <Metric k={tr('cancelación lluvia a 20 km', 'rain cancellation at 20 km')} v={fmt(canc.rain, 1)} unit="dB" tone={canc.rain < 35 ? 'warn' : undefined} />
          </div>
          {trapped && <div className="body"><p className="note" style={{ margin: 0 }}>
            {tr('Con', 'With a')} {fmt(sea.duct.heightM, 0)} {tr('m de conducto la banda S queda atrapada', 'm duct, S-band is trapped')} (f {tr('mín', 'min')} ≈ {fmt(sea.duct.minFreqHz / 1e9, 2)} GHz):{' '}
            {tr('blancos y antena dentro del conducto pueden verse más allá del horizonte.', 'targets and antenna inside the duct can see beyond the horizon.')} {e.propPE ? tr('La ecuación parabólica lo incluye en las curvas y en la cobertura.', 'The parabolic equation includes it in the curves and the coverage.') : tr('Activa la ecuación parabólica para incluirlo.', 'Enable the parabolic equation to include it.')}</p></div>}
        </Panel>

        <Panel title={tr('Reflectividad del mar', 'Sea reflectivity')} hint={`${tr('modelo NRL', 'NRL model')} · Douglas ${sea.ss}`}>
          <LinePlot
            series={[
              { x: sigma0.x, y: sigma0.h, color: '#59d8ff', width: 1.5, label: 'HH' },
              { x: sigma0.x, y: sigma0.v, color: '#ffc061', width: 1.5, label: 'VV' },
            ]}
            xRange={[-1, 1.5]} yRange={[-80, -10]} xLabel={tr('ángulo rasante (°)', 'grazing angle (°)')} yLabel="σ⁰ dB" aspect={0.55} xTicks={5} yTicks={7}
            xFmt={v => { const g = Math.pow(10, v); return g < 1 ? fmt(g, 1) : fmt(g, 0); }} />
        </Panel>

        <Panel title={tr('Modelos', 'Models')}>
          <ul className="model-list">
            <li><b>{tr('Mar', 'Sea')}</b> {tr('Pierson-Moskowitz desarrollado + mar de fondo; escalas Douglas y Beaufort.', 'Fully developed Pierson-Moskowitz + swell; Douglas and Beaufort scales.')}</li>
            <li><b>{tr('Buque', 'Ship')}</b> {tr('RAO de un grado de libertad por componente, frecuencia de encuentro, fragata de 140 m.', 'Single-degree-of-freedom RAO per component, encounter frequency, 140 m frigate.')}</li>
            <li><b>{tr('Refracción', 'Refraction')}</b> {tr('ITU-R P.453 y modelo exponencial CRPL; conducto de evaporación en estabilidad neutra.', 'ITU-R P.453 and CRPL exponential model; evaporation duct under neutral stability.')}</li>
            <li><b>{tr('Atenuación', 'Attenuation')}</b> {tr('ITU-R P.676 (gases) y P.838-3 (lluvia).', 'ITU-R P.676 (gases) and P.838-3 (rain).')}</li>
            <li><b>Clutter</b> {tr('mar NRL (2012) en celda limitada por pulso; lluvia Marshall-Palmer en', 'NRL (2012) sea in a pulse-limited cell; Marshall-Palmer rain over')} {fmt(25, 0)} km.</li>
            <li><b>{tr('Clutter K', 'K clutter')}</b> {tr('forma ν de Ward, Tough y Watts y pérdida del CA-CFAR por las espigas del mar, de un Monte Carlo en MATLAB con 3·10⁷ celdas.', 'Ward, Tough and Watts ν shape and CA-CFAR loss due to sea spikes, from a MATLAB Monte Carlo with 3·10⁷ cells.')}</li>
            <li><b>{tr('Cancelación', 'Cancellation')}</b> {tr('fuga del clutter a las celdas Doppler del MTD: espectro gaussiano del mar y de la lluvia a través de la ventana, ruido de fase del oscilador decorrelado con el retardo e inestabilidad del transmisor; validada frente a la cadena I/Q de MATLAB.', 'clutter leakage into the MTD Doppler cells: Gaussian sea and rain spectra through the window, oscillator phase noise decorrelated with delay, and transmitter instability; validated against the MATLAB I/Q chain.')}</li>
            <li><b>{tr('Multitrayecto', 'Multipath')}</b> {tr('dos rayos sobre tierra esférica (Blake), Fresnel del agua de mar y rugosidad de Ament.', 'two-ray over a spherical Earth (Blake), seawater Fresnel coefficients and Ament roughness.')}</li>
            <li><b>{tr('Difracción y conductos', 'Diffraction and ducting')}</b> {tr('ecuación parabólica de ángulo ancho (split-step Fourier) sobre mar real (Fresnel H o V y rugosidad de Ament por el método de la imagen espectral), con conducto de evaporación de Paulus-Jeske y capa de inversión trilineal; validada frente a ITU-R P.526 y al dos rayos exacto.', 'wide-angle parabolic equation (split-step Fourier) over a real sea (H or V Fresnel and Ament roughness via the spectral image method), with Paulus-Jeske evaporation duct and trilinear inversion layer; validated against ITU-R P.526 and the exact two-ray model.')}</li>
          </ul>
        </Panel>
      </div>
    </main>
  );
}

const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const cardinal = (d: number) => CARD[Math.round(((d % 360) + 360) % 360 / 45) % 8];

/** Rose: ship heading, wind, and swell (true directions, north up). */
function WindRose({ e }: { e: EnvConfig }) {
  const S = 150, c = S / 2, R = 58;
  const pt = (deg: number, r: number) => [c + r * Math.sin(deg * Math.PI / 180), c - r * Math.cos(deg * Math.PI / 180)];
  const arrowFrom = (deg: number, color: string, w: number) => {
    // arrow pointing from the "coming from" direction toward the center
    const [x0, y0] = pt(deg, R + 4), [x1, y1] = pt(deg, 18);
    const a = (deg + 180) * Math.PI / 180;
    const hx = Math.sin(a), hy = -Math.cos(a);
    return (
      <g stroke={color} fill={color} strokeWidth={w} strokeLinecap="round">
        <line x1={x0} y1={y0} x2={x1} y2={y1} />
        <path d={`M${x1 + hx * 2},${y1 + hy * 2} L${x1 - hx * 7 - hy * 4},${y1 - hy * 7 + hx * 4} L${x1 - hx * 7 + hy * 4},${y1 - hy * 7 - hx * 4} Z`} stroke="none" />
      </g>
    );
  };
  const hd = e.headingDeg * Math.PI / 180;
  const ship = (dx: number, dy: number) => [c + dx * Math.cos(hd) - dy * Math.sin(hd), c + dx * Math.sin(hd) + dy * Math.cos(hd)];
  const hull = [[0, -24], [7, -8], [7, 18], [-7, 18], [-7, -8]].map(([x, y]) => ship(x, y).join(',')).join(' ');
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="rose" aria-label={tr('rosa de vientos', 'wind rose')}>
      <circle cx={c} cy={c} r={R} className="rose-ring" />
      <circle cx={c} cy={c} r={R * 0.55} className="rose-ring faint" />
      {CARD.map((n, i) => { const [x, y] = pt(i * 45, R + 11); return <text key={n} x={x} y={y + 3} textAnchor="middle" className={i === 0 ? 'rose-n' : 'rose-l'}>{n}</text>; })}
      <polygon points={hull} className="rose-ship" />
      {e.swellHm > 0.05 && arrowFrom(e.swellDirDeg, '#7be0b0', 2)}
      {e.windMs > 0.2 && arrowFrom(e.windDirDeg, '#59d8ff', 2.4)}
    </svg>
  );
}
