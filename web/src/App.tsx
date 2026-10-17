import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_BEAM, DEFAULT_FACE, DEFAULT_RADAR, faceGeometry,
  type BeamConfig, type FaceConfig, type RadarParams,
} from './engine/config';
import { computeWeights, steerUV } from './engine/array';
import { azimuthCut, elevationCut, gainAt, uvMap } from './engine/pattern';
import { cutMetrics, sll2D } from './engine/metrics';
import { AntennaTab } from './views/AntennaTab';
import { RadarTab } from './views/RadarTab';
import { ModelTab } from './views/ModelTab';
import { EnvironmentTab } from './views/EnvironmentTab';
const SignalTab = lazy(() => import('./views/SignalTab').then(m => ({ default: m.SignalTab })));
const ExperimentsTab = lazy(() => import('./views/ExperimentsTab').then(m => ({ default: m.ExperimentsTab })));
const ValidationTab = lazy(() => import('./views/ValidationTab').then(m => ({ default: m.ValidationTab })));
import { DEFAULT_ENV, type EnvConfig } from './engine/environment';
import { DEFAULT_COUPLING, applyCoupling, couplingFor, elementCorrDb, type CouplingConfig } from './engine/coupling';
import { LangSwitch, tr, useLang } from './i18n';
import { DEFAULT_ERRORS, drawErrors, hasErrors, predictErrors, realizeErrors, type HwErrors } from './engine/errors';

export type Tab = 'antenna' | 'radar' | 'env' | 'sig' | 'model' | 'exp' | 'val';
const HASH: Record<Tab, string> = { antenna: '#antena', radar: '#radar', env: '#entorno', model: '#modelo', sig: '#senal', exp: '#experimentos', val: '#validacion' };
const fromHash = (): Tab => (Object.keys(HASH) as Tab[]).find(t => HASH[t] === location.hash) ?? 'antenna';
const TABS = (): { id: Tab; label: string }[] => [
  { id: 'antenna', label: tr('Antena', 'Antenna') }, { id: 'radar', label: 'Radar' }, { id: 'env', label: tr('Entorno', 'Environment') },
  { id: 'sig', label: tr('Señal', 'Signal') }, { id: 'model', label: tr('Modelo 3D', '3D model') },
  { id: 'exp', label: tr('Experimentos', 'Experiments') }, { id: 'val', label: tr('Validación', 'Validation') },
];

