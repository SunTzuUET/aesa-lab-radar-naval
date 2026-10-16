// Waveform, processing losses and timeline. Replaces the fixed loss figure
// with its components and adds what the radar equation alone misses: unambiguous range, blind zone,
// eclipsing, duty cycle, target Doppler bin and search revisit time.
// Loss validation: matlab/fase3_linea_base/val_perdidas.m.
import { C0, type RadarParams } from './config';
import { chebyshev } from './tapers';
import { snrConstant, type LinkInputs } from './radar';

const db = (x: number) => 10 * Math.log10(x);

/** Presets: long-range search (low PRF, 400 km unambiguous range) and low-altitude search with MTD. */
export const WAVEFORMS = {
  lejana: { tauS: 100e-6, prfHz: 375, nPulses: 8 },
  mtd: { tauS: 20e-6, prfHz: 2500, nPulses: 16 },
} as const;
export type WaveMode = keyof typeof WAVEFORMS;

export interface WaveInfo {
  ruKm: number;            // unambiguous range c/(2·PRF)
  blindKm: number;         // blind zone c·τ/2
  duty: number;            // duty cycle τ·PRF
  vBlindMs: number;        // blind speed λ·PRF/2
  dwellS: number;          // time per beam position Np/PRF
}
export function waveInfo(r: RadarParams, fHz: number): WaveInfo {
  return {
    ruKm: C0 / (2 * r.prfHz) / 1e3, blindKm: C0 * r.tauS / 2 / 1e3, duty: r.tauS * r.prfHz,
    vBlindMs: C0 / fHz * r.prfHz / 2, dwellS: r.nPulses / r.prfHz,
  };
}

function normWindow(np: number, sll: number): Float64Array {
  const w = chebyshev(np, sll);
  let e = 0; for (const v of w) e += v * v;
  return w.map(v => v / Math.sqrt(e));
}
/** |W(f)|² with f normalized to the PRF. */
function W2(w: Float64Array, f: number): number {
  let re = 0, im = 0;
  for (let m = 0; m < w.length; m++) { const a = -2 * Math.PI * f * m; re += w[m] * Math.cos(a); im += w[m] * Math.sin(a); }
  return re * re + im * im;
}

/** Coherent gain loss of the Doppler window: −10·log((Σw)²/(N·Σw²)). */
export function windowLossDb(np: number, sll: number): number {
  const w = normWindow(np, sll); let s = 0; for (const v of w) s += v;
  return -db(s * s / np);
}

/** Doppler straddle loss (best bin) at frequency f/PRF, in dB. */
export function dopplerCellLossDb(np: number, sll: number, fNorm: number): { lossDb: number; bin: number } {
  const w = normWindow(np, sll); let s = 0; for (const v of w) s += v;
  let best = 0, bin = 0;
  for (let k = 0; k < np; k++) { const v = W2(w, fNorm - k / np); if (v > best) { best = v; bin = k; } }
  return { lossDb: -db(best / (s * s)), bin: bin >= np / 2 ? bin - np : bin };
}
/** Mean in dB over a uniformly distributed target frequency (512 points). */
export function dopplerStraddleDb(np: number, sll: number): number {
  let acc = 0; const n = 512;
  for (let i = 0; i < n; i++) acc += dopplerCellLossDb(np, sll, i / n).lossDb;
  return acc / n;
}

/** Range straddle loss with fs/B samples per resolution cell: mean of −10·log sinc²(B·δ), δ ∈ ±Δ/2. */
export function rangeStraddleDb(fsOverB: number): number {
  let acc = 0; const n = 400;
  for (let i = 0; i < n; i++) {
    const x = Math.PI * ((i + 0.5) / n - 0.5) / fsOverB;
    acc += -db((Math.sin(x) / x) ** 2);
  }
  return acc / n;
}

/**
 * Mean beam-shape loss (two-way, both axes) for a search grid with spacing s·θ₃ᵣ:
 * Gaussian beams, 2·4·ln2·(10/ln10)·(1/θₜ² + 1/θᵣ²)·(s·θᵣ)²/12. Differs by < 0.1 dB from the real face.
 */
export function beamShapeLossDb(s: number, th3TxDeg: number, th3RxDeg: number): number {
  return 2 * 4 * Math.LN2 * 10 / Math.LN10 * (1 / th3TxDeg ** 2 + 1 / th3RxDeg ** 2) * (s * th3RxDeg) ** 2 / 12;
}

/** CA-CFAR loss with N cells (square-law, Swerling 1), exact. */
export function cfarLossDb(n: number, pd: number, pfa: number): number {
  const req = (Math.pow(pfa, -1 / n) - 1) / (Math.pow(pd, -1 / n) - 1) - 1;
  const ideal = Math.log(pfa) / Math.log(pd) - 1;
  return db(req / ideal);
}

