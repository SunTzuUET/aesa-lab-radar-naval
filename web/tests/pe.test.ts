// Parabolic equation (engine/pe.ts) versus the MATLAB reference implementation
// (matlab/lib/propagacion/pe_ssf.m, validated against two-ray, ITU-R P.526 and reciprocity).
import { describe, expect, it } from 'vitest';
import { peAt, runPe } from '../src/engine/pe';
import { fresnel, roughness, seaPermittivity, type Pol } from '../src/engine/environment';
import REF from '../src/validation/ref_pe.json';

const m = REF.meta;
const pattern = (el: number) => Math.exp(-2 * Math.log(2) * (el * 180 / Math.PI / m.bwDeg) ** 2);

describe('parabolic equation', () => {
  for (const key of ['d0', 'd15'] as const) {
    const r = REF[key];
    it(`matches MATLAB, ${r.ductM} m duct`, () => {
      const g = runPe({
        fHz: m.f, hAnt: m.hAnt, pattern, k: m.k, ductM: r.ductM,
        xMax: m.xMax, dx: m.dx, zMax: m.zMax, nz: m.nz, nOutX: m.xMax / m.dx, nOutZ: 1201,
      });
      r.x.forEach((x, i) => {
        if (r.Fdb[i] < -70) return;                      // PE numerical floor
        const db = 20 * Math.log10(peAt(g, x, r.z[i]));
        expect(Math.abs(db - r.Fdb[i])).toBeLessThan(0.3);
      });
    }, 60_000);
  }
  for (const r of REF.superficie) {
    it(`real sea ${r.pol}, σh = ${r.sigmaH} m${r.capa.length ? ', trilinear layer' : ''}: matches MATLAB`, () => {
      const eps = seaPermittivity(m.f), lam = 299_792_458 / m.f;
      const gamma = (psi: number): [number, number] => {
        const G = fresnel(psi, eps, r.pol as Pol), a = roughness(psi, 4 * r.sigmaH, lam);   // roughness uses σh = Hs/4
        return [G[0] * a, G[1] * a];
      };
      const g = runPe({
        fHz: m.f, hAnt: m.hAnt, pattern, k: m.k, ductM: r.ductM, gamma,
        layer: r.capa.length ? [r.capa[0], r.capa[1], r.capa[2]] : null,
        xMax: m.xMax, dx: m.dx, zMax: m.zMax, nz: m.nz, nOutX: m.xMax / m.dx, nOutZ: 1201,
      });
      r.x.forEach((x, i) => {
        if (r.Fdb[i] < -70) return;
        const db = 20 * Math.log10(peAt(g, x, r.z[i]));
        expect(Math.abs(db - r.Fdb[i])).toBeLessThan(0.3);
      });
    }, 120_000);
  }
});

describe('engine PE range step', () => {
  it('dx = 1000 m versus 250 m: < 0.5 dB (rough sea, 12 m duct)', () => {
    const eps = seaPermittivity(3.3e9), lam = 299_792_458 / 3.3e9;
    const gamma = (psi: number): [number, number] => { const G = fresnel(psi, eps, 'H'), a = roughness(psi, 2, lam); return [G[0] * a, G[1] * a]; };
    const src = (el: number) => Math.exp(-2 * Math.log(2) * (el * 180 / Math.PI / 4) ** 2);
    const base = { fHz: 3.3e9, hAnt: 20, pattern: src, k: 4 / 3, ductM: 12, gamma, xMax: 200e3, zMax: 1000, nz: 4096, nOutZ: 401 };
    const a = runPe({ ...base, dx: 1000, nOutX: 200 }), b = runPe({ ...base, dx: 250, nOutX: 200 });
    for (const [x, z] of [[30e3, 10], [50e3, 50], [80e3, 7], [120e3, 20], [180e3, 7]]) {
      const fa = 20 * Math.log10(peAt(a, x, z)), fb = 20 * Math.log10(peAt(b, x, z));
      if (fb < -70) continue;
      expect(Math.abs(fa - fb)).toBeLessThan(0.5);
    }
  }, 120_000);
});