/** Everything derived from state (recomputed from the deferred value). */
export function useSimulation(face: FaceConfig, beam: BeamConfig, failed: Uint8Array, hw: HwErrors = DEFAULT_ERRORS, coup: CouplingConfig = DEFAULT_COUPLING) {
  return useMemo(() => {
    const g = faceGeometry(face);
    const f = face.f0 + beam.freqOffsetHz;
    // hardware errors: same realization on receive and transmit (same T/R modules)
    const errsOn = hasErrors(hw) || (hw.dither && beam.psBits > 0);
    const errs = errsOn ? realizeErrors(g, drawErrors(g, face.nSubX * face.nSubY, hw.seed), hw) : null;
    let wRx = computeWeights(face, g, beam, failed, undefined, errs);
    let wTx = computeWeights(face, g, beam, failed, 'uniform', errs);
    // mutual coupling: actual currents replace the commanded weights (A5)
    let coupling = null as null | ReturnType<typeof applyCoupling> & { source: string };
    let couplingTx = null as null | ReturnType<typeof applyCoupling>;
    if (coup.on) {
      const cf = couplingFor(g, face.f0);
      const cal = coup.cal === 'elemento' ? cf.zCal : null;
      const cr = applyCoupling(g, cf.m, wRx.re, wRx.im, cf.zRef, cal);
      const ct = applyCoupling(g, cf.m, wTx.re, wTx.im, cf.zRef, cal);
      coupling = { ...cr, source: cf.m.source }; couplingTx = ct;
      wRx = { re: cr.Ire, im: cr.Iim }; wTx = { re: ct.Ire, im: ct.Iim };
    }
    const wIdeal = errs ? computeWeights(face, g, beam, failed) : wRx;
    const ampIdeal = Float64Array.from(wIdeal.re, (r, i) => Math.hypot(r, wIdeal.im[i]));
    const [u0, v0] = steerUV(beam.azDeg, beam.elDeg);
    const map = uvMap(g, wRx, f, 301);
    const azCut = azimuthCut(g, wRx, f, beam.elDeg, 0.05);
    const elCut = elevationCut(g, wRx, f, u0, 0.05);
    if (coup.on) {
      // real element (dipole over ground plane) instead of cos θ, and realized gain (available power)
      const pr = coupling!.powerRatioDb;
      let pk = -Infinity;
      for (let b = 0; b < map.res; b++) for (let a = 0; a < map.res; a++) {
        const o = b * map.res + a, gv = map.gainDbi[o];
        if (Number.isNaN(gv)) continue;
        const v2 = gv + pr + elementCorrDb(-1 + 2 * a / (map.res - 1), 1 - 2 * b / (map.res - 1));
        map.gainDbi[o] = v2; if (v2 > pk) pk = v2;
      }
      map.peakDbi = pk;
      const ce = Math.cos(beam.elDeg * Math.PI / 180), se = Math.sin(beam.elDeg * Math.PI / 180);
      azCut.angDeg.forEach((a, i) => { azCut.gainDbi[i] += pr + elementCorrDb(ce * Math.sin(a * Math.PI / 180), se); });
      elCut.angDeg.forEach((a, i) => { elCut.gainDbi[i] += pr + elementCorrDb(u0, Math.sin(a * Math.PI / 180)); });
    }
    const U = Float64Array.of(u0), V = Float64Array.of(v0);
    let nActive = 0;
    for (let i = 0; i < g.N; i++) if (!failed[i]) nActive++;
    const grIdealDbi = errs ? gainAt(g, wIdeal, f, U, V)[0] : NaN;
    return {
      face, g, f, wRx, map, azCut, elCut, u0, v0, nActive, hw, errsOn, errs, grIdealDbi,
      pred: predictErrors(g, face, ampIdeal, hw, f, beam.psBits),
      mAz: cutMetrics(azCut), mEl: cutMetrics(elCut),
      sll2d: sll2D(map.gainDbi, map.res),
      grSteerDbi: gainAt(g, wRx, f, U, V)[0] + (coupling ? coupling.powerRatioDb + elementCorrDb(u0, v0) : 0),
      gtSteerDbi: gainAt(g, wTx, f, U, V)[0] + (couplingTx ? couplingTx.powerRatioDb + elementCorrDb(u0, v0) : 0),
      coupling, coup,
      gIdealDbi: 10 * Math.log10(4 * Math.PI * g.N * (face.dLambda * f / face.f0) ** 2),   // uniform aperture, broadside
    };
  }, [face, beam, failed, hw, coup]);
}
export type Sim = ReturnType<typeof useSimulation>;

