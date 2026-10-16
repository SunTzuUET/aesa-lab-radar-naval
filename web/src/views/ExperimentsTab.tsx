// Experiments tab: the thesis (TFG) rules applied to the radar (phase 4, matlab/fase4_optimizacion/).
// Each experiment shows results precomputed in MATLAB (web/src/data/eN_*.json).
import { useMemo, useState, type ReactNode } from 'react';
import E1 from '../data/e1_particion.json';
import E2 from '../data/e2_canales.json';
import E3 from '../data/e3_ttd.json';
import E4 from '../data/e4_jammer.json';
import E6 from '../data/e6_robustez.json';
import { Metric, Panel, fmt } from '../ui/controls';
import { LinePlot } from './LinePlot';
import { phrases, tr } from '../i18n';
import { EXP_FRAGS } from '../i18nEngine';

const X = (s: string) => phrases(s, {}, EXP_FRAGS);

const COL = ['#59d8ff', '#ffc061', '#5fd8a2', '#c58cff', '#ff6b6b'];
const log10 = (x: number) => Math.log10(x);
const fmtPow = (v: number) => { const x = 10 ** v; return x < 1 ? fmt(x, 2) : fmt(x, 1); };

interface Exp {
  id: string; title: string; tfg: string; script: string;
  question: string; conclusion: string; body: () => ReactNode; side: () => ReactNode;
}

