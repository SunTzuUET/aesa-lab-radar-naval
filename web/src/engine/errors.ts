// Face hardware errors (A1–A3):
//   A1 · per-element amplitude and phase (T/R tolerances, calibration residual)
//   A2 · per-subarray gain and phase (digital channel) and TTD delay error
//   A3 · phase quantization dither
// Composite model, for element n of subarray s:
//   w_n = a_n · g_n · G_s · exp(j(φ_n + δφ_n + δφ_s − 2π·f·τe_s))
// with g, G log-normal (σ in dB), δφ Gaussian and τe Gaussian per subarray.
// Realizations are deterministic for a given seed and scale linearly with σ
// (changing a σ changes the magnitude, not the "shape" of the error).
import type { FaceConfig, FaceGeometry } from './config';

export interface HwErrors {
  seed: number;
  sigAElemDb: number;     // per-element amplitude σ (dB)
  sigPhElemDeg: number;   // per-element phase σ (°)
  sigASubDb: number;      // per-subarray gain σ (dB)
  sigPhSubDeg: number;    // per-subarray phase σ (°)
  ttdPs: number;          // per-subarray TTD delay error σ (ps)
  dither: boolean;        // known random phase before quantization (A3)
}

export const DEFAULT_ERRORS: HwErrors = {
  seed: 1, sigAElemDb: 0, sigPhElemDeg: 0, sigASubDb: 0, sigPhSubDeg: 0, ttdPs: 0, dither: true,
};

export const hasErrors = (e: HwErrors) =>
  e.sigAElemDb > 0 || e.sigPhElemDeg > 0 || e.sigASubDb > 0 || e.sigPhSubDeg > 0 || e.ttdPs > 0;

/** Realization: multipliers already scaled by σ. */
export interface ErrorRealization {
  gain: Float64Array;      // per element: g_n·G_s (linear)
  phase: Float64Array;     // per element: δφ_n + δφ_s (rad)
  tau: Float64Array;       // per element: τe_s of its subarray's TTD (s)
  dither: Float64Array | null;   // known random phase per element (rad)
}

/** Deterministic PRNG (mulberry32) and standard normal via Box-Muller. */
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
  return { u, n };
}

const LN10_20 = Math.log(10) / 20;
const deg = Math.PI / 180;

/** Fixed standard normals for the seed (stored so they can be rescaled without redrawing). */
export interface ErrorDraws { zAe: Float64Array; zPe: Float64Array; zAs: Float64Array; zPs: Float64Array; zT: Float64Array; r: Float64Array; }
export function drawErrors(g: FaceGeometry, nSub: number, seed: number): ErrorDraws {
  const R = rng(seed * 2654435761);
  const f = (n: number) => { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = R.n(); return a; };
  const zAe = f(g.N), zPe = f(g.N), zAs = f(nSub), zPs = f(nSub), zT = f(nSub);
  const r = new Float64Array(g.N); for (let i = 0; i < g.N; i++) r[i] = 2 * Math.PI * R.u();
  return { zAe, zPe, zAs, zPs, zT, r };
}

export function realizeErrors(g: FaceGeometry, d: ErrorDraws, e: HwErrors): ErrorRealization {
  const gain = new Float64Array(g.N), phase = new Float64Array(g.N), tau = new Float64Array(g.N);
  for (let i = 0; i < g.N; i++) {
    const s = g.sub[i];
    gain[i] = Math.exp(LN10_20 * (e.sigAElemDb * d.zAe[i] + e.sigASubDb * d.zAs[s]));
    phase[i] = (e.sigPhElemDeg * d.zPe[i] + e.sigPhSubDeg * d.zPs[s]) * deg;
    tau[i] = e.ttdPs * 1e-12 * d.zT[s];
  }
  return { gain, phase, tau, dither: e.dither ? d.r : null };
}

// ───────────────────────── analytical predictions ─────────────────────────

/** Moments of a factor ε = g·e^{jδφ} with g log-normal (σ_dB) and δφ Gaussian (σ_rad). */
/**
 * Per-element error moments; with dither and B bits the quantization error is uniform
 * on [−π/2^B, π/2^B) and independent: E[e^{jq}] = sinc(2^{−B}) = sin(π/2^B)/(π/2^B).
 */
function elemMoments(e: HwErrors, bits: number) {
  const m = moments(e.sigAElemDb, e.sigPhElemDeg * deg);
  if (e.dither && bits > 0) { const x = Math.PI / (1 << bits); m.mu *= Math.sin(x) / x; }
  return m;
}

function moments(sigDb: number, sigPh: number) {
  const s = LN10_20 * sigDb;
  const mu = Math.exp(s * s / 2) * Math.exp(-sigPh * sigPh / 2);   // E[ε] (real)
  const m2 = Math.exp(2 * s * s);                                  // E|ε|²
  return { mu, m2 };
}

export interface ErrorPrediction {
  gainLossDb: number;        // mean gain loss in the commanded direction (receive)
  floorDb: number;           // mean residual sidelobe floor, relative to the ideal peak
  floorElemDb: number;       // part due to per-element errors
  floorSubPeakDb: number;    // subarray floor at the first sidelobe (near the beam), relative to the peak
  sigmaUElem: number; sigmaUSub: number; sigmaU: number;   // pointing error (sine space, RMS)
}

