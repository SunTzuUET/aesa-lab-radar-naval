// Environment: weather, sea state, ship motion, refraction,
// atmospheric attenuation, sea and rain clutter, and multipath over the sea.
// Classic analytical models (references in each function). All in SI except
// where noted (degrees for user-facing angles, dB for powers).
import { C0, EARTH_R } from './config';
import P676 from './p676_table.json';
import { peAt, runPe, type PeGrid } from './pe';
import KTAB from './clutter_k_tabla.json';
import { cancelVsRange, type OscQuality } from './mtd';
import { eclipseFraction } from './waveform';

export const G_ACC = 9.80665;
const deg = Math.PI / 180;
const db = (x: number) => 10 * Math.log10(x);
const lin = (x: number) => Math.pow(10, x / 10);

export type Pol = 'H' | 'V';

export interface EnvConfig {
  // weather
  windMs: number;        // wind at ~10 m (m/s)
  windDirDeg: number;    // true direction it blows FROM (0 = north)
  swellHm: number;       // swell: significant height (m)
  swellTs: number;       // swell: period (s)
  swellDirDeg: number;   // true direction the swell comes from
  tempC: number;         // air temperature
  seaTempC: number;      // sea temperature
  rhPct: number;         // relative humidity (%)
  pressHpa: number;      // pressure (hPa)
  rainMmH: number;       // rain rate (mm/h)
  // ship
  headingDeg: number;    // true heading
  speedKn: number;       // speed (knots)
  finStab: boolean;      // fin stabilizers (roll damping)
  beamStab: boolean;     // electronic beam stabilization (compensates attitude)
  // radar versus environment
  pol: Pol;
  bandwidthHz: number;   // bandwidth after compression (range resolution)
  cancelDb: number;      // clutter improvement of Doppler processing (MTI/MTD), if not computed
  cancelPhys: boolean;   // computed cancellation: window, clutter spectrum, oscillator, transmitter
  osc: OscQuality;       // reference oscillator quality (phase noise)
  jitterDeg: number;     // pulse-to-pulse transmitter phase instability (RMS degrees)
  propPE: boolean;       // parabolic equation near and beyond the horizon (diffraction and ducting)
  layerOn: boolean;      // inversion layer (trilinear profile): elevated or surface duct
  layerBaseM: number;    // layer base (m)
  layerThickM: number;   // thickness (m)
  layerDeficitM: number; // M deficit across the layer (M units)
  clutterK: boolean;     // K-distributed sea clutter (spikes): CFAR detection loss
}

export const DEFAULT_ENV: EnvConfig = {
  windMs: 9, windDirDeg: 300, swellHm: 1.2, swellTs: 11, swellDirDeg: 250,
  tempC: 18, seaTempC: 20, rhPct: 75, pressHpa: 1013, rainMmH: 0,
  headingDeg: 0, speedKn: 16, finStab: true, beamStab: true,
  pol: 'H', bandwidthHz: 5e6, cancelDb: 35, propPE: true, clutterK: true,
  layerOn: false, layerBaseM: 150, layerThickM: 50, layerDeficitM: 40,
  cancelPhys: true, osc: 'tipico', jitterDeg: 0.2,
};

/** Generic frigate-type ship (class-typical assumptions). */
export const SHIP = {
  lengthM: 140, beamM: 18,
  rollPeriodS: 10.5,          // natural roll period
  pitchPeriodS: 6.5,
  zetaRoll: 0.06,             // roll damping without fins
  zetaRollFins: 0.25,         // with active fins
};

// ─────────────────────────── sea state ───────────────────────────

/**
 * Fully developed wind sea, Pierson-Moskowitz spectrum:
 * Hs = 0.21 U²/g, ωp = 0.877 g/U (U at 19.5 m; the 10 m wind is used here).
 */
export function windSea(U: number): { hs: number; tp: number } {
  if (U < 0.3) return { hs: 0, tp: 2 };
  return { hs: 0.21 * U * U / G_ACC, tp: 2 * Math.PI * U / (0.877 * G_ACC) };
}

/** Combined significant height (wind sea + swell). */
export function totalHs(e: EnvConfig): number {
  const w = windSea(e.windMs).hs;
  return Math.hypot(w, e.swellHm);
}

/** Douglas scale (sea state) from Hs. */
export function douglas(hs: number): number {
  const lim = [0.0001, 0.1, 0.5, 1.25, 2.5, 4, 6, 9, 14];
  let s = 0;
  while (s < lim.length && hs > lim[s]) s++;
  return Math.min(9, s);
}
export const DOUGLAS_NAME = ['calma', 'rizada', 'marejadilla', 'marejada', 'fuerte marejada', 'gruesa', 'muy gruesa', 'arbolada', 'montañosa', 'enorme'];

/** Beaufort scale from wind speed (m/s). */
export function beaufort(U: number): number {
  const lim = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];   // WMO
  let b = 0;
  while (b < lim.length && U >= lim[b]) b++;
  return b;
}

/** Pierson-Moskowitz spectrum as a function of Hs and Tp: S(ω) (m²·s). */
function pmSpectrum(w: number, hs: number, tp: number): number {
  const wp = 2 * Math.PI / tp;
  return (5 / 16) * hs * hs * Math.pow(wp, 4) / Math.pow(w, 5) * Math.exp(-1.25 * Math.pow(wp / w, 4));
}

/** Wave components (for the 3D ocean and for ship motion). */
export interface WaveComp {
  amp: number;      // amplitude (m)
  omega: number;    // absolute frequency (rad/s)
  k: number;        // wavenumber (rad/m), deep water k = ω²/g
  dirDeg: number;   // propagation direction relative to the bow (0 = toward the bow: following sea)
  phase: number;
}

/** Discretizes a wave system (PM spectrum) into n components with directional spreading. */
function discretize(hs: number, tp: number, dirFromRelDeg: number, n: number, spreadDeg: number, seed: number): WaveComp[] {
  if (hs < 1e-3) return [];
  const wp = 2 * Math.PI / tp;
  const w0 = 0.7 * wp, w1 = 2.6 * wp, dw = (w1 - w0) / n;
  let rnd = seed;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const out: WaveComp[] = [];
  let m0 = 0;
  for (let i = 0; i < n; i++) {
    const w = w0 + (i + 0.5) * dw;
    const a = Math.sqrt(2 * pmSpectrum(w, hs, tp) * dw);
    m0 += a * a / 2;
    const spread = (rand() - 0.5) * 2 * spreadDeg;
    out.push({ amp: a, omega: w, k: w * w / G_ACC, dirDeg: dirFromRelDeg + 180 + spread, phase: rand() * 2 * Math.PI });
  }
  // rescale to preserve exactly Hs = 4√m0
  const s = hs / (4 * Math.sqrt(m0));
  out.forEach(c => { c.amp *= s; });
  return out;
}

