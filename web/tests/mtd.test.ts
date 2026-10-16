// Physical MTD cancellation: per-bin leakage versus matlab/lib/radar/fuga_clutter.m.
import { describe, expect, it } from 'vitest';
import { clutterLeak, phaseNoiseL, type OscQuality } from '../src/engine/mtd';
import { DEFAULT_ENV, cancelFns } from '../src/engine/environment';
import REF from '../src/validation/ref_ruido_fase.json';

describe('MTD: cancellation ceiling', () => {
  it('per-bin leakage and cancellation match fuga_clutter.m', () => {
    for (const c of REF.casos) {
      const p = { np: c.np, prf: c.prf, B: c.B, sllDb: c.sll, osc: c.osc as OscQuality | '', jitDeg: c.jitDeg };
      const r = clutterLeak(p, c.sigmaF, c.fc, c.tau);
      const tot = c.total as number[];
      tot.forEach((v, j) => expect(10 * Math.log10(r.total[j] / v)).toBeCloseTo(0, 3));
      expect(r.cancelDb).toBeCloseTo(c.cancelDb, 3);
    }
  });
  it('L(f) passes through the table points and is flat above 1 MHz', () => {
    expect(10 * Math.log10(phaseNoiseL(1e3, 'tipico'))).toBeCloseTo(-110, 9);
    expect(10 * Math.log10(phaseNoiseL(-1e4, 'pobre'))).toBeCloseTo(-105, 9);
    expect(phaseNoiseL(5e6, 'bueno')).toBeCloseTo(phaseNoiseL(1e6, 'bueno'), 20);
    expect(10 * Math.log10(phaseNoiseL(10, 'tipico'))).toBeCloseTo(-55, 9);
  });
  it('a worse oscillator never improves cancellation, and rain cancels worse than sea', () => {
    const L = { K: 1, fHz: 3.3e9, hRadar: 20, hpbwAzDeg: 1.7, hpbwElDeg: 1.7, extraLossDb: 0, tauS: 20e-6, rcs: 1, grDbi: 41, gtDbi: 43 };
    const e70 = { ...DEFAULT_ENV, jitterDeg: 0.05 }, L70 = { ...L, dopplerSllDb: 70 };
    for (const R of [2e3, 15e3, 60e3]) {
      const b = cancelFns(L70, { ...e70, osc: 'bueno' }).sea(R), t = cancelFns(L70, { ...e70, osc: 'tipico' }).sea(R), p = cancelFns(L70, { ...e70, osc: 'pobre' }).sea(R);
      expect(b).toBeGreaterThanOrEqual(t - 1e-9); expect(t).toBeGreaterThanOrEqual(p - 1e-9);
      const f = cancelFns(L, DEFAULT_ENV);
      expect(f.rain(R)).toBeLessThan(f.sea(R));
    }
  });
});
