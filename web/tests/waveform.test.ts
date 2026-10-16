// Waveform and losses: versus matlab/fase3_linea_base/val_perdidas.m and effects on the chain.
import { describe, expect, it } from 'vitest';
import {
  WAVEFORMS, beamShapeLossDb, cfarLossDb, dopplerStraddleDb, eclipseFraction, rangeStraddleDb, targetBin, timeline, windowLossDb,
} from '../src/engine/waveform';
import { DEFAULT_RADAR } from '../src/engine/config';
import { DEFAULT_ENV, envContext, evalPoint, patternFromCut } from '../src/engine/environment';
import REF from '../src/validation/ref_perdidas.json';

const C = 299_792_458;

describe('processing losses versus MATLAB', () => {
  it('Doppler window and straddle loss', () => {
    for (const c of REF.L1) {
      expect(windowLossDb(c.np, c.sll)).toBeCloseTo(c.ventanaDb, 6);
      expect(Math.abs(dopplerStraddleDb(c.np, c.sll) - c.celdaDb)).toBeLessThan(0.01);   // 512 versus 4096 points
    }
  });
  it('range straddle: sinc² model versus the LFM chain (< 0.02 dB)', () => {
    for (const c of REF.L2) {
      expect(Math.abs(rangeStraddleDb(c.ratio) - c.modeloDb)).toBeLessThan(0.01);
      expect(Math.abs(rangeStraddleDb(c.ratio) - c.medidaDb)).toBeLessThan(0.02);
    }
  });
  it('beam shape: Gaussian versus the real face (< 0.1 dB)', () => {
    for (const c of REF.L3.casos) {
      const v = beamShapeLossDb(c.s, REF.L3.theta3TxDeg, REF.L3.theta3RxDeg);
      expect(v).toBeCloseTo(c.modeloDb, 6);
      expect(Math.abs(v - c.medidaDb)).toBeLessThan(0.1);
    }
  });
  it('exact CA-CFAR, confirmed by Monte Carlo (Pd 0.9)', () => {
    for (const c of REF.L4) {
      expect(cfarLossDb(c.n, c.pd, c.pfa)).toBeCloseTo(c.snrReqDb - c.snrIdealDb, 6);
      expect(Math.abs(c.pdMc - c.pd)).toBeLessThan(0.005);
    }
  });
  it('eclipsing: the compressed peak drops as f² (LFM chain)', () => {
    for (const c of REF.L5) { expect(c.inicioDb).toBeCloseTo(c.modeloDb, 1); expect(c.finDb).toBeCloseTo(c.modeloDb, 1); }
  });
});

describe('waveform in the chain', () => {
  it('eclipsing: blind within c·τ/2 and when transmitting again, full in between', () => {
    const tau = 20e-6, prf = 2500, ru = C / (2 * prf), blind = C * tau / 2;
    expect(eclipseFraction(0.5 * blind, tau, prf)).toBeCloseTo(0.5, 9);
    expect(eclipseFraction(2 * blind, tau, prf)).toBe(1);
    expect(eclipseFraction(ru - 0.25 * blind, tau, prf)).toBeCloseTo(0.25, 9);   // the echo overlaps the next pulse
    expect(eclipseFraction(ru + 0.5 * blind, tau, prf)).toBeCloseTo(0.5, 9);
  });
  it('presets have a reasonable duty cycle and long-range search is unambiguous at 400 km', () => {
    for (const w of Object.values(WAVEFORMS)) expect(w.tauS * w.prfHz).toBeLessThanOrEqual(0.05);
    expect(C / (2 * WAVEFORMS.lejana.prfHz)).toBeGreaterThan(399e3);
  });
  it('timeline: beams × pulses / PRF', () => {
    const r = { ...DEFAULT_RADAR, beamSpacing: 1, nPulses: 8, prfHz: 400 };
    const t = timeline(r, 2, 2, 0.001, 2);       // near-zero sector: one beam, one bar
    expect(t.beams).toBe(1);
    expect(t.frameS).toBeCloseTo(8 / 400, 12);
  });

  const L0 = { K: 1e22, fHz: 3.3e9, hRadar: 20, hpbwAzDeg: 1.7, hpbwElDeg: 1.7, extraLossDb: 0, tauS: 20e-6, rcs: 0.1, grDbi: 41, gtDbi: 43, nPulses: 16 };
  const ang = Float64Array.from({ length: 401 }, (_, i) => -10 + i * 0.05);
  const pat = patternFromCut(ang, ang.map(a => 41 - 12 * (a / 1.7) ** 2), 0, 41, true);
  const env = { ...DEFAULT_ENV, windMs: 12, propPE: false, clutterK: false };

  it('high PRF: sea clutter from previous sweeps folds onto far ranges', () => {
    const lo = envContext({ ...L0, prfHz: 2500 }, env, pat, true), hi = envContext({ ...L0, prfHz: 15000 }, env, pat, true);
    // at 12 km a 15 kHz PRF (Ru = 10 km) brings in the sea at 2 km; with 2.5 kHz there is no folding
    const a = evalPoint(lo, 12e3, 500), b = evalPoint(hi, 12e3, 500);
    expect(b.cnrDb).toBeGreaterThan(a.cnrDb + 10);
    expect(b.ambiguous).toBe(true); expect(a.ambiguous).toBe(false);
  });
  it('target in the clutter notch: no cancellation; outside it, MTD cancellation', () => {
    const r0 = { ...DEFAULT_RADAR, ...WAVEFORMS.mtd };
    const vIn = 2, vOut = 0.4 * C / 3.3e9 * 2500 / 2;     // 2 m/s (bin 0) and 0.4 of the blind speed
    const bin = (v: number) => targetBin({ ...r0, vRadialMs: v }, 3.3e9);
    expect(bin(vIn)).toBe(0);
    const cin = envContext({ ...L0, prfHz: 2500, dopplerBin: bin(vIn) }, env, pat, true);
    const cout = envContext({ ...L0, prfHz: 2500, dopplerBin: bin(vOut) }, env, pat, true);
    expect(evalPoint(cin, 6e3, 50).cnrDb).toBeGreaterThan(evalPoint(cout, 6e3, 50).cnrDb + 30);
  });
});