/** Bow-relative angle (−180..180) of a true direction. */
export const relDeg = (trueDeg: number, headingDeg: number) => ((((trueDeg - headingDeg) % 360) + 540) % 360) - 180;

export function waveField(e: EnvConfig, nWind = 9, nSwell = 4): WaveComp[] {
  const ws = windSea(e.windMs);
  return [
    ...discretize(ws.hs, ws.tp, relDeg(e.windDirDeg, e.headingDeg), nWind, 35, 7),
    ...discretize(e.swellHm, e.swellTs, relDeg(e.swellDirDeg, e.headingDeg), nSwell, 8, 11),
  ];
}

// ─────────────────────── ship motion (seakeeping) ───────────────────────

export interface Osc { amp: number; omega: number; phase: number; }
export interface ShipMotion {
  roll: Osc[]; pitch: Osc[]; heave: Osc[];
  rollSigDeg: number; pitchSigDeg: number; heaveSigM: number;   // significant amplitudes (2σ)
  rollPeakPeriodS: number;
}

/**
 * Linear ship response (single-degree-of-freedom RAO) to each component,
 * with encounter frequency ωe = |ω − ω²·U·cos χ / g|.
 *  - roll: wave slope k·a·|sin χ| amplified by a damped oscillator (Tφ, ζ)
 *  - pitch and heave: ship-length filter 1/(1 + (L/λ)²) (short waves average out)
 */
export function shipMotion(e: EnvConfig, waves = waveField(e, 24, 10)): ShipMotion {
  const U = e.speedKn * 0.5144;
  const wn = 2 * Math.PI / SHIP.rollPeriodS, wnP = 2 * Math.PI / SHIP.pitchPeriodS;
  const zeta = e.finStab ? SHIP.zetaRollFins : SHIP.zetaRoll;
  const roll: Osc[] = [], pitch: Osc[] = [], heave: Osc[] = [];
  let vr = 0, vp = 0, vh = 0, best = 0, bestW = wn;
  for (const c of waves) {
    const chi = c.dirDeg * deg;                    // bow-relative propagation
    const we = Math.max(0.05, Math.abs(c.omega - c.omega * c.omega * U * Math.cos(chi) / G_ACC));
    const lam = 2 * Math.PI / c.k;
    const slope = c.k * c.amp;                     // rad
    const r = we / wn;
    const raoR = 1 / Math.sqrt((1 - r * r) ** 2 + (2 * zeta * r) ** 2);
    const lf = 1 / (1 + (SHIP.lengthM / lam) ** 2);
    const bf = 1 / (1 + (SHIP.beamM / lam) ** 2);
    const rP = we / wnP;
    const raoP = 1 / Math.sqrt((1 - rP * rP) ** 2 + (2 * 0.35 * rP) ** 2);
    const aR = Math.min(0.6, slope * Math.abs(Math.sin(chi)) * raoR * bf * 0.8);
    const aP = slope * Math.abs(Math.cos(chi)) * lf * raoP;
    const aH = c.amp * Math.sqrt(lf);
    roll.push({ amp: aR, omega: we, phase: c.phase });
    pitch.push({ amp: aP, omega: we, phase: c.phase + 1.1 });
    heave.push({ amp: aH, omega: we, phase: c.phase + 0.4 });
    vr += aR * aR / 2; vp += aP * aP / 2; vh += aH * aH / 2;
    if (aR > best) { best = aR; bestW = we; }
  }
  return {
    roll, pitch, heave,
    rollSigDeg: 2 * Math.sqrt(vr) / deg, pitchSigDeg: 2 * Math.sqrt(vp) / deg, heaveSigM: 2 * Math.sqrt(vh),
    rollPeakPeriodS: 2 * Math.PI / bestW,
  };
}

const sumOsc = (o: Osc[], t: number) => { let s = 0; for (const c of o) s += c.amp * Math.sin(c.omega * t + c.phase); return s; };

/** Instantaneous attitude: roll and pitch (rad, + = port up / bow up) and heave (m). */
export function attitudeAt(m: ShipMotion, t: number) {
  return { roll: sumOsc(m.roll, t), pitch: sumOsc(m.pitch, t), heave: sumOsc(m.heave, t) };
}

/**
 * Elevation pointing error due to attitude, for a beam at azimuth az
 * relative to the bow: δ ≈ θp·cos az + θr·sin az. Returns the RMS value (°).
 * With electronic stabilization a residual remains (latency of the INS and of
 * phase recomputation): 3 % of the motion + 0.02°.
 */
export function pointingErrorRmsDeg(m: ShipMotion, azRelDeg: number, stabilized: boolean): number {
  const sr = m.rollSigDeg / 2, sp = m.pitchSigDeg / 2;
  const a = azRelDeg * deg;
  const raw = Math.hypot(sp * Math.cos(a), sr * Math.sin(a));
  return stabilized ? 0.03 * raw + 0.02 : raw;
}

/** Mean two-way pointing loss (dB) with a Gaussian beam: 2·12·(δ/θ3)². */
export function pointingLossDb(errRmsDeg: number, hpbwDeg: number): number {
  return 2 * 12 * (errRmsDeg / Math.max(hpbwDeg, 0.05)) ** 2;
}

// ──────────────────────── refraction and ducting ────────────────────────

/** Saturation vapor pressure (hPa), ITU-R P.453 (water). */
export function satVapor(tC: number): number {
  return 6.1121 * Math.exp(17.502 * tC / (tC + 240.97));
}

/** Refractivity N = 77.6/T·(P + 4810·e/T)  (ITU-R P.453). */
export function refractivity(tC: number, pHpa: number, rhPct: number): number {
  const T = tC + 273.15, e = rhPct / 100 * satVapor(tC);
  return 77.6 / T * (pHpa + 4810 * e / T);
}

/** Absolute humidity (g/m³). */
export function absHumidity(tC: number, rhPct: number): number {
  const e = rhPct / 100 * satVapor(tC);
  return 216.7 * e / (tC + 273.15);
}

/**
 * Refractivity gradient in the first km from the CRPL exponential model
 * (ΔN = −7.32·e^{0.005577·Ns} N/km) and effective earth k-factor.
 */