export default function App() {
  const { lang } = useLang();
  useEffect(() => { document.title = tr('AESA Lab · Radar naval multifunción', 'AESA Lab · Naval multifunction radar'); }, [lang]);
  const [tab, setTabState] = useState<Tab>(fromHash);
  const setTab = (t: Tab) => { setTabState(t); history.replaceState(null, '', HASH[t]); };
  useEffect(() => {
    const on = () => setTabState(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [face, setFace] = useState<FaceConfig>(DEFAULT_FACE);
  const [beam, setBeam] = useState<BeamConfig>(DEFAULT_BEAM);
  const [radar, setRadar] = useState<RadarParams>(DEFAULT_RADAR);
  const [env, setEnv] = useState<EnvConfig>(DEFAULT_ENV);
  const [hw, setHw] = useState<HwErrors>(DEFAULT_ERRORS);
  const dHw = useDeferredValue(hw);
  const updHw = useCallback((p: Partial<HwErrors>) => setHw(h => ({ ...h, ...p })), []);
  const [coup, setCoup] = useState<CouplingConfig>(DEFAULT_COUPLING);
  const dCoup = useDeferredValue(coup);
  const updCoup = useCallback((p: Partial<CouplingConfig>) => setCoup(c => ({ ...c, ...p })), []);
  const dEnv = useDeferredValue(env);
  const [failed, setFailed] = useState<Uint8Array>(() => {
    const g = faceGeometry(DEFAULT_FACE); return new Uint8Array(g.N);
  });

  const dFace = useDeferredValue(face), dBeam = useDeferredValue(beam), dFailed = useDeferredValue(failed);
  const sim = useSimulation(dFace, dBeam, dFailed, dHw, dCoup);
  const busy = dBeam !== beam || dFailed !== failed || dFace !== face || dEnv !== env || dHw !== hw || dCoup !== coup;

  const updBeam = useCallback((p: Partial<BeamConfig>) => setBeam(b => ({ ...b, ...p })), []);
  const updRadar = useCallback((p: Partial<RadarParams>) => setRadar(r => ({ ...r, ...p })), []);
  const updEnv = useCallback((p: Partial<EnvConfig>) => setEnv(e => ({ ...e, ...p })), []);
  const updFace = useCallback((p: Partial<FaceConfig>) => {
    const nf = { ...face, ...p };
    setFace(nf);
    setFailed(new Uint8Array(faceGeometry(nf).N));
  }, [face]);
  const toggle = useCallback((idx: number[], fail: boolean) => {
    setFailed(prev => {
      if (idx.every(i => prev[i] === (fail ? 1 : 0))) return prev;
      const n = prev.slice(); for (const i of idx) n[i] = fail ? 1 : 0; return n;
    });
  }, []);
  const randomFail = useCallback((pct: number) => {
    setFailed(prev => {
      const n = new Uint8Array(prev.length);
      for (let i = 0; i < n.length; i++) n[i] = Math.random() < pct / 100 ? 1 : 0;
      return n;
    });
  }, []);

  const clearFail = () => setFailed(new Uint8Array(failed.length));

  return (
    <>
      <header className={'top' + (busy ? ' busy' : '')}>
        <div className="brand">
          <svg viewBox="0 0 20 20" className="mark" aria-hidden>
            <path d="M10 17 3.5 5.5A8 8 0 0 1 16.5 5.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M10 17 7 6.2M10 17l3-10.8" stroke="currentColor" strokeWidth="1" opacity=".55" />
          </svg>
          <b>AESA Lab</b><span>{tr('Radar naval multifunción · banda S', 'Naval multifunction radar · S-band')}</span>
        </div>
        <nav className="tabs">
          {TABS().map(t => <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </nav>
        <div className="status">{busy ? tr('Calculando…', 'Computing…') : tr('Sistema genérico', 'Generic system')}</div>
        <LangSwitch />
      </header>

      {tab === 'antenna'
        ? <AntennaTab face={face} beam={beam} sim={sim} failed={dFailed}
            updFace={updFace} updBeam={updBeam} toggle={toggle} randomFail={randomFail} clearFail={clearFail}
            hw={hw} updHw={updHw} coup={coup} updCoup={updCoup} />
        : tab === 'radar'
          ? <RadarTab radar={radar} updRadar={updRadar} sim={sim} beam={beam} />
          : tab === 'sig'
            ? <Suspense fallback={<div className="placeholder">{tr('cargando resultados…', 'loading results…')}</div>}><SignalTab /></Suspense>
          : tab === 'exp'
            ? <Suspense fallback={<div className="placeholder">{tr('cargando resultados…', 'loading results…')}</div>}><ExperimentsTab /></Suspense>
          : tab === 'val'
            ? <Suspense fallback={<div className="placeholder">{tr('cargando referencias…', 'loading references…')}</div>}><ValidationTab /></Suspense>
          : tab === 'env'
            ? <EnvironmentTab env={dEnv} updEnv={updEnv} radar={radar} updRadar={updRadar} sim={sim} beam={beam} failed={dFailed} />
            : <ModelTab beam={beam} sim={sim} failed={dFailed} updBeam={updBeam} updFace={updFace} env={dEnv} radar={radar}
                randomFail={randomFail} clearFail={clearFail} />}

      <footer className="foot">
        {tr('Sistema genérico con parámetros supuestos, valores típicos de su clase según bibliografía abierta. '
          + 'No representa a ningún sistema real ni tiene relación con ningún fabricante. Motor verificado frente a '
          + 'la teoría clásica de arrays y frente a MATLAB (pestaña Validación).',
          'Generic system with assumed parameters, typical of its class according to open literature. '
          + 'It does not represent any real system and has no relation to any manufacturer. Engine verified against '
          + 'classical array theory and against MATLAB (Validation tab).')}
      </footer>
    </>
  );
}
