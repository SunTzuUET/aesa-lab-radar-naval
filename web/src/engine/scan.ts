// Search scan of the 4 faces: scan plan (raster), simulation clock,
// each face's pattern at each instant and transmitted waveform (LFM).
import { C0, type FaceGeometry } from './config';
import type { Weights } from './array';

const deg = Math.PI / 180;

export interface ScanConfig {
  azSpanDeg: number;      // azimuth half-sector of each face (±)
  azStepDeg: number;      // step between beam positions
  elBarsDeg: number[];    // elevation bars
  pulses: number;         // pulses per position (dwell)
  priS: number;           // repetition period
  tauS: number;           // pulse width
  bwHz: number;           // chirp bandwidth
}

export interface ScanPlan { pos: [number, number][]; dwellS: number; frameS: number; }

/** Boustrophedon raster: each elevation bar is traversed in alternating direction. */
export function scanPlan(c: ScanConfig): ScanPlan {
  const n = Math.max(1, Math.round(2 * c.azSpanDeg / c.azStepDeg) + 1);
  const pos: [number, number][] = [];
  c.elBarsDeg.forEach((el, b) => {
    for (let i = 0; i < n; i++) {
      const k = b % 2 ? n - 1 - i : i;
      pos.push([-c.azSpanDeg + (2 * c.azSpanDeg) * (n > 1 ? k / (n - 1) : 0.5), el]);
    }
  });
  const dwellS = c.pulses * c.priS;
  return { pos, dwellS, frameS: dwellS * pos.length };
}

/** The 4 faces: 0 bow, 1 port, 2 stern, 3 starboard (ship azimuth, clockwise from the bow). */
export const FACE_AZ = [0, 270, 180, 90];
export const FACE_NAME = ['proa', 'babor', 'popa', 'estribor'];
export const FACE_COLOR = ['#ffc061', '#59d8ff', '#5fd8a2', '#c99bff'];

export interface BeamState {
  face: number; azDeg: number; elDeg: number;    // local face steering
  posIdx: number; nPos: number;
  pulseIdx: number; tInPri: number;              // current pulse within the dwell
  frameFrac: number;
}

/** Beam state of face k at time t; faces are offset by ¼ frame. */
export function beamAt(plan: ScanPlan, c: ScanConfig, face: number, t: number): BeamState {
  const tf = ((t + face * plan.frameS / 4) % plan.frameS + plan.frameS) % plan.frameS;
  const posIdx = Math.min(plan.pos.length - 1, Math.floor(tf / plan.dwellS));
  const td = tf - posIdx * plan.dwellS;
  const pulseIdx = Math.min(c.pulses - 1, Math.floor(td / c.priS));
  const [az, el] = plan.pos[posIdx];
  return { face, azDeg: az, elDeg: el, posIdx, nPos: plan.pos.length, pulseIdx, tInPri: td - pulseIdx * c.priS, frameFrac: tf / plan.frameS };
}

/** Simulation clock with slow motion and pause. */
export class ScanClock {
  private base = 0;
  private ref = performance.now();
  speed = 1;
  paused = false;
  now(): number { return this.paused ? this.base : this.base + (performance.now() - this.ref) / 1000 * this.speed; }
  set(speed: number, paused: boolean) { this.base = this.now(); this.ref = performance.now(); this.speed = speed; this.paused = paused; }
}

/**
 * Azimuth pattern of a face with "unsteered" weights (taper and failures), tabulated over
 * Δu = u − u0 ∈ [−2, 2]. With ideal phase shifters the steered beam is the same pattern
 * shifted in sine space: G(u) = P(u − u0)·cos θ. The vertical dimension is
 * collapsed in the beam's elevation plane (Σ over columns).
 */
export interface UTable { gainDbi: Float32Array; n: number; peakDbi: number; }
export function apertureTable(g: FaceGeometry, w: Weights, f: number, n = 2049): UTable {
  const k = 2 * Math.PI * f / C0, lam = C0 / f;
  const cr = new Float64Array(g.Nx), ci = new Float64Array(g.Nx);
  let pw = 0;
  for (let iy = 0; iy < g.Ny; iy++) for (let ix = 0; ix < g.Nx; ix++) {
    const i = iy * g.Nx + ix; cr[ix] += w.re[i]; ci[ix] += w.im[i]; pw += w.re[i] ** 2 + w.im[i] ** 2;
  }
  const norm = 4 * Math.PI * g.d * g.d / (lam * lam) / Math.max(pw, 1e-30);
  const out = new Float32Array(n);
  let peak = -Infinity;
  for (let p = 0; p < n; p++) {
    const du = -2 + 4 * p / (n - 1);
    const p0 = k * g.x[0] * du, dp = k * g.d * du;
    let er = Math.cos(p0), ei = Math.sin(p0);
    const sr = Math.cos(dp), si = Math.sin(dp);
    let ar = 0, ai = 0;
    for (let a = 0; a < g.Nx; a++) {
      ar += cr[a] * er - ci[a] * ei; ai += cr[a] * ei + ci[a] * er;
      const t = er * sr - ei * si; ei = er * si + ei * sr; er = t;
    }
    const v = 10 * Math.log10(Math.max((ar * ar + ai * ai) * norm, 1e-30));
    out[p] = v; if (v > peak) peak = v;
  }
  return { gainDbi: out, n, peakDbi: peak };
}

/** Gain (dBi) of a face at local azimuth θ (°) with the beam at (az0, el0). */
export function faceGain(t: UTable, thetaDeg: number, az0Deg: number, el0Deg: number): number {
  if (Math.abs(thetaDeg) >= 90) return -Infinity;
  const ce = Math.cos(el0Deg * deg);
  const u = ce * Math.sin(thetaDeg * deg), u0 = ce * Math.sin(az0Deg * deg), v0 = Math.sin(el0Deg * deg);
  const r2 = u * u + v0 * v0;
  if (r2 >= 1) return -Infinity;
  const f = (u - u0 + 2) / 4 * (t.n - 1);
  const i = Math.max(0, Math.min(t.n - 2, Math.floor(f))), a = f - i;
  return t.gainDbi[i] * (1 - a) + t.gainDbi[i + 1] * a + 5 * Math.log10(1 - r2);   // cos θ element pattern (power)
}

/** Baseband linear chirp: phase π·(B/τ)·t², t ∈ [−τ/2, τ/2]. */
export function lfm(tauS: number, bwHz: number, t: number): { i: number; q: number; fHz: number } {
  const tc = t - tauS / 2;
  const ph = Math.PI * bwHz / tauS * tc * tc;
  return { i: Math.cos(ph), q: Math.sin(ph), fHz: bwHz / tauS * tc };
}