export function kFactor(Ns: number): { dNdh: number; k: number } {
  const dNdh = -7.32 * Math.exp(0.005577 * Ns);          // N/km
  const k = 1 / (1 + EARTH_R * dNdh * 1e-9);
  return { dNdh, k };
}

/**
 * Evaporation duct height, log profile under neutral stability
 * (simplified Paulus-Jeske): N(z) = N₀ + ΔN·ln(z/z₀)/ln(zr/z₀), with N₀ the
 * saturated air (98 %) at sea temperature and ΔN = N(zr) − N₀.
 * The minimum of M(z) = N(z) + 0.157·z lies at δ = −ΔN / (0.157·ln(zr/z₀)).
 */
export function evapDuct(e: EnvConfig): { heightM: number; minFreqHz: number } {
  const zr = 6, z0 = 1.5e-4;
  const N0 = refractivity(e.seaTempC, e.pressHpa, 98);
  const Nr = refractivity(e.tempC, e.pressHpa, e.rhPct);
  const dN = Nr - N0;
  // coarse stability correction: air colder than the sea (unstable) thins the duct
  const dT = e.tempC - e.seaTempC;
  const stab = dT < 0 ? 1 / (1 - 0.06 * dT) : 1 + 0.04 * Math.min(dT, 5);
  const h = Math.max(0, -dN / (0.157 * Math.log(zr / z0)) * stab);
  // maximum trapped wavelength: λmax ≈ 0.0144·δ^1.5  (Kerr)
  const lmax = 0.0144 * Math.pow(h, 1.5);
  return { heightM: Math.min(h, 40), minFreqHz: lmax > 0 ? C0 / lmax : Infinity };
}

// ─────────────────────────── attenuation ───────────────────────────

/**
 * Specific gaseous attenuation (dB/km), ITU-R P.676, interpolated from a table generated with
 * MATLAB gaspl (matlab/fase2_entorno/tabla_p676.m): γ_O2 (dry air) and γ_H2O, grid
 * f 2.5–4.5 GHz × T −10–40 °C × ρ 0–30 g/m³ × P 950–1050 hPa, multilinear interpolation.
 */
export function gasAttenDbKm(fHz: number, tC: number, pHpa: number, rho: number): { o2: number; h2o: number } {
  const t = P676;
  const loc = (ax: number[], v: number) => {
    const x = Math.min(ax[ax.length - 1], Math.max(ax[0], v));
    let i = 0; while (i < ax.length - 2 && x > ax[i + 1]) i++;
    return [i, (x - ax[i]) / (ax[i + 1] - ax[i])] as const;
  };
  const [ia, fa] = loc(t.fGHz, fHz / 1e9), [ib, fb] = loc(t.T, tC), [ic, fc] = loc(t.rho, rho), [id, fd] = loc(t.P, pHpa);
  const nT = t.T.length, nR = t.rho.length, nP = t.P.length;
  let o2 = 0, h2o = 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let d = 0; d < 2; d++) {
    const w = (a ? fa : 1 - fa) * (b ? fb : 1 - fb) * (d ? fd : 1 - fd);
    o2 += w * t.o2[((ia + a) * nT + (ib + b)) * nP + (id + d)];
    for (let c = 0; c < 2; c++) {
      const wc = w * (c ? fc : 1 - fc);
      h2o += wc * t.h2o[(((ia + a) * nT + (ib + b)) * nR + (ic + c)) * nP + (id + d)];
    }
  }
  return { o2, h2o };
}

/**
 * ITU-R P.838-3 k, α coefficients (H and V polarization), γ = k·R^α (dB/km), interpolated
 * in log f. Values extracted from rainpl (MATLAB, 1 m path to remove the path
 * reduction) by matlab/fase2_entorno/val_entorno.m.
 */
const P838: [number, number, number, number, number][] = [
  // f GHz, kH, αH, kV, αV (0.1 GHz step)
  [1.0, 6.47318e-05, 0.96907, 7.69934e-05, 0.85922],
  [1.1, 6.98920e-05, 0.97783, 8.48096e-05, 0.86455],
  [1.2, 7.70369e-05, 0.98761, 9.58867e-05, 0.87097],
  [1.3, 8.61507e-05, 0.99786, 1.09626e-04, 0.87839],
  [1.4, 9.73072e-05, 1.00824, 1.25592e-04, 0.88667],
  [1.5, 1.10626e-04, 1.01853, 1.43410e-04, 0.89571],
  [1.6, 1.26235e-04, 1.02861, 1.62739e-04, 0.90542],
  [1.7, 1.44228e-04, 1.03842, 1.83262e-04, 0.91568],
  [1.8, 1.64610e-04, 1.04794, 2.04701e-04, 0.92641],
  [1.9, 1.87230e-04, 1.05723, 2.26816e-04, 0.93753],
  [2.0, 2.11717e-04, 1.06642, 2.49415e-04, 0.94896],
  [2.1, 2.37419e-04, 1.07569, 2.72354e-04, 0.96062],
  [2.2, 2.63384e-04, 1.08535, 2.95534e-04, 0.97246],
  [2.3, 2.88400e-04, 1.09578, 3.18896e-04, 0.98441],
  [2.4, 3.11098e-04, 1.10745, 3.42414e-04, 0.99642],
  [2.5, 3.30133e-04, 1.12091, 3.66082e-04, 1.00845],
  [2.6, 3.44386e-04, 1.13673, 3.89897e-04, 1.02048],
  [2.7, 3.53153e-04, 1.15542, 4.13844e-04, 1.03249],
  [2.8, 3.56261e-04, 1.17742, 4.37866e-04, 1.04450],
  [2.9, 3.54081e-04, 1.20298, 4.61846e-04, 1.05656],
  [3.0, 3.47448e-04, 1.23216, 4.85580e-04, 1.06876],
  [3.1, 3.37499e-04, 1.26480, 5.08761e-04, 1.08124],
  [3.2, 3.25498e-04, 1.30049, 5.30973e-04, 1.09421],
  [3.3, 3.12678e-04, 1.33862, 5.51706e-04, 1.10790],
  [3.4, 3.00126e-04, 1.37839, 5.70387e-04, 1.12262],
  [3.5, 2.88733e-04, 1.41891, 5.86434e-04, 1.13866],
  [3.6, 2.79186e-04, 1.45922, 5.99329e-04, 1.15635],
  [3.7, 2.71992e-04, 1.49839, 6.08694e-04, 1.17595],
  [3.8, 2.67520e-04, 1.53554, 6.14359e-04, 1.19764],
  [3.9, 2.66056e-04, 1.56991, 6.16408e-04, 1.22152],
  [4.0, 2.67836e-04, 1.60088, 6.15193e-04, 1.24755],
  [4.1, 2.73096e-04, 1.62801, 6.11317e-04, 1.27554],
  [4.2, 2.82094e-04, 1.65101, 6.05582e-04, 1.30516],
  [4.3, 2.95135e-04, 1.66976, 5.98925e-04, 1.33596],
  [4.4, 3.12586e-04, 1.68429, 5.92345e-04, 1.36734],
  [4.5, 3.34891e-04, 1.69476, 5.86844e-04, 1.39867],
  [4.6, 3.62572e-04, 1.70141, 5.83380e-04, 1.42927],
  [4.7, 3.96234e-04, 1.70456, 5.82850e-04, 1.45846],
  [4.8, 4.36567e-04, 1.70460, 5.86083e-04, 1.48560],
  [4.9, 4.84335e-04, 1.70192, 5.93855e-04, 1.51017],
  [5.0, 5.40376e-04, 1.69693, 6.06909e-04, 1.53173],
  [5.1, 6.05585e-04, 1.69001, 6.25988e-04, 1.54997],
  [5.2, 6.80906e-04, 1.68153, 6.51858e-04, 1.56472],
  [5.3, 7.67313e-04, 1.67183, 6.85339e-04, 1.57594],
  [5.4, 8.65797e-04, 1.66122, 7.27322e-04, 1.58371],
  [5.5, 9.77348e-04, 1.64994, 7.78791e-04, 1.58822],
  [5.6, 1.10294e-03, 1.63822, 8.40824e-04, 1.58974],
  [5.7, 1.24352e-03, 1.62625, 9.14603e-04, 1.58858],
  [5.8, 1.39998e-03, 1.61415, 1.00140e-03, 1.58511],
  [5.9, 1.57320e-03, 1.60206, 1.10258e-03, 1.57972],
  [6.0, 1.76397e-03, 1.59005, 1.21956e-03, 1.57276],
];
export function rainAttenDbKm(fHz: number, R: number, pol: Pol): number {
  if (R <= 0) return 0;
  const f = Math.min(6, Math.max(1, fHz / 1e9));
  let i = 0; while (i < P838.length - 2 && f > P838[i + 1][0]) i++;
  const [f0, kh0, ah0, kv0, av0] = P838[i], [f1, kh1, ah1, kv1, av1] = P838[i + 1];
  const t = Math.log(f / f0) / Math.log(f1 / f0);
  const k = pol === 'H' ? Math.exp(Math.log(kh0) + t * (Math.log(kh1) - Math.log(kh0))) : Math.exp(Math.log(kv0) + t * (Math.log(kv1) - Math.log(kv0)));
  const a = pol === 'H' ? ah0 + t * (ah1 - ah0) : av0 + t * (av1 - av0);
  return k * Math.pow(R, a);
}

