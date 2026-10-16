// Engine validation against known theoretical results.
import { describe, expect, it } from 'vitest';
import { DEFAULT_BEAM, DEFAULT_FACE, faceGeometry, type BeamConfig, type FaceConfig } from '../src/engine/config';
import { computeWeights } from '../src/engine/array';
import { azimuthCut, gainAt, uvMap } from '../src/engine/pattern';
import { cutMetrics } from '../src/engine/metrics';
import { fft1d } from '../src/engine/fft';
import { radarHorizon, snrReqSwerling1 } from '../src/engine/radar';

const face: FaceConfig = { ...DEFAULT_FACE };
const g = faceGeometry(face);
const none = new Uint8Array(g.N);
const beam = (o: Partial<BeamConfig>): BeamConfig =>
  ({ ...DEFAULT_BEAM, taper: 'uniform', psBits: 0, ttd: false, ...o });
const metricsAz = (b: BeamConfig, el = 0, fails = none) => {
  const w = computeWeights(face, g, b, fails);
  return cutMetrics(azimuthCut(g, w, face.f0 + b.freqOffsetHz, el, 0.02, 90));
};

describe('FFT', () => {
  it('matches the direct DFT', () => {
    const n = 16, re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) { re[i] = Math.sin(i * 1.3) + 0.2 * i; im[i] = Math.cos(i * 0.7); }
    const r0 = re.slice(), i0 = im.slice();
    fft1d(re, im, -1);
    for (let k = 0; k < n; k++) {
      let ar = 0, ai = 0;
      for (let t = 0; t < n; t++) {
        const a = -2 * Math.PI * k * t / n;
        ar += r0[t] * Math.cos(a) - i0[t] * Math.sin(a);
        ai += r0[t] * Math.sin(a) + i0[t] * Math.cos(a);
      }
      expect(re[k]).toBeCloseTo(ar, 9); expect(im[k]).toBeCloseTo(ai, 9);
    }
  });
});

describe('Uniform 80×80 face, λ/2', () => {
  const m = metricsAz(beam({}));
  it('SLL ≈ -13.26 dB', () => expect(m.sllDb).toBeCloseTo(-13.26, 1));
  it('HPBW ≈ 0.886·λ/(N d) rad', () => expect(m.hpbwDeg).toBeCloseTo(0.886 * 2 / 80 * 180 / Math.PI, 1));
  it('gain ≈ 10·log10(π·N)', () => expect(m.peakDbi).toBeCloseTo(10 * Math.log10(Math.PI * 6400), 1));
  it('scan loss at 30° = cos θ', () => {
    const s = metricsAz(beam({ azDeg: 30 }));
    expect(s.peakAngDeg).toBeCloseTo(30, 1);
    expect(m.peakDbi - s.peakDbi).toBeCloseTo(-10 * Math.log10(Math.cos(Math.PI / 6)), 1);
  });
});

describe('Tapers', () => {
  it('Chebyshev 30 dB → SLL = -30 dB', () => {
    expect(metricsAz(beam({ taper: 'chebyshev', sllDb: 30 })).sllDb).toBeCloseTo(-30, 0);
  });
  it('Taylor 35 dB, n̄ = 5 → SLL ≈ -35 dB', () => {
    const s = metricsAz(beam({ taper: 'taylor', sllDb: 35, nbar: 5 })).sllDb;
    expect(s).toBeLessThan(-34); expect(s).toBeGreaterThan(-36.5);
  });
});

describe('Squint and TTD', () => {
  const df = 0.05 * face.f0;
  it('without TTD the beam squints: sin θ = sin θ0 · f0/f', () => {
    const m = metricsAz(beam({ azDeg: 40, freqOffsetHz: df }));
    const th = Math.asin(Math.sin(40 * Math.PI / 180) * face.f0 / (face.f0 + df)) * 180 / Math.PI;
    expect(m.peakAngDeg).toBeCloseTo(th, 1);
  });
  it('with per-subarray TTD the peak stays at θ0 (±0.1°)', () => {
    const m = metricsAz(beam({ azDeg: 40, freqOffsetHz: df, ttd: true }));
    expect(Math.abs(m.peakAngDeg - 40)).toBeLessThan(0.1);
  });
});

describe('u-v map (FFT) versus direct summation', () => {
  it('same gain at the same main-lobe (u, v) points (±0.1 dB)', () => {
    const b = beam({ azDeg: 20, elDeg: 10, taper: 'taylor' });
    const w = computeWeights(face, g, b, none);
    const map = uvMap(g, w, face.f0, 481);
    const direct = gainAt(g, w, face.f0, Float64Array.of(map.peakU), Float64Array.of(map.peakV))[0];
    expect(Math.abs(map.peakDbi - direct)).toBeLessThan(0.1);
  });
});

describe('Radar', () => {
  it('horizon 20 m / 5 m ≈ 27.7 km (k = 4/3)', () => {
    expect(radarHorizon(20, 5) / 1000).toBeCloseTo(27.65, 0);
  });
  it('Swerling 1, Pd = 0.9, Pfa = 1e-6 → SNR ≈ 21.1 dB', () => {
    expect(10 * Math.log10(snrReqSwerling1(0.9, 1e-6))).toBeCloseTo(21.1, 1);
  });
});

describe('Separable cuts versus direct summation', () => {
  it('azimuth cut matches gainAt (±0.01 dB)', () => {
    const b = beam({ azDeg: 25, elDeg: 15, taper: 'taylor', psBits: 4 });
    const fails = new Uint8Array(g.N); for (let i = 0; i < g.N; i += 37) fails[i] = 1;
    const w = computeWeights(face, g, b, fails);
    const c = azimuthCut(g, w, face.f0, 15, 1, 90);
    const el = 15 * Math.PI / 180;
    const us = Float64Array.from(c.angDeg, a => Math.cos(el) * Math.sin(a * Math.PI / 180));
    const vs = new Float64Array(us.length).fill(Math.sin(el));
    const d = gainAt(g, w, face.f0, us, vs);
    for (let i = 0; i < d.length; i++) expect(Math.abs(c.gainDbi[i] - d[i])).toBeLessThan(0.01);
  });
});