/**
 * Exact moment-based prediction for independent per-element (e) and per-subarray (s) errors,
 * with amplitude weights a_n (taper, including failures) and f the operating frequency:
 *   E|F(u0)|² = μe²μs²(Σa)² + μe²(m2s − μs²)·Σ_s(Σ_{n∈s}a_n)² + (m2e − μe²)·m2s·Σa²
 *   G/G0 = E|F(u0)|² / (m2e·m2s·(Σa)²)
 *   floor(u) =[(m2e − μe²)·m2s·Σa² + μe²(m2s − μs²)·Σ_s|SA_s(u)|²] / (Σa)²
 * and the linearized pointing error:Δu = −Σ a_n x_n δφ_n / (k·Σ a_n x_n²).
 */
export function predictErrors(g: FaceGeometry, face: FaceConfig, amp: Float64Array, e: HwErrors, fHz: number, bits = 0): ErrorPrediction {
  const sPh = Math.hypot(e.sigPhSubDeg * deg, 2 * Math.PI * fHz * e.ttdPs * 1e-12);
  const E = elemMoments(e, bits), S = moments(e.sigASubDb, sPh);
  const nSub = face.nSubX * face.nSubY;
  const subSum = new Float64Array(nSub), subX = new Float64Array(nSub);
  let sA = 0, sA2 = 0, sAx2 = 0, sA2x2 = 0;
  for (let i = 0; i < g.N; i++) {
    const a = amp[i], x = g.x[i];
    sA += a; sA2 += a * a; sAx2 += a * x * x; sA2x2 += a * a * x * x;
    subSum[g.sub[i]] += a; subX[g.sub[i]] += a * x;
  }
  let sSub2 = 0, sSubX2 = 0;
  for (let s = 0; s < nSub; s++) { sSub2 += subSum[s] ** 2; sSubX2 += subX[s] ** 2; }
  const EF2 = E.mu ** 2 * S.mu ** 2 * sA ** 2 + E.mu ** 2 * (S.m2 - S.mu ** 2) * sSub2 + (E.m2 - E.mu ** 2) * S.m2 * sA2;
  const gainLossDb = -10 * Math.log10(EF2 / (E.m2 * S.m2 * sA * sA));
  const elem = (E.m2 - E.mu ** 2) * S.m2 * sA2 / (sA * sA);
  // the subarray term, averaged over one period in u, equals Σa² (λ/2): same mean level
  const subAvg = E.mu ** 2 * (S.m2 - S.mu ** 2) * sA2 / (sA * sA);
  // near the beam (u ≈ u0 ± 1.5/N_x·λ/d) the subarray pattern is close to its maximum
  const subPeak = E.mu ** 2 * (S.m2 - S.mu ** 2) * sSub2 / (sA * sA);
  const k = 2 * Math.PI * fHz / 299_792_458;
  const sigmaUElem = (e.sigPhElemDeg * deg) * Math.sqrt(sA2x2) / (k * sAx2);
  const sigmaUSub = sPh * Math.sqrt(sSubX2) / (k * sAx2);
  const db = (x: number) => x > 0 ? 10 * Math.log10(x) : -Infinity;
  return {
    gainLossDb, floorDb: db(elem + subAvg), floorElemDb: db(elem), floorSubPeakDb: db(subPeak),
    sigmaUElem, sigmaUSub, sigmaU: Math.hypot(sigmaUElem, sigmaUSub),
  };
}

/**
 * Exact residual floor in direction (u, v), relative to the ideal peak (Σa)²:
 *   [(m2e − μe²)·m2s·Σa² + μe²(m2s − μs²)·Σ_s|SA_s(u, v)|²] / (Σa)²
 * with SA_s the array factor of subarray s with ideal weights (amplitude and steering phase).
 */
export function residualFloor(g: FaceGeometry, face: FaceConfig, wRe: Float64Array, wIm: Float64Array,
  e: HwErrors, fHz: number, u: number, v: number, bits = 0): number {
  const sPh = Math.hypot(e.sigPhSubDeg * deg, 2 * Math.PI * fHz * e.ttdPs * 1e-12);
  const E = elemMoments(e, bits), S = moments(e.sigASubDb, sPh);
  const k = 2 * Math.PI * fHz / 299_792_458;
  const nSub = face.nSubX * face.nSubY;
  const sr = new Float64Array(nSub), si = new Float64Array(nSub);
  let sA = 0, sA2 = 0;
  for (let i = 0; i < g.N; i++) {
    const a2 = wRe[i] * wRe[i] + wIm[i] * wIm[i];
    sA += Math.sqrt(a2); sA2 += a2;
    const ph = k * (g.x[i] * u + g.y[i] * v), c = Math.cos(ph), s = Math.sin(ph);
    sr[g.sub[i]] += wRe[i] * c - wIm[i] * s; si[g.sub[i]] += wRe[i] * s + wIm[i] * c;
  }
  let sub = 0; for (let s = 0; s < nSub; s++) sub += sr[s] * sr[s] + si[s] * si[s];
  return ((E.m2 - E.mu ** 2) * S.m2 * sA2 + E.mu ** 2 * (S.m2 - S.mu ** 2) * sub) / (sA * sA);
}