export const RAIN_TOP_M = 3000;      // 0 °C isotherm height (assumed)
export const RAIN_RADIUS_M = 25e3;   // rain shower extent around the ship (assumed)

/**
 * Two-way atmospheric loss (dB) to a target at range R and elevation el.
 * Each term is integrated with an exponential profile of scale height H: the equivalent
 * length is R·(1 − e^{−x})/x with x = R·sin(el)/H.
 */
export function atmLossDb(fHz: number, e: EnvConfig, R: number, elRad: number): number {
  const rho = absHumidity(e.tempC, e.rhPct);
  const g = gasAttenDbKm(fHz, e.tempC, e.pressHpa, rho);
  const eq = (H: number) => { const x = R * Math.max(Math.sin(elRad), 1e-4) / H; return x < 1e-6 ? R : R * (1 - Math.exp(-x)) / x; };
  const rainLen = Math.min(R, RAIN_RADIUS_M, RAIN_TOP_M / Math.max(Math.sin(elRad), 1e-3));
  const one = g.o2 * eq(6000) / 1e3 + g.h2o * eq(2000) / 1e3 + rainAttenDbKm(fHz, e.rainMmH, e.pol) * rainLen / 1e3;
  return 2 * one;
}

/** Approximate meteorological visibility (km) for rendering: humidity and rain. */
export function visibilityKm(e: EnvConfig): number {
  const rh = Math.min(99.5, e.rhPct);
  const haze = 60 * Math.pow((100 - rh) / 60, 0.7);
  const rain = e.rainMmH > 0 ? 25 / Math.pow(e.rainMmH, 0.6) : Infinity;
  return Math.max(0.4, Math.min(80, 1 / (1 / haze + 1 / rain)));
}

// ─────────────────────────── clutter ───────────────────────────

/**
 * Sea reflectivity σ⁰ (dB m²/m²), NRL model (Gregers-Hansen and Mital, 2012),
 * valid for 0.1°–60° grazing, 0.5–35 GHz and sea states 0–6 (saturates at 6 above that).
 */
export function seaSigma0Db(grazDeg: number, fHz: number, ss: number, pol: Pol): number {
  const [c1, c2, c3, c4, c5] = pol === 'H'
    ? [-73.0, 20.78, 7.351, 25.65, 0.0054]
    : [-50.79, 25.93, 0.7093, 21.58, 0.00211];
  const p = Math.max(0.1, Math.min(60, grazDeg));
  ss = Math.min(6, Math.max(0, ss));                         // model validity: states 0–6
  const f = fHz / 1e9;
  return c1 + c2 * Math.log10(Math.sin(p * deg)) + (27.5 + c3 * p) * Math.log10(f) / (1 + 0.95 * p)
    + c4 * Math.pow(1 + ss, 1 / (2 + 0.085 * p + 0.033 * ss)) + c5 * p * p;
}

/** Rain volume reflectivity η (m²/m³): Z = 200·R^1.6 (Marshall-Palmer). */
export function rainEta(fHz: number, R: number): number {
  if (R <= 0) return 0;
  const lam = C0 / fHz;
  const Z = 200 * Math.pow(R, 1.6) * 1e-18;              // m⁶/m³
  return Math.pow(Math.PI, 5) * 0.93 * Z / Math.pow(lam, 4);
}

// ───────────────────────── multipath ─────────────────────────

/** Complex permittivity of seawater at f (single Debye model, 20 °C, 35 ‰). */
export function seaPermittivity(fHz: number): { re: number; im: number } {
  const eInf = 4.9, eS = 72, tau = 9.2e-12, sigma = 4.7, e0 = 8.854e-12;
  const w = 2 * Math.PI * fHz, wt = w * tau, den = 1 + wt * wt;
  return { re: eInf + (eS - eInf) / den, im: (eS - eInf) * wt / den + sigma / (w * e0) };
}

