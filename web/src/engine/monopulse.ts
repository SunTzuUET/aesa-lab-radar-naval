// Monopulse angle measurement for the face (antenna engineering): sum beam Σ with the receive
// taper and difference beam Δ by halves at subarray level (sign of the subarray center),
// which is what one digital channel per subarray allows. Ratio r = Im{Δ/Σ}; the angle is estimated
// by inverting the ideal curve (calibration). Port of matlab/lib/radar/monopulso_curva.m,
// validated in matlab/fase1_sistema/mc_monopulso.m.
import { C0, type BeamConfig, type FaceConfig, type FaceGeometry } from './config';
import { computeWeights, type Weights } from './array';
import type { ErrorRealization, HwErrors } from './errors';

const deg = Math.PI / 180;
export type MonoAxis = 'az' | 'el';

export interface MonoOptions {
  axis: MonoAxis;
  snrDb: number;          // sum-beam SNR on boresight (integrated)
  mmGainDb: number;       // gain mismatch of the Δ channel relative to Σ
  mmPhaseDeg: number;     // phase mismatch of the Δ channel relative to Σ
}

/** Δ weights: sign of the subarray center along the axis (0 for the center subarray if the count is odd). */
export function deltaWeights(g: FaceGeometry, w: Weights, axis: MonoAxis): Weights {
  const c = axis === 'az' ? g.xc : g.yc;
  return { re: w.re.map((v, i) => Math.sign(c[i]) * v), im: w.im.map((v, i) => Math.sign(c[i]) * v) };
}

/** Σ and Δ (complex) at offsets d (degrees) along the axis, from (az0, el0). */
export function monoCurve(g: FaceGeometry, wS: Weights, wD: Weights, f: number, d: ArrayLike<number>,
  az0: number, el0: number, axis: MonoAxis) {
  const k = 2 * Math.PI * f / C0, n = d.length;
  const S = { re: new Float64Array(n), im: new Float64Array(n) }, D = { re: new Float64Array(n), im: new Float64Array(n) };
  const r = new Float64Array(n);
  const exr = new Float64Array(g.Nx), exi = new Float64Array(g.Nx), eyr = new Float64Array(g.Ny), eyi = new Float64Array(g.Ny);
  for (let p = 0; p < n; p++) {
    const az = (axis === 'az' ? az0 + d[p] : az0) * deg, el = (axis === 'el' ? el0 + d[p] : el0) * deg;
    const u = Math.cos(el) * Math.sin(az), v = Math.sin(el);
    for (let ix = 0; ix < g.Nx; ix++) { const a = k * g.x[ix] * u; exr[ix] = Math.cos(a); exi[ix] = Math.sin(a); }
    for (let iy = 0; iy < g.Ny; iy++) { const a = k * g.y[iy * g.Nx] * v; eyr[iy] = Math.cos(a); eyi[iy] = Math.sin(a); }
    let sr = 0, si = 0, dr = 0, di = 0;
    for (let iy = 0; iy < g.Ny; iy++) for (let ix = 0; ix < g.Nx; ix++) {
      const i = iy * g.Nx + ix;
      const er = exr[ix] * eyr[iy] - exi[ix] * eyi[iy], ei = exr[ix] * eyi[iy] + exi[ix] * eyr[iy];
      sr += wS.re[i] * er - wS.im[i] * ei; si += wS.re[i] * ei + wS.im[i] * er;
      dr += wD.re[i] * er - wD.im[i] * ei; di += wD.re[i] * ei + wD.im[i] * er;
    }
    S.re[p] = sr; S.im[p] = si; D.re[p] = dr; D.im[p] = di;
    r[p] = (di * sr - dr * si) / (sr * sr + si * si);     // Im{Δ/Σ}
  }
  return { S, D, r };
}

/** Inverts the ideal curve on its monotonically increasing segment around 0 (saturates outside). */
export function invertCurve(d: ArrayLike<number>, rRef: ArrayLike<number>, r: number): number {
  let i0 = 0; for (let i = 1; i < d.length; i++) if (Math.abs(d[i]) < Math.abs(d[i0])) i0 = i;
  let a = i0; while (a > 0 && rRef[a - 1] < rRef[a]) a--;
  let b = i0; while (b < rRef.length - 1 && rRef[b + 1] > rRef[b]) b++;
  if (r <= rRef[a]) return d[a];
  if (r >= rRef[b]) return d[b];
  let i = a; while (rRef[i + 1] < r) i++;
  return d[i] + (d[i + 1] - d[i]) * (r - rRef[i]) / (rRef[i + 1] - rRef[i]);
}

export interface MonoResult {
  d: Float64Array; rIdeal: Float64Array; rActual: Float64Array; sumDb: Float64Array;
  theta3Deg: number; slopePerDeg: number; slopeNorm: number; rangeDeg: number;
  sigmaThermalDeg: number;     // thermal noise on boresight for the given SNR
  biasDeg: number;             // boresight bias for this realization (errors + mismatch)
  rmsQuarterDeg: number;       // RMS error over ±θ₃/4 for this realization
  biasStdPredDeg: number;      // predicted boresight bias σ for the error σ values
  slopeRel: number;            // actual / ideal slope (channel mismatch)
}

/**
 * Monopulse analysis at the current steering. errs: hardware error realization (or null).
 * Weights are the receive weights without coupling: the active-impedance approximation is not accurate
 * enough for the bias (the exact bias is < 0.01° on this face).
 */