// ---------------------------------------------------------------- E2
function E2Body() {
  const D = E2;
  const L8 = useMemo(() => {
    const rows = D.mmin.filter(r => r.L === 8 && r.Mmin !== null);
    const Ks = [...new Set(rows.map(r => r.K))].sort((a, b) => a - b);
    return Ks.map((K, i) => {
      const rr = rows.filter(r => r.K === K).sort((a, b) => a.s - b.s);
      return { x: rr.map(r => log10(r.s)), y: rr.map(r => r.Mmin as number), color: COL[i], width: 1.6, label: `K = ${K}` };
    });
  }, [D]);
  const cota = useMemo(() => {
    const rows = D.mmin.filter(r => r.L === 8).sort((a, b) => a.s - b.s);
    return { x: rows.map(r => log10(r.s)), y: rows.map(r => r.rEff), color: '#8a8a94', width: 1.2, dash: [5, 4], label: tr('cota r_eff', 'r_eff bound') };
  }, [D]);
  const ej = D.ejemplo;
  const xs = L8.flatMap(s => s.x).concat(cota.x);
  return (
    <>
      <Panel title={tr('Puertos por subarray necesarios', 'Required ports per subarray')} hint={tr('subarrays de 8 elementos · criterio pérdida ≤ 1 dB y SLL ≤ −30 dB', '8-element subarrays · criterion loss ≤ 1 dB and SLL ≤ −30 dB')}>
        <LinePlot series={[cota, ...L8]} xRange={[Math.min(...xs) - 0.05, Math.max(...xs) + 0.05]} yRange={[0, 9]}
          xLabel={tr('s = Δu·L·d/λ (escala log)', 's = Δu·L·d/λ (log scale)')} yLabel={tr('M mínimo', 'minimum M')} aspect={0.38} xTicks={6} yTicks={9} xFmt={fmtPow} />
        <p className="note">{tr('s mide lo ancho que es el racimo de haces visto desde un subarray. La cota r_eff es el rango numérico del sector (valores singulares por encima del SLL de diseño): nunca se ha medido un M por debajo de ella.', 's measures how wide the beam cluster is as seen from a subarray. The r_eff bound is the numerical rank of the sector (singular values above the design SLL): no M below it has ever been measured.')}</p>
      </Panel>
      <Panel title={tr('Por qué: lóbulos de cuantización', 'Why: quantization lobes')} hint={tr(`haz del borde de un racimo de ${ej.uk.length} · subarrays de ${ej.L}`, `edge beam of a cluster of ${ej.uk.length} · subarrays of ${ej.L}`)}>
        <LinePlot series={[
          { x: ej.u, y: ej.idealDb, color: '#ededf0', width: 1, label: tr('digital puro', 'fully digital') },
          ...ej.M.map((m, i) => ({ x: ej.u, y: ej.pDb[i], color: i === 0 ? '#ff6b6b' : '#59d8ff', width: 1.2,
            label: `M = ${m}: SLL ${fmt(ej.sll[i], 0)} dB` })),
        ]} xRange={[-0.6, 0.6]} yRange={[-60, 0]} xLabel={tr('u = sen θ', 'u = sin θ')} yLabel="dB" aspect={0.36} xTicks={6} yTicks={6} xFmt={v => fmt(v, 1)} />
        <p className="note">{tr('Con un puerto por subarray el haz digital se aparta del apuntamiento analógico y los subarrays (4λ entre centros) generan lóbulos de rejilla. La ganancia apenas cae', 'With one port per subarray the digital beam departs from the analog pointing and the subarrays (4λ between centres) produce grating lobes. Gain barely drops')} ({fmt(ej.loss[0], 1)} dB){tr('; lo que rompe el diseño es el SLL.', '; what breaks the design is the SLL.')}</p>
      </Panel>
      <Panel title={tr('Canales de la cara 80×80', 'Channels of the 80×80 face')} hint={tr('mínimo que cumple el criterio · M = desfasadores por elemento', 'minimum meeting the criterion · M = phase shifters per element')}>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>{tr('situación', 'case')}</th>{D.caras.L.map(L => <th key={L}>L = {L}</th>)}</tr></thead>
            <tbody>
              {D.caras.casos.map((c, i) => (
                <tr key={c} className="norow">
                  <td>{X(c)}</td>
                  {D.caras.nch[i].map((n, j) => <td key={j} className={D.caras.L[j] === 8 ? 'hl' : ''}>{n} <small>M={D.caras.M[i][j]}</small></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">{tr('Subarrays grandes ahorran canales digitales pero piden más puertos, es decir, más desfasadores por elemento; los pequeños, al revés. Es el compromiso fully-connected / sub-connected del TFG. Digital puro:', 'Large subarrays save digital channels but need more ports, i.e. more phase shifters per element; small ones, the opposite. It is the fully-connected / sub-connected trade-off of the thesis. Fully digital:')} {D.N * D.N} {tr('canales', 'channels')}.</p>
      </Panel>
    </>
  );
}
function E2Side() {
  const D = E2;
  const ok = D.mmin.filter(r => r.Mmin !== null);
  const exact = ok.filter(r => r.Mmin === Math.min(r.K, r.rEff)).length;
  const below = ok.filter(r => (r.Mmin as number) < Math.min(r.K, r.rEff)).length;
  const j8 = D.caras.L.indexOf(8);
  return (
    <>
      <Panel title={tr('Resultados', 'Results')} pad={false}>
        <div className="metrics">
          <Metric k={tr('cota exacta', 'bound is exact')} v={`${exact}/${ok.length}`} tone="good" />
          <Metric k={tr('casos bajo la cota', 'cases below the bound')} v={String(below)} tone="good" />
          {D.caras.casos.map((c, i) => <Metric key={c} k={X(c.split(' (')[0])} v={String(D.caras.nch[i][j8])} unit={tr('canales', 'channels')} />)}
          <Metric k={tr('digital puro', 'fully digital')} v={String(D.N * D.N)} unit={tr('canales', 'channels')} tone="warn" />
        </div>
      </Panel>
      <Panel title={tr('Lectura', 'Reading')}>
        <ul className="findings">
          <li className="mejora"><span className="tag-k">{tr('cota', 'bound')}</span><b>N_ch ≥ N_sub·min(K, r_eff)</b>
            <p>{tr('Con haces repartidos r_eff ≥ K y queda N_ch ≥ N_sub·K: cada haz necesita su propia dimensión analógica, como cada banda y cada flujo en la cota N_RF ≥ B·N_s del TFG. Los haces en racimo comparten dimensiones.', 'With spread beams r_eff ≥ K and N_ch ≥ N_sub·K: each beam needs its own analog dimension, like each band and each stream in the thesis bound N_RF ≥ B·N_s. Clustered beams share dimensions.')}</p></li>
          <li className="metodo"><span className="tag-k">hardware</span><b>{tr('Taper en el módulo T/R', 'Taper in the T/R module')}</b>
            <p>{tr('A diferencia del TFG (módulo constante), el AESA aplica la amplitud en el módulo T/R, común a todos los haces. Por eso con M = K el haz es exacto.', 'Unlike the thesis (constant modulus), the AESA applies the amplitude in the T/R module, common to all beams. That is why with M = K the beam is exact.')}</p></li>
          <li className="limite"><span className="tag-k">{tr('hallazgo', 'finding')}</span><b>{tr('Frobenius no es el criterio del radar', 'Frobenius is not the radar criterion')}</b>
            <p>{tr('El descompositor del TFG (PE-AltMin) baja el error de Frobenius pero empeora el SLL en el 29 % de los casos y solo lo mejora en el 20 %: minimizar el error global no controla los lóbulos.', 'The thesis decomposer (PE-AltMin) lowers the Frobenius error but worsens the SLL in 29 % of cases and improves it in only 20 %: minimizing the global error does not control the sidelobes.')}</p></li>
        </ul>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- E1
function E1Body() {
  const D = E1, ej = D.ejemplo;
  return (
    <>
      <Panel title={tr('SLL frente al desplazamiento del haz digital', 'SLL versus digital beam offset')} hint={tr(`fila de ${D.particiones.reduce((a, p) => a + p.tam.length, 0) / D.particiones.length} canales · δ en anchos de haz del subarray`, `row of ${D.particiones.reduce((a, p) => a + p.tam.length, 0) / D.particiones.length} channels · δ in subarray beamwidths`)}>
        <LinePlot series={D.particiones.map((p, i) => ({ x: D.delta, y: D.sllDb[i], color: COL[i], width: 1.6, label: X(p.nombre) }))}
          hMarks={[{ at: D.criterio.sllDb, color: '#8a8a94', label: tr('criterio', 'criterion') }]}
          xRange={[0, D.delta[D.delta.length - 1]]} yRange={[-45, 0]} xLabel={tr('δ (desplazamiento / ancho del subarray)', 'δ (offset / subarray beamwidth)')} yLabel="SLL (dB)" aspect={0.38} xTicks={5} yTicks={9} xFmt={v => fmt(v, 2)} />
        <p className="note">{tr('Con un puerto por subarray, todo haz digital que se aparte del apuntamiento analógico levanta lóbulos de cuantización. La partición decide cuánto.', 'With one port per subarray, any digital beam that departs from the analog pointing raises quantization lobes. The partition decides how much.')}</p>
      </Panel>
      <Panel title={tr('Diagrama con δ = 0,25', 'Pattern with δ = 0.25')} hint={tr('la regular concentra la energía en lóbulos; la irregular la reparte; el solape la elimina', 'the regular one concentrates energy in lobes; the irregular one spreads it; overlap removes it')}>
        <LinePlot series={[
          { x: ej.u, y: ej.idealDb, color: '#ededf0', width: 1, label: tr('digital puro', 'fully digital') },
          ...D.particiones.map((p, i) => ({ x: ej.u, y: ej.pDb[i], color: COL[i], width: 1.1, label: X(p.nombre.split(' (')[0]) })),
        ]} xRange={[-1, 1]} yRange={[-60, 0]} xLabel={tr('u = sen θ', 'u = sin θ')} yLabel="dB" aspect={0.36} xTicks={8} yTicks={6} xFmt={v => fmt(v, 2)} />
      </Panel>
      <Panel title={tr('Resumen por partición', 'Summary by partition')} hint={tr('un puerto por subarray salvo donde se indica', 'one port per subarray unless stated')}>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>{tr('partición', 'partition')}</th><th>{tr('entradas por elemento', 'inputs per element')}</th><th>{tr('δ máx. que cumple', 'max. δ meeting criterion')}</th><th>SLL (δ = {tr('0,25', '0.25')})</th><th>ISLR (δ = {tr('0,25', '0.25')})</th><th>{tr('4 haces en racimo', '4 clustered beams')}</th></tr></thead>
            <tbody>
              {D.particiones.map((p, i) => (
                <tr key={p.nombre} className="norow">
                  <td>{X(p.nombre)}</td><td>{fmt(p.entradasPorElem, p.entradasPorElem % 1 ? 1 : 0)}</td>
                  <td>{fmt(D.deltaMax[i], 3)} <small>{fmt(D.deltaMax[i] * D.bwSub / D.hpbwU, 1)} HPBW</small></td>
                  <td>{fmt(ej.sll[i], 1)} dB</td><td>{fmt(ej.islr[i], 1)} dB</td>
                  <td className={D.racimo4.Mmin[i] === 1 ? 'hl' : ''}>M = {D.racimo4.Mmin[i]} · {D.racimo4.Mmin[i] * 100} {tr('canales', 'channels')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">{tr('Canales en la cara 2D de 100 subarrays (racimo en acimut). ISLR del digital puro:', 'Channels in the 2D face of 100 subarrays (cluster in azimuth). Fully digital ISLR:')} {fmt(ej.islrIdeal, 1)} dB.</p>
      </Panel>
    </>
  );
}
function E1Side() {
  const D = E1, ej = D.ejemplo;
  return (
    <>
      <Panel title={tr('Resultados', 'Results')} pad={false}>
        <div className="metrics">
          {D.particiones.map((p, i) => <Metric key={p.nombre} k={`SLL ${X(p.nombre.split(' (')[0])}`} v={fmt(ej.sll[i], 1)} unit="dB" tone={ej.sll[i] <= D.criterio.sllDb + 0.5 ? 'good' : ej.sll[i] < -15 ? 'warn' : 'bad'} />)}
          <Metric k={tr('racimo de 4, regular', 'cluster of 4, regular')} v={String(D.racimo4.Mmin[0] * 100)} unit={tr('canales', 'channels')} />
          <Metric k={tr('racimo de 4, solape ×3', 'cluster of 4, overlap ×3')} v={String(D.racimo4.Mmin[3] * 100)} unit={tr('canales', 'channels')} tone="good" />
        </div>
      </Panel>
      <Panel title={tr('Lectura', 'Reading')}>
        <ul className="findings">
          <li className="mejora"><span className="tag-k">{tr('solape', 'overlap')}</span><b>{tr('Mitad de canales y de desfasadores', 'Half the channels and phase shifters')}</b>
            <p>{tr('Con solape ×3 y ventana de Hann, 4 haces en racimo salen con 100 canales y un desfasador por elemento, frente a 200 y dos con la partición regular. El precio es un divisor 1:3 por elemento en la red de combinación.', 'With ×3 overlap and a Hann window, 4 clustered beams need 100 channels and one phase shifter per element, versus 200 and two with the regular partition. The price is a 1:3 splitter per element in the combining network.')}</p></li>
          <li className="limite"><span className="tag-k">irregular</span><b>{tr('Baja el pico, no la energía', 'It lowers the peak, not the energy')}</b>
            <p>{tr('Romper la periodicidad baja el lóbulo máximo', 'Breaking the periodicity lowers the peak sidelobe by')} {fmt(ej.sll[0] - ej.sll[1], 0)} dB{tr(', pero el ISLR apenas cambia', ', but the ISLR barely changes')} ({fmt(ej.islr[0], 1)} → {fmt(ej.islr[1], 1)} dB){tr(': la energía se reparte en un suelo de lóbulos.', ': the energy is spread into a sidelobe floor.')}</p></li>
          <li className="metodo"><span className="tag-k">{tr('TFG', 'thesis')}</span><b>{tr('Máscaras con intención', 'Masks with a purpose')}</b>
            <p>{tr('En el TFG la máscara no uniforme solo servía para cuadrar tamaños. Aquí se usa para romper la periodicidad, y el solape es una conexión parcial entre sub-connected y fully-connected.', 'In the thesis the non-uniform mask only served to make sizes fit. Here it is used to break periodicity, and overlap is a partial connection between sub-connected and fully-connected.')}</p></li>
        </ul>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- E6
function E6Body() {
  const D = E6, F = D.fallos, E = D.errores, R = D.recal;
  return (
    <>
      <Panel title={tr('Módulos T/R caídos al azar', 'Randomly failed T/R modules')} hint={tr('Monte Carlo con IC95 % frente a la teoría de errores de la pestaña Antena, ampliada con fallos', 'Monte Carlo with 95 % CI versus the error theory of the Antenna tab, extended with failures')}>
        <LinePlot series={[
          { x: F.pct, y: F.sllDb, color: '#59d8ff', width: 1.6, label: tr('SLL máximo', 'peak SLL') },
          { x: F.pct, y: F.farDb, color: '#ffc061', width: 1.6, label: tr('suelo lejano (MC)', 'far floor (MC)') },
          { x: F.pct, y: F.farTeoDb, color: '#ededf0', width: 1, dash: [5, 4], label: tr('suelo lejano (teoría)', 'far floor (theory)') },
        ]} hMarks={[{ at: D.ideal.sllDb, color: '#5e5e68', label: tr('cara ideal', 'ideal face') }]}
          xRange={[0, F.pct[F.pct.length - 1]]} yRange={[-65, -25]} xLabel={tr('módulos caídos (%)', 'failed modules (%)')} yLabel="dB" aspect={0.36} xTicks={4} yTicks={8} xFmt={v => fmt(v, 0)} />
        <p className="note">{tr('Pérdida de ganancia con un 10 % de fallos:', 'Gain loss with 10 % failures:')} {fmt(F.lossDb[F.pct.indexOf(10)], 2)} dB {tr('medida y', 'measured and')} {fmt(F.lossTeoDb[F.pct.indexOf(10)], 2)} dB {tr('teórica. Con 6400 elementos el suelo de lóbulos sube mucho, pero el SLL máximo apenas se mueve.', 'theoretical. With 6400 elements the sidelobe floor rises a lot, but the peak SLL hardly moves.')}</p>
      </Panel>
      <Panel title={tr('Errores de fase y amplitud', 'Phase and amplitude errors')} hint={tr('σ de fase y de amplitud a la vez', 'phase and amplitude σ together')}>
        <LinePlot series={[
          { x: E.sigPhDeg, y: E.sllDb, color: '#59d8ff', width: 1.6, label: tr('SLL máximo', 'peak SLL') },
          { x: E.sigPhDeg, y: E.farDb, color: '#ffc061', width: 1.6, label: tr('suelo lejano (MC)', 'far floor (MC)') },
          { x: E.sigPhDeg, y: E.farTeoDb, color: '#ededf0', width: 1, dash: [5, 4], label: tr('teoría', 'theory') },
        ]} xRange={[0, E.sigPhDeg[E.sigPhDeg.length - 1]]} yRange={[-65, -25]} xLabel={tr('σ fase (°)  ·  σ amplitud = σ fase / 10 dB', 'phase σ (°)  ·  amplitude σ = phase σ / 10 dB')} yLabel="dB" aspect={0.32} xTicks={6} yTicks={8} xFmt={v => fmt(v, 1)} />
      </Panel>
      <Panel title={tr('Subarrays enteros caídos y recalibración', 'Whole failed subarrays and recalibration')} hint={tr('un subarray de 64 elementos frente a 64 elementos sueltos', 'one 64-element subarray versus 64 scattered elements')}>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>{tr('caso', 'case')}</th><th>{tr('antes', 'before')}</th><th>{tr('pesos digitales', 'digital weights')}</th><th>{tr('re-taper de elemento', 'element re-taper')}</th></tr></thead>
            <tbody>
              {R.subN.map((n, i) => (
                <tr key={n} className="norow"><td>{n} {tr(`subarray${n > 1 ? 's' : ''} caído${n > 1 ? 's' : ''}`, `failed subarray${n > 1 ? 's' : ''}`)}</td>
                  <td>{fmt(R.subAntes[i], 1)} dB</td><td>{fmt(R.subDigital[i], 1)} dB</td><td className="hl">{fmt(R.subElemento[i], 1)} dB</td></tr>
              ))}
              {R.fallosPct.map((p, i) => (
                <tr key={'f' + p} className="norow"><td>{p} % {tr('de módulos al azar', 'random modules')}</td>
                  <td>{fmt(R.fallosAntes[i], 1)} dB</td><td>—</td><td className="hl">{fmt(R.fallosDespues[i], 1)} dB</td></tr>
              ))}
              <tr className="norow"><td>{tr('errores 1 dB / 10°, calibrados', '1 dB / 10° errors, calibrated')}</td><td>{fmt(R.erroresAntes, 1)} dB</td><td>—</td><td className="hl">{fmt(R.erroresDespues, 1)} dB</td></tr>
            </tbody>
          </table>
        </div>
        <p className="note">{tr('SLL máximo, media sobre posiciones al azar de los subarrays caídos; el central es el peor caso', 'Peak SLL, averaged over random positions of the failed subarrays; the central one is the worst case')} ({fmt(D.subarrays.centralSllDb, 1)} dB). {tr('Los pesos digitales tienen 99 grados de libertad; el re-taper de elemento, unos 6300. Recalibración con diagnóstico perfecto (heurística de Keizer).', 'The digital weights have 99 degrees of freedom; the element re-taper, about 6300. Recalibration with perfect diagnosis (Keizer heuristic).')}</p>
      </Panel>
    </>
  );
}
function E6Side() {
  const D = E6, F = D.fallos, i10 = F.pct.indexOf(10);
  return (
    <>
      <Panel title={tr('Resultados', 'Results')} pad={false}>
        <div className="metrics">
          <Metric k={tr('cara ideal (con dither)', 'ideal face (with dither)')} v={fmt(D.ideal.sllDb, 1)} unit="dB" />
          <Metric k={tr('10 % caídos', '10 % failed')} v={fmt(F.sllDb[i10], 1)} unit="dB" tone="warn" />
          <Metric k={tr('tras re-taper', 'after re-taper')} v={fmt(D.recal.fallosDespues[1], 1)} unit="dB" tone="good" />
          <Metric k={tr('subarray central caído', 'central subarray failed')} v={fmt(D.subarrays.centralSllDb, 1)} unit="dB" tone="bad" />
          <Metric k={tr('teoría frente a MC', 'theory versus MC')} v={tr('± 0,1', '± 0.1')} unit="dB" tone="good" />
          <Metric k={tr('sin dither (6 bits)', 'no dither (6 bits)')} v={fmt(D.ideal.sllSinDitherDb, 1)} unit="dB" tone="warn" />
        </div>
      </Panel>
      <Panel title={tr('Lectura', 'Reading')}>
        <ul className="findings">
          <li className="mejora"><span className="tag-k">{tr('validación', 'validation')}</span><b>{tr('La teoría de errores se cumple', 'The error theory holds')}</b>
            <p>{tr('Suelo de lóbulos, pérdida de ganancia y desapuntamiento coinciden con las fórmulas de la web ampliadas con un factor de Bernoulli para los fallos.', 'Sidelobe floor, gain loss and pointing error match the web formulas extended with a Bernoulli factor for failures.')}</p></li>
          <li className="limite"><span className="tag-k">{tr('correlado', 'correlated')}</span><b>{tr('Un subarray caído pesa 7 veces más', 'A failed subarray weighs 7 times more')}</b>
            <p>{tr('64 elementos caídos juntos levantan lóbulos estructurados: unos 3 dB de SLL de media frente a 0,4 dB si caen al azar. Es lo que pasa si falla una fuente de alimentación.', '64 elements failing together raise structured lobes: about 3 dB of SLL on average versus 0.4 dB if they fail at random. This is what happens when a power supply fails.')}</p></li>
          <li className="metodo"><span className="tag-k">{tr('TFG', 'thesis')}</span><b>{tr('Grados de libertad otra vez', 'Degrees of freedom again')}</b>
            <p>{tr('Los pesos digitales (99 grados de libertad) recuperan 1,5 dB; el re-taper de elemento (≈ 6300), 2,8 dB. El mismo compromiso de grados de libertad del TFG y de E2.', 'The digital weights (99 degrees of freedom) recover 1.5 dB; the element re-taper (≈ 6300), 2.8 dB. The same degrees-of-freedom trade-off as in the thesis and E2.')}</p></li>
          <li className="limite"><span className="tag-k">{tr('hallazgo', 'finding')}</span><b>{tr('6 bits sin dither: −31 dB', '6 bits without dither: −31 dB')}</b>
            <p>{tr('Con TTD por subarray, el residuo de fase de los desfasadores se repite igual en los 100 subarrays y crea lóbulos de cuantización. El dither lo devuelve a −35 dB.', 'With TTD per subarray, the phase-shifter phase residue repeats identically in the 100 subarrays and creates quantization lobes. Dither brings it back to −35 dB.')}</p></li>
        </ul>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- E3
function E3Body() {
  const D = E3, ej = D.ejemplo, B = D.bits;
  const last = D.thetas.length - 1;
  return (
    <>
      <Panel title={tr('Ancho de banda instantáneo máximo', 'Maximum instantaneous bandwidth')} hint={tr('criterio completo: pérdida ≤ 1 dB y SLL ≤ −30 dB en los bordes de banda', 'full criterion: loss ≤ 1 dB and SLL ≤ −30 dB at the band edges')}>
        <LinePlot series={D.arquitecturas.map((a, i) => ({ x: D.thetas, y: D.BmaxMHz[i].map(v => log10(Math.max(v, 1))), color: COL[i], width: 1.6, label: X(a.replace('TTD por subarray ', 'TTD ')) }))}
          xRange={[D.thetas[0], D.thetas[last]]} yRange={[0.5, 3]} xLabel={tr('ángulo de barrido (°)', 'scan angle (°)')} yLabel={tr('B máx. (MHz, log)', 'max. B (MHz, log)')} aspect={0.4} xTicks={6} yTicks={5}
          xFmt={v => fmt(v, 0)} yFmt={v => fmt(10 ** v, 0)}
          hMarks={[{ at: log10(D.web.BMHz), color: '#8a8a94', label: `${tr('forma de onda de la web', 'web waveform')}: ${D.web.BMHz} MHz` }]} />
        <p className="note">{tr('El TTD por subarray corrige el squint (solo con el criterio de pérdida, L = 8 llega a', 'TTD per subarray corrects squint (with the loss criterion alone, L = 8 reaches')} {D.BmaxSoloPerdidaMHz[2][last]} {tr('MHz a 60°), pero fuera de f0 los retardos escalonados dejan saltos de fase entre subarrays que levantan lóbulos de cuantización. Ese límite cae aproximadamente como 1/L.', 'MHz at 60°), but away from f0 the stepped delays leave phase jumps between subarrays that raise quantization lobes. That limit falls roughly as 1/L.')}</p>
      </Panel>
      <Panel title={`${tr('Diagrama a', 'Pattern at')} ${fmt(ej.fGHz, 2)} GHz`} hint={tr(`borde de una banda de ${ej.BMHz} MHz · barrido a ${ej.thetaDeg}°`, `edge of a ${ej.BMHz} MHz band · scanned to ${ej.thetaDeg}°`)}>
        <LinePlot series={ej.nombres.map((n, i) => ({ x: ej.u, y: ej.pDb[i], color: [COL[4], COL[1], COL[0]][i], width: 1.1,
          label: `${X(n.replace('TTD por subarray ', 'TTD '))}: ${tr('pérdida', 'loss')} ${fmt(ej.loss[i], 1)} dB, SLL ${fmt(ej.sll[i], 0)} dB` }))}
          xRange={[-1, 1]} yRange={[-60, 0]} xLabel={tr('u = sen θ', 'u = sin θ')} yLabel="dB" aspect={0.36} xTicks={8} yTicks={6} xFmt={v => fmt(v, 2)} />
      </Panel>
      <Panel title={tr('Bits de retardo', 'Delay bits')} hint={tr('mínimo para alcanzar el B máximo con retardos continuos, a 60°', 'minimum to reach the max. B with continuous delays, at 60°')}>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>subarray</th><th>{tr('rango de retardo', 'delay range')}</th><th>{tr('bits (criterio completo)', 'bits (full criterion)')}</th><th>{tr('bits (solo pérdida)', 'bits (loss only)')}</th><th>{tr('con 3 bits, solo pérdida', 'with 3 bits, loss only')}</th></tr></thead>
            <tbody>
              {B.L.map((L, i) => (
                <tr key={L} className="norow"><td>L = {L}</td><td>{fmt(B.tauMaxNs[i], 1)} ns</td>
                  <td className="hl">{B.bMin[i]}</td><td>{B.bMinSoloPerdida[i]}</td><td>{B.BmaxSoloPerdidaMHz[i][B.b.indexOf(3)]} MHz</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">{tr('En el TFG bastaban 3 bits porque el producto τ_max·B era 0,11; aquí va de 0,16 a 1,02 con el criterio completo. Los «3 bits» eran un caso particular, no una regla general.', 'In the thesis 3 bits sufficed because the τ_max·B product was 0.11; here it ranges from 0.16 to 1.02 with the full criterion. The “3 bits” were a special case, not a general rule.')}</p>
      </Panel>
    </>
  );
}
function E3Side() {
  const D = E3, last = D.thetas.length - 1;
  return (
    <>
      <Panel title={tr('Resultados a 60°', 'Results at 60°')} pad={false}>
        <div className="metrics">
          {D.arquitecturas.map((a, i) => <Metric key={a} k={X(a.replace('TTD por subarray', 'TTD subarray'))} v={String(D.BmaxMHz[i][last])} unit="MHz" tone={i === 4 ? 'good' : undefined} />)}
          <Metric k={tr('pérdida con 5 MHz', 'loss at 5 MHz')} v={fmt(D.web.perdidaDb, 3)} unit="dB" tone="good" />
        </div>
      </Panel>
      <Panel title={tr('Lectura', 'Reading')}>
        <ul className="findings">
          <li className="limite"><span className="tag-k">{tr('choque con el TFG', 'clash with the thesis')}</span><b>{tr('El TTD por subarray no basta', 'TTD per subarray is not enough')}</b>
            <p>{tr('Corrige la pérdida por squint hasta cientos de MHz, pero sus lóbulos de cuantización dejan el límite con −30 dB en', 'It corrects squint loss up to hundreds of MHz, but its quantization lobes put the −30 dB limit at')} {D.BmaxMHz[2][last]} {tr('MHz para L = 8, por debajo de los', 'MHz for L = 8, below the')} {D.BmaxMHz[0][last]} {tr('MHz de no poner TTD. En el TFG no apareció porque su TTD era por columna, equivalente a por elemento en el plano de barrido.', 'MHz without TTD. It did not show up in the thesis because its TTD was per column, equivalent to per element in the scan plane.')}</p></li>
          <li className="metodo"><span className="tag-k">bits</span><b>{tr('4–5 bits, no 3', '4–5 bits, not 3')}</b>
            <p>{tr('El número de bits depende de τ_max·B. Con la apertura y la banda del radar hacen falta 4–5 bits de retardo.', 'The number of bits depends on τ_max·B. With the radar aperture and bandwidth, 4–5 delay bits are needed.')}</p></li>
          <li className="mejora"><span className="tag-k">web</span><b>{tr('La forma de onda actual va sobrada', 'The current waveform has ample margin')}</b>
            <p>{tr('Con 5 MHz la pérdida a 60° es de', 'At 5 MHz the loss at 60° is')} {fmt(D.web.perdidaDb, 3)} dB{tr(', unas 12 veces por debajo del límite: el simulador no necesita TTD con su forma de onda actual.', ', about 12 times below the limit: the simulator does not need TTD with its current waveform.')}</p></li>
          <li className="metodo"><span className="tag-k">{tr('enlace con E1', 'link with E1')}</span><b>{tr('El solape también ayuda aquí', 'Overlap helps here too')}</b>
            <p>{tr('Los lóbulos del TTD por subarray son los mismos lóbulos de cuantización de E1 y E2: los subarrays solapados son la vía natural para ampliar la banda.', 'The TTD-per-subarray lobes are the same quantization lobes as in E1 and E2: overlapped subarrays are the natural way to widen the band.')}</p></li>
        </ul>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- E4
function E4Body() {
  const D = E4, J = D.jammers, lJ = J.J.map(log10), L = D.lobulos, ej = D.ejemplo;
  const lj = { x: lJ, xRange: [0, log10(200)] as [number, number], xLabel: tr('jammers J (log)', 'jammers J (log)'), xFmt: (v: number) => fmt(10 ** v, 0) };
  const dof = [{ at: log10(D.dof), color: '#8a8a94', label: `${D.dof} ${tr('GdL', 'DoF')}`, dash: [4, 4] }];
  return (
    <>
      <Panel title={tr('Pérdida de SINR frente al número de jammers', 'SINR loss versus number of jammers')} hint={tr(`JNR ${D.jnrDb} dB por elemento · jammers al azar fuera del lóbulo principal · medianas`, `JNR ${D.jnrDb} dB per element · random jammers outside the main lobe · medians`)}>
        <LinePlot series={[
          { x: lj.x, y: J.lossConv, color: COL[4], width: 1.6, label: tr('haz fijo (Taylor)', 'fixed beam (Taylor)') },
          { x: lj.x, y: J.lossMvdrQ, color: COL[2], width: 1.8, label: tr('MVDR con patrón quiescente', 'MVDR with quiescent pattern') },
        ]} xRange={lj.xRange} yRange={[-1, 30]} xLabel={lj.xLabel} yLabel={tr('pérdida de SINR (dB)', 'SINR loss (dB)')} aspect={0.36} xTicks={5} yTicks={6}
          xFmt={lj.xFmt} vMarks={dof} />
        <p className="note">{tr('El adaptativo solo ve las', 'The adaptive processor only sees the')} {D.dof} {tr('salidas de subarray y aun así anula más jammers que grados de libertad: el haz analógico, apuntado al blanco, ya atenúa los lejanos, y lo que cuenta es cuántos quedan por encima del ruido a la salida de los subarrays. Con menos de 1 dB de pérdida aguanta 110 jammers con JNR de 40 dB, 130 con 30 dB y al menos 200 con 20 dB.', 'subarray outputs and still nulls more jammers than degrees of freedom: the analog beam, pointed at the target, already attenuates distant ones, and what counts is how many remain above noise at the subarray outputs. With less than 1 dB of loss it handles 110 jammers at 40 dB JNR, 130 at 30 dB and at least 200 at 20 dB.')}</p>
      </Panel>
      <Panel title={tr('Coste para el haz principal', 'Cost to the main beam')} hint={tr('SLL del diagrama adaptado (mediana)', 'SLL of the adapted pattern (median)')}>
        <LinePlot series={[
          { x: lj.x, y: J.sllMvdr, color: COL[1], width: 1.4, label: tr('MVDR puro', 'plain MVDR') },
          { x: lj.x, y: J.sllMvdrQ, color: COL[2], width: 1.8, label: tr('MVDR con patrón quiescente', 'MVDR with quiescent pattern') },
        ]} xRange={lj.xRange} yRange={[-35, -10]} xLabel={lj.xLabel} yLabel="SLL (dB)" aspect={0.3} xTicks={5} yTicks={5}
          xFmt={lj.xFmt} vMarks={dof} hMarks={[{ at: D.quiescente.sllDb, color: '#8a8a94', label: tr('diseño', 'design') }]} />
        <p className="note">{tr('El MVDR puro deshace el taper entre subarrays: gana 1,7 dB de SINR sin jammers, pero el SLL sube a', 'Plain MVDR undoes the taper across subarrays: it gains 1.7 dB of SINR without jammers, but the SLL rises to')} {fmt(J.sllMvdr[0], 1)} dB. {tr('Con el patrón quiescente el diagrama se mantiene en el de diseño hasta unos 40 jammers.', 'With the quiescent pattern the pattern stays at the design one up to about 40 jammers.')}</p>
      </Panel>
      <Panel title={tr('Dos jammers: el aliasing de los subarrays', 'Two jammers: subarray aliasing')} hint={tr('SLL tras anular dos jammers en función de su separación Δu', 'SLL after nulling two jammers as a function of their separation Δu')}>
        <LinePlot series={[{ x: L.dosDelta, y: L.dosSll.map(v => v ?? NaN), color: COL[0], width: 1.3 }]}
          xRange={[L.dosDelta[0], L.dosDelta[L.dosDelta.length - 1]]} yRange={[-35, -10]} xLabel={tr('separación Δu', 'separation Δu')} yLabel="SLL (dB)" aspect={0.3} xTicks={6} yTicks={5}
          xFmt={v => fmt(v, 2)} vMarks={[0.25, 0.5, 0.75].map((a, k) => ({ at: a, color: COL[4], label: `k = ${k + 1}`, dash: [3, 3] }))} />
        <p className="note">{tr('Separados k·λ/(L·d) = 0,25·k, las dos direcciones dan la misma respuesta a nivel de subarray. Al anularlas a la vez el SLL sube a −14…−20 dB, aunque la SINR casi no sufre. Es el mismo aliasing que los lóbulos de cuantización de E2, y lo que corrige E1.', 'Separated by k·λ/(L·d) = 0.25·k, both directions give the same response at subarray level. Nulling both raises the SLL to −14…−20 dB, although the SINR barely suffers. It is the same aliasing as the E2 quantization lobes, and what E1 corrects.')}</p>
      </Panel>
      <Panel title={tr('Ejemplo: tres jammers en el corte de acimut', 'Example: three jammers in the azimuth cut')} hint={tr('líneas de puntos: direcciones de los jammers', 'dotted lines: jammer directions')}>
        <LinePlot series={[tr('haz fijo', 'fixed beam'), tr('MVDR puro', 'plain MVDR'), tr('MVDR con patrón quiescente', 'MVDR with quiescent pattern')].map((n, i) => ({ x: ej.u, y: ej.cutDb[i], color: [COL[4], COL[1], COL[2]][i], width: 1.1, label: n }))}
          xRange={[-1, 1]} yRange={[-80, 0]} xLabel={tr('u = sen θ', 'u = sin θ')} yLabel="dB" aspect={0.36} xTicks={8} yTicks={8} xFmt={v => fmt(v, 2)}
          vMarks={ej.uj.map(u => ({ at: u, color: '#8a8a94', dash: [2, 3] }))} />
      </Panel>
    </>
  );
}
function E4Side() {
  const D = E4, J = D.jammers, R = D.rmb, i10 = J.J.indexOf(10), iK = R.K.indexOf(200);
  return (
    <>
      <Panel title={tr('Resultados', 'Results')} pad={false}>
        <div className="metrics">
          <Metric k={tr('grados de libertad', 'degrees of freedom')} v={String(D.dof)} unit="subarrays" />
          <Metric k={tr('10 jammers, haz fijo', '10 jammers, fixed beam')} v={fmt(J.lossConv[i10], 1)} unit={tr('dB pérdida', 'dB loss')} tone="warn" />
          <Metric k={tr('10 jammers, adaptativo', '10 jammers, adaptive')} v={fmt(Math.abs(J.lossMvdrQ[i10]), 2)} unit={tr('dB pérdida', 'dB loss')} tone="good" />
          <Metric k="RMB, K = 200" v={fmt(10 * log10(R.rho[iK]), 2)} unit={`dB (${tr('teoría', 'theory')} ${fmt(10 * log10(R.rhoTeoria[iK]), 2)})`} />
        </div>
      </Panel>
      <Panel title={tr('Lectura', 'Reading')}>
        <ul className="findings">
          <li className="mejora"><span className="tag-k">{tr('regla del TFG', 'thesis rule')}</span><b>{tr('N_RF también son grados de libertad', 'N_RF are also degrees of freedom')}</b>
            <p>{tr('En el TFG los canales digitales fijaban cuántos haces caben. En el radar fijan además cuántas interferencias se pueden anular, y la cara híbrida con 100 canales da para más de 100 jammers de ruido.', 'In the thesis the digital channels set how many beams fit. In the radar they also set how many interferers can be nulled, and the hybrid face with 100 channels handles more than 100 noise jammers.')}</p></li>
          <li className="limite"><span className="tag-k">{tr('límite', 'limit')}</span><b>{tr('Pares de jammers con aliasing', 'Aliased jammer pairs')}</b>
            <p>{tr('Dos jammers separados un múltiplo de λ/(L·d) son indistinguibles a nivel de subarray: anularlos rompe el diagrama. Un jammer solo, en un lóbulo de cuantización, no es un problema.', 'Two jammers separated by a multiple of λ/(L·d) are indistinguishable at subarray level: nulling them breaks the pattern. A single jammer in a quantization lobe is not a problem.')}</p></li>
          <li className="metodo"><span className="tag-k">{tr('validación', 'validation')}</span><b>Reed-Mallett-Brennan</b>
            <p>{tr('La pérdida del SMI con K snapshots coincide con la teoría en los 9 valores de K (IC del 95 %). Con carga diagonal basta K = 2J (regla de Carlson).', 'The SMI loss with K snapshots matches theory at all 9 values of K (95 % CI). With diagonal loading K = 2J suffices (Carlson’s rule).')}</p></li>
          <li className="metodo"><span className="tag-k">{tr('salvedad', 'caveat')}</span><b>{tr('Nulos ideales', 'Ideal nulls')}</b>
            <p>{tr('Los nulos de más de −100 dB salen de la covarianza exacta. En la práctica los limita la calibración (E6). Modelo de banda estrecha, JNR genérica y sin jammers en el lóbulo principal.', 'Nulls deeper than −100 dB come from the exact covariance. In practice they are limited by calibration (E6). Narrowband model, generic JNR and no main-lobe jammers.')}</p></li>
        </ul>
      </Panel>
    </>
  );
}

const EXPS = (): Exp[] => [
  {
    id: 'E1', title: tr('Partición en subarrays', 'Subarray partitioning'), tfg: tr('arquitecturas SC y máscaras', 'SC architectures and masks'),
    script: 'matlab/fase4_optimizacion/e1_particion_subarrays.m',
    question: tr('Con los mismos canales digitales, ¿qué partición (regular, irregular o solapada) reduce los lóbulos de cuantización y cuánto deja desplazar el haz digital?', 'With the same digital channels, which partition (regular, irregular or overlapped) reduces quantization lobes, and how far can the digital beam be offset?'),
    conclusion: tr('Con solape ×3 la cara forma 4 haces en racimo con 100 canales y un desfasador por elemento, la mitad que la partición regular; la irregular baja el pico de los lóbulos 7 dB pero no su energía.', 'With ×3 overlap the face forms 4 clustered beams with 100 channels and one phase shifter per element, half of the regular partition; the irregular one lowers the sidelobe peak by 7 dB but not their energy.'),
    body: () => <E1Body />, side: () => <E1Side />,
  },
  {
    id: 'E2', title: tr('Canales digitales frente a haces simultáneos', 'Digital channels versus simultaneous beams'), tfg: tr('cota N_RF ≥ B·N_s', 'bound N_RF ≥ B·N_s'),
    script: 'matlab/fase4_optimizacion/e2_canales_haces.m',
    question: tr('¿Cuántos canales digitales necesita la cara por subarrays para formar K haces de recepción simultáneos sin perder ganancia ni subir el SLL?', 'How many digital channels does the subarrayed face need to form K simultaneous receive beams without losing gain or raising the SLL?'),
    conclusion: tr('Cada subarray necesita M ≥ min(K, r_eff) puertos: en la cara de referencia, 200 canales para 4 haces en racimo, 300 para 8 y 700 para 8 repartidos, frente a 6400 del digital puro.', 'Each subarray needs M ≥ min(K, r_eff) ports: on the reference face, 200 channels for 4 clustered beams, 300 for 8 and 700 for 8 spread beams, versus 6400 for fully digital.'),
    body: () => <E2Body />, side: () => <E2Side />,
  },
  {
    id: 'E3', title: tr('TTD por subarray frente al ancho de banda', 'TTD per subarray versus bandwidth'), tfg: tr('TTD con 3 bits', 'TTD with 3 bits'),
    script: 'matlab/fase4_optimizacion/e3_ttd_ancho_banda.m',
    question: tr('¿A partir de qué ancho de banda instantáneo hace falta TTD por subarray, de qué tamaño de subarray y con cuántos bits de retardo?', 'Above what instantaneous bandwidth is TTD per subarray needed, with what subarray size and how many delay bits?'),
    conclusion: tr('A 60°, sin TTD la cara admite 58 MHz; el TTD por subarray de 8×8 elimina la pérdida hasta 500 MHz, pero sus lóbulos de cuantización dejan el límite con −30 dB en 47 MHz. Hacen falta 4–5 bits de retardo, no los 3 del TFG.', 'At 60°, without TTD the face supports 58 MHz; 8×8 TTD per subarray removes the loss up to 500 MHz, but its quantization lobes put the −30 dB limit at 47 MHz. 4–5 delay bits are needed, not the 3 of the thesis.'),
    body: () => <E3Body />, side: () => <E3Side />,
  },
  {
    id: 'E4', title: tr('Anulación adaptativa de jammers', 'Adaptive jammer nulling'), tfg: tr('grados de libertad N_RF', 'N_RF degrees of freedom'),
    script: 'matlab/fase4_optimizacion/e4_anulacion_jammer.m',
    question: tr('Con solo las 100 salidas de subarray, ¿cuántos jammers de ruido puede anular la cara, cuánta SINR recupera y qué le cuesta al haz principal?', 'With only the 100 subarray outputs, how many noise jammers can the face null, how much SINR does it recover and what does it cost the main beam?'),
    conclusion: tr('El MVDR con patrón quiescente anula más jammers que grados de libertad (130 con JNR de 30 dB, con menos de 1 dB de pérdida) y conserva el SLL de diseño hasta unos 40. Su punto débil son los pares de jammers separados un múltiplo de λ/(L·d): el mismo aliasing de subarray que en E1 y E2.', 'MVDR with a quiescent pattern nulls more jammers than degrees of freedom (130 at 30 dB JNR, with less than 1 dB of loss) and keeps the design SLL up to about 40. Its weak spot is jammer pairs separated by a multiple of λ/(L·d): the same subarray aliasing as in E1 and E2.'),
    body: () => <E4Body />, side: () => <E4Side />,
  },
  {
    id: 'E6', title: tr('Fallos de módulos T/R y recalibración', 'T/R module failures and recalibration'), tfg: tr('línea futura del TFG', 'future work of the thesis'),
    script: 'matlab/fase4_optimizacion/e6_robustez_fallos.m',
    question: tr('¿Cuánto se degradan el SLL y la ganancia con módulos T/R caídos y errores de fase o amplitud, y cuánto recupera una recalibración?', 'How much do SLL and gain degrade with failed T/R modules and phase or amplitude errors, and how much does recalibration recover?'),
    conclusion: tr('Con un 10 % de módulos caídos el SLL sube de −35,1 a −33,2 dB y el re-taper lo devuelve a −35,1 dB por 0,02 dB de ganancia; un subarray entero caído cuesta 7 veces más que los mismos elementos al azar.', 'With 10 % of modules failed the SLL rises from −35.1 to −33.2 dB and the re-taper brings it back to −35.1 dB for 0.02 dB of gain; a whole failed subarray costs 7 times more than the same elements at random.'),
    body: () => <E6Body />, side: () => <E6Side />,
  },
];
const PENDING = () => [
  { id: 'E1', title: tr('Partición en subarrays', 'Subarray partitioning'), tfg: tr('arquitecturas SC y máscaras', 'SC architectures and masks') },
  { id: 'E3', title: tr('TTD por subarray frente al ancho de banda', 'TTD per subarray versus bandwidth'), tfg: tr('TTD con 3 bits', 'TTD with 3 bits') },
  { id: 'E4', title: tr('Anulación adaptativa de jammers', 'Adaptive jammer nulling'), tfg: tr('grados de libertad N_RF', 'N_RF degrees of freedom') },
  { id: 'E5', title: tr('Misil rozaolas y multitrayecto', 'Sea-skimming missile and multipath'), tfg: '—' },
  { id: 'E6', title: tr('Fallos de módulos T/R y recalibración', 'T/R module failures and recalibration'), tfg: tr('línea futura del TFG', 'future work of the thesis') },
];

export function ExperimentsTab() {
  const exps = EXPS();
  const pending = PENDING().filter(p => !exps.some(e => e.id === p.id));
  const [sel, setSel] = useState(exps[0].id);
  const e = exps.find(x => x.id === sel) ?? exps[0];
  return (
    <main className="grid scen-grid">
      <div className="col">
        <Panel title={tr('Del TFG al radar', 'From the thesis to the radar')}>
          <p className="note">{tr('Cada experimento toma una conclusión del TFG (beamforming híbrido multibanda en mmWave) y la pone a prueba en la cara del radar en banda S, con métricas de radar: ganancia, SLL y SINR.', 'Each experiment takes a conclusion from the bachelor’s thesis (multiband hybrid beamforming at mmWave) and tests it on the S-band radar face with radar metrics: gain, SLL and SINR.')}</p>
          <ul className="exp-list">
            {exps.map(x => (
              <li key={x.id}><button className={'exp-item' + (x.id === sel ? ' on' : '')} onClick={() => setSel(x.id)}>
                <span className="scen-code">{x.id}</span><span><b>{x.title}</b><small>{tr('TFG', 'Thesis')}: {x.tfg}</small></span>
              </button></li>
            ))}
            {[...pending].sort((a, b) => a.id.localeCompare(b.id)).map(x => (
              <li key={x.id}><button className="exp-item" disabled>
                <span className="scen-code">{x.id}</span><span><b>{x.title}</b><small>{tr('pendiente · TFG', 'pending · thesis')}: {x.tfg}</small></span>
              </button></li>
            ))}
          </ul>
        </Panel>
      </div>
      <div className="col">
        <header className="scen-head">
          <span className="scen-code">{e.id}</span>
          <div>
            <h2>{e.title}</h2>
            <p>{e.question}</p>
          </div>
        </header>
        <div className="exp-concl"><span className="tag-k">{tr('conclusión', 'conclusion')}</span><p>{e.conclusion}</p></div>
        {e.body()}
        <p className="note">{tr('Reproducible con', 'Reproducible with')} <code>{e.script}</code>.</p>
      </div>
      <div className="col">{e.side()}</div>
    </main>
  );
}