type Cx = [number, number];
const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: Cx, b: Cx): Cx => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const csqrt = (a: Cx): Cx => { const r = Math.hypot(a[0], a[1]); const re = Math.sqrt((r + a[0]) / 2); const im = Math.sign(a[1] || 1) * Math.sqrt(Math.max(0, (r - a[0]) / 2)); return [re, im]; };

/** Fresnel coefficient of a smooth sea (complex), ε = ε' − jε''. */
export function fresnel(psi: number, eps: { re: number; im: number }, pol: Pol): Cx {
  const s = Math.sin(psi), c2 = Math.cos(psi) ** 2;
  const ec: Cx = [eps.re, -eps.im];
  const root = csqrt([ec[0] - c2, ec[1]]);
  if (pol === 'H') return cdiv([s - root[0], -root[1]], [s + root[0], root[1]]);
  const es = cmul(ec, [s, 0]);
  return cdiv([es[0] - root[0], es[1] - root[1]], [es[0] + root[0], es[1] + root[1]]);
}

/** Ament roughness factor: ρs = exp(−2·(2π·σh·sin ψ/λ)²), with σh = Hs/4. */
export function roughness(psi: number, hs: number, lam: number): number {
  const g = 2 * Math.PI * (hs / 4) * Math.sin(psi) / lam;
  return Math.exp(-2 * g * g);
}

export interface Geometry {
  visible: boolean;
  elDirect: number;       // direct-ray elevation at the radar (rad)
  psi: number;            // grazing angle at the reflection point (rad)
  dPath: number;          // path difference (m)
  divergence: number;
}

/**
 * Two-ray geometry over a spherical earth of effective radius ae (Blake):
 * reflection point d1 from the trigonometric solution of the cubic, reduced
 * heights h' = h − d²/(2ae), ψ = atan(h1'/d1) and Δ from the image (≈ 2·h1'·h2'/d at low grazing).
 */
export function twoRayGeometry(h1: number, h2: number, d: number, ae: number): Geometry {
  const lo = Math.min(h1, h2), hi = Math.max(h1, h2);
  const dh = Math.sqrt(2 * ae * Math.max(lo, 0)) + Math.sqrt(2 * ae * Math.max(hi, 0));
  const elDirect = Math.atan2(h2 - h1, d) - d / (2 * ae);
  if (d >= dh) return { visible: false, elDirect, psi: 0, dPath: 0, divergence: 0 };
  const p = 2 / Math.sqrt(3) * Math.sqrt(ae * (lo + hi) + d * d / 4);
  const phi = Math.acos(Math.max(-1, Math.min(1, 2 * ae * (hi - lo) * d / (p * p * p))));
  let d1 = d / 2 - p * Math.cos((phi + Math.PI) / 3);   // from the lower antenna
  d1 = Math.max(1e-3, Math.min(d - 1e-3, d1));
  const d2 = d - d1;
  const h1r = lo - d1 * d1 / (2 * ae), h2r = hi - d2 * d2 / (2 * ae);
  if (h1r <= 0 || h2r <= 0) return { visible: true, elDirect, psi: 0, dPath: 0, divergence: 0 };
  const psi = Math.atan(h1r / d1);
  // exact path difference from the image (also valid at short range, large ψ)
  const dPath = Math.sqrt(d * d + (h1r + h2r) ** 2) - Math.sqrt(d * d + (h2r - h1r) ** 2);
  const divergence = 1 / Math.sqrt(1 + 2 * d1 * d2 / (ae * d * Math.max(Math.tan(psi), 1e-9)));
  return { visible: true, elDirect, psi, dPath, divergence };
}

/**
 * Propagation factor F (amplitude, relative to free space on the beam axis):
 * F = | f(θd) + Γ·ρs·D·f(−ψ)·e^{−jkΔ} |, where f is the amplitude pattern relative to the peak.
 */
export function propagationFactor(
  geo: Geometry, lam: number, hs: number, eps: { re: number; im: number }, pol: Pol,
  patRel: (elRad: number) => number,
): number {
  if (!geo.visible) return 0;
  const fd = patRel(geo.elDirect);
  if (geo.psi <= 0) return fd;
  const G = fresnel(geo.psi, eps, pol);
  const amp = roughness(geo.psi, hs, lam) * geo.divergence * patRel(-geo.psi);
  const ph = -2 * Math.PI * geo.dPath / lam;
  const re = fd + amp * (G[0] * Math.cos(ph) - G[1] * Math.sin(ph));
  const im = amp * (G[0] * Math.sin(ph) + G[1] * Math.cos(ph));
  return Math.hypot(re, im);
}

/** Relative pattern (amplitude) from an elevation cut: θ → 10^((G(θb+Δ) − Gpeak)/20). */
export function patternFromCut(angDeg: Float64Array, gainDbi: Float64Array, beamElDeg: number, peakDbi: number, envelope: boolean) {
  const a0 = angDeg[0], step = angDeg[1] - angDeg[0], n = angDeg.length;
  // cut peak (the beam may not be exactly at the commanded elevation)
  let iPk = 0; for (let i = 1; i < n; i++) if (gainDbi[i] > gainDbi[iPk]) iPk = i;
  const elPk = angDeg[iPk];
  // amplitude table (avoids a pow() per evaluation)
  const amp = new Float64Array(n);
  for (let i = 0; i < n; i++) amp[i] = Number.isFinite(gainDbi[i]) ? Math.pow(10, (gainDbi[i] - peakDbi) / 20) : 1e-4;
  const at = (x: number) => {
    const f = (x - a0) / step;
    if (f <= 0 || f >= n - 1) return 1e-4;
    const i = Math.floor(f), t = f - i;
    return amp[i] * (1 - t) + amp[i + 1] * t;
  };
  return {
    /** relative to the direct-ray direction when envelope (one beam per elevation). */
    rel: (elRad: number, aimRad?: number) => {
      const el = elRad / deg;
      const off = envelope && aimRad !== undefined ? el - aimRad / deg : el - beamElDeg;
      return at(elPk + off);
    },
  };
}

// ───────────────────────── full chain ─────────────────────────

