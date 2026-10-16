// Validation of the environment models against reference values from the literature.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENV, douglas, evapDuct, fresnel, gasAttenDbKm, kFactor, propagationFactor, rainAttenDbKm,
  refractivity, seaPermittivity, seaSigma0Db, shipMotion, twoRayGeometry, windSea, type EnvConfig,
} from '../src/engine/environment';

const env = (o: Partial<EnvConfig>): EnvConfig => ({ ...DEFAULT_ENV, ...o });

describe('sea and weather', () => {
  it('Pierson-Moskowitz: 10 m/s gives Hs ≈ 2.1 m and Tp ≈ 7.3 s', () => {
    const s = windSea(10);
    expect(s.hs).toBeCloseTo(2.14, 1);
    expect(s.tp).toBeCloseTo(7.3, 1);
  });
  it('Douglas scale', () => {
    expect(douglas(0.3)).toBe(2);
    expect(douglas(1.0)).toBe(3);
    expect(douglas(2.0)).toBe(4);
    expect(douglas(3.0)).toBe(5);
  });
});

describe('refraction', () => {
  it('standard atmosphere: Ns ≈ 315–330 and k ≈ 4/3', () => {
    const N = refractivity(15, 1013.25, 60);
    expect(N).toBeGreaterThan(310);
    expect(N).toBeLessThan(335);
    expect(kFactor(N).k).toBeGreaterThan(1.25);
    expect(kFactor(N).k).toBeLessThan(1.45);
  });
  it('evaporation duct grows with dry air over warm sea', () => {
    const wet = evapDuct(env({ rhPct: 95, tempC: 20, seaTempC: 20 })).heightM;
    const dry = evapDuct(env({ rhPct: 55, tempC: 27, seaTempC: 29 })).heightM;
    expect(dry).toBeGreaterThan(wet);
    expect(dry).toBeGreaterThan(8);
    expect(dry).toBeLessThanOrEqual(40);
  });
});

describe('attenuation (ITU-R)', () => {
  it('P.676 at 3.3 GHz: oxygen ≈ 0.007 dB/km, water vapor < 0.003 dB/km', () => {
    const g = gasAttenDbKm(3.3e9, 15, 1013.25, 7.5);
    expect(g.o2).toBeGreaterThan(0.005);
    expect(g.o2).toBeLessThan(0.009);
    expect(g.h2o).toBeLessThan(0.003);
  });
  it('P.838 at 3 GHz and 25 mm/h: tens of mdB/km', () => {
    const a = rainAttenDbKm(3e9, 25, 'H');
    expect(a).toBeGreaterThan(0.005);
    expect(a).toBeLessThan(0.05);
  });
});

describe('sea clutter (NRL)', () => {
  it('S-band HH σ⁰, sea state 3, 1° ≈ −50 dB and increases with sea state and grazing angle', () => {
    const s = seaSigma0Db(1, 3.3e9, 3, 'H');
    expect(s).toBeGreaterThan(-58);
    expect(s).toBeLessThan(-44);
    expect(seaSigma0Db(1, 3.3e9, 5, 'H')).toBeGreaterThan(s);
    expect(seaSigma0Db(5, 3.3e9, 3, 'H')).toBeGreaterThan(s);
    expect(seaSigma0Db(1, 3.3e9, 3, 'V')).toBeGreaterThan(s);   // VV > HH at low grazing
  });
});

describe('multipath', () => {
  const eps = seaPermittivity(3.3e9);
  it('Fresnel at very low grazing: Γ ≈ −1 for both polarizations', () => {
    for (const pol of ['H', 'V'] as const) {
      const G = fresnel(0.001, eps, pol);
      expect(G[0]).toBeLessThan(-0.9);
    }
  });
  it('Blake geometry → flat earth as ae → ∞', () => {
    const g = twoRayGeometry(20, 100, 5000, 1e12);
    expect(g.psi).toBeCloseTo(Math.atan(120 / 5000), 4);
    expect(g.dPath).toBeCloseTo(2 * 20 * 100 / 5000, 3);
  });
  it('smooth sea: F oscillates between 0 and 2 (+6 dB enhancement)', () => {
    let mn = 9, mx = 0;
    for (let R = 2000; R < 40000; R += 5) {
      const g = twoRayGeometry(20, 300, R, 1e12);
      const F = propagationFactor(g, 0.0908, 0, eps, 'H', () => 1);
      mn = Math.min(mn, F); mx = Math.max(mx, F);
    }
    expect(mx).toBeGreaterThan(1.9);
    expect(mn).toBeLessThan(0.1);
  });
  it('rough sea reduces the reflection (Ament)', () => {
    const g = twoRayGeometry(20, 300, 6000, 8.5e6);
    const smooth = propagationFactor(g, 0.0908, 0, eps, 'H', () => 1);
    const rough = propagationFactor(g, 0.0908, 4, eps, 'H', () => 1);
    expect(Math.abs(rough - 1)).toBeLessThan(Math.abs(smooth - 1) + 1e-9);
  });
});

describe('ship motion', () => {
  it('beam seas cause more roll than head seas; fins reduce it', () => {
    const beamSea = shipMotion(env({ windMs: 14, windDirDeg: 90, swellHm: 0, headingDeg: 0, finStab: false }));
    const headSea = shipMotion(env({ windMs: 14, windDirDeg: 0, swellHm: 0, headingDeg: 0, finStab: false }));
    const fins = shipMotion(env({ windMs: 14, windDirDeg: 90, swellHm: 0, headingDeg: 0, finStab: true }));
    expect(beamSea.rollSigDeg).toBeGreaterThan(3 * headSea.rollSigDeg);
    expect(headSea.pitchSigDeg).toBeGreaterThan(beamSea.pitchSigDeg);
    expect(fins.rollSigDeg).toBeLessThan(beamSea.rollSigDeg);
    expect(beamSea.rollSigDeg).toBeLessThan(35);
  });
});
