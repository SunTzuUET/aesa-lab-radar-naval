// Scan pattern (unsteered pattern shifted in sine space) versus direct summation.
import { describe, expect, it } from 'vitest';
import { DEFAULT_BEAM, DEFAULT_FACE, faceGeometry } from '../src/engine/config';
import { computeWeights, steerUV } from '../src/engine/array';
import { gainAt } from '../src/engine/pattern';
import { apertureTable, beamAt, faceGain, scanPlan, type ScanConfig } from '../src/engine/scan';

const face = { ...DEFAULT_FACE, nSubX: 4, nSubY: 4 };
const g = faceGeometry(face);
const none = new Uint8Array(g.N);
const ideal = { ...DEFAULT_BEAM, psBits: 0, ttd: false };

describe('shifted pattern', () => {
  it('matches direct summation at the peak and 2° off a beam steered to 30°', () => {
    const t = apertureTable(g, computeWeights(face, g, { ...ideal, azDeg: 0, elDeg: 0 }, none), face.f0);
    const w = computeWeights(face, g, { ...ideal, azDeg: 30, elDeg: 0 }, none);
    for (const th of [30, 32, 26]) {
      const [u, v] = steerUV(th, 0);
      const exact = gainAt(g, w, face.f0, Float64Array.of(u), Float64Array.of(v))[0];
      expect(faceGain(t, th, 30, 0)).toBeCloseTo(exact, 0);
    }
  });
});

describe('scan plan', () => {
  const cfg: ScanConfig = { azSpanDeg: 45, azStepDeg: 1.5, elBarsDeg: [0, 1.7], pulses: 16, priS: 1e-3, tauS: 1e-4, bwHz: 5e6 };
  it('covers ±45° in boustrophedon order and lasts positions × dwell', () => {
    const p = scanPlan(cfg);
    expect(p.pos.length).toBe(2 * 61);
    expect(p.pos[0]).toEqual([-45, 0]);
    expect(p.pos[60]).toEqual([45, 0]);
    expect(p.pos[61]).toEqual([45, 1.7]);
    expect(p.frameS).toBeCloseTo(122 * 0.016, 9);
    const b = beamAt(p, cfg, 0, 0.0165);
    expect(b.posIdx).toBe(1);
    expect(b.pulseIdx).toBe(0);
  });
});