export interface EnvLink {
  K: number;                // SNR = K/R⁴ in free space (from the radar engine)
  fHz: number;
  hRadar: number;
  hpbwAzDeg: number; hpbwElDeg: number;
  extraLossDb: number;      // pointing losses due to motion, etc.
  tauS: number;
  rcs: number;
  grDbi: number; gtDbi: number;   // for clutter
  nPulses?: number;         // CPI pulses (MTD); default 16
  prfHz?: number;           // PRF (unambiguous range, eclipsing, MTD); default 2.5 kHz
  dopplerSllDb?: number;    // MTD Doppler window; default 50 dB
  dopplerBin?: number | null;   // target Doppler bin (null = mean over usable bins)
}

export interface EnvPoint {
  F: number;               // propagation factor (amplitude)
  snrFsDb: number;         // free space
  snrDb: number;           // with environment (propagation, atmosphere, pointing)
  cnrDb: number;           // clutter-to-noise after cancellation (sea + rain)
  sinrDb: number;          // with the K-clutter loss already applied
  kLossDb: number;         // detection loss due to sea spikes (dB)
  nuK: number;             // sea K shape in the cell (Infinity = Gaussian or no sea)
  eclipseDb: number;       // eclipsing loss (echo arriving while transmitting; Infinity = blind zone)
  ambiguous: boolean;      // beyond the unambiguous range c/(2·PRF)
}

/**
 * Pattern-independent clutter terms: sea base (without gain), grazing angle and rain, for the cell's
 * ring and the ambiguous rings (R mod Ru) + n·Ru, Ru = c/(2·PRF), which arrive simultaneously (folded).
 */
export interface ClutterTerms {
  seaBase: number; psi: number; rain: number; areaM2: number;
  fold: { seaBase: number; psi: number }[];
}

/** MTD cancellation versus range for sea and rain (cached by parameters). */
type CancelFn = (R: number, bin?: number | null) => number;
const cancelCache = new Map<string, { sea: CancelFn; rain: CancelFn }>();
export function cancelFns(L: EnvLink, e: EnvConfig) {
  // MTD with an even number of pulses (bins k = −Np/2…Np/2−1) and at least 4
  const np = Math.max(4, 2 * Math.round((L.nPulses ?? 16) / 2)), lam = C0 / L.fHz, thEl = L.hpbwElDeg * deg;
  const prf = L.prfHz ?? 2500, sll = L.dopplerSllDb ?? 50;
  const key = [np, prf, e.bandwidthHz, sll, e.osc, e.jitterDeg, e.windMs, L.fHz, L.hpbwElDeg].join(':');
  let c = cancelCache.get(key);
  if (!c) {
    const p = { np, prf, B: e.bandwidthHz, sllDb: sll, osc: e.osc, jitDeg: e.jitterDeg };
    // sea: σv = 0.12·U, centered at zero Doppler (the MTD centers its notch on sea clutter)
    const sfSea = 2 * 0.12 * e.windMs / lam;
    // rain (Nathanson): σv² = (0.42·k_s·R·θ_el)² + σ_turb², k_s = 4 (m/s)/km, σ_turb = 1 m/s;
    // it moves with the wind: mean radial velocity U/√2 (RMS over azimuth)
    const sfRain = (R: number) => 2 * Math.hypot(0.42 * 4e-3 * R * thEl, 1) / lam;
    c = {
      sea: cancelVsRange(p, () => ({ sigmaF: sfSea, fc: 0 })),
      rain: cancelVsRange(p, R => ({ sigmaF: sfRain(R), fc: 2 * e.windMs / Math.SQRT2 / lam })),
    };
    if (cancelCache.size > 16) cancelCache.clear();
    cancelCache.set(key, c);
  }
  return c;
}

/** Sea and rain clutter power relative to noise, after cancellation, excluding pattern gain. */
export function clutterTerms(L: EnvLink, e: EnvConfig, R: number, ae: number, ss: number, hs: number): ClutterTerms {
  const t = clutterRing(L, e, R, ae, ss, hs);
  const fold: ClutterTerms['fold'] = [];
  if (L.prfHz) {
    // clutter from previous sweeps: out to the sea horizon (with margin) or the edge of the rain shower
    const Ru = C0 / (2 * L.prfHz), rEnd = Math.max(Math.sqrt(2 * ae * L.hRadar) * 1.05, e.rainMmH > 0 ? RAIN_RADIUS_M : 0);
    // all rings with the same delay modulo the PRI: R mod Ru + n·Ru (excluding its own)
    for (let Rn = R % Ru; Rn < rEnd; Rn += Ru) {
      if (Math.abs(Rn - R) < 1 || Rn < 1) continue;
      const q = clutterRing(L, e, Rn, ae, ss, hs);
      if (q.seaBase > 0) fold.push({ seaBase: q.seaBase, psi: q.psi });
      t.rain += q.rain;
    }
  }
  return { ...t, fold };
}

function clutterRing(L: EnvLink, e: EnvConfig, R: number, ae: number, ss: number, hs: number) {
  const lam = C0 / L.fHz;
  const dR = C0 / (2 * e.bandwidthHz);
  const thAz = L.hpbwAzDeg * deg, thEl = L.hpbwElDeg * deg;
  // SNR of a 1 m² target at that range in free space (normalization)
  const unit = L.K / L.rcs / Math.pow(R, 4);
  const canc = e.cancelPhys ? cancelFns(L, e) : null;
  // sea: pulse-limited cell at low grazing angles
  let seaBase = 0, psi = 0, areaM2 = 0;
  const dh = Math.sqrt(2 * ae * L.hRadar);
  if (R < dh) {
    psi = Math.asin(Math.min(1, L.hRadar / R - R / (2 * ae)));
    if (psi > 0) {
      const area = R * (thAz / 1.33) * dR / Math.cos(psi);    // effective two-way width θ3/1.33 (Barton)
      areaM2 = area;
      const s0 = lin(seaSigma0Db(psi / deg, L.fHz, ss, e.pol));
      // propagation factor below the critical angle (interference zone)
      const psiC = lam / (4 * Math.PI * Math.max(hs / 4, 0.01));
      const fc = psi < psiC ? Math.pow(psi / psiC, 4) : 1;
      seaBase = unit * s0 * area * fc * lin(-(canc ? canc.sea(R, L.dopplerBin) : e.cancelDb));
    } else psi = 0;
  }
  // rain: cell volume inside the shower and below the isotherm
  let rain = 0;
  if (e.rainMmH > 0 && R < RAIN_RADIUS_M) {
    const hBeam = Math.min(R * thEl, RAIN_TOP_M);
    const vol = (Math.PI / 4) * (R * thAz) * hBeam * dR / 0.693 * 0.5;
    // rain has Doppler spread and mean velocity: without the physical model, 15 dB less cancellation
    rain = unit * rainEta(L.fHz, e.rainMmH) * vol * lin(-(canc ? canc.rain(R, L.dopplerBin) : Math.max(0, e.cancelDb - 15)));
  }
  return { seaBase, psi, rain, areaM2 };
}

