// Radiation pattern: u-v map via 2D FFT and cuts via direct summation.
// Gain: G = 4π dx dy / λ² · |AF|² / Σ|w|² · cos θ  (cos θ element pattern,
// valid without grating lobes; with them, gain is split approximately).
import { C0, type FaceGeometry } from './config';
import type { Weights } from './array';
import { fft2d } from './fft';

export interface UVMap {
  res: number;            // pixels per side
  gainDbi: Float32Array;  // res×res, NaN outside visible space; row 0 = v = +1
  peakDbi: number;
  peakU: number; peakV: number;
}

function powerSum(w: Weights): number {
  let s = 0;
  for (let i = 0; i < w.re.length; i++) s += w.re[i] * w.re[i] + w.im[i] * w.im[i];
  return s;
}

function nextPow2(n: number): number { let p = 1; while (p < n) p <<= 1; return p; }

export function uvMap(g: FaceGeometry, w: Weights, f: number, res = 241): UVMap {
  const P = Math.max(256, nextPow2(4 * Math.max(g.Nx, g.Ny)));   // oversampling ≥ 4×
  const re = new Float64Array(P * P), im = new Float64Array(P * P);
  for (let iy = 0; iy < g.Ny; iy++) {
    for (let ix = 0; ix < g.Nx; ix++) {
      const s = iy * g.Nx + ix, t = iy * P + ix;
      re[t] = w.re[s]; im[t] = w.im[s];
    }
  }
  fft2d(re, im, P, 1);   // AF(pu,pv) = Σ w e^{+j2π(ix pu + iy pv)/P}
  const pw = new Float64Array(P * P);
  for (let i = 0; i < P * P; i++) pw[i] = re[i] * re[i] + im[i] * im[i];

  const lam = C0 / f;
  const norm = 4 * Math.PI * g.d * g.d / (lam * lam) / Math.max(powerSum(w), 1e-30);
  const scale = P * g.d / lam;           // bins per unit of u
  const out = new Float32Array(res * res);
  let peak = -Infinity, pu = 0, pv = 0;
  const wrap = (a: number) => ((a % P) + P) % P;
  for (let b = 0; b < res; b++) {
    const v = 1 - 2 * b / (res - 1);
    for (let a = 0; a < res; a++) {
      const u = -1 + 2 * a / (res - 1);
      const r2 = u * u + v * v;
      const o = b * res + a;
      if (r2 > 1) { out[o] = NaN; continue; }
      // bilinear interpolation on the periodic FFT grid
      const fx = u * scale, fy = v * scale;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const dx = fx - x0, dy = fy - y0;
      const X0 = wrap(x0), X1 = wrap(x0 + 1), Y0 = wrap(y0), Y1 = wrap(y0 + 1);
      const p = (1 - dx) * (1 - dy) * pw[Y0 * P + X0] + dx * (1 - dy) * pw[Y0 * P + X1]
              + (1 - dx) * dy * pw[Y1 * P + X0] + dx * dy * pw[Y1 * P + X1];
      const gdb = 10 * Math.log10(Math.max(p * norm * Math.sqrt(1 - r2), 1e-30));
      out[o] = gdb;
      if (gdb > peak) { peak = gdb; pu = u; pv = v; }
    }
  }
  return { res, gainDbi: out, peakDbi: peak, peakU: pu, peakV: pv };
}

export interface Cut { angDeg: Float64Array; gainDbi: Float64Array; }

/** Gain at arbitrary (u, v) directions by direct summation (exact). */
export function gainAt(g: FaceGeometry, w: Weights, f: number, us: Float64Array, vs: Float64Array): Float64Array {
  const k = 2 * Math.PI * f / C0;
  const lam = C0 / f;
  const norm = 4 * Math.PI * g.d * g.d / (lam * lam) / Math.max(powerSum(w), 1e-30);
  const xs = new Float64Array(g.Nx), ys = new Float64Array(g.Ny);
  for (let ix = 0; ix < g.Nx; ix++) xs[ix] = g.x[ix];
  for (let iy = 0; iy < g.Ny; iy++) ys[iy] = g.y[iy * g.Nx];
  const exr = new Float64Array(g.Nx), exi = new Float64Array(g.Nx);
  const out = new Float64Array(us.length);
  for (let p = 0; p < us.length; p++) {
    const u = us[p], v = vs[p];
    for (let ix = 0; ix < g.Nx; ix++) { const a = k * xs[ix] * u; exr[ix] = Math.cos(a); exi[ix] = Math.sin(a); }
    let ar = 0, ai = 0;
    for (let iy = 0; iy < g.Ny; iy++) {
      let rr = 0, ri = 0;
      const o = iy * g.Nx;
      for (let ix = 0; ix < g.Nx; ix++) {
        const wr = w.re[o + ix], wi = w.im[o + ix];
        rr += wr * exr[ix] - wi * exi[ix];
        ri += wr * exi[ix] + wi * exr[ix];
      }
      const b = k * ys[iy] * v, cr = Math.cos(b), ci = Math.sin(b);
      ar += rr * cr - ri * ci; ai += rr * ci + ri * cr;
    }
    const r2 = Math.min(u * u + v * v, 1);
    out[p] = 10 * Math.log10(Math.max((ar * ar + ai * ai) * norm * Math.sqrt(1 - r2), 1e-30));
  }
  return out;
}

