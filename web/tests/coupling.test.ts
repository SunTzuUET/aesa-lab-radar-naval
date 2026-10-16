// Mutual coupling (A5): induced EMF kernel, energy consistency and scan gain.
import { describe, expect, it } from 'vitest';
import { C0, DEFAULT_BEAM, DEFAULT_FACE, faceGeometry } from '../src/engine/config';
import { computeWeights, steerUV } from '../src/engine/array';
import { gainAt } from '../src/engine/pattern';
import {
  applyCoupling, centerActiveZ, couplingFor, dipoleOverGroundPower, elementCorrDb, mutualZ, scanGamma,
} from '../src/engine/coupling';

const f = DEFAULT_FACE.f0, lam = C0 / f, k = 2 * Math.PI / lam;
const g = faceGeometry(DEFAULT_FACE);

describe('induced EMF kernel', () => {
  it('reproduces the classic λ/2 dipole values (Balanis, ch. 8)', () => {
    const L = lam / 2;
    const self = mutualZ(k, L, 0, lam / 200);
    const side = mutualZ(k, L, 0, lam / 2), far = mutualZ(k, L, 0, lam);
    expect(self[0]).toBeCloseTo(73.1, 0);
    expect(Math.abs(self[1] - 42.5)).toBeLessThan(3);          // depends on the radius
    expect(side[0]).toBeCloseTo(-12.5, 0); expect(side[1]).toBeCloseTo(-29.9, 0);
    expect(far[0]).toBeCloseTo(4.0, 0); expect(far[1]).toBeCloseTo(17.7, 0);
  });
});

describe('80×80 array with coupling', () => {
  const { m, zRef } = couplingFor(g, f);
  const ones = new Float64Array(g.N).fill(1);
  it('energy consistency: R_a(θ)/R_a(0) = P_elem(θ)/cos θ (Hannan) in the E and H planes', () => {
    for (const a of [15, 30, 45, 60]) {
      const s = Math.sin(a * Math.PI / 180);
      for (const [u, v] of [[s, 0], [0, s]]) {
        const z = centerActiveZ(g, m, ones, u, v);
        expect(Math.abs(z[0] / zRef[0] / (dipoleOverGroundPower(u, v) / Math.cos(a * Math.PI / 180)) - 1)).toBeLessThan(0.01);
      }
    }
  });
  it('active |Γ|: engine kernel (induced EMF) versus Antenna Toolbox MoM kernel', () => {
    const e = scanGamma(g, f, 60, 10), mm = scanGamma(g, f, 60, 10, 'mom');
    e.ang.forEach((_, i) => {
      expect(Math.abs(e.gE[i] - mm.gE[i])).toBeLessThan(0.03);
      expect(Math.abs(e.gH[i] - mm.gH[i])).toBeLessThan(0.03);
    });
  });
  it('realized scan gain ≈ cos θ·(1 − |Γ|²) (center element, large array)', () => {
    const beam = { ...DEFAULT_BEAM, taper: 'uniform' as const, psBits: 0, ttd: false, freqOffsetHz: 0 };
    const none = new Uint8Array(g.N);
    const gainDb = (az: number, el: number) => {
      const w = computeWeights(DEFAULT_FACE, g, { ...beam, azDeg: az, elDeg: el }, none);
      const c = applyCoupling(g, m, w.re, w.im, zRef);
      const [u, v] = steerUV(az, el);
      return { G: gainAt(g, { re: c.Ire, im: c.Iim }, f, Float64Array.of(u), Float64Array.of(v))[0] + c.powerRatioDb + elementCorrDb(u, v), gam: c.gammaCenter };
    };
    const g0 = gainDb(0, 0).G;
    for (const [az, el] of [[30, 0], [45, 0], [0, 30], [0, 45]]) {
      const r = gainDb(az, el), th = Math.max(az, el) * Math.PI / 180;
      const pred = 10 * Math.log10(Math.cos(th) * (1 - r.gam ** 2));
      expect(Math.abs(r.G - g0 - pred)).toBeLessThan(0.35);   // the finite array edge departs from the center
    }
  });
});