// ───────────────────── K-distributed sea clutter ─────────────────────

/**
 * Shape ν of the sea K-distribution (Ward, Tough and Watts, 2006):
 *   log10 ν = (2/3)·log10 ψ° + (5/8)·log10 A_c − k_pol − cos(2·θ_sw)/3,  k_pol = 1.39 (VV), 2.09 (HH)
 * θ_sw: angle between look direction and swell (default 45°). Clamped to [0.1, 50].
 */
export function shapeK(psiDeg: number, areaM2: number, pol: Pol, swellAspectDeg = 45): number {
  const kp = pol === 'V' ? 1.39 : 2.09;
  const p = Math.min(Math.max(psiDeg, 0.1), 10);
  const l = (2 / 3) * Math.log10(p) + (5 / 8) * Math.log10(Math.max(areaM2, 1)) - kp - Math.cos(2 * swellAspectDeg * deg) / 3;
  return Math.min(Math.max(Math.pow(10, l), 0.1), 50);
}

/**
 * Detection loss (dB) of K clutter versus Gaussian clutter, with the CA-CFAR set to
 * hold Pfa = 10⁻⁶ (extra SNR for Pd 0.9, Swerling 1). Monte Carlo table from
 * matlab/fase3_linea_base/mc_clutter_k.m, interpolated in 1/ν and residual CNR (dB);
 * below 10 dB CNR it is scaled by the clutter fraction c/(1+c).
 */
export function kLossDb(nu: number, cnrDb: number): number {
  if (!Number.isFinite(nu) || nu >= 50 || !Number.isFinite(cnrDb)) return 0;
  const xs = [0, ...KTAB.nu.map(v => 1 / v)];
  const x = Math.min(1 / nu, xs[xs.length - 1]);
  const rowAt = (r: number[]) => {
    const ys = [0, ...r];
    let i = 0; while (i < xs.length - 2 && x > xs[i + 1]) i++;
    return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i]);
  };
  const c = KTAB.cnrDb, rows = KTAB.perdidaDb;
  const cc = Math.min(Math.max(cnrDb, c[0]), c[c.length - 1]);
  let j = 0; while (j < c.length - 2 && cc > c[j + 1]) j++;
  const t = (cc - c[j]) / (c[j + 1] - c[j]);
  const L = rowAt(rows[j]) * (1 - t) + rowAt(rows[j + 1]) * t;
  if (cnrDb >= c[0]) return L;
  const f = (cl: number) => { const v = Math.pow(10, cl / 10); return v / (1 + v); };
  return L * f(cnrDb) / f(c[0]);
}

/** Clutter (sea + rain) relative to noise including the two-way pattern gain toward the sea. */
export function clutterToNoise(L: EnvLink, e: EnvConfig, R: number, ae: number, ss: number, hs: number,
  patRel: (elRad: number) => number): { sea: number; rain: number; grazDeg: number } {
  const t = clutterTerms(L, e, R, ae, ss, hs);
  return { sea: t.psi > 0 ? t.seaBase * patRel(-t.psi) ** 4 : 0, rain: t.rain, grazDeg: t.psi / deg };
}

/** Precomputed context (refraction, sea, permittivity, attenuation) for evaluating many points. */
export function envContext(L: EnvLink, e: EnvConfig, pat: ReturnType<typeof patternFromCut>, envelope: boolean) {
  const Ns = refractivity(e.tempC, e.pressHpa, e.rhPct);
  const ae = kFactor(Ns).k * EARTH_R;
  const hs = totalHs(e);
  const gas = gasAttenDbKm(L.fHz, e.tempC, e.pressHpa, absHumidity(e.tempC, e.rhPct));
  return {
    L, e, pat, envelope, ae, hs, ss: douglas(hs), eps: seaPermittivity(L.fHz), lam: C0 / L.fHz,
    gasO2: gas.o2, gasH2o: gas.h2o, rainDbKm: rainAttenDbKm(L.fHz, e.rainMmH, e.pol),
    pe: e.propPE ? peFor(L.fHz, L.hRadar, ae / EARTH_R, evapDuct(e).heightM, e.pol, hs,
      e.layerOn ? [e.layerBaseM, e.layerThickM, e.layerDeficitM] : null) : null,
  };
}

// ───────────────────── parabolic equation (diffraction and ducting) ─────────────────────
// PE grid: up to 400 km and 1 km height. 4° Gaussian source (nearly isotropic in the
// grazing region); its pattern is divided out and the antenna pattern is applied in the direct direction.
export const PE_X = 400e3, PE_Z = 1000;
const PE_BW_DEG = 4;
export const PE_DX = 1000;   // engine PE range step (tests/pe.test.ts: compared against 250 m)
const peSrc = (el: number) => Math.exp(-2 * Math.log(2) * (el / deg / PE_BW_DEG) ** 2);
const peCache = new Map<string, PeGrid>();
/**
 * F(x, z) grid cached by rounded (f, antenna, k, duct, polarization, Hs, layer). Surface: real
 * sea with Fresnel Γ (Debye permittivity) times Ament roughness with σh = Hs/4.
 */
export function peFor(fHz: number, hRadar: number, k: number, ductM: number, pol: Pol = 'H', hs = 0,
  layer: [number, number, number] | null = null): PeGrid {
  const kq = Math.round(k * 100) / 100, dq = Math.round(ductM * 2) / 2, hq = Math.round(hs * 4) / 4;
  const key = `${fHz}:${hRadar}:${kq}:${dq}:${pol}:${hq}:${layer ? layer.join(',') : ''}`;
  let g = peCache.get(key);
  if (!g) {
    const eps = seaPermittivity(fHz), lam = C0 / fHz;
    const gamma = (psi: number): [number, number] => {
      const G = fresnel(psi, eps, pol), a = roughness(psi, hq, lam);
      return [G[0] * a, G[1] * a];
    };
    g = runPe({ fHz, hAnt: hRadar, pattern: peSrc, k: kq, ductM: dq, layer, gamma, xMax: PE_X, dx: PE_DX, zMax: PE_Z, nz: 4096, nOutX: 400, nOutZ: 401 });
    if (peCache.size > 12) peCache.clear();
    peCache.set(key, g);
  }
  return g;
}
/**
 * Weight of the PE versus two-ray by fraction of the horizon: 0 below 60 %
 * (interference zone, where two-ray with roughness is better), 1 above 90 %.
 */
