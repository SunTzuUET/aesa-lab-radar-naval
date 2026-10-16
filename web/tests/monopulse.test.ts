// Monopulse: Σ/Δ curve, thermal noise and error-induced bias versus matlab/fase1_sistema/mc_monopulso.m.
import { describe, expect, it } from 'vitest';
import { DEFAULT_BEAM, DEFAULT_FACE, faceGeometry } from '../src/engine/config';
import { computeWeights } from '../src/engine/array';
import { deltaWeights, monoCurve, monopulse, type MonoAxis } from '../src/engine/monopulse';
import { DEFAULT_ERRORS } from '../src/engine/errors';
import REF from '../src/validation/ref_monopulso.json';

const face = DEFAULT_FACE, g = faceGeometry(face), failed = new Uint8Array(g.N);
const beamAt = (az: number) => ({ ...DEFAULT_BEAM, azDeg: az, psBits: 0, ttd: false });
const opt = { axis: 'az' as MonoAxis, snrDb: 20, mmGainDb: 0, mmPhaseDeg: 0 };

describe('monopulse', () => {
  it('ratio Im{Δ/Σ} matches monopulso_curva.m (azimuth and elevation, 0° and 30°)', () => {
    for (const c of REF.curvas) {
      const w = computeWeights(face, g, beamAt(c.az0), failed);
      const m = monoCurve(g, w, deltaWeights(g, w, c.eje as MonoAxis), face.f0, c.d, c.az0, 0, c.eje as MonoAxis);
      c.r.forEach((v: number, i: number) => expect(m.r[i]).toBeCloseTo(v, 8));
    }
  });
  it('θ₃, normalized slope and boresight thermal noise as in MATLAB', () => {
    for (const r of REF.m1) {
      const m = monopulse(face, g, beamAt(r.az0), failed, null, DEFAULT_ERRORS, opt);
      expect(m.theta3Deg).toBeCloseTo(r.theta3Deg, 2);   // MATLAB: 0.005° grid
      expect(m.slopePerDeg / r.pendientePorGrado).toBeCloseTo(1, 3);
    }
    const m0 = monopulse(face, g, beamAt(0), failed, null, DEFAULT_ERRORS, opt);
    type M2 = { offsetDeg: number; snrDb: number; sigmaPredDeg: number; sigmaMedidaDeg: number };
    for (const r of (REF.m2 as unknown as M2[][]).flat()) {
      if (r.offsetDeg !== 0) continue;
      const m = monopulse(face, g, beamAt(0), failed, null, DEFAULT_ERRORS, { ...opt, snrDb: r.snrDb });
      expect(m.sigmaThermalDeg / r.sigmaPredDeg).toBeCloseTo(1, 3);
      expect(m.sigmaThermalDeg / r.sigmaMedidaDeg).toBeGreaterThan(0.95);   // and versus Monte Carlo
      expect(m.sigmaThermalDeg / r.sigmaMedidaDeg).toBeLessThan(1.05);
    }
    expect(m0.biasDeg).toBeCloseTo(0, 9);
  });
  it('predicted bias σ matches MATLAB (element and subarray errors, channel mismatch)', () => {
    const hw = { ...DEFAULT_ERRORS, sigAElemDb: 0.5, sigPhElemDeg: 5, sigASubDb: 0.3, sigPhSubDeg: 3 };
    for (const r of REF.m34) {
      const m = monopulse(face, g, beamAt(0), failed, null, hw, { ...opt, mmGainDb: r.gDb, mmPhaseDeg: r.psiDeg });
      expect(m.biasStdPredDeg / r.sesgoPredDeg).toBeCloseTo(1, 3);
      expect(m.biasStdPredDeg / r.sesgoStdDeg).toBeGreaterThan(0.85);       // and versus Monte Carlo
    }
  });
  it('channel mismatch scales the slope by g·cos ψ', () => {
    const m = monopulse(face, g, beamAt(0), failed, null, DEFAULT_ERRORS, { ...opt, mmGainDb: 1, mmPhaseDeg: 20 });
    expect(m.slopeRel).toBeCloseTo(Math.pow(10, 1 / 20) * Math.cos(20 * Math.PI / 180), 6);
  });
});
