// Physical ceiling of MTD clutter cancellation: clutter Doppler spread through
// the window, oscillator phase noise (decorrelated by the round-trip delay) and
// pulse-to-pulse transmitter phase instability. Port of matlab/lib/radar/fuga_clutter.m
// and ruido_fase.m (validated against the I/Q chain in matlab/fase3_linea_base/mc_ruido_fase.m).
import { chebyshev } from './tapers';

export type OscQuality = 'bueno' | 'tipico' | 'pobre';

/** Single-sideband L(f) (dBc/Hz) at 100 Hz, 1, 10, 100 kHz and 1 MHz. Assumed values for three quality grades. */
export const OSC_TABLE: Record<OscQuality, number[]> = {
  bueno: [-100, -125, -140, -150, -160],
  tipico: [-85, -110, -125, -135, -145],
  pobre: [-70, -90, -105, -120, -130],
};
const OSC_F = [2, 3, 4, 5, 6];   // log10 of the table frequencies

/** Linear L(|f|) (1/Hz): log-log between points, −30 dB/dec below 100 Hz, flat above 1 MHz. */
export function phaseNoiseL(f: number, osc: OscQuality): number {
  const t = OSC_TABLE[osc];
  const x = Math.log10(Math.max(Math.abs(f), 1e-3));
  let y: number;
  if (x <= OSC_F[0]) y = t[0] - 30 * (x - OSC_F[0]);
  else if (x >= OSC_F[4]) y = t[4];
  else {
    let i = 0; while (x > OSC_F[i + 1]) i++;
    y = t[i] + (t[i + 1] - t[i]) * (x - OSC_F[i]);
  }
  return Math.pow(10, y / 10);
}

export interface MtdParams {
  np: number;         // CPI pulses
  prf: number;        // Hz
  B: number;          // pulse bandwidth (Hz)
  sllDb: number;      // Doppler window sidelobes (Chebyshev)
  osc: OscQuality | '';      // '' = no phase noise
  jitDeg: number;     // transmitter phase instability (RMS degrees)
}

/** Chebyshev window normalized to Σw² = 1 (unit thermal noise power in each bin). */
function window(np: number, sll: number): Float64Array {
  const w = chebyshev(np, sll);
  let e = 0; for (const v of w) e += v * v;
  const s = 1 / Math.sqrt(e);
  return w.map(v => v * s);
}

/** Spread leakage (Gaussian spectrum σf centered at fc) into each bin k = −Np/2…Np/2−1. */
function leakSpread(w: Float64Array, prf: number, sigmaF: number, fc: number): Float64Array {
  const np = w.length, T = 1 / prf, out = new Float64Array(np);
  // E|Y_k|² = Σ_d c(d)·ρ(d)·cos(2π(fc − f_k)dT), c(d) = Σ_m w_m w_{m+d}
  const c = new Float64Array(np);
  for (let d = 0; d < np; d++) for (let m = 0; m + d < np; m++) c[d] += w[m] * w[m + d];
  for (let j = 0; j < np; j++) {
    const fk = (j - np / 2) * prf / np;
    let acc = c[0];
    for (let d = 1; d < np; d++) {
      const rho = Math.exp(-2 * Math.PI * Math.PI * sigmaF * sigmaF * d * d * T * T);
      acc += 2 * c[d] * rho * Math.cos(2 * Math.PI * (fc - fk) * d * T);
    }
    out[j] = acc;
  }
  return out;
}

/** L(|f|)·(1 − |f|/B)·df on the inner grid i·df, |i| ≤ I (index i + I). */
function innerL(p: MtdParams): Float64Array {
  const M = 32 * p.np, df = p.prf / M, I = 16 * M, out = new Float64Array(2 * I + 1);
  for (let i = -I; i <= I; i++) {
    if (i === 0) continue;
    const f = i * df;
    out[i + I] = phaseNoiseL(f, p.osc as OscQuality) * Math.max(0, 1 - Math.abs(f) / p.B) * df;
  }
  return out;
}

/** Phase-noise leakage into each bin for a delay τ (s). */
function leakPn(p: MtdParams, W2: Float64Array, tau: number, Lin = innerL(p), Lout?: Float64Array): Float64Array {
  const np = p.np, prf = p.prf, M = 32 * np, df = prf / M, f1 = 16 * prf, I = 16 * M;
  const osc = p.osc as OscQuality, out = new Float64Array(np);
  // S is folded into one PRF period (|W|² is periodic) and then correlated with |W|²
  const fold = new Float64Array(M);
  for (let i = -I; i <= I; i++) {
    const Lv = Lin[i + I];
    if (Lv === 0) continue;
    const s = Math.sin(Math.PI * i * df * tau);
    fold[((i % M) + M) % M] += Lv * 4 * s * s;
  }
  for (let j = 0; j < np; j++) {
    const k = j - np / 2;
    let acc = 0;
    for (let r = 0; r < M; r++) acc += fold[r] * W2[(((r - k * 32) % M) + M) % M];
    out[j] = acc;
  }
  // outside ±16·PRF: |W|² replaced by its mean Σw² = 1, trapezoids with step min(250 Hz, 1/(16τ))
  const step = Math.min(250, 1 / (16 * tau));
  const n = Math.floor((p.B - f1) / step + 1e-9);
  let acc = 0, prev = 0;
  for (let q = 0; q <= n; q++) {
    const f = f1 + q * step, s = Math.sin(Math.PI * f * tau);
    const v = (step === 250 && Lout ? Lout[q] : phaseNoiseL(f, osc) * (1 - f / p.B)) * 4 * s * s;
    if (q > 0) acc += 0.5 * (prev + v) * step;
    prev = v;
  }
  for (let j = 0; j < np; j++) out[j] += 2 * acc;
  return out;
}