export function peWeight(d: number, hR: number, hT: number, ae: number): number {
  const dH = Math.sqrt(2 * ae * hR) + Math.sqrt(2 * ae * Math.max(hT, 0));
  return Math.min(1, Math.max(0, (d / dH - 0.6) / 0.3));
}
export type EnvCtx = ReturnType<typeof envContext>;

/** Same as atmLossDb but with the context coefficients (no per-point ITU recomputation). */
function atmLossCtx(c: EnvCtx, R: number, elRad: number): number {
  const s = Math.max(Math.sin(elRad), 1e-4);
  const eq = (H: number) => { const x = R * s / H; return x < 1e-6 ? R : R * (1 - Math.exp(-x)) / x; };
  const rainLen = c.rainDbKm > 0 ? Math.min(R, RAIN_RADIUS_M, RAIN_TOP_M / Math.max(Math.sin(elRad), 1e-3)) : 0;
  return 2e-3 * (c.gasO2 * eq(6000) + c.gasH2o * eq(2000) + c.rainDbKm * rainLen);
}

/** Ground range from slant range (law of cosines on a spherical earth of radius ae). */
export function groundRange(R: number, h1: number, h2: number, ae: number): number {
  const a = ae + h1, b = ae + h2;
  return ae * Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - R * R) / (2 * a * b))));
}
/** Slant range from ground range. */
export function slantRange(d: number, h1: number, h2: number, ae: number): number {
  const a = ae + h1, b = ae + h2;
  return Math.sqrt(Math.max(0, a * a + b * b - 2 * a * b * Math.cos(d / ae)));
}

/**
 * SNR, CNR and SINR for a target at SLANT range R (m) and height hT (m).
 * The two-ray geometry works with ground range.
 * Accepts precomputed clutter terms.
 */
export function evalPoint(c: EnvCtx, R: number, hT: number, ct?: ClutterTerms): EnvPoint {
  const { L, e, pat } = c;
  const d = groundRange(R, L.hRadar, hT, c.ae);
  const geo = twoRayGeometry(L.hRadar, hT, d, c.ae);
  const aim = geo.elDirect;
  const rel = c.envelope ? (x: number) => pat.rel(x, aim) : (x: number) => pat.rel(x);
  let F = propagationFactor(geo, c.lam, c.hs, c.eps, e.pol, rel);
  if (c.pe && hT <= PE_Z && d <= PE_X) {
    const w = peWeight(d, L.hRadar, hT, c.ae);
    const fp = w > 0 ? peAt(c.pe, d, hT) : NaN;
    if (Number.isFinite(fp)) F = (1 - w) * F + w * fp / peSrc(geo.elDirect) * rel(geo.elDirect);
  }
  const snrFs = L.K / Math.pow(R, 4);
  const att = atmLossCtx(c, R, Math.max(geo.elDirect, 0));
  const snr = snrFs * Math.pow(F, 4) * lin(-att - L.extraLossDb);
  const t = ct ?? clutterTerms(L, e, R, c.ae, c.ss, c.hs);
  let sea = t.psi > 0 ? t.seaBase * rel(-t.psi) ** 4 : 0;
  // K shape of the cell's own ring (before adding folded rings)
  const nu = e.clutterK && sea > 0 ? shapeK(t.psi / deg, t.areaM2, e.pol) : Infinity;
  for (const q of t.fold) sea += q.seaBase * rel(-q.psi) ** 4;
  // eclipsing: target and clutter arriving together lose the same fraction (f² after compression)
  const fe = L.prfHz ? eclipseFraction(R, L.tauS, L.prfHz) : 1, ge = fe * fe;
  const cnr = (sea + t.rain) * ge;
  // K clutter: CFAR loss due to sea spikes, based on the residual sea CNR
  const kl = Number.isFinite(nu) ? kLossDb(nu, db(Math.max(sea * ge, 1e-30))) : 0;
  return {
    F, snrFsDb: db(snrFs), snrDb: db(Math.max(snr * ge, 1e-30)), cnrDb: db(Math.max(cnr, 1e-30)),
    sinrDb: db(Math.max(snr * ge / (1 + cnr), 1e-30)) - kl, kLossDb: kl, nuK: nu,
    eclipseDb: fe > 0 ? -20 * Math.log10(fe) : Infinity, ambiguous: !!L.prfHz && R > C0 / (2 * L.prfHz),
  };
}

/** Curves versus range at fixed height. */
export function linkVsRange(c: EnvCtx, Rm: ArrayLike<number>, hT: number): EnvPoint[] {
  const out: EnvPoint[] = [];
  for (let i = 0; i < Rm.length; i++) out.push(evalPoint(c, Rm[i], hT));
  return out;
}

/** Coverage diagram: SINR (dB) on a range × height grid (row 0 = maximum height). */
export function coverageGrid(c: EnvCtx, rMax: number, hMax: number, nx: number, ny: number): Float32Array {
  const out = new Float32Array(nx * ny);
  // clutter depends only on range: once per column
  const cols: ClutterTerms[] = [];
  for (let i = 0; i < nx; i++) cols.push(clutterTerms(c.L, c.e, rMax * (i + 0.5) / nx, c.ae, c.ss, c.hs));
  // horizontal axis = ground range; evaluation uses slant range
  for (let i = 0; i < nx; i++) {
    const d = rMax * (i + 0.5) / nx;
    for (let j = 0; j < ny; j++) {
      const h = hMax * (1 - (j + 0.5) / ny);
      out[j * nx + i] = evalPoint(c, slantRange(d, c.L.hRadar, h, c.ae), h, cols[i]).sinrDb;
    }
  }
  return out;
}

/** Serializable coverage diagram inputs (to compute it in a worker). */
export interface CoverageJob {
  L: EnvLink; e: EnvConfig; ang: Float64Array; gain: Float64Array; beamElDeg: number; peakDbi: number;
  envelope: boolean; rMax: number; hMax: number; nx: number; ny: number;
}
export function runCoverageJob(j: CoverageJob): Float32Array {
  const pat = patternFromCut(j.ang, j.gain, j.beamElDeg, j.peakDbi, j.envelope);
  return coverageGrid(envContext(j.L, j.e, pat, j.envelope), j.rMax, j.hMax, j.nx, j.ny);
}

/** Effective earth radius with the current surface refractivity. */
export function effectiveEarth(e: EnvConfig): number {
  return kFactor(refractivity(e.tempC, e.pressHpa, e.rhPct)).k * EARTH_R;
}