/**
 * Received echo fraction (eclipsing): the receiver is blanked while transmitting, during [0, τ] of each
 * PRI. Echo of duration τ arriving at t = 2R/c (modulo the PRI). After compression, the peak drops as f².
 */
export function eclipseFraction(R: number, tauS: number, prfHz: number): number {
  const T = 1 / prfHz, t = (2 * R / C0) % T;
  // echo on [t, t + τ]; blanked windows [0, τ] and [T, T + τ]
  const closed = (a: number, b: number) => Math.max(0, Math.min(t + tauS, b) - Math.max(t, a));
  const lost = closed(0, tauS) + closed(T, T + tauS);
  return Math.max(0, 1 - lost / tauS);
}

export interface LossBreakdown {
  rfDb: number; windowDb: number; dopplerDb: number; rangeDb: number; beamDb: number; cfarDb: number;
  totalDb: number;
}
/**
 * Losses entering the radar equation (in addition to environmental ones): RF (lossDb), Doppler window,
 * Doppler straddle (mean or at the target velocity), range straddle
 * (fs = 2B, as in the signal chain), beam shape and CFAR.
 */
export function lossBreakdown(r: RadarParams, th3TxDeg: number, th3RxDeg: number, fHz: number): LossBreakdown {
  const np = Math.max(1, r.nPulses);
  const windowDb = np > 1 ? windowLossDb(np, r.dopplerSllDb) : 0;
  let dopplerDb = 0;
  if (np > 1) {
    if (r.vRadialMs === null) dopplerDb = dopplerStraddleDb(np, r.dopplerSllDb);
    else dopplerDb = dopplerCellLossDb(np, r.dopplerSllDb, targetDopplerNorm(r, fHz)).lossDb;
  }
  const rangeDb = rangeStraddleDb(2);
  const beamDb = beamShapeLossDb(r.beamSpacing, th3TxDeg, th3RxDeg);
  const cfarDb = cfarLossDb(r.cfarCells, r.pdReq, r.pfa);
  return { rfDb: r.lossDb, windowDb, dopplerDb, rangeDb, beamDb, cfarDb, totalDb: r.lossDb + windowDb + dopplerDb + rangeDb + beamDb + cfarDb };
}

/** Target Doppler normalized to the PRF, in [0, 1). */
export function targetDopplerNorm(r: RadarParams, fHz: number): number {
  const fd = 2 * (r.vRadialMs ?? 0) * fHz / C0;
  return (((fd / r.prfHz) % 1) + 1) % 1;
}
/** Target Doppler bin (k = −Np/2…Np/2−1) or null if velocity is averaged. */
export function targetBin(r: RadarParams, fHz: number): number | null {
  if (r.vRadialMs === null || r.nPulses < 2) return null;
  return dopplerCellLossDb(r.nPulses, r.dopplerSllDb, targetDopplerNorm(r, fHz)).bin;
}

export interface Timeline { beamsAz: number; bars: number; beams: number; frameS: number; }
/**
 * Search revisit for one face: grid with spacing s·θ₃ over a sector of ±azSpan and from 0 to elMax.
 * Azimuth θ₃ grows as 1/cos(az) when steering off broadside (the number of beams is integrated).
 */
export function timeline(r: RadarParams, th3AzDeg: number, th3ElDeg: number, azSpanDeg: number, elMaxDeg: number): Timeline {
  const stepAz = r.beamSpacing * th3AzDeg;
  let beamsAz = 0; const n = 200;
  for (let i = 0; i < n; i++) {
    const az = -azSpanDeg + 2 * azSpanDeg * (i + 0.5) / n;
    beamsAz += (2 * azSpanDeg / n) * Math.cos(az * Math.PI / 180) / stepAz;
  }
  beamsAz = Math.ceil(beamsAz);
  const bars = Math.max(1, Math.ceil(elMaxDeg / (r.beamSpacing * th3ElDeg)));
  const beams = beamsAz * bars;
  return { beamsAz, bars, beams, frameS: beams * r.nPulses / r.prfHz };
}

/** Transmit θ₃ (°) with uniform amplitude: 0.886·λ/(N·d), broadened by 1/cos of the scan angle. */
export function txBeamwidthDeg(nElem: number, dLambda: number, scanDeg: number): number {
  return 0.886 * 180 / Math.PI / (nElem * dLambda) / Math.max(Math.cos(scanDeg * Math.PI / 180), 0.2);
}

/** Radar equation constant K with processing losses already applied. */
export function radarK(r: RadarParams, l: LinkInputs, th3TxDeg: number, th3RxDeg: number): { K: number; losses: LossBreakdown } {
  const losses = lossBreakdown(r, th3TxDeg, th3RxDeg, l.f);
  return { K: snrConstant(r, l) * Math.pow(10, -(losses.totalDb - r.lossDb) / 10), losses };
}
