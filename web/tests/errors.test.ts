// Hardware errors (A1–A3): Monte Carlo versus the analytical predictions in errors.ts.
import { describe, expect, it } from 'vitest';
import { DEFAULT_BEAM, DEFAULT_FACE, faceGeometry, type BeamConfig } from '../src/engine/config';
import { computeWeights, steerUV } from '../src/engine/array';
import { DEFAULT_ERRORS, drawErrors, predictErrors, realizeErrors, residualFloor, type HwErrors } from '../src/engine/errors';

const face = { ...DEFAULT_FACE };
const g = faceGeometry(face);
const nSub = face.nSubX * face.nSubY;
const none = new Uint8Array(g.N);
const beam: BeamConfig = { ...DEFAULT_BEAM, azDeg: 20, elDeg: 0, psBits: 0, ttd: false, freqOffsetHz: 0 };
const f = face.f0, k = 2 * Math.PI * f / 299_792_458;
const [u0, v0] = steerUV(beam.azDeg, beam.elDeg);
const ideal = computeWeights(face, g, beam, none);
const amp = Float64Array.from(ideal.re, (r, i) => Math.hypot(r, ideal.im[i]));

/** Complex array factor at (u, v). */
function af(w: { re: Float64Array; im: Float64Array }, u: number, v: number): [number, number] {
  let re = 0, im = 0;
  for (let i = 0; i < g.N; i++) {
    const ph = k * (g.x[i] * u + g.y[i] * v), c = Math.cos(ph), s = Math.sin(ph);
    re += w.re[i] * c - w.im[i] * s; im += w.re[i] * s + w.im[i] * c;
  }
  return [re, im];
}
const pw = (w: { re: Float64Array; im: Float64Array }) => { let s = 0; for (let i = 0; i < g.N; i++) s += w.re[i] ** 2 + w.im[i] ** 2; return s; };

function monteCarlo(e: HwErrors, M: number, us: number[]) {
  let num = 0, den = 0;
  const sum = us.map(() => [0, 0, 0]);      // ΣRe, ΣIm, Σ|F|²
  const du: number[] = [];
  for (let m = 0; m < M; m++) {
    const w = computeWeights(face, g, beam, none, undefined, realizeErrors(g, drawErrors(g, nSub, 1000 + m), e));
    const [r0, i0] = af(w, u0, v0);
    num += r0 * r0 + i0 * i0; den += pw(w);
    us.forEach((u, j) => { const [r, i] = af(w, u, v0); sum[j][0] += r; sum[j][1] += i; sum[j][2] += r * r + i * i; });
    // peak in u by parabolic interpolation (two passes)
    let c = u0, h = 2e-3;
    for (let p = 0; p < 2; p++) {
      const P = [-h, 0, h].map(d => { const [r, i] = af(w, c + d, v0); return r * r + i * i; });
      c += h * 0.5 * (P[0] - P[2]) / (P[0] - 2 * P[1] + P[2]); h /= 4;
    }
    du.push(c - u0);
  }
  const [ri, ii] = af(ideal, u0, v0);
  const lossDb = -10 * Math.log10((num / den) / ((ri * ri + ii * ii) / pw(ideal)));
  let sA = 0; for (const a of amp) sA += a;
  const floor = sum.map(([r, i, p2]) => (p2 / M - ((r / M) ** 2 + (i / M) ** 2)) / (sA * sA));
  const mean = du.reduce((a, b) => a + b, 0) / M;
  const sigmaU = Math.sqrt(du.reduce((a, b) => a + (b - mean) ** 2, 0) / (M - 1));
  return { lossDb, floor, sigmaU };
}

describe('hardware errors versus theory', () => {
  const us = Array.from({ length: 12 }, (_, i) => u0 + 0.25 + 0.03 * i);
  const cases: [string, Partial<HwErrors>][] = [
    ['elemento 0,5 dB / 5°', { sigAElemDb: 0.5, sigPhElemDeg: 5 }],
    ['elemento 1 dB / 10°', { sigAElemDb: 1, sigPhElemDeg: 10 }],
    ['subarray 0,5 dB / 5°', { sigASubDb: 0.5, sigPhSubDeg: 5 }],
    ['TTD 5 ps + elemento 5°', { ttdPs: 5, sigPhElemDeg: 5 }],
  ];
  for (const [name, o] of cases) {
    it(name, () => {
      const e = { ...DEFAULT_ERRORS, ...o };
      const pr = predictErrors(g, face, amp, e, f);
      const mc = monteCarlo(e, 400, us);
      const fl = us.map(u => residualFloor(g, face, ideal.re, ideal.im, e, f, u, v0));
      const flErr = Math.max(...mc.floor.map((x, j) => Math.abs(10 * Math.log10(x / fl[j]))));
      // floor averaged over 12 directions (each with 400 exponential realizations: ±0.4 dB)
      const flMean = 10 * Math.log10(mc.floor.reduce((a, b) => a + b, 0) / fl.reduce((a, b) => a + b, 0));
      console.log(`${name}: ΔG ${mc.lossDb.toFixed(3)} / ${pr.gainLossDb.toFixed(3)} dB · fondo medio ${flMean.toFixed(2)} dB (máx ${flErr.toFixed(2)}) · σu ${mc.sigmaU.toExponential(2)} / ${pr.sigmaU.toExponential(2)}`);
      expect(Math.abs(mc.lossDb - pr.gainLossDb)).toBeLessThan(0.03 + 0.05 * pr.gainLossDb);
      expect(Math.abs(flMean)).toBeLessThan(0.3);
      expect(flErr).toBeLessThan(1.2);
      if (pr.sigmaU > 0) expect(Math.abs(mc.sigmaU / pr.sigmaU - 1)).toBeLessThan(0.12);
    }, 120_000);
  }

  it('3-bit quantization with dither', () => {
    const b3: BeamConfig = { ...beam, psBits: 3 };
    const id3 = computeWeights(face, g, { ...b3, psBits: 0 }, none);
    const e = { ...DEFAULT_ERRORS, dither: true };
    const pr = predictErrors(g, face, amp, e, f, 3);
    let num = 0, den = 0;
    const us = Array.from({ length: 12 }, (_, i) => u0 + 0.25 + 0.03 * i);
    const sum = us.map(() => [0, 0, 0]);
    const M = 300;
    for (let m = 0; m < M; m++) {
      const w = computeWeights(face, g, b3, none, undefined, realizeErrors(g, drawErrors(g, nSub, 5000 + m), e));
      const [r0, i0] = af(w, u0, v0); num += r0 * r0 + i0 * i0; den += pw(w);
      us.forEach((u, j) => { const [r, i] = af(w, u, v0); sum[j][0] += r; sum[j][1] += i; sum[j][2] += r * r + i * i; });
    }
    const [ri, ii] = af(id3, u0, v0);
    const loss = -10 * Math.log10((num / den) / ((ri * ri + ii * ii) / pw(id3)));
    let sA = 0; for (const a of amp) sA += a;
    const fl = sum.reduce((acc, [r, i, p2]) => acc + (p2 / M - ((r / M) ** 2 + (i / M) ** 2)) / (sA * sA), 0) / us.length;
    console.log(`dither 3 bits: ΔG ${loss.toFixed(3)} / ${pr.gainLossDb.toFixed(3)} dB · fondo ${(10 * Math.log10(fl)).toFixed(1)} / ${pr.floorDb.toFixed(1)} dB`);
    expect(Math.abs(loss - pr.gainLossDb)).toBeLessThan(0.03);
    expect(Math.abs(10 * Math.log10(fl) - pr.floorDb)).toBeLessThan(0.4);
  }, 120_000);
});