export interface Leak { total: Float64Array; spread: Float64Array; pn: Float64Array; jit: number; cancelDb: number; }

/**
 * Clutter leakage (unit power per pulse) into each Doppler bin and equivalent cancellation for the
 * environment engine, which integrates Np pulses without a window: −mean_k 10·log10(leak_k/Np) over |k| ≥ 2.
 */
export function clutterLeak(p: MtdParams, sigmaF: number, fc: number, tau: number): Leak {
  const w = window(p.np, p.sllDb);
  const spread = leakSpread(w, p.prf, sigmaF, fc);
  const pn = p.osc ? leakPn(p, windowSpectrum(w), tau) : new Float64Array(p.np);
  const jit = (p.jitDeg * Math.PI / 180) ** 2;
  const total = spread.map((v, j) => v + pn[j] + jit);
  let acc = 0, n = 0;
  for (let j = 0; j < p.np; j++) if (Math.abs(j - p.np / 2) >= 2) { acc += 10 * Math.log10(total[j] / p.np); n++; }
  return { total, spread, pn, jit, cancelDb: -acc / n };
}

/** |W(i·PRF/M)|², M = 32·Np (direct DFT). */
function windowSpectrum(w: Float64Array): Float64Array {
  const np = w.length, M = 32 * np, out = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    let re = 0, im = 0;
    for (let m = 0; m < np; m++) { const a = -2 * Math.PI * i * m / M; re += w[m] * Math.cos(a); im += w[m] * Math.sin(a); }
    out[i] = re * re + im * im;
  }
  return out;
}

// ───────────── range table (for the environment engine, cached) ─────────────
// sea clutter ends at the horizon (< 30 km with the antenna at 40 m) and rain at the shower edge
// (25 km): the grid extends to 60 km and the last value is held beyond that
const R_MIN = 100, R_MAX = 60e3, NR = 48;
const C0 = 299_792_458;
const pnCache = new Map<string, Float64Array[]>();

/** Phase-noise leakage on the range grid (expensive: cached by parameters). */
function pnTable(p: MtdParams): Float64Array[] {
  const key = `${p.np}:${p.prf}:${p.B}:${p.sllDb}:${p.osc}`;
  let t = pnCache.get(key);
  if (!t) {
    const W2 = windowSpectrum(window(p.np, p.sllDb)), Lin = p.osc ? innerL(p) : undefined;
    // L(f)·(1 − f/B) on the outer 250 Hz grid, shared by all delays < 250 µs
    const f1 = 16 * p.prf, nO = Math.max(0, Math.floor((p.B - f1) / 250 + 1e-9) + 1);
    const Lout = p.osc ? Float64Array.from({ length: nO }, (_, q) => phaseNoiseL(f1 + q * 250, p.osc as OscQuality) * (1 - (f1 + q * 250) / p.B)) : undefined;
    t = [];
    for (let i = 0; i < NR; i++) t.push(p.osc ? leakPn(p, W2, 2 * rGrid(i) / C0, Lin, Lout) : new Float64Array(p.np));
    if (pnCache.size > 16) pnCache.clear();
    pnCache.set(key, t);
  }
  return t;
}
const rGrid = (i: number) => R_MIN * Math.pow(R_MAX / R_MIN, i / (NR - 1));

/**
 * Cancellation (dB) versus range for a clutter spectrum that may depend on range:
 * spec(R) = {σf, fc}. Linear interpolation in log R over the range grid. Without a bin: mean in
 * dB over usable bins |k| ≥ 2; with bin k (−Np/2…Np/2−1): that bin's value (in the notch, ≈ 0 dB).
 */
export function cancelVsRange(p: MtdParams, spec: (R: number) => { sigmaF: number; fc: number }): (R: number, bin?: number | null) => number {
  const pn = pnTable(p), w = window(p.np, p.sllDb), jit = (p.jitDeg * Math.PI / 180) ** 2;
  const c = new Float64Array(NR), cb = new Float64Array(NR * p.np);
  for (let i = 0; i < NR; i++) {
    const sp = spec(rGrid(i)), sp0 = leakSpread(w, p.prf, sp.sigmaF, sp.fc);
    let acc = 0, n = 0;
    for (let j = 0; j < p.np; j++) {
      const v = -10 * Math.log10((sp0[j] + pn[i][j] + jit) / p.np);
      cb[i * p.np + j] = v;
      if (Math.abs(j - p.np / 2) >= 2) { acc += v; n++; }
    }
    c[i] = acc / n;
  }
  const lr0 = Math.log(R_MIN), dl = Math.log(R_MAX / R_MIN) / (NR - 1);
  return (R: number, bin?: number | null) => {
    const x = Math.min(Math.max((Math.log(Math.max(R, R_MIN)) - lr0) / dl, 0), NR - 1);
    const i = Math.min(Math.floor(x), NR - 2), t = x - i;
    if (bin === undefined || bin === null) return c[i] * (1 - t) + c[i + 1] * t;
    const j = (((bin + p.np / 2) % p.np) + p.np) % p.np;
    return cb[i * p.np + j] * (1 - t) + cb[(i + 1) * p.np + j] * t;
  };
}
