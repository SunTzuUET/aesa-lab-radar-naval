import { useMemo, useState } from 'react';
import { C0, type BeamConfig, type FaceConfig } from '../engine/config';
import type { Sim } from '../App';
import { Metric, Panel, Seg, Slider, Toggle, fmt } from '../ui/controls';
import { UVMapView } from './UVMapView';
import { FaceView } from './FaceView';
import { LinePlot } from './LinePlot';
import { FacePresets } from './FacePresets';
import { DEFAULT_ERRORS, type HwErrors } from '../engine/errors';
import { scanGamma, type CouplingConfig } from '../engine/coupling';
import { monopulse, type MonoAxis } from '../engine/monopulse';
import { tr } from '../i18n';

export function AntennaTab(p: {
  face: FaceConfig; beam: BeamConfig; sim: Sim; failed: Uint8Array;
  updFace: (p: Partial<FaceConfig>) => void; updBeam: (p: Partial<BeamConfig>) => void;
  toggle: (idx: number[], fail: boolean) => void; randomFail: (pct: number) => void; clearFail: () => void;
  hw: HwErrors; updHw: (p: Partial<HwErrors>) => void;
  coup: CouplingConfig; updCoup: (p: Partial<CouplingConfig>) => void;
}) {
  const { face, beam, sim } = p;
  const [zoom, setZoom] = useState(false);
  const [failPct, setFailPct] = useState(5);
  const g = sim.g;
  const scan = useMemo(() => p.coup.on ? scanGamma(g, face.f0) : null, [p.coup.on, g, face.f0]);
  const [mAxis, setMAxis] = useState<MonoAxis>('az');
  const [mSnr, setMSnr] = useState(20);
  const [mmG, setMmG] = useState(0);
  const [mmP, setMmP] = useState(0);
  const mono = useMemo(() => monopulse(face, g, beam, p.failed, sim.errs, p.hw, { axis: mAxis, snrDb: mSnr, mmGainDb: mmG, mmPhaseDeg: mmP }),
    [face, g, beam, p.failed, sim.errs, p.hw, mAxis, mSnr, mmG, mmP]);
  const aperture = g.Nx * g.d;
  const elSteer = Math.asin(sim.v0) * 180 / Math.PI;
  const errAz = sim.mAz.peakAngDeg - beam.azDeg;
  const errEl = sim.mEl.peakAngDeg - elSteer;
  const scanLoss = sim.gIdealDbi - sim.grSteerDbi;
  const pctOff = 100 * (1 - sim.nActive / g.N);

  const cutPlot = (cut: Sim['azCut'], center: number, label: string, mark: number) => {
    const span: [number, number] = zoom ? [center - 15, center + 15] : [-90, 90];
    const top = Math.ceil((sim.map.peakDbi + 3) / 10) * 10;
    return (
      <LinePlot
        series={[{ x: cut.angDeg, y: cut.gainDbi, color: '#4fd6ff', width: 1.4 }]}
        xRange={span} yRange={[top - 70, top]} xLabel={label} yLabel="dBi" aspect={0.5} yTicks={7}
        vMarks={[{ at: mark, color: '#4be39a', dash: [3, 3] }]}
        hMarks={[
          { at: sim.map.peakDbi - beam.sllDb, color: '#8a5e1f', label: beam.taper === 'uniform' ? undefined : tr(`objetivo −${beam.sllDb} dB`, `target −${beam.sllDb} dB`) },
          ...(sim.errsOn && Number.isFinite(sim.pred.floorDb) ? [{ at: sim.map.peakDbi + sim.pred.floorDb, color: '#ff6b6b99', label: tr(`fondo esperado ${fmt(sim.pred.floorDb, 0)} dB`, `expected floor ${fmt(sim.pred.floorDb, 0)} dB`) }] : []),
        ]}
        xFmt={v => fmt(v, 0) + '°'} />
    );
  };

  return (
    <main className="grid">
      <div className="col">
        <Panel title={tr('Apuntamiento', 'Steering')}>
          <Slider label={tr('Acimut', 'Azimuth')} value={beam.azDeg} min={-60} max={60} step={0.5} onChange={v => p.updBeam({ azDeg: v })} fmt={v => fmt(v) + '°'} />
          <Slider label={tr('Elevación', 'Elevation')} value={beam.elDeg} min={-30} max={60} step={0.5} onChange={v => p.updBeam({ elDeg: v })} fmt={v => fmt(v) + '°'} />
        </Panel>

        <Panel title="Hardware">
          <Seg label={tr('Bits del desfasador', 'Phase-shifter bits')} value={beam.psBits} onChange={v => p.updBeam({ psBits: v })}
            options={[{ v: 0, label: '∞' }, { v: 3, label: '3' }, { v: 4, label: '4' }, { v: 5, label: '5' }, { v: 6, label: '6' }]} />
          <Toggle label={tr('TTD por subarray', 'Subarray TTD')} on={beam.ttd} onChange={v => p.updBeam({ ttd: v })} />
          <Slider label={tr('Frecuencia instantánea', 'Instantaneous frequency')} value={beam.freqOffsetHz} min={-300e6} max={300e6} step={5e6}
            onChange={v => p.updBeam({ freqOffsetHz: v })}
            fmt={v => `${fmt((face.f0 + v) / 1e9, 3)} GHz`} />
          <p className="note">{tr('Lejos de f₀ el desfasador ya no da la fase correcta y el haz se desvía (squint). Con el TTD por subarray solo queda el residuo intra-subarray.', 'Away from f₀ the phase shifter no longer gives the right phase and the beam squints. With subarray TTD only the intra-subarray residual remains.')}</p>
        </Panel>

        <Panel title={tr('Elemento y acoplamiento mutuo', 'Element and mutual coupling')} hint={sim.coupling ? sim.coupling.source : tr('elemento cos θ ideal', 'ideal cos θ element')}>
          <Toggle label={tr('Acoplamiento mutuo (dipolo sobre masa)', 'Mutual coupling (dipole over ground)')} on={p.coup.on} onChange={v => p.updCoup({ on: v })} />
          {p.coup.on && <Seg label={tr('Adaptación y calibración', 'Matching and calibration')} value={p.coup.cal} onChange={v => p.updCoup({ cal: v })}
            options={[{ v: 'centro', label: tr('centro a broadside', 'centre at broadside') }, { v: 'elemento', label: tr('cada elemento', 'each element') }]} />}
          {sim.coupling && (
            <>
              <dl className="spec">
                <dt>{tr('Z activa (centro)', 'Active Z (centre)')}</dt><dd>{fmt(sim.coupling.zCenter[0], 1)} {sim.coupling.zCenter[1] >= 0 ? '+' : '−'} j{fmt(Math.abs(sim.coupling.zCenter[1]), 1)} Ω</dd>
                <dt>{tr('Z de diseño', 'Design Z')}</dt><dd>{fmt(sim.coupling.zRef[0], 1)} {sim.coupling.zRef[1] >= 0 ? '+' : '−'} j{fmt(Math.abs(sim.coupling.zRef[1]), 1)} Ω</dd>
                <dt>{tr('|Γ| activo centro / máx.', 'Active |Γ| centre / max.')}</dt><dd>{fmt(sim.coupling.gammaCenter, 3)} / {fmt(sim.coupling.gammaMax, 3)}</dd>
                <dt>{tr('ROE máxima', 'Max. VSWR')}</dt><dd>{fmt(sim.coupling.vswrMax, 2)}</dd>
                <dt>{tr('pérdida por desadaptación', 'mismatch loss')}</dt><dd>{fmt(sim.coupling.mismatchLossDb, 2)} dB</dd>
              </dl>
              {scan && <LinePlot
                series={[
                  { x: scan.ang, y: scan.gE, color: '#59d8ff', width: 1.5, label: tr('plano E (acimut)', 'E-plane (azimuth)') },
                  { x: scan.ang, y: scan.gH, color: '#ffc061', width: 1.5, label: tr('plano H (elevación)', 'H-plane (elevation)') },
                ]}
                xRange={[0, 70]} yRange={[0, 1]} xLabel={tr('ángulo de barrido (°)', 'scan angle (°)')} yLabel="|Γ|" aspect={0.62} xTicks={7} yTicks={5}
                yFmt={v => fmt(v, 1)}
                vMarks={[{ at: Math.abs(beam.azDeg), color: '#ffffff55' }]}
                xFmt={v => fmt(v, 0)} />}
            </>
          )}
          <p className="note">{tr('Dipolos de 0,45λ a λ/4 sobre un plano de masa. Impedancias mutuas por FEM inducida, coherentes en energía con el diagrama de elemento y contrastadas con el método de momentos de Antenna Toolbox (pestaña Validación); el T/R está adaptado al elemento central a broadside. El acoplamiento actúa como un error determinista que cambia con el apuntamiento: |Γ| activo, pérdida de barrido y diferencias entre elementos del borde y del centro.', '0.45λ dipoles λ/4 above a ground plane. Mutual impedances by the induced-EMF method, energy-consistent with the element pattern and checked against the Antenna Toolbox method of moments (Validation tab); the T/R module is matched to the centre element at broadside. Coupling acts as a deterministic error that changes with steering: active |Γ|, scan loss and differences between edge and centre elements.')}</p>
        </Panel>

        <Panel title={tr('Errores de hardware', 'Hardware errors')} hint={sim.errsOn ? tr(`realización ${p.hw.seed}`, `realization ${p.hw.seed}`) : 'ideal'}>
          <Slider label={tr('Amplitud por elemento (σ)', 'Element amplitude (σ)')} value={p.hw.sigAElemDb} min={0} max={2} step={0.05} onChange={v => p.updHw({ sigAElemDb: v })} fmt={v => `${fmt(v, 2)} dB`} />
          <Slider label={tr('Fase por elemento (σ)', 'Element phase (σ)')} value={p.hw.sigPhElemDeg} min={0} max={20} step={0.5} onChange={v => p.updHw({ sigPhElemDeg: v })} fmt={v => `${fmt(v, 1)}°`} />
          <Slider label={tr('Ganancia por subarray (σ)', 'Subarray gain (σ)')} value={p.hw.sigASubDb} min={0} max={2} step={0.05} onChange={v => p.updHw({ sigASubDb: v })} fmt={v => `${fmt(v, 2)} dB`} />
          <Slider label={tr('Fase por subarray (σ)', 'Subarray phase (σ)')} value={p.hw.sigPhSubDeg} min={0} max={20} step={0.5} onChange={v => p.updHw({ sigPhSubDeg: v })} fmt={v => `${fmt(v, 1)}°`} />
          <Slider label={tr('Retardo del TTD (σ)', 'TTD delay (σ)')} value={p.hw.ttdPs} min={0} max={20} step={0.5} onChange={v => p.updHw({ ttdPs: v })} fmt={v => `${fmt(v, 1)} ps · ${fmt(360 * sim.f * v * 1e-12, 1)}°`} />
          <Toggle label={tr('Aleatorizar la cuantización (dither)', 'Randomize quantization (dither)')} on={p.hw.dither} onChange={v => p.updHw({ dither: v })} />
          <div className="row">
            <button className="btn" onClick={() => p.updHw({ seed: p.hw.seed + 1 })}>{tr('Nueva realización', 'New realization')}</button>
            <button className="btn" onClick={() => p.updHw({ ...DEFAULT_ERRORS, seed: p.hw.seed })}>{tr('Sin errores', 'No errors')}</button>
          </div>
          {sim.errsOn && (
            <dl className="spec" style={{ marginTop: 12 }}>
              <dt>{tr('ΔG esta realización', 'ΔG this realization')}</dt><dd>{fmt(sim.grIdealDbi - sim.grSteerDbi, 2)} dB</dd>
              <dt>{tr('ΔG esperada', 'Expected ΔG')}</dt><dd>{fmt(sim.pred.gainLossDb, 2)} dB</dd>
              <dt>{tr('fondo medio esperado', 'expected mean floor')}</dt><dd>{Number.isFinite(sim.pred.floorDb) ? fmt(sim.pred.floorDb, 1) + ' dB' : '—'}</dd>
              <dt>{tr('fondo de subarray junto al haz', 'subarray floor near the beam')}</dt><dd>{Number.isFinite(sim.pred.floorSubPeakDb) ? fmt(sim.pred.floorSubPeakDb, 1) + ' dB' : '—'}</dd>
              <dt>{tr('σ apuntamiento esperado', 'expected pointing σ')}</dt><dd>{fmt(Math.asin(Math.min(1, sim.pred.sigmaU)) * 180 / Math.PI * 1e3, 1)} m° ({fmt(100 * Math.asin(Math.min(1, sim.pred.sigmaU)) * 180 / Math.PI / Math.max(sim.mAz.hpbwDeg, 1e-3), 2)} {tr('% de θ₃', '% of θ₃')})</dd>
            </dl>
          )}
          <p className="note">{tr('Residuo tras la calibración: errores gaussianos por elemento (T/R) y por subarray (canal digital y TTD), la misma realización en transmisión y recepción. Las cifras esperadas son exactas en momentos y están validadas por Monte Carlo', 'Residual after calibration: Gaussian errors per element (T/R) and per subarray (digital channel and TTD), the same realization on transmit and receive. Expected figures are exact in moments and validated by Monte Carlo')} (<code>tests/errors.test.ts</code>). {tr('Los errores por subarray se concentran cerca del haz principal.', 'Subarray errors concentrate near the main beam.')}</p>
        </Panel>

        <Panel title={tr('Ponderación en recepción', 'Receive weighting')}>
          <Seg value={beam.taper} onChange={v => p.updBeam({ taper: v })}
            options={[{ v: 'uniform', label: tr('uniforme', 'uniform') }, { v: 'taylor', label: 'Taylor' }, { v: 'chebyshev', label: 'Chebyshev' }]} />
          {beam.taper !== 'uniform' && (
            <Slider label={tr('SLL objetivo', 'Target SLL')} value={beam.sllDb} min={20} max={50} step={1} onChange={v => p.updBeam({ sllDb: v })} fmt={v => `−${v} dB`} />
          )}
          {beam.taper === 'taylor' && (
            <Slider label="n̄" value={beam.nbar} min={2} max={10} step={1} onChange={v => p.updBeam({ nbar: v })} />
          )}
          <p className="note">{tr('La transmisión se calcula siempre con amplitud uniforme (amplificadores GaN en saturación).', 'Transmit is always computed with uniform amplitude (GaN amplifiers in saturation).')}</p>
        </Panel>

        <Panel title={tr('Cara', 'Face')}>
          <FacePresets face={face} updFace={p.updFace} />
          <Slider label={tr('Subarrays por lado', 'Subarrays per side')} value={face.nSubX} min={1} max={16} step={1}
            onChange={v => p.updFace({ nSubX: v, nSubY: v })} fmt={v => `${v}×${v}`} />
          <Seg label={tr('Elementos por subarray', 'Elements per subarray')} value={face.subNx} onChange={v => p.updFace({ subNx: v, subNy: v })}
            options={[{ v: 1, label: '1' }, { v: 2, label: '2×2' }, { v: 4, label: '4×4' }, { v: 8, label: '8×8' }]} />
          <p className="note">
            {g.Nx}×{g.Ny} = {fmt(g.N, 0)} {tr('elementos', 'elements')} · {face.nSubX * face.nSubY} {tr('canales digitales', 'digital channels')} ·
            {tr('apertura', 'aperture')} {fmt(aperture, 2)} m · f₀ {fmt(face.f0 / 1e9, 1)} GHz (λ = {fmt(C0 / face.f0 * 100, 1)} cm)
          </p>
        </Panel>
      </div>

      <div className="col">
        <Panel title={tr('Patrón de recepción · espacio seno', 'Receive pattern · sine space')} hint={tr('pasa el ratón por el mapa', 'hover over the map')}>
          <UVMapView map={sim.map} steer={[sim.u0, sim.v0]} />
        </Panel>
        <Panel title={tr('Cortes principales', 'Principal cuts')} hint={
          <span style={{ display: 'inline-flex', width: 150 }}>
            <Seg value={zoom ? 'z' : 'f'} onChange={v => setZoom(v === 'z')} options={[{ v: 'f', label: '±90°' }, { v: 'z', label: 'zoom' }]} />
          </span>}>
          <div className="cuts">
            <div>{cutPlot(sim.azCut, beam.azDeg, tr(`acimut (el = ${fmt(beam.elDeg)}°)`, `azimuth (el = ${fmt(beam.elDeg)}°)`), beam.azDeg)}</div>
            <div>{cutPlot(sim.elCut, elSteer, tr('elevación (plano u = u₀)', 'elevation (plane u = u₀)'), elSteer)}</div>
          </div>
        </Panel>
        <Panel title={tr('Medida angular monopulso', 'Monopulse angle measurement')} hint={
          <span style={{ display: 'inline-flex', width: 150 }}>
            <Seg value={mAxis} onChange={setMAxis} options={[{ v: 'az', label: tr('acimut', 'azimuth') }, { v: 'el', label: tr('elevación', 'elevation') }]} />
          </span>}>
          <div className="cuts">
            <div>
              <LinePlot
                series={[
                  { x: mono.d, y: mono.rIdeal, color: '#59d8ff', width: 1.5, label: 'ideal' },
                  { x: mono.d, y: mono.rActual, color: '#ffc061', width: 1.3, label: tr('con errores', 'with errors') },
                ]}
                xRange={[mono.d[0], mono.d[mono.d.length - 1]]} yRange={[-2, 2]} xLabel={tr('desplazamiento (°)', 'offset (°)')} yLabel="Im{Δ/Σ}"
                aspect={0.62} xTicks={4} yTicks={4} xFmt={v => fmt(v, 1)} yFmt={v => fmt(v, 0)}
                vMarks={[{ at: -mono.theta3Deg / 2, color: '#ffffff33', label: '−θ₃/2' }, { at: mono.theta3Deg / 2, color: '#ffffff33' }]} />
            </div>
            <div>
              <Slider label={tr('SNR del haz suma', 'Sum-beam SNR')} value={mSnr} min={0} max={40} step={1} onChange={setMSnr} fmt={v => `${v} dB`} />
              <Slider label={tr('Desajuste de ganancia Δ/Σ', 'Δ/Σ gain mismatch')} value={mmG} min={-2} max={2} step={0.1} onChange={setMmG} fmt={v => `${fmt(v, 1)} dB`} />
              <Slider label={tr('Desajuste de fase Δ/Σ', 'Δ/Σ phase mismatch')} value={mmP} min={-30} max={30} step={1} onChange={setMmP} fmt={v => `${v}°`} />
              <div className="metrics">
                <Metric k={tr('pendiente k·θ₃', 'slope k·θ₃')} v={fmt(mono.slopeNorm, 2)} />
                <Metric k={tr('ruido térmico (σ)', 'thermal noise (σ)')} v={fmt(mono.sigmaThermalDeg, 3)} unit="°" />
                <Metric k={tr('sesgo en el eje', 'boresight bias')} v={fmt(mono.biasDeg, 3)} unit="°" tone={Math.abs(mono.biasDeg) > mono.sigmaThermalDeg ? 'warn' : undefined} />
                <Metric k={tr('σ sesgo (predicha)', 'bias σ (predicted)')} v={fmt(mono.biasStdPredDeg, 3)} unit="°" />
                <Metric k={tr('error eficaz ±θ₃/4', 'RMS error ±θ₃/4')} v={fmt(mono.rmsQuarterDeg, 3)} unit="°" tone={mono.rmsQuarterDeg > mono.sigmaThermalDeg ? 'warn' : undefined} />
                <Metric k={tr('pendiente / ideal', 'slope / ideal')} v={fmt(mono.slopeRel, 3)} />
              </div>
            </div>
          </div>
          <p className="note">{tr('Haz Δ por mitades al nivel de subarray (un canal digital por subarray); el ángulo se estima invirtiendo la curva ideal. Los errores de hardware son los del panel «Errores de hardware»: en el eje solo sesgan los de fase; los de amplitud entran con el desajuste de fase entre canales. El acoplamiento mutuo no se aplica aquí: su sesgo exacto es inferior a 0,01° en esta cara (MATLAB, solución completa) y la aproximación de impedancia activa no lo reproduce.', 'Δ beam formed by halves at subarray level (one digital channel per subarray); the angle is estimated by inverting the ideal curve. Hardware errors are those of the «Hardware errors» panel: on boresight only phase errors bias the estimate; amplitude errors enter through the inter-channel phase mismatch. Mutual coupling is not applied here: its exact bias is below 0.01° for this face (MATLAB, full solution) and the active-impedance approximation does not reproduce it.')}</p>
        </Panel>
      </div>

      <div className="col col-right">
        <Panel title={tr('Cara AESA', 'AESA face')} hint={tr(`${face.nSubX}×${face.nSubY} subarrays de ${face.subNx}×${face.subNy}`, `${face.nSubX}×${face.nSubY} subarrays of ${face.subNx}×${face.subNy}`)} pad={false}>
          <div className="body" style={{ paddingBottom: 0 }}>
            <FaceView face={sim.face} g={g} w={sim.wRx} failed={p.failed} onToggle={p.toggle} />
          </div>
          <div className="body" style={{ paddingTop: 0 }}>
            <Slider label={tr('Fallos aleatorios', 'Random failures')} value={failPct} min={0} max={30} step={1} onChange={setFailPct} fmt={v => `${v} %`} />
            <div className="row">
              <button className="btn" onClick={() => p.randomFail(failPct)}>{tr('Generar fallos', 'Generate failures')}</button>
              <button className="btn" onClick={p.clearFail}>{tr('Reparar todo', 'Repair all')}</button>
            </div>
          </div>
        </Panel>

        <Panel title={tr('Métricas', 'Metrics')} pad={false}>
          <div className="metrics">
            <Metric k={tr('G rx apuntamiento', 'Rx G at steering')} v={fmt(sim.grSteerDbi)} unit="dBi" />
            <Metric k={tr('pérdida vs. uniforme', 'loss vs. uniform')} v={fmt(scanLoss)} unit="dB" tone={scanLoss > 3 ? 'warn' : undefined} />
            <Metric k="error az" v={fmt(errAz, 2)} unit="°" tone={Math.abs(errAz) > sim.mAz.hpbwDeg / 2 ? 'bad' : Math.abs(errAz) > sim.mAz.hpbwDeg / 10 ? 'warn' : 'good'} />
            <Metric k="error el" v={fmt(errEl, 2)} unit="°" tone={Math.abs(errEl) > sim.mEl.hpbwDeg / 2 ? 'bad' : Math.abs(errEl) > sim.mEl.hpbwDeg / 10 ? 'warn' : 'good'} />
            <Metric k="HPBW az" v={fmt(sim.mAz.hpbwDeg, 2)} unit="°" />
            <Metric k="HPBW el" v={fmt(sim.mEl.hpbwDeg, 2)} unit="°" />
            <Metric k="SLL az" v={fmt(sim.mAz.sllDb)} unit="dB" tone={sllTone(sim.mAz.sllDb, beam)} />
            <Metric k="SLL el" v={fmt(sim.mEl.sllDb)} unit="dB" tone={sllTone(sim.mEl.sllDb, beam)} />
            <Metric k="SLL 2D (≈)" v={fmt(sim.sll2d)} unit="dB" tone={sllTone(sim.sll2d, beam)} />
            <Metric k={tr('elementos activos', 'active elements')} v={`${fmt(100 - pctOff, 1)}`} unit="%" tone={pctOff > 0 ? 'warn' : undefined} />
          </div>
        </Panel>
      </div>
    </main>
  );
}

function sllTone(sll: number, beam: BeamConfig): 'good' | 'warn' | 'bad' | undefined {
  if (beam.taper === 'uniform') return undefined;
  const d = sll + beam.sllDb;             // >0: worse than target
  return d > 6 ? 'bad' : d > 2 ? 'warn' : 'good';
}