export function monopulse(face: FaceConfig, g: FaceGeometry, beam: BeamConfig, failed: Uint8Array,
  errs: ErrorRealization | null, hw: HwErrors, o: MonoOptions): MonoResult {
  const f = face.f0 + beam.freqOffsetHz;
  const wI = computeWeights(face, g, beam, failed);
  const wA = errs ? computeWeights(face, g, beam, failed, undefined, errs) : wI;
  const dI = deltaWeights(g, wI, o.axis), dA = deltaWeights(g, wA, o.axis);
  // grid: ±1.25 times an estimate of θ₃ (within the Σ main lobe)
  const nAx = o.axis === 'az' ? g.Nx : g.Ny;
  const cosScan = o.axis === 'az' ? Math.cos(beam.azDeg * deg) : Math.cos(beam.elDeg * deg);
  const th3e = 1.15 / deg * (C0 / f) / (nAx * g.d * Math.max(cosScan, 0.2));
  const n = 241, d = Float64Array.from({ length: n }, (_, i) => -1.25 * th3e + 2.5 * th3e * i / (n - 1));
  const I = monoCurve(g, wI, dI, f, d, beam.azDeg, beam.elDeg, o.axis);
  const A = monoCurve(g, wA, dA, f, d, beam.azDeg, beam.elDeg, o.axis);
  // Δ channel mismatch:r' = Im{g·e^{jψ}·Δ/Σ}
  const gm = Math.pow(10, o.mmGainDb / 20), c = gm * Math.cos(o.mmPhaseDeg * deg), s = gm * Math.sin(o.mmPhaseDeg * deg);
  const rA = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    const sr = A.S.re[p], si = A.S.im[p], q = sr * sr + si * si;
    const qr = (A.D.re[p] * sr + A.D.im[p] * si) / q, qi = (A.D.im[p] * sr - A.D.re[p] * si) / q;   // Δ/Σ
    rA[p] = c * qi + s * qr;
  }
  // θ₃, slope and segment of the ideal curve
  const P = Float64Array.from({ length: n }, (_, p) => I.S.re[p] ** 2 + I.S.im[p] ** 2);
  let pk = 0; for (let p = 0; p < n; p++) pk = Math.max(pk, P[p]);
  let a = -1, b = -1; for (let p = 0; p < n; p++) if (P[p] >= pk / 2) { if (a < 0) a = p; b = p; }
  // linearly interpolated −3 dB crossings
  const cross = (i: number, j: number) => d[i] + (d[j] - d[i]) * (pk / 2 - P[i]) / (P[j] - P[i]);
  const th3 = (b < n - 1 ? cross(b, b + 1) : d[b]) - (a > 0 ? cross(a - 1, a) : d[a]);
  const i0 = (n - 1) / 2, h = d[1] - d[0];
  const slope = (I.r[i0 + 1] - I.r[i0 - 1]) / (2 * h);
  let e = i0; while (e < n - 1 && I.r[e + 1] > I.r[e]) e++;
  // thermal noise on boresight:σ_r² = (σ_Δ² + r²σ_Σ²)/(2|Σ|²), σ_θ = σ_r/pendiente
  let pS = 0, pD = 0, sum0 = 0;
  for (let i = 0; i < g.N; i++) { pS += wI.re[i] ** 2 + wI.im[i] ** 2; pD += dI.re[i] ** 2 + dI.im[i] ** 2; }
  sum0 = Math.sqrt(P[i0]);
  const snr = Math.pow(10, o.snrDb / 10);
  const sigR = Math.sqrt(pD / pS / (2 * snr));
  // realization error
  const bias = invertCurve(d, I.r, rA[i0]);
  let acc = 0, cnt = 0;
  for (let p = 0; p < n; p++) if (Math.abs(d[p]) <= th3 / 4) { const err = invertCurve(d, I.r, rA[p]) - d[p]; acc += err * err; cnt++; }
  // boresight bias σ (first order): phase → Im{δΔ}/Σ, amplitude → Re{δΔ}/Σ (the latter only with ψ ≠ 0)
  const amp = Float64Array.from(wI.re, (v, i) => Math.hypot(v, wI.im[i]));
  const As = new Float64Array(face.nSubX * face.nSubY);
  let a2 = 0; for (let i = 0; i < g.N; i++) { a2 += amp[i] ** 2; As[g.sub[i]] += amp[i]; }
  let A2 = 0; for (const v of As) A2 += v * v;
  const lnA = Math.log(10) / 20;
  const Vp = (hw.sigPhElemDeg * deg) ** 2 * a2 + (hw.sigPhSubDeg * deg) ** 2 * A2;
  const Va = (hw.sigAElemDb * lnA) ** 2 * a2 + (hw.sigASubDb * lnA) ** 2 * A2;
  const pred = Math.sqrt(c * c * Vp + s * s * Va) / sum0 / slope;
  const sumDb = Float64Array.from(P, v => 10 * Math.log10(Math.max(v / pk, 1e-12)));
  return {
    d, rIdeal: I.r, rActual: rA, sumDb, theta3Deg: th3, slopePerDeg: slope, slopeNorm: slope * th3, rangeDeg: d[e],
    sigmaThermalDeg: sigR / slope, biasDeg: bias, rmsQuarterDeg: Math.sqrt(acc / Math.max(cnt, 1)),
    biasStdPredDeg: pred, slopeRel: (rA[i0 + 1] - rA[i0 - 1]) / (2 * h) / slope,
  };
}