const deg = Math.PI / 180;

/**
 * Principal cuts in sine space, separable and therefore fast (O(N + Nx·G)):
 *  - azimuth: fixed v = sin(el0), u = cos(el0)·sin(az) with az ∈ [-span, span]
 *  - elevation: fixed u = u0 (from steering), v = sin(el) with el ∈ [-span, span]
 */
function separableCut(
  g: FaceGeometry, w: Weights, f: number, fixedIsV: boolean, fixed: number,
  ang: Float64Array, vary: Float64Array,
): Float64Array {
  const k = 2 * Math.PI * f / C0;
  const lam = C0 / f;
  const norm = 4 * Math.PI * g.d * g.d / (lam * lam) / Math.max(powerSum(w), 1e-30);
  // collapse the fixed dimension:c[j] = Σ_i w e^{jk·pos_i·fixed}
  const nA = fixedIsV ? g.Nx : g.Ny;          // varying dimension
  const nB = fixedIsV ? g.Ny : g.Nx;          // collapsed dimension
  const cr = new Float64Array(nA), ci = new Float64Array(nA);
  for (let b = 0; b < nB; b++) {
    const pos = fixedIsV ? g.y[b * g.Nx] : g.x[b];
    const ph = k * pos * fixed, er = Math.cos(ph), ei = Math.sin(ph);
    for (let a = 0; a < nA; a++) {
      const i = fixedIsV ? b * g.Nx + a : a * g.Nx + b;
      cr[a] += w.re[i] * er - w.im[i] * ei;
      ci[a] += w.re[i] * ei + w.im[i] * er;
    }
  }
  const posA = new Float64Array(nA);
  for (let a = 0; a < nA; a++) posA[a] = fixedIsV ? g.x[a] : g.y[a * g.Nx];
  const dA = nA > 1 ? posA[1] - posA[0] : 0;
  const out = new Float64Array(ang.length);
  for (let p = 0; p < ang.length; p++) {
    const q = vary[p];
    const u = fixedIsV ? q : fixed, v = fixedIsV ? fixed : q;
    const r2 = u * u + v * v;
    if (r2 > 1) { out[p] = NaN; continue; }
    // uniform grid:e^{jk·pos_a·q} = e^{jk·pos_0·q} · (e^{jk·d·q})^a  (a single trig call per point)
    let ar = 0, ai = 0;
    const p0 = k * posA[0] * q, dp = k * dA * q;
    let er = Math.cos(p0), ei = Math.sin(p0);
    const sr = Math.cos(dp), si = Math.sin(dp);
    for (let a = 0; a < nA; a++) {
      ar += cr[a] * er - ci[a] * ei; ai += cr[a] * ei + ci[a] * er;
      const t = er * sr - ei * si; ei = er * si + ei * sr; er = t;
    }
    out[p] = 10 * Math.log10(Math.max((ar * ar + ai * ai) * norm * Math.sqrt(1 - r2), 1e-30));
  }
  return out;
}

/** Azimuth cut at fixed elevation (u = cos el · sin az, v = sin el). */
export function azimuthCut(g: FaceGeometry, w: Weights, f: number, elDeg: number, step = 0.1, span = 90): Cut {
  const n = Math.round(2 * span / step) + 1;
  const ang = new Float64Array(n), us = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ang[i] = -span + i * step;
    us[i] = Math.cos(elDeg * deg) * Math.sin(ang[i] * deg);
  }
  return { angDeg: ang, gainDbi: separableCut(g, w, f, true, Math.sin(elDeg * deg), ang, us) };
}

/** Elevation cut through the plane u = u0 (u0 = cos el0 · sin az0 from steering). */
export function elevationCut(g: FaceGeometry, w: Weights, f: number, u0: number, step = 0.1, span = 90): Cut {
  const n = Math.round(2 * span / step) + 1;
  const ang = new Float64Array(n), vs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ang[i] = -span + i * step;
    vs[i] = Math.sin(ang[i] * deg);
  }
  return { angDeg: ang, gainDbi: separableCut(g, w, f, false, u0, ang, vs) };
}
