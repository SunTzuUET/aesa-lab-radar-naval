// Complex face weights: taper × phase shifter (quantized) × per-subarray TTD × failures.
import { C0, type BeamConfig, type FaceConfig, type FaceGeometry } from './config';
import { taper1d } from './tapers';
import type { ErrorRealization } from './errors';

export interface Weights { re: Float64Array; im: Float64Array; }

const deg = Math.PI / 180;

/** Steering direction cosines: u = cos(el) sin(az), v = sin(el). */
export function steerUV(azDeg: number, elDeg: number): [number, number] {
  return [Math.cos(elDeg * deg) * Math.sin(azDeg * deg), Math.sin(elDeg * deg)];
}

/** Quantizes a phase to 2^bits uniform levels (bits = 0: continuous). */
export function quantizePhase(phi: number, bits: number): number {
  const w = Math.atan2(Math.sin(phi), Math.cos(phi));
  if (!bits) return w;
  const step = 2 * Math.PI / (1 << bits);
  return Math.round(w / step) * step;
}

/**
 * Weights at frequency f = f0 + beam.freqOffsetHz.
 * - Without TTD: the phase shifter carries the full steering phase, computed at f0;
 *   it does not scale when f changes → squint.
 * - With TTD: each subarray applies a true delay τ_s = (xc u0 + yc v0)/c, which
 *   scales with f, and the phase shifter only the intra-subarray residual.
 * taperOverride allows forcing 'uniform' (transmit with saturated amplifiers).
 * errs applies a hardware error realization (errors.ts): per-element and per-subarray gain
 * and phase, TTD delay error (phase −2π·f·τe) and, with dither, quantization as
 * Q_B(φ + r_n) − r_n with r_n a known random phase per element.
 */
export function computeWeights(
  face: FaceConfig, g: FaceGeometry, beam: BeamConfig, failed: Uint8Array,
  taperOverride?: BeamConfig['taper'],
  errs?: ErrorRealization | null,
): Weights {
  const kind = taperOverride ?? beam.taper;
  const tx = taper1d(kind, g.Nx, beam.sllDb, beam.nbar);
  const ty = taper1d(kind, g.Ny, beam.sllDb, beam.nbar);
  const [u0, v0] = steerUV(beam.azDeg, beam.elDeg);
  const k0 = 2 * Math.PI * face.f0 / C0;
  const f = face.f0 + beam.freqOffsetHz;
  const re = new Float64Array(g.N), im = new Float64Array(g.N);
  for (let iy = 0; iy < g.Ny; iy++) {
    for (let ix = 0; ix < g.Nx; ix++) {
      const i = iy * g.Nx + ix;
      if (failed[i]) continue;
      let a = tx[ix] * ty[iy];
      const r = errs?.dither ? errs.dither[i] : 0;
      const q = (phi: number) => quantizePhase(phi + r, beam.psBits) - r;
      let ph: number;
      if (beam.ttd) {
        const res = -k0 * ((g.x[i] - g.xc[i]) * u0 + (g.y[i] - g.yc[i]) * v0);
        const tau = (g.xc[i] * u0 + g.yc[i] * v0) / C0;
        ph = q(res) - 2 * Math.PI * f * tau;
      } else {
        ph = q(-k0 * (g.x[i] * u0 + g.y[i] * v0));
      }
      if (errs) {
        a *= errs.gain[i];
        ph += errs.phase[i] - 2 * Math.PI * f * errs.tau[i];
      }
      re[i] = a * Math.cos(ph);
      im[i] = a * Math.sin(ph);
    }
  }
  return { re, im };
}
