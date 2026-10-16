// K-distributed sea clutter: shape ν versus MATLAB, loss table and effect on the chain.
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENV, kLossDb, shapeK, type Pol } from '../src/engine/environment';
import KTAB from '../src/engine/clutter_k_tabla.json';
import REF from '../src/validation/ref_clutter_k.json';
import { DEFAULT_RADAR } from '../src/engine/config';
import { SCENARIOS, applyScenario } from '../src/engine/scenarios';
import { envContext, evalPoint, patternFromCut } from '../src/engine/environment';

describe('clutter K', () => {
  it('shape ν matches matlab/lib/radar/forma_k.m', () => {
    for (const c of REF.casos) {
      expect(shapeK(c.psi, c.area, c.pol as Pol, c.aspecto)).toBeCloseTo(c.nu, 9);
    }
  });
  it('loss reproduces the Monte Carlo table at its nodes and is 0 with Gaussian clutter', () => {
    KTAB.cnrDb.forEach((cn, i) => KTAB.nu.forEach((nu, j) => {
      expect(kLossDb(nu, cn)).toBeCloseTo(KTAB.perdidaDb[i][j], 9);
    }));
    expect(kLossDb(Infinity, 20)).toBe(0);
    expect(kLossDb(60, 20)).toBe(0);
  });
  it('more spikes (smaller ν) or more clutter never reduce the loss', () => {
    let prev = -1;
    for (const nu of [40, 10, 3, 1, 0.5, 0.3, 0.1]) { const l = kLossDb(nu, 20); expect(l).toBeGreaterThanOrEqual(prev); prev = l; }
    expect(kLossDb(0.5, 0)).toBeLessThan(kLossDb(0.5, 10));
  });
  it('in the chain it only reduces SINR where there is sea clutter', () => {
    const s = SCENARIOS.find(x => x.id === 's2')!;
    const { env, radar } = applyScenario(s, DEFAULT_ENV, DEFAULT_RADAR);
    const ang = Float64Array.from({ length: 401 }, (_, i) => -10 + i * 0.05);
    const gain = ang.map(a => 41 - 12 * (a / 1.7) ** 2);
    const pat = patternFromCut(ang, gain, 0, 41, true);
    const L = { K: 1e22, fHz: 3.3e9, hRadar: radar.hRadarM, hpbwAzDeg: 1.7, hpbwElDeg: 1.7, extraLossDb: 0, tauS: 20e-6, rcs: 0.1, grDbi: 41, gtDbi: 43 };
    const on = envContext(L, { ...env, clutterK: true, propPE: false }, pat, true);
    const off = envContext(L, { ...env, clutterK: false, propPE: false }, pat, true);
    const near = evalPoint(on, 8e3, 7), nearOff = evalPoint(off, 8e3, 7);
    expect(near.kLossDb).toBeGreaterThan(0);
    expect(near.sinrDb).toBeCloseTo(nearOff.sinrDb - near.kLossDb, 9);
    const far = evalPoint(on, 60e3, 500);                 // beyond the sea horizon: no clutter
    expect(far.kLossDb).toBe(0);
  });
});
