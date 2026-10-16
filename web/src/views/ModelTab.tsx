import { useEffect, useMemo, useRef, useState } from 'react';
import { C0, type BeamConfig, type FaceConfig, type RadarParams } from '../engine/config';
import { computeWeights } from '../engine/array';
import { FacePresets } from './FacePresets';
import type { Sim } from '../App';
import { Panel, Seg, Slider, Toggle, fmt } from '../ui/controls';
import { getLang, tr } from '../i18n';
import { Radar3D, type ScanDrive } from './Radar3D';
import type { EnvConfig } from '../engine/environment';
import { ScanClock, apertureTable, scanPlan, type ScanConfig } from '../engine/scan';
import { PolarPatterns, ScanTimeline, Waveform, type LiveScan } from './ScanViews';

type Speed = 'rt' | 'q' | 's' | 'pause';
const SPEED: Record<Speed, number> = { rt: 1, q: 0.25, s: 0.05, pause: 0 };

export function ModelTab(p: {
  beam: BeamConfig; sim: Sim; failed: Uint8Array; radar: RadarParams;
  updBeam: (p: Partial<BeamConfig>) => void; updFace: (p: Partial<FaceConfig>) => void; randomFail: (pct: number) => void; clearFail: () => void;
  env: EnvConfig;
}) {
  const { beam, sim, radar } = p;
  const face = sim.face;
  const [showBeam, setShowBeam] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [allLive, setAllLive] = useState(false);
  const [technical, setTechnical] = useState(false);
  // scan
  const [scanOn, setScanOn] = useState(true);
  const [speed, setSpeed] = useState<Speed>('q');
  const [azSpan, setAzSpan] = useState(45);
  const [nBars, setNBars] = useState(2);
  const [stepK, setStepK] = useState(0.9);
  const g = sim.g;

  const clock = useRef(new ScanClock()).current;
  useEffect(() => { clock.set(SPEED[speed] || 1, speed === 'pause'); }, [speed, clock]);

  const hpbwAz = Math.max(sim.mAz.hpbwDeg, 0.3), hpbwEl = Math.max(sim.mEl.hpbwDeg, 0.3);
  const cfg = useMemo<ScanConfig>(() => ({
    azSpanDeg: azSpan, azStepDeg: Math.max(0.2, stepK * hpbwAz),
    elBarsDeg: Array.from({ length: nBars }, (_, i) => i * hpbwEl),
    pulses: radar.nPulses, priS: 1 / radar.prfHz, tauS: Math.min(radar.tauS, 0.5 / radar.prfHz), bwHz: p.env.bandwidthHz,
  }), [azSpan, stepK, hpbwAz, hpbwEl, nBars, radar.nPulses, radar.tauS, radar.prfHz, p.env.bandwidthHz]);
  const plan = useMemo(() => scanPlan(cfg), [cfg]);

  // unsteered pattern of each face: face 0 with its failures, the rest healthy
  const { wBroad, tables } = useMemo(() => {
    const b0 = { ...beam, azDeg: 0, elDeg: 0, freqOffsetHz: 0 };
    const w0 = computeWeights(face, g, b0, p.failed);
    const t0 = apertureTable(g, w0, face.f0);
    const anyFail = p.failed.some(x => x);
    const t1 = anyFail && !allLive ? apertureTable(g, computeWeights(face, g, b0, new Uint8Array(g.N)), face.f0) : t0;
    return { wBroad: w0, tables: [t0, t1, t1, t1] };
  }, [beam, face, g, p.failed, allLive]);

  const drive = useMemo<ScanDrive | null>(() => scanOn ? { clock, plan, cfg } : null, [scanOn, clock, plan, cfg]);
  const live = useMemo<LiveScan>(() => ({
    clock, plan, cfg, tables, active: scanOn, manual: { azDeg: beam.azDeg, elDeg: beam.elDeg },
  }), [clock, plan, cfg, tables, scanOn, beam.azDeg, beam.elDeg]);

  return (
    <main className="grid-3d">
      <div className="main3d">
        <section className="stage">
          <Radar3D face={face} g={g} w={sim.wRx} failed={p.failed} u0={sim.u0} v0={sim.v0} className="model3d"
            hpbwDeg={Math.max(sim.mAz.hpbwDeg, 0.5)} showBeam={showBeam} autoRotate={autoRotate} allFacesLive={allLive}
            technical={technical} env={p.env} scan={drive} wBroad={wBroad} />
          <div className="tag">{tr('arrastra para girar · rueda para zoom · clic derecho para desplazar', 'drag to rotate · wheel to zoom · right-click to pan')}</div>
        </section>

        <div className="live-strip">
          <Panel title={tr('Diagrama de las 4 caras', 'Pattern of the 4 faces')} hint={tr('acimut · dB rel. pico', 'azimuth · dB rel. peak')} collapsible={false}>
            <PolarPatterns live={live} />
          </Panel>
          <Panel title={tr('Cronograma del barrido', 'Scan timeline')} hint={scanOn ? `×${SPEED[speed] || 0}` : tr('haces fijos', 'fixed beams')} collapsible={false}>
            <ScanTimeline live={live} />
          </Panel>
          <Panel title={tr('Señal transmitida', 'Transmitted signal')} hint="chirp LFM" collapsible={false}>
            <Waveform live={live} />
          </Panel>
        </div>
      </div>

      <div className="col">
        <Panel title={tr('Escaneo de búsqueda', 'Search scan')}>
          <Toggle label={tr('Las 4 caras barriendo', 'All 4 faces scanning')} on={scanOn} onChange={setScanOn} />
          <Seg label={tr('Velocidad', 'Speed')} value={speed} onChange={setSpeed}
            options={[{ v: 'rt', label: tr('real', 'real time') }, { v: 'q', label: '¼' }, { v: 's', label: '1/20' }, { v: 'pause', label: tr('pausa', 'pause') }]} />
          <Slider label={tr('Sector por cara', 'Sector per face')} value={azSpan} min={10} max={60} step={1} onChange={setAzSpan} fmt={v => `±${v}°`} />
          <Slider label={tr('Paso entre haces', 'Beam spacing')} value={stepK} min={0.5} max={1.5} step={0.05} onChange={setStepK} fmt={v => `${fmt(v, 2)}·θ₃ = ${fmt(v * hpbwAz, 2)}°`} />
          <Slider label={tr('Barras de elevación', 'Elevation bars')} value={nBars} min={1} max={6} step={1} onChange={setNBars} fmt={v => `${v} · ${tr('hasta', 'up to')} ${fmt((v - 1) * hpbwEl, 1)}°`} />
          <p className="note">
            PRI {fmt(cfg.priS * 1e3, 2)} ms · {cfg.pulses} {tr('pulsos por posición y PRF de la pestaña Radar', 'pulses per position and PRF from the Radar tab')} · {plan.pos.length} {tr('posiciones', 'positions')} ·
            {tr('refresco', 'frame time')} {fmt(plan.frameS, 2)} {tr('s por cara. El diagrama se desplaza en espacio seno con desfasadores ideales.', 's per face. The pattern shifts in sine space with ideal phase shifters.')}
          </p>
        </Panel>

        <Panel title={tr('Apuntamiento manual · cara frontal', 'Manual steering · front face')} defaultOpen={!scanOn}>
          <Slider label={tr('Acimut', 'Azimuth')} value={beam.azDeg} min={-60} max={60} step={0.5} onChange={v => p.updBeam({ azDeg: v })} fmt={v => fmt(v) + '°'} />
          <Slider label={tr('Elevación', 'Elevation')} value={beam.elDeg} min={-30} max={60} step={0.5} onChange={v => p.updBeam({ elDeg: v })} fmt={v => fmt(v) + '°'} />
          <div className="row">
            <button className="btn" onClick={() => p.randomFail(8)}>{tr('Fallos 8 %', '8 % failures')}</button>
            <button className="btn" onClick={p.clearFail}>{tr('Reparar', 'Repair')}</button>
          </div>
          {scanOn && <p className="note">{tr('Con el escaneo activo manda el plan de barrido; desactívalo para apuntar a mano.', 'With scanning active the scan plan is in control; turn it off to steer manually.')}</p>}
        </Panel>

        <Panel title={tr('Tamaño de la cara', 'Face size')}>
          <FacePresets face={face} updFace={p.updFace} />
          <p className="note" style={{ marginTop: 0 }}>{g.N.toLocaleString(getLang() === 'en' ? 'en-US' : 'es-ES')} {tr('elementos · el mástil se dimensiona con la cara · la figura naranja mide 1,8 m.', 'elements · the mast scales with the face · the orange figure is 1.8 m tall.')}</p>
        </Panel>

        <Panel title={tr('Vista', 'View')}>
          <Toggle label={tr('Modo técnico (sin radomo)', 'Technical mode (no radome)')} on={technical} onChange={setTechnical} />
          <Toggle label={tr('Giro automático', 'Auto-rotate')} on={autoRotate} onChange={setAutoRotate} />
          <Toggle label={tr('Mostrar haces', 'Show beams')} on={showBeam} onChange={setShowBeam} />
          <Toggle label={tr('Las 4 caras con la misma ley', 'All 4 faces with the same law')} on={allLive} onChange={setAllLive} />
          <p className="note">{technical ? '' : tr('Activa el modo técnico para ver los elementos. ', 'Turn on technical mode to see the elements. ')}{tr('El color de cada elemento es la fase del desfasador y su brillo la amplitud del taper; en rojo, módulos T/R caídos. La anchura de los haces está exagerada ×4.', 'Each element colour is the phase-shifter phase and its brightness the taper amplitude; failed T/R modules in red. Beamwidths are exaggerated ×4.')}</p>
        </Panel>

        <Panel title={tr('Ficha · sistema genérico', 'Datasheet · generic system')} defaultOpen={false}>
          <dl className="spec">
            <dt>{tr('banda', 'band')}</dt><dd>S · {fmt(face.f0 / 1e9, 1)} GHz</dd>
            <dt>{tr('caras', 'faces')}</dt><dd>{tr('4 fijas · cobertura 360°', '4 fixed · 360° coverage')}</dd>
            <dt>{tr('apertura por cara', 'aperture per face')}</dt><dd>{fmt(g.Nx * g.d, 2)} × {fmt(g.Ny * g.d, 2)} m</dd>
            <dt>{tr('elementos por cara', 'elements per face')}</dt><dd>{g.N.toLocaleString(getLang() === 'en' ? 'en-US' : 'es-ES')}</dd>
            <dt>{tr('subarrays por cara', 'subarrays per face')}</dt><dd>{face.nSubX * face.nSubY} {tr('de', 'of')} {face.subNx}×{face.subNy}</dd>
            <dt>{tr('espaciado', 'spacing')}</dt><dd>{fmt(g.d * 100, 1)} cm (λ/{fmt(C0 / face.f0 / g.d, 0)})</dd>
            <dt>{tr('inclinación de cara', 'face tilt')}</dt><dd>12°</dd>
            <dt>HPBW</dt><dd>{fmt(sim.mAz.hpbwDeg, 2)}° × {fmt(sim.mEl.hpbwDeg, 2)}°</dd>
            <dt>G rx</dt><dd>{fmt(sim.grSteerDbi)} dBi</dd>
          </dl>
          <p className="note">{tr('Modelo esquemático con parámetros supuestos. No representa a ningún sistema real.', 'Schematic model with assumed parameters. It does not represent any real system.')}</p>
        </Panel>
      </div>
    </main>
  );
}
