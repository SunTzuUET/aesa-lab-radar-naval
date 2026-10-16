// Signal tab: signal-level chain (MATLAB, matlab/fase3_linea_base/mc_pd_s2.m) for S2.
// Shows precomputed results: range-Doppler map, pulse compression, Monte Carlo
// Pd vs. theory, and measured processing losses.
import { useMemo } from 'react';
import D from '../data/senal_s2.json';
import { Metric, Panel, fmt } from '../ui/controls';
import { LinePlot } from './LinePlot';
import { LUT, LUT_CSS } from './colormap';
import { useCanvas } from './useCanvas';
import { tr } from '../i18n';

const num = (v: number | null) => (v === null || !Number.isFinite(v) ? NaN : v);

function RangeDoppler() {
  const S = D.snap;
  const nD = S.rdDb.length, nR = S.rdDb[0].length;
  const LO = -5, HI = 45;
  const img = useMemo(() => {
    const c = document.createElement('canvas'); c.width = nR; c.height = nD;
    const ctx = c.getContext('2d')!, id = ctx.createImageData(nR, nD);
    for (let j = 0; j < nD; j++) for (let i = 0; i < nR; i++) {
      const v = num(S.rdDb[nD - 1 - j][i]);                 // positive Doppler at the top
      const t = Math.max(0, Math.min(1, (v - LO) / (HI - LO))), k = Math.round(t * 255) * 3, o = (j * nR + i) * 4;
      id.data[o] = LUT[k]; id.data[o + 1] = LUT[k + 1]; id.data[o + 2] = LUT[k + 2]; id.data[o + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }, [S, nD, nR]);
  const ref = useCanvas(0.42, (c, w, h) => {
    const L = 52, R = 10, T = 8, B = 30, pw = w - L - R, ph = h - T - B;
    c.clearRect(0, 0, w, h);
    c.save(); c.beginPath(); c.roundRect(L, T, pw, ph, 6); c.clip();
    c.imageSmoothingEnabled = false; c.drawImage(img, L, T, pw, ph); c.restore();
    const r0 = S.rangeKm[0], r1 = S.rangeKm[nR - 1], fd0 = S.dopplerHz[0], df = S.dopplerHz[1] - S.dopplerHz[0], fd1 = S.dopplerHz[nD - 1] + df;
    c.font = '10px "Geist Mono"'; c.fillStyle = '#8a8a94';
    for (let i = 0; i <= 5; i++) { const r = r0 + (r1 - r0) * i / 5, s = fmt(r, 1); c.fillText(s, L + pw * i / 5 - c.measureText(s).width / 2, h - B + 15); }
    for (let j = 0; j <= 4; j++) { const f = fd0 + (fd1 - fd0) * j / 4, s = fmt(f / 1e3, 1); c.fillText(s, L - 8 - c.measureText(s).width, T + ph * (1 - j / 4) + 3); }
    const xl = tr('distancia (km)', 'range (km)');
    c.fillStyle = '#5e5e68'; c.fillText(xl, L + pw - c.measureText(xl).width, h - 3);
    c.save(); c.translate(11, T + ph / 2); c.rotate(-Math.PI / 2); c.fillText('Doppler (kHz)', -30, 0); c.restore();
    // target marker
    const x = L + (S.tgtKm - r0) / (r1 - r0) * pw, y = T + ph * (1 - (S.tgtFdHz - fd0) / (fd1 - fd0));
    c.strokeStyle = '#fff'; c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, 9, 0, 2 * Math.PI); c.stroke();
    c.fillStyle = '#fff'; c.fillText(tr('blanco', 'target'), x + 12, y - 8);
  }, [img]);
  return (
    <>
      <div className="view"><canvas ref={ref} /></div>
      <div className="legend">
        <span>{LO} dB</span><div className="bar" style={{ background: LUT_CSS }} /><span>+{HI} dB</span>
        <span className="legend-note">{tr('potencia relativa al ruido · la cresta en Doppler 0 es el clutter de mar', 'power relative to noise · the ridge at zero Doppler is sea clutter')} (CNR {fmt(S.cnrDb, 1)} dB {tr('por celda', 'per cell')})</span>
      </div>
    </>
  );
}

export function SignalTab() {
  const S = D.snap, M = D.meta;
  const prof = useMemo(() => {
    const x = S.rangeKm;
    const rawPk = Math.max(...S.rawDb.map(num).filter(Number.isFinite)), mfPk = Math.max(...S.mfDb.map(num).filter(Number.isFinite));
    return { x, raw: S.rawDb.map(v => num(v) - mfPk), mf: S.mfDb.map(v => num(v) - mfPk), rawPk: rawPk - mfPk };
  }, [S]);
  const chirp = useMemo(() => {
    const n = S.chirpI.length, t = Array.from({ length: n }, (_, i) => i / M.fs * 1e6);
    return { t, i: S.chirpI, q: S.chirpQ };
  }, [S, M]);
  const A = D.ideal, B1 = D.s2, P = D.perdida;
  const colors = ['#ff6b6b', '#ffc061', '#5fd8a2', '#59d8ff'];
  const inCi = A.pdTh.filter((p, i) => p >= A.lo[i] && p <= A.hi[i]).length;
  const clean = P.casos.map(c => c.perdidaLimpioDb).filter(v => v !== null) as number[];
  const meanClean = clean.reduce((a, b) => a + b, 0) / clean.length;

  return (
    <main className="grid scen-grid">
      <div className="col">
        <Panel title={tr('Forma de onda', 'Waveform')}>
          <dl className="spec">
            <dt>chirp LFM</dt><dd>{fmt(M.B / 1e6, 0)} MHz · {fmt(M.tau * 1e6, 0)} µs</dd>
            <dt>{tr('BT · compresión', 'BT · compression')}</dt><dd>{fmt(M.B * M.tau, 0)} · {fmt(10 * Math.log10(M.B * M.tau), 1)} dB</dd>
            <dt>{tr('resolución', 'resolution')}</dt><dd>{fmt(3e8 / 2 / M.B, 0)} m</dd>
            <dt>{tr('PRF · pulsos', 'PRF · pulses')}</dt><dd>{fmt(M.prf / 1e3, 1)} kHz · {M.np}</dd>
            <dt>{tr('alcance no ambiguo', 'unambiguous range')}</dt><dd>{fmt(3e8 / 2 / M.prf / 1e3, 0)} km</dd>
            <dt>{tr('zona ciega', 'blind zone')}</dt><dd>{fmt(3e8 * M.tau / 2 / 1e3, 1)} km</dd>
            <dt>{tr('ventana Doppler', 'Doppler window')}</dt><dd>{M.ventana}</dd>
            <dt>CFAR</dt><dd>CA 2D · {M.celdasRefCfar} {tr('celdas', 'cells')}</dd>
            <dt>Pfa</dt><dd>{M.pfa.toExponential(0)}</dd>
          </dl>
          <p className="note">{tr('Cota baja: con el pulso de 100 µs de la búsqueda lejana la zona ciega llegaría a 15 km, inaceptable para un rozaolas.', 'Low-altitude waveform: with the 100 µs long-range search pulse the blind zone would reach 15 km, unacceptable for a sea-skimmer.')}</p>
        </Panel>
        <Panel title={tr('Escenario simulado', 'Simulated scenario')}>
          <dl className="spec">
            <dt>{tr('blanco', 'target')}</dt><dd>{tr('0,1 m²', '0.1 m²')} · 7 m · Swerling 1</dd>
            <dt>{tr('velocidad', 'velocity')}</dt><dd>250–330 m/s ({tr('aleatoria', 'random')})</dd>
            <dt>{tr('mar', 'sea')}</dt><dd>{tr('estado', 'state')} {M.seaState} · σh {fmt(M.sigmaH, 2)} m</dd>
            <dt>clutter</dt><dd>NRL · σv {fmt(M.sigmaV, 2)} m/s</dd>
            <dt>G tx / rx</dt><dd>{fmt(M.Gt, 1)} / {fmt(M.Gr, 1)} dBi</dd>
            <dt>{tr('HPBW acimut', 'azimuth HPBW')}</dt><dd>{fmt(M.hpbwAz, 2)}°</dd>
            <dt>{tr('ensayos', 'trials')}</dt><dd>{M.nA} (A) · {M.nB} {tr('y', 'and')} {M.nB2} (B)</dd>
          </dl>
          <p className="note">{tr('Reproducible con', 'Reproducible with')} <code>matlab/fase3_linea_base/mc_pd_s2.m</code> ({tr('semillas fijas', 'fixed seeds')}, {fmt(M.segundos, 0)} s).</p>
        </Panel>
      </div>

      <div className="col">
        <header className="scen-head">
          <span className="scen-code">S2</span>
          <div>
            <h2>{tr('Cadena a nivel de señal', 'Signal-level chain')}</h2>
            <p>{tr('I/Q simulado del haz suma, compresión de pulso, procesado Doppler y CA-CFAR para el misil rozaolas sobre mar de estado 5. Monte Carlo en MATLAB frente a la teoría de detección.', 'Simulated sum-beam I/Q, pulse compression, Doppler processing and CA-CFAR for the sea-skimming missile over sea state 5. Monte Carlo in MATLAB against detection theory.')}</p>
          </div>
        </header>

        <Panel title={tr('Mapa distancia-Doppler', 'Range-Doppler map')} hint={tr(`un CPI a ${fmt(S.tgtKm, 0)} km · blanco con SNR integrada ${S.tgtSnrIntDb} dB`, `one CPI at ${fmt(S.tgtKm, 0)} km · target with integrated SNR ${S.tgtSnrIntDb} dB`)}>
          <RangeDoppler />
        </Panel>

        <div className="cuts">
          <Panel title={tr('Compresión de pulso', 'Pulse compression')} hint={tr('un pulso · relativo al pico comprimido', 'one pulse · relative to compressed peak')}>
            <LinePlot series={[
              { x: prof.x, y: prof.raw, color: '#8a8a94', width: 1, label: tr('antes', 'before') },
              { x: prof.x, y: prof.mf, color: '#59d8ff', width: 1.3, label: tr('después', 'after') },
            ]} xRange={[prof.x[0], prof.x[prof.x.length - 1]]} yRange={[-50, 5]} xLabel={tr('distancia (km)', 'range (km)')} yLabel="dB" aspect={0.55} xTicks={5} yTicks={5}
              xFmt={v => fmt(v, 1)} />
          </Panel>
          <Panel title={tr('Chirp transmitido', 'Transmitted chirp')} hint={tr('banda base · I y Q', 'baseband · I and Q')}>
            <LinePlot series={[
              { x: chirp.t, y: chirp.i, color: '#59d8ff', width: 1, label: 'I' },
              { x: chirp.t, y: chirp.q, color: '#ffc061', width: 1, label: 'Q' },
            ]} xRange={[0, chirp.t[chirp.t.length - 1]]} yRange={[-1.2, 1.2]} xLabel={tr('tiempo (µs)', 'time (µs)')} yLabel="" aspect={0.55} xTicks={4} yTicks={4}
              xFmt={v => fmt(v, 0)} />
          </Panel>
        </div>

        <Panel title={tr('A · cadena ideal frente a la teoría', 'A · ideal chain versus theory')} hint={tr(`Swerling 1 · ${inCi} de ${A.pd.length} puntos dentro del IC95 %`, `Swerling 1 · ${inCi} of ${A.pd.length} points within the 95 % CI`)}>
          <LinePlot series={[
            { x: A.snrIntDb, y: A.pdTh.map(v => 100 * v), color: '#ededf0', width: 1.6, label: tr('teoría', 'theory') },
            { x: A.snrIntDb, y: A.pd.map(v => 100 * v), color: '#59d8ff', width: 1.6, label: 'Monte Carlo' },
            { x: A.snrIntDb, y: A.lo.map(v => 100 * v), color: '#59d8ff66', width: 1, dash: [3, 3] },
            { x: A.snrIntDb, y: A.hi.map(v => 100 * v), color: '#59d8ff66', width: 1, dash: [3, 3], label: tr('IC95 %', '95 % CI') },
          ]} xRange={[A.snrIntDb[0], A.snrIntDb[A.snrIntDb.length - 1]]} yRange={[0, 100]} xLabel={tr('SNR integrada (dB)', 'integrated SNR (dB)')} yLabel="Pd (%)" aspect={0.36} xTicks={7} yTicks={5}
            xFmt={v => fmt(v, 0)} />
          <p className="note">{tr('Sin clutter, ventana rectangular y blanco centrado en la celda. Pfa medida', 'No clutter, rectangular window and target centred in the cell. Measured Pfa')} {A.pfa.toExponential(2)} ({tr('IC95 %', '95 % CI')} {A.pfaLo.toExponential(2)}–{A.pfaHi.toExponential(2)}) {tr('en', 'over')} {(A.celdas / 1e6).toFixed(0)} {tr('millones de celdas, frente a', 'million cells, versus')} {M.pfa.toExponential(0)} {tr('de diseño', 'design')}.</p>
        </Panel>

        <Panel title={tr('B2 · pérdida de procesado medida', 'B2 · measured processing loss')} hint={tr('CA-CFAR, blanco en posición y velocidad aleatorias', 'CA-CFAR, target at random position and velocity')}>
          <LinePlot series={[
            { x: P.snrIntDb, y: P.pdTh.map(v => 100 * v), color: '#ededf0', width: 1.8, label: tr('teoría', 'theory') },
            ...P.casos.map((c, i) => ({ x: P.snrIntDb, y: c.pdCfar.map(v => 100 * v), color: colors[i], width: 1.3,
              label: `${c.Rkm} km (CNR ${c.cnrDb === null ? '—' : fmt(c.cnrDb, 0) + ' dB'})` })),
          ]} xRange={[P.snrIntDb[0], P.snrIntDb[P.snrIntDb.length - 1]]} yRange={[0, 100]} xLabel={tr('SNR integrada (dB)', 'integrated SNR (dB)')} yLabel="Pd (%)" aspect={0.36} xTicks={7} yTicks={5}
            xFmt={v => fmt(v, 0)} />
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>{tr('distancia', 'range')}</th><th>{tr('CNR por celda', 'CNR per cell')}</th><th>{tr('pérdida sin clutter', 'loss without clutter')}</th><th>{tr('pérdida con clutter', 'loss with clutter')}</th><th>{tr('debida al clutter', 'due to clutter')}</th></tr></thead>
              <tbody>
                {P.casos.map(c => (
                  <tr key={c.Rkm} className="norow">
                    <td>{c.Rkm} km</td><td>{c.cnrDb === null ? tr('bajo el horizonte del mar', 'below the sea horizon') : fmt(c.cnrDb, 1) + ' dB'}</td>
                    <td>{fmt(num(c.perdidaLimpioDb), 2)} dB</td><td>{fmt(num(c.perdidaDb), 2)} dB</td>
                    <td className={num(c.perdidaDb) - num(c.perdidaLimpioDb) > 1 ? 'warn' : ''}>{fmt(Math.max(0, num(c.perdidaDb) - num(c.perdidaLimpioDb)), 2)} dB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title={tr('B1 · rozaolas nominal frente a distancia', 'B1 · nominal sea-skimmer versus range')} hint={tr('0,1 m² · analítica frente a Monte Carlo con CA-CFAR', '0.1 m² · analytical versus Monte Carlo with CA-CFAR')}>
          <LinePlot series={[
            { x: B1.Rkm, y: B1.pdTh.map(v => 100 * v), color: '#ededf0', width: 1.6, label: tr('analítica', 'analytical') },
            { x: B1.Rkm, y: B1.pdCfar.map(v => 100 * v), color: '#ffc061', width: 1.6, label: 'Monte Carlo' },
          ]} xRange={[B1.Rkm[0], B1.Rkm[B1.Rkm.length - 1]]} yRange={[80, 101]} xLabel={tr('distancia (km)', 'range (km)')} yLabel="Pd (%)" aspect={0.3} xTicks={6} yTicks={4}
            xFmt={v => fmt(v, 0)} />
          <p className="note">{tr('Con 96 kW de pico el rozaolas tiene SNR integrada de 29 a 100 dB: la Pd es ≈ 1 hasta el horizonte salvo en el nulo de multitrayecto de 20–22 km. La limitación es geométrica, no de sensibilidad.', 'With 96 kW peak the sea-skimmer has an integrated SNR of 29 to 100 dB: Pd ≈ 1 up to the horizon except in the 20–22 km multipath null. The limitation is geometric, not sensitivity.')}</p>
        </Panel>
      </div>

      <div className="col">
        <Panel title={tr('Resultados', 'Results')} pad={false}>
          <div className="metrics">
            <Metric k={tr('teoría en el IC95 %', 'theory within 95 % CI')} v={`${inCi}/${A.pd.length}`} tone="good" />
            <Metric k={tr('Pfa medida', 'measured Pfa')} v={A.pfa.toExponential(1)} tone="good" />
            <Metric k={tr('pérdida sin clutter', 'loss without clutter')} v={fmt(meanClean, 1)} unit="dB" />
            <Metric k={tr('de ella, ventana', 'of which, window')} v={fmt(M.perdidaVentanaDb, 1)} unit="dB" />
            <Metric k={`${tr('pérdida con', 'loss with')} CNR ${fmt(num(P.casos[1].cnrDb), 0)} dB`} v={fmt(num(P.casos[1].perdidaDb), 1)} unit="dB" tone="warn" />
            <Metric k={`${tr('pérdida con', 'loss with')} CNR ${fmt(num(P.casos[0].cnrDb), 0)} dB`} v={fmt(num(P.casos[0].perdidaDb), 1)} unit="dB" tone="bad" />
          </div>
        </Panel>
        <Panel title={tr('Lectura', 'Reading')}>
          <ul className="findings">
            <li className="mejora"><span className="tag-k">{tr('validación', 'validation')}</span><b>{tr('La cadena reproduce la teoría', 'The chain reproduces theory')}</b>
              <p>{tr('Con el blanco centrado y sin clutter, la Pd simulada coincide con Pd = Pfa^(1/(1+SNR)) en todos los puntos, y la Pfa medida con el umbral de diseño. El simulador de señal es fiable.', 'With the target centred and no clutter, the simulated Pd matches Pd = Pfa^(1/(1+SNR)) at every point, and the measured Pfa matches the design threshold. The signal simulator is reliable.')}</p></li>
            <li className="metodo"><span className="tag-k">{tr('presupuesto', 'budget')}</span><b>~{fmt(meanClean, 1)} dB {tr('de pérdida de procesado', 'of processing loss')}</b>
              <p>{tr('Ventana de Chebyshev', 'Chebyshev window')} ({fmt(M.perdidaVentanaDb, 1)} dB), {tr('straddle en distancia y Doppler y CFAR con', 'range and Doppler straddle and CFAR with')} {M.celdasRefCfar} {tr('celdas. Cabe en los 6 dB de pérdidas del sistema que supone la ecuación radar.', 'cells. It fits within the 6 dB of system losses assumed by the radar equation.')}</p></li>
            <li className="limite"><span className="tag-k">{tr('hallazgo', 'finding')}</span><b>{tr('El clutter fuerte cuesta más de lo que supone la web', 'Strong clutter costs more than the web assumes')}</b>
              <p>{tr('Con CNR de', 'With a CNR of')} {fmt(num(P.casos[0].cnrDb), 0)} dB {tr('la pérdida sube a', 'the loss rises to')} {fmt(num(P.casos[0].perdidaDb), 1)} dB{tr(': la «cancelación de 35 dB» del modelo analítico es optimista con clutter fuerte y espectro ensanchado por el mar. Siguiente paso: calibrar la cancelación de la web con este resultado.', ': the “35 dB cancellation” of the analytical model is optimistic with strong clutter and a sea-broadened spectrum. Next step: calibrate the web cancellation with this result.')}</p></li>
          </ul>
        </Panel>
      </div>
    </main>
  );
}
