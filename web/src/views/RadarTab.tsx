import { useMemo, useState } from 'react';
import type { BeamConfig, RadarParams } from '../engine/config';
import type { Sim } from '../App';
import {
  detectionRange, pdSwerling0, pdSwerling1, radarHorizon, snrDbAt, snrReqSwerling1,
} from '../engine/radar';
import { WAVEFORMS, eclipseFraction, radarK, timeline, txBeamwidthDeg, waveInfo, type WaveMode } from '../engine/waveform';
import { Metric, Panel, Seg, Slider, Toggle, fmt } from '../ui/controls';
import { LinePlot } from './LinePlot';
import { tr } from '../i18n';

const RCS_PRESETS = () => [
  { v: 0.01, label: tr('0,01 m²', '0.01 m²') },
  { v: 0.1, label: tr('0,1', '0.1') },
  { v: 1, label: '1' },
  { v: 10, label: '10' },
  { v: 100, label: '100' },
];
const C = 299_792_458;

export function RadarTab(p: { radar: RadarParams; updRadar: (p: Partial<RadarParams>) => void; sim: Sim; beam: BeamConfig }) {
  const { radar: r, sim } = p;
  const [azSpan, setAzSpan] = useState(45);
  const [elMax, setElMax] = useState(6);
  const th3Rx = Math.max(sim.mAz.hpbwDeg, 0.3), th3El = Math.max(sim.mEl.hpbwDeg, 0.3);
  const th3Tx = txBeamwidthDeg(sim.g.Nx, sim.face.dLambda * sim.f / sim.face.f0, p.beam.azDeg);
  const wi = waveInfo(r, sim.f);
  const tl = timeline(r, th3Rx, th3El, azSpan, elMax);
  const mode: WaveMode | 'otra' = (Object.keys(WAVEFORMS) as WaveMode[]).find(k => {
    const w = WAVEFORMS[k]; return w.tauS === r.tauS && w.prfHz === r.prfHz && w.nPulses === r.nPulses;
  }) ?? 'otra';

  const out = useMemo(() => {
    const { K, losses } = radarK(r, { f: sim.f, gtDbi: sim.gtSteerDbi, grDbi: sim.grSteerDbi, nActive: sim.nActive }, th3Tx, th3Rx);
    const req = snrReqSwerling1(r.pdReq, r.pfa);
    const ru = C / (2 * r.prfHz);
    const rDetRaw = detectionRange(K, req);
    const rDet = Math.min(rDetRaw, ru);
    const rHor = radarHorizon(r.hRadarM, r.hTargetM);
    const rRaw = Math.min(2000e3, Math.max(60e3, 1.35 * Math.max(Math.min(rDetRaw, 1500e3), Math.min(rHor, 1500e3))));
    const tick = rRaw > 1200e3 ? 200e3 : rRaw > 600e3 ? 100e3 : rRaw > 250e3 ? 50e3 : 20e3;
    const rMax = Math.ceil(rRaw / tick) * tick;
    const n = 800;
    const R = new Float64Array(n), snr = new Float64Array(n), pd1 = new Float64Array(n), pd0 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      R[i] = rMax * (i + 1) / n;
      const fe = eclipseFraction(R[i], r.tauS, r.prfHz);        // echo arriving while transmitting
      snr[i] = fe > 0 ? snrDbAt(K, R[i]) + 20 * Math.log10(fe) : -100;
      const sl = Math.pow(10, snr[i] / 10);
      const out = R[i] > rHor || R[i] > ru;           // below the horizon or at an ambiguous range
      pd1[i] = out ? 0 : 100 * pdSwerling1(sl, r.pfa);
      pd0[i] = out ? 0 : 100 * pdSwerling0(sl, r.pfa);
    }
    return { K, losses, ru, rDetRaw, req, rDet, rHor, rMax, nTicks: Math.round(rMax / tick), R: Float64Array.from(R, x => x / 1e3), snr, pd1, pd0 };
  }, [r, sim, th3Tx, th3Rx]);

  const ptKw = sim.nActive * r.pElemW / 1e3;
  const rEff = Math.min(out.rDet, out.rHor);
  const reqDb = 10 * Math.log10(out.req);
  const limit = out.rHor < out.rDet ? 'horizonte' : out.rDetRaw > out.ru ? 'ambigüedad' : 'SNR';

  return (
    <main className="grid">
      <div className="col">
        <Panel title={tr('Blanco', 'Target')}>
          <Seg label="RCS" value={r.rcsM2} onChange={v => p.updRadar({ rcsM2: v })} options={RCS_PRESETS()} />
          <Slider label="RCS" value={10 * Math.log10(r.rcsM2)} min={-30} max={30} step={1}
            onChange={v => p.updRadar({ rcsM2: Math.pow(10, v / 10) })} fmt={v => `${fmt(v, 0)} dBsm`} />
          <Slider label={tr('Altura del blanco', 'Target height')} value={r.hTargetM} min={2} max={15000} step={1}
            onChange={v => p.updRadar({ hTargetM: v })} fmt={v => `${fmt(v, 0)} m`} />
          <Toggle label={tr('Velocidad radial conocida', 'Known radial velocity')} on={r.vRadialMs !== null} onChange={v => p.updRadar({ vRadialMs: v ? 100 : null })} />
          {r.vRadialMs !== null && <Slider label={tr('Velocidad radial', 'Radial velocity')} value={r.vRadialMs} min={-400} max={400} step={1} onChange={v => p.updRadar({ vRadialMs: v })} fmt={v => `${v} m/s`} />}
        </Panel>
        <Panel title={tr('Transmisor y forma de onda', 'Transmitter and waveform')}>
          <Seg label={tr('Forma de onda', 'Waveform')} value={mode} onChange={v => { if (v !== 'otra') p.updRadar({ ...WAVEFORMS[v] }); }}
            options={[{ v: 'lejana', label: tr('búsqueda lejana', 'long-range search') }, { v: 'mtd', label: tr('cota baja (MTD)', 'low altitude (MTD)') }, { v: 'otra', label: 'manual' }]} />
          <Slider label={tr('Potencia de pico por elemento', 'Peak power per element')} value={r.pElemW} min={1} max={40} step={1} onChange={v => p.updRadar({ pElemW: v })} fmt={v => `${v} W`} />
          <Slider label={tr('Ancho de pulso', 'Pulse width')} value={r.tauS * 1e6} min={1} max={500} step={1} onChange={v => p.updRadar({ tauS: v / 1e6 })} fmt={v => `${v} µs`} />
          <Slider label="PRF" value={r.prfHz} min={200} max={10000} step={25} onChange={v => p.updRadar({ prfHz: v })} fmt={v => `${fmt(v / 1e3, 3)} kHz`} />
          <Slider label={tr('Pulsos por haz', 'Pulses per beam')} value={r.nPulses} min={2} max={64} step={2} onChange={v => p.updRadar({ nPulses: v })} />
          <Slider label={tr('Ventana Doppler', 'Doppler window')} value={r.dopplerSllDb} min={30} max={80} step={1} onChange={v => p.updRadar({ dopplerSllDb: v })} fmt={v => `Chebyshev ${v} dB`} />
        </Panel>
        <Panel title={tr('Receptor y detección', 'Receiver and detection')}>
          <Slider label={tr('Figura de ruido', 'Noise figure')} value={r.nfDb} min={1} max={10} step={0.5} onChange={v => p.updRadar({ nfDb: v })} fmt={v => `${fmt(v)} dB`} />
          <Slider label={tr('Pérdidas de RF', 'RF losses')} value={r.lossDb} min={0} max={10} step={0.5} onChange={v => p.updRadar({ lossDb: v })} fmt={v => `${fmt(v)} dB`} />
          <Slider label={tr('Celdas del CFAR', 'CFAR cells')} value={r.cfarCells} min={8} max={64} step={2} onChange={v => p.updRadar({ cfarCells: v })} />
          <Slider label={tr('Pd requerida', 'Required Pd')} value={r.pdReq} min={0.5} max={0.99} step={0.01} onChange={v => p.updRadar({ pdReq: v })} fmt={v => fmt(v, 2)} />
          <Seg label="Pfa" value={r.pfa} onChange={v => p.updRadar({ pfa: v })}
            options={[{ v: 1e-4, label: '1e-4' }, { v: 1e-6, label: '1e-6' }, { v: 1e-8, label: '1e-8' }]} />
          <Slider label={tr('Altura de la antena', 'Antenna height')} value={r.hRadarM} min={5} max={40} step={1} onChange={v => p.updRadar({ hRadarM: v })} fmt={v => `${v} m`} />
        </Panel>
        <Panel title={tr('Búsqueda', 'Search')}>
          <Slider label={tr('Sector por cara', 'Sector per face')} value={azSpan} min={15} max={60} step={1} onChange={setAzSpan} fmt={v => `±${v}°`} />
          <Slider label={tr('Elevación máxima', 'Maximum elevation')} value={elMax} min={2} max={60} step={1} onChange={setElMax} fmt={v => `${v}°`} />
          <Slider label={tr('Paso entre haces', 'Beam spacing')} value={r.beamSpacing} min={0.4} max={1.2} step={0.05} onChange={v => p.updRadar({ beamSpacing: v })} fmt={v => `${fmt(v, 2)}·θ₃`} />
        </Panel>
      </div>

      <div className="col">
        <Panel title={tr('SNR frente a distancia', 'SNR versus range')} hint={tr('espacio libre con pérdidas y eclipsado · el entorno se añade en Entorno y Escenarios', 'free space with losses and eclipsing · the environment is added in Environment and Scenarios')}>
          <LinePlot
            series={[{ x: out.R, y: out.snr, color: '#4fd6ff', width: 1.8, label: tr('SNR integrada', 'integrated SNR') }]}
            xRange={[0, out.rMax / 1e3]} yRange={[-10, 60]} xLabel={tr('distancia (km)', 'range (km)')} yLabel="dB" aspect={0.45} xTicks={out.nTicks} yTicks={7}
            hMarks={[{ at: reqDb, color: '#ffb547', label: tr(`umbral Pd = ${fmt(r.pdReq, 2)} (${fmt(reqDb)} dB)`, `threshold Pd = ${fmt(r.pdReq, 2)} (${fmt(reqDb)} dB)`) }]}
            vMarks={[
              { at: out.rHor / 1e3, color: '#ff5d5d', label: tr('horizonte', 'horizon') },
              ...(out.ru < out.rMax ? [{ at: out.ru / 1e3, color: '#c99bff', label: tr('R no ambiguo', 'unambiguous R') }] : []),
              ...(out.rDet < out.rMax ? [{ at: out.rDet / 1e3, color: '#4be39a', label: 'R det' }] : []),
            ]}
            xFmt={v => fmt(v, 0)} />
        </Panel>
        <Panel title={tr('Probabilidad de detección', 'Probability of detection')} hint={`Pfa = ${r.pfa.toExponential(0)}`}>
          <LinePlot
            series={[
              { x: out.R, y: out.pd1, color: '#ffb547', width: 1.8, label: 'Swerling 1' },
              { x: out.R, y: out.pd0, color: '#4fd6ff', width: 1.4, dash: [5, 4], label: 'Swerling 0' },
            ]}
            xRange={[0, out.rMax / 1e3]} yRange={[0, 100]} xLabel={tr('distancia (km)', 'range (km)')} yLabel="Pd (%)" aspect={0.38} xTicks={out.nTicks}
            vMarks={[{ at: out.rHor / 1e3, color: '#ff5d5d' }, ...(out.ru < out.rMax ? [{ at: out.ru / 1e3, color: '#c99bff' }] : [])]}
            xFmt={v => fmt(v, 0)} />
        </Panel>
        <Panel title={tr('Modelo', 'Model')}>
          <p className="note" style={{ marginTop: 0 }}>
            SNR = Pₜ τ Gₜ Gᵣ λ² σ N / ((4π)³ k T₀ F L R⁴){tr(', con integración coherente de N pulsos. L = RF + procesado: ventana y celda Doppler, muestras de distancia, forma del haz y CFAR, validadas en MATLAB', ', with coherent integration of N pulses. L = RF + processing: Doppler window and cell, range sampling, beam shape and CFAR, validated in MATLAB')}
            (fase3_linea_base/val_perdidas.m). {tr('El eco que llega mientras se transmite pierde f² (eclipsado) y solo cuenta la detección dentro del alcance no ambiguo. Pd: Swerling 1 exacta y Swerling 0 por Albersheim. Horizonte con tierra 4/3.', 'An echo arriving while transmitting loses f² (eclipsing), and only detections within the unambiguous range count. Pd: exact Swerling 1 and Swerling 0 by Albersheim. Horizon with 4/3 Earth.')}
          </p>
          <p className="note">{tr('Aquí solo espacio libre. El clutter, el multitrayecto y la atenuación están en Entorno y Escenarios; la cadena de señal (compresión, Doppler y CFAR), en Señal.', 'Free space only here. Clutter, multipath and attenuation are in Environment and Scenarios; the signal chain (compression, Doppler and CFAR) is in Signal.')}</p>
        </Panel>
      </div>

      <div className="col col-right">
        <Panel title={tr('Presupuesto', 'Budget')} pad={false}>
          <div className="metrics">
            <Metric k={tr('potencia de pico', 'peak power')} v={fmt(ptKw, 1)} unit="kW" />
            <Metric k={tr('energía por pulso', 'energy per pulse')} v={fmt(ptKw * 1e3 * r.tauS, 1)} unit="J" />
            <Metric k={tr('G tx (uniforme)', 'Tx G (uniform)')} v={fmt(sim.gtSteerDbi)} unit="dBi" />
            <Metric k={tr('G rx (con taper)', 'Rx G (tapered)')} v={fmt(sim.grSteerDbi)} unit="dBi" />
            <Metric k={tr('SNR requerida', 'required SNR')} v={fmt(reqDb)} unit="dB" />
            <Metric k={tr('frecuencia', 'frequency')} v={fmt(sim.f / 1e9, 3)} unit="GHz" />
            <Metric k={tr('alcance detección', 'detection range')} v={fmt(out.rDet / 1e3, 0)} unit="km" tone="good" />
            <Metric k={tr('horizonte radar', 'radar horizon')} v={fmt(out.rHor / 1e3, 0)} unit="km" />
            <Metric k={tr('alcance efectivo', 'effective range')} v={fmt(rEff / 1e3, 0)} unit="km" tone={limit === 'SNR' ? 'good' : 'warn'} />
            <Metric k={tr('limitado por', 'limited by')} v={limit === 'horizonte' ? tr('horizonte', 'horizon') : limit === 'ambigüedad' ? tr('ambigüedad', 'ambiguity') : limit} />
          </div>
        </Panel>
        <Panel title={tr('Forma de onda', 'Waveform')} pad={false}>
          <div className="metrics">
            <Metric k={tr('alcance no ambiguo', 'unambiguous range')} v={fmt(wi.ruKm, 0)} unit="km" />
            <Metric k={tr('zona ciega', 'blind zone')} v={fmt(wi.blindKm, 1)} unit="km" tone={wi.blindKm > 5 ? 'warn' : undefined} />
            <Metric k={tr('ciclo de trabajo', 'duty cycle')} v={fmt(100 * wi.duty, 1)} unit="%" tone={wi.duty > 0.2 ? 'bad' : wi.duty > 0.1 ? 'warn' : 'good'} />
            <Metric k={tr('potencia media', 'average power')} v={fmt(ptKw * wi.duty, 2)} unit="kW" />
            <Metric k={tr('velocidad ciega', 'blind speed')} v={fmt(wi.vBlindMs, 0)} unit="m/s" />
            <Metric k={tr('tiempo por haz', 'dwell per beam')} v={fmt(wi.dwellS * 1e3, 1)} unit="ms" />
          </div>
        </Panel>
        <Panel title={tr('Pérdidas', 'Losses')} pad={false} hint={`total ${fmt(out.losses.totalDb, 1)} dB`}>
          <div className="metrics">
            <Metric k="RF" v={fmt(out.losses.rfDb, 1)} unit="dB" />
            <Metric k={tr('ventana Doppler', 'Doppler window')} v={fmt(out.losses.windowDb, 2)} unit="dB" />
            <Metric k={r.vRadialMs === null ? tr('entre celdas Doppler', 'Doppler straddle') : tr('celda Doppler', 'Doppler cell')} v={fmt(out.losses.dopplerDb, 2)} unit="dB" />
            <Metric k={tr('entre muestras', 'range straddle')} v={fmt(out.losses.rangeDb, 2)} unit="dB" />
            <Metric k={tr('forma del haz', 'beam shape')} v={fmt(out.losses.beamDb, 2)} unit="dB" />
            <Metric k={tr(`CFAR (${r.cfarCells} celdas)`, `CFAR (${r.cfarCells} cells)`)} v={fmt(out.losses.cfarDb, 2)} unit="dB" />
          </div>
        </Panel>
        <Panel title={tr('Presupuesto de tiempo', 'Time budget')} pad={false} hint={tr('una cara', 'one face')}>
          <div className="metrics">
            <Metric k={tr('haces en acimut', 'beams in azimuth')} v={fmt(tl.beamsAz, 0)} />
            <Metric k={tr('barras de elevación', 'elevation bars')} v={fmt(tl.bars, 0)} />
            <Metric k={tr('posiciones de haz', 'beam positions')} v={fmt(tl.beams, 0)} />
            <Metric k={tr('refresco de la búsqueda', 'search frame time')} v={fmt(tl.frameS, 1)} unit="s" tone={tl.frameS > 10 ? 'bad' : tl.frameS > 4 ? 'warn' : 'good'} />
          </div>
          <div className="body"><p className="note" style={{ margin: 0 }}>
            {tr('Posiciones de haz × pulsos por haz / PRF, con θ₃ ensanchado por 1/cos del acimut. Con la forma de onda lejana solo se cubren las elevaciones bajas (donde está el alcance); las altas se barren con pulsos cortos y menos alcance.', 'Beam positions × pulses per beam / PRF, with θ₃ broadened by 1/cos of azimuth. The long-range waveform only covers low elevations (where the range is); high elevations are scanned with short pulses and less range.')}
          </p></div>
        </Panel>
      </div>
    </main>
  );
}
