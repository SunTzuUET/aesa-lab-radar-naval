// Radar equation, detection and horizon.
import { C0, EARTH_R, K_BOLTZ, T0, type RadarParams } from './config';

const db = (x: number) => 10 * Math.log10(x);
const lin = (x: number) => Math.pow(10, x / 10);

export interface LinkInputs {
  f: number;         // Hz
  gtDbi: number;     // transmit gain
  grDbi: number;     // receive gain
  nActive: number;   // active elements (total power = nActive · pElemW)
}

/**
 * Constant K such that SNR(R) = K / R⁴ (energy form, matched filter):
 *   SNR = Pt τ Gt Gr λ² σ N / ((4π)³ k T0 F L R⁴)
 */
export function snrConstant(p: RadarParams, l: LinkInputs): number {
  const lam = C0 / l.f;
  const Pt = l.nActive * p.pElemW;
  return Pt * p.tauS * lin(l.gtDbi) * lin(l.grDbi) * lam * lam * p.rcsM2 * p.nPulses
    / (Math.pow(4 * Math.PI, 3) * K_BOLTZ * T0 * lin(p.nfDb) * lin(p.lossDb));
}

export function snrDbAt(K: number, R: number): number { return db(K / Math.pow(R, 4)); }

/** Swerling 1 Pd after coherent integration (integrated SNR): Pd = Pfa^{1/(1+SNR)}. */
export function pdSwerling1(snrLin: number, pfa: number): number {
  return Math.pow(pfa, 1 / (1 + snrLin));
}

/** Required SNR (linear) for Pd, Swerling 1. */
export function snrReqSwerling1(pd: number, pfa: number): number {
  return Math.log(pfa) / Math.log(pd) - 1;
}

/**
 * Swerling 0 Pd (non-fluctuating target, single pulse) by inverting Albersheim's approximation:
 *   SNR_dB = (6,2 + 4,54/√1,44)·log10(A + 0,12·A·B + 1,7·B),  A = ln(0,62/Pfa),  B = ln(Pd/(1−Pd)).
 */
export function pdSwerling0(snrLin: number, pfa: number): number {
  const A = Math.log(0.62 / pfa);
  const Z = Math.pow(10, db(snrLin) / (6.2 + 4.54 / Math.sqrt(1.44)));
  const B = (Z - A) / (0.12 * A + 1.7);
  return 1 / (1 + Math.exp(-B));
}

/** Range (m) at which the required SNR is reached. */
export function detectionRange(K: number, snrReqLin: number): number {
  return Math.pow(K / snrReqLin, 0.25);
}

/** Radar horizon with effective earth radius k·a (k = 4/3). */
export function radarHorizon(hRadar: number, hTarget: number, k = 4 / 3): number {
  const ae = k * EARTH_R;
  return Math.sqrt(2 * ae * Math.max(hRadar, 0)) + Math.sqrt(2 * ae * Math.max(hTarget, 0));
}
