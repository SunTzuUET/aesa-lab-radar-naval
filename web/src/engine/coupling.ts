// Mutual coupling between elements (catalog A5).
//
// Element: 0.45λ horizontal dipole (x axis; at 0.5λ the ends of collinear neighbors would
// touch at d = λ/2), strip width λ/100 (equivalent radius λ/400), at h = λ/4 above an infinite
// ground plane. Self and mutual impedances by the induced EMF method with sinusoidal current
// (Balanis, ch. 8): exact near field of one dipole integrated over the other with Gauss-Legendre.
// The ground plane is modeled by its image (opposite current at −h).
//
// Active Z of element n with excitation w:  Za_n = Σ_m Z(Δ_nm)·w_m / w_n  (2D convolution, FFT).
// Actual current with a T/R of internal impedance Zs conjugate-matched to the center element at
// broadside:  I_n = w_n·(Zs + Zref)/(Zs + Za_n),  Γ_n = (Za_n − Zs*)/(Za_n + Zs).
// This is the "active impedance" approximation (first order: the current distribution is taken
// as proportional to the excitation); coupling acts as a deterministic multiplicative error
// that depends on steering.
import { C0, type FaceGeometry } from './config';
import { fft2d } from './fft';
import MOM from './coupling_mom.json';

const ETA = 376.730313668;

/** Element dimensions in wavelengths (same as matlab/fase1_sistema/val_acoplamiento.m). */
export const DIPOLE = { lengthL: 0.45, radiusL: 1 / 400, heightL: 0.25 };

// Gauss-Legendre nodes and weights on [−1, 1] (32 points)
const GL = (() => {
  const n = 32, x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = z;
      for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      dp = n * (z * p1 - p0) / (z * z - 1);
      const dz = p1 / dp; z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x[i] = z; w[i] = 2 / ((1 - z * z) * dp * dp);
  }
  return { x, w };
})();

/**
 * Mutual impedance (Ω) between two parallel dipoles of length L (x axis) with sinusoidal current,
 * separated by dx along the axis and ρ transversely. Z21 = −(1/I²)∫ E_x1·I2 dx, with
 *   E_x1 = −j·η/(4π)·[e^{−jkR1}/R1 + e^{−jkR2}/R2 − 2cos(kL/2)·e^{−jkR0}/R0]   (I0 = 1).
 * The integral is split over the two halves of dipole 2 (the current peaks at the center).
 */
export function mutualZ(k: number, L: number, dx: number, rho: number): [number, number] {
  const h = L / 2, c = Math.cos(k * h);
  let re = 0, im = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < GL.x.length; i++) {
      const t = side * h * (GL.x[i] + 1) / 2;                 // position along dipole 2
      const wq = GL.w[i] * h / 2;
      const s = dx + t;                                       // coordinate relative to the center of dipole 1
      const R1 = Math.hypot(rho, s - h), R2 = Math.hypot(rho, s + h), R0 = Math.hypot(rho, s);
      // e^{−jkR}/R → (cos − j·sin)/R
      let er = Math.cos(k * R1) / R1 + Math.cos(k * R2) / R2 - 2 * c * Math.cos(k * R0) / R0;
      let ei = -Math.sin(k * R1) / R1 - Math.sin(k * R2) / R2 + 2 * c * Math.sin(k * R0) / R0;
      // E = −j·η/(4π)·(er + j·ei) = η/(4π)·(ei − j·er)
      const Er = ETA / (4 * Math.PI) * ei, Ei = -ETA / (4 * Math.PI) * er;

      const I2 = Math.sin(k * (h - Math.abs(t)));
      re -= Er * I2 * wq; im -= Ei * I2 * wq;
    }
  }
  // normalization to the input current: I(0) = sin(k·h)
  const n0 = Math.sin(k * h) ** 2;
  return [re / n0, im / n0];
}

export interface CouplingModel {
  f: number; L: number; a: number; hGnd: number;
  source: string;                    // 'MoM ±K + FEM inducida' or 'FEM inducida'
  nx: number; ny: number;            // table size (offsets 0..nx-1, 0..ny-1)
  Zre: Float64Array; Zim: Float64Array;   // Z(|Δix|, |Δiy|) including image
  zSelf: [number, number];
}

/**
 * Face impedance table (0.45λ dipoles at λ/4 above ground) versus offset.
 * kernel 'emf' (the engine's): induced EMF over the full range. It is energy-consistent with the
 * isolated element pattern (same sinusoidal current): satisfies R_a(θ)/R_a(0) = P_elem(θ)/cos θ (Hannan).
 * kernel 'mom' (validation only): Antenna Toolbox MoM kernel up to r ≤ K
 * (matlab/fase1_sistema/nucleo_acoplamiento.m, with images) and corrected induced EMF beyond. It is more
 * accurate pair by pair, but not consistent with the isolated pattern (it includes scattering by the
 * open-circuited elements), so it is not mixed with it in the gain chain.
 */
export function couplingTable(g: FaceGeometry, f: number, kernel: 'emf' | 'mom' = 'emf'): CouplingModel {
  const lam = C0 / f, k = 2 * Math.PI / lam;
  const L = DIPOLE.lengthL * lam, a = DIPOLE.radiusL * lam, hGnd = DIPOLE.heightL * lam;
  const nx = g.Nx, ny = g.Ny;
  const useMom = kernel === 'mom' && Math.abs(g.d / lam - MOM.meta.d / MOM.meta.lambda) < 1e-3;
  const K = useMom ? MOM.K : -1;
  const emf = (i: number, j: number): [number, number] => {
    const dx = i * g.d, dy = j * g.d;
    const [r1, i1] = mutualZ(k, L, dx, i === 0 && j === 0 ? a : dy);
    const [r2, i2] = mutualZ(k, L, dx, Math.hypot(dy, 2 * hGnd));   // image: opposite current
    return [r1 - r2, i1 - i2];
  };
  // tail correction: MoM/EMF ratio on the outer MoM ring, interpolated in angle
  const ring: { phi: number; re: number; im: number }[] = [];
  if (useMom) for (let j = 0; j <= K; j++) for (let i = 0; i <= K; i++) {
    const r = Math.hypot(i, j);
    if (r < K - 1.5 || r > K + 0.01) continue;
    const [er, ei] = emf(i, j), d = er * er + ei * ei;
    ring.push({ phi: Math.atan2(j, i), re: (MOM.Zre[j][i] * er + MOM.Zim[j][i] * ei) / d, im: (MOM.Zim[j][i] * er - MOM.Zre[j][i] * ei) / d });
  }
  ring.sort((p, q) => p.phi - q.phi);
  const ratioAt = (phi: number): [number, number] => {
    if (!ring.length) return [1, 0];
    // mean weighted by angular proximity (8° Gaussian kernel)
    let wr = 0, rr = 0, ri = 0;
    for (const p of ring) { const w = Math.exp(-(((phi - p.phi) / (8 * Math.PI / 180)) ** 2)); wr += w; rr += w * p.re; ri += w * p.im; }
    return [rr / wr, ri / wr];
  };
  const Zre = new Float64Array(nx * ny), Zim = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (i <= K && j <= K && Math.hypot(i, j) <= K + 0.01) { Zre[j * nx + i] = MOM.Zre[j][i]; Zim[j * nx + i] = MOM.Zim[j][i]; continue; }
    const [er, ei] = emf(i, j), [cr, ci] = ratioAt(Math.atan2(j, i));
    Zre[j * nx + i] = er * cr - ei * ci; Zim[j * nx + i] = er * ci + ei * cr;
  }
  return { f, L, a, hGnd, source: useMom ? `MoM (r ≤ ${K}) + FEM inducida corregida` : 'FEM inducida', nx, ny, Zre, Zim, zSelf: [Zre[0], Zim[0]] };
}

/**
 * Active Z of the center element for an amplitude excitation a(ix, iy) steered to (u0, v0),
 * by direct summation (fast: single element). For Γ-versus-scan curves.
 */
export function centerActiveZ(g: FaceGeometry, m: CouplingModel, amp: Float64Array, u0: number, v0: number): [number, number] {
  const k = 2 * Math.PI * m.f / C0;
  const cx = g.Nx >> 1, cy = g.Ny >> 1, c = cy * g.Nx + cx;
  let re = 0, im = 0;
  for (let iy = 0; iy < g.Ny; iy++) for (let ix = 0; ix < g.Nx; ix++) {
    const n = iy * g.Nx + ix, s = Math.abs(iy - cy) * m.nx + Math.abs(ix - cx);
    const ph = -k * ((g.x[n] - g.x[c]) * u0 + (g.y[n] - g.y[c]) * v0), a = amp[n] / amp[c];
    const wr = a * Math.cos(ph), wi = a * Math.sin(ph);
    re += m.Zre[s] * wr - m.Zim[s] * wi; im += m.Zre[s] * wi + m.Zim[s] * wr;
  }
  return [re, im];
}

function nextPow2(n: number) { let p = 1; while (p < n) p <<= 1; return p; }

/**
 * Active Z of every element for weights w (2D convolution with the symmetric kernel, via FFT).
 * Elements with w = 0 (failed): Za = NaN.
 */
export function activeImpedance(g: FaceGeometry, m: CouplingModel, wRe: Float64Array, wIm: Float64Array) {
  const P = nextPow2(2 * Math.max(g.Nx, g.Ny));
  const kr = new Float64Array(P * P), ki = new Float64Array(P * P);
  for (let j = -(g.Ny - 1); j <= g.Ny - 1; j++) for (let i = -(g.Nx - 1); i <= g.Nx - 1; i++) {
    const t = ((j + P) % P) * P + ((i + P) % P), s = Math.abs(j) * m.nx + Math.abs(i);
    kr[t] = m.Zre[s]; ki[t] = m.Zim[s];
  }
  const xr = new Float64Array(P * P), xi = new Float64Array(P * P);
  for (let iy = 0; iy < g.Ny; iy++) for (let ix = 0; ix < g.Nx; ix++) {
    const s = iy * g.Nx + ix, t = iy * P + ix; xr[t] = wRe[s]; xi[t] = wIm[s];
  }
  fft2d(kr, ki, P, -1); fft2d(xr, xi, P, -1);
  for (let t = 0; t < P * P; t++) {
    const r = kr[t] * xr[t] - ki[t] * xi[t], i = kr[t] * xi[t] + ki[t] * xr[t];
    xr[t] = r; xi[t] = i;
  }
  fft2d(xr, xi, P, 1);
  const zr = new Float64Array(g.N), zi = new Float64Array(g.N);
  for (let iy = 0; iy < g.Ny; iy++) for (let ix = 0; ix < g.Nx; ix++) {
    const s = iy * g.Nx + ix, t = iy * P + ix;
    const vr = xr[t] / (P * P), vi = xi[t] / (P * P);           // V_n = Σ Z·w
    const d = wRe[s] * wRe[s] + wIm[s] * wIm[s];
    if (d < 1e-30) { zr[s] = NaN; zi[s] = NaN; continue; }
    zr[s] = (vr * wRe[s] + vi * wIm[s]) / d;                   // V/w
    zi[s] = (vi * wRe[s] - vr * wIm[s]) / d;
  }
  return { zr, zi };
}

export interface CouplingEffect {
  Ire: Float64Array; Iim: Float64Array;   // effective currents (replace the weights)
  gammaMag: Float64Array;                 // active |Γ| per element
  zRef: [number, number];                 // design active Z (center, broadside)
  zCenter: [number, number];              // center active Z at this steering
  gammaCenter: number; gammaMax: number; vswrMax: number;
  mismatchLossDb: number;                 // mean mismatch loss (reflected power)
  powerRatioDb: number;                   // 10·log(Σ|I|²/Σ|w|²): pattern functions normalize by Σ|weights|²,
                                          // and realized gain is referenced to available power (Σ|w|²)
}

/**
 * Applies coupling to a set of weights. zRef is the active Z the T/R is matched to (Zs = Zref*).
 * calRef (optional): active Z of each element in the calibration condition; if given,
 * calibration corrects each element's ratio (Zs + Zcal_n)/(Zs + Zref) (per-element calibration).
 */
export function applyCoupling(g: FaceGeometry, m: CouplingModel, wRe: Float64Array, wIm: Float64Array,
  zRef: [number, number], calRef?: { zr: Float64Array; zi: Float64Array } | null): CouplingEffect {
  const { zr, zi } = activeImpedance(g, m, wRe, wIm);
  const [rr, ri] = zRef;
  const sr = rr, si = -ri;                                   // Zs = Zref*
  const Ire = new Float64Array(g.N), Iim = new Float64Array(g.N), gm = new Float64Array(g.N);
  let gMax = 0, refl = 0, inc = 0, pI = 0;
  for (let n = 0; n < g.N; n++) {
    if (!Number.isFinite(zr[n])) continue;
    // c = (Zs + Zref)/(Zs + Za_n)   [with per-element calibration: (Zs + Zcal_n)/(Zs + Za_n)]
    const nr = calRef && Number.isFinite(calRef.zr[n]) ? sr + calRef.zr[n] : sr + rr;
    const ni = calRef && Number.isFinite(calRef.zr[n]) ? si + calRef.zi[n] : si + ri;
    const dr = sr + zr[n], di = si + zi[n], dd = dr * dr + di * di;
    const cr = (nr * dr + ni * di) / dd, ci = (ni * dr - nr * di) / dd;
    Ire[n] = wRe[n] * cr - wIm[n] * ci; Iim[n] = wRe[n] * ci + wIm[n] * cr;
    pI += Ire[n] * Ire[n] + Iim[n] * Iim[n];
    // Γ = (Za − Zs*)/(Za + Zs),  Zs* = Zref
    const gr = zr[n] - rr, gi = zi[n] - ri;
    const G = Math.sqrt((gr * gr + gi * gi) / dd);
    gm[n] = G; gMax = Math.max(gMax, G);
    const p = wRe[n] * wRe[n] + wIm[n] * wIm[n];
    refl += p * G * G; inc += p;
  }
  const c = (g.Ny >> 1) * g.Nx + (g.Nx >> 1);
  return {
    Ire, Iim, gammaMag: gm, zRef, zCenter: [zr[c], zi[c]], gammaCenter: gm[c], gammaMax: gMax,
    vswrMax: (1 + gMax) / (1 - Math.min(gMax, 0.999)), mismatchLossDb: -10 * Math.log10(1 - refl / Math.max(inc, 1e-30)),
    powerRatioDb: 10 * Math.log10(pI / Math.max(inc, 1e-30)),
  };
}

/**
 * Power pattern of the isolated element (length-L dipole along x at h above ground), normalized to 1
 * at broadside, as a function of direction cosines (u, v):  cos θ = w = √(1 − u² − v²),
 *   F_dip = [cos(kL/2·u) − cos(kL/2)] / [√(1 − u²)·(1 − cos(kL/2))]   (u = cosine to the dipole axis)
 *   F_gnd = sin(k·h·cos θ) / sin(k·h)
 * The web app uses cos θ by default; this function is the alternative with the real element.
 */
export function dipoleOverGroundPower(u: number, v: number, khGnd = 2 * Math.PI * DIPOLE.heightL): number {
  const r2 = u * u + v * v;
  if (r2 >= 1) return 0;
  const ct = Math.sqrt(1 - r2);
  const kl = Math.PI * DIPOLE.lengthL;                       // k·L/2
  const fd = Math.abs(u) < 1 - 1e-9 ? (Math.cos(kl * u) - Math.cos(kl)) / Math.sqrt(1 - u * u) / (1 - Math.cos(kl)) : 0;
  const fg = Math.sin(khGnd * ct) / Math.sin(khGnd);
  return (fd * fg) ** 2;
}

// ───────────────────────── configuration and cache ─────────────────────────

export interface CouplingConfig {
  on: boolean;
  cal: 'centro' | 'elemento';   // matching/calibration: center element only at broadside, or every element at broadside
}
export const DEFAULT_COUPLING: CouplingConfig = { on: false, cal: 'centro' };

const cache = new Map<string, { m: CouplingModel; zRef: [number, number]; zCal: { zr: Float64Array; zi: Float64Array } }>();

/**
 * Kernel and design conditions for a geometry (cached): zRef = active Z of the center with
 * uniform broadside excitation (the T/R is matched to it); zCal = active Z of every element in that
 * same condition (per-element calibration).
 */
export function couplingFor(g: FaceGeometry, f: number) {
  const key = `${g.Nx}x${g.Ny}:${g.d}:${f}`;
  let c = cache.get(key);
  if (!c) {
    const m = couplingTable(g, f);
    const ones = new Float64Array(g.N).fill(1), zeros = new Float64Array(g.N);
    const zCal = activeImpedance(g, m, ones, zeros);
    const ctr = (g.Ny >> 1) * g.Nx + (g.Nx >> 1);
    c = { m, zRef: [zCal.zr[ctr], zCal.zi[ctr]], zCal };
    if (cache.size > 6) cache.clear();
    cache.set(key, c);
  }
  return c;
}

/** Element pattern correction (dB): dipole over ground instead of cos θ (without power normalization). */
export function elementCorrDb(u: number, v: number): number {
  const r2 = u * u + v * v;
  if (r2 >= 1) return -300;
  return 10 * Math.log10(Math.max(dipoleOverGroundPower(u, v), 1e-30) / Math.sqrt(1 - r2));
}

/** Active |Γ| of the center element versus scan in the E (azimuth) and H (elevation) planes, uniform excitation. */
export function scanGamma(g: FaceGeometry, f: number, maxDeg = 70, stepDeg = 2, kernel: 'emf' | 'mom' = 'emf') {
  const { m, zRef } = kernel === 'emf' ? couplingFor(g, f) : (() => {
    const mm = couplingTable(g, f, 'mom');
    const ones = new Float64Array(g.N).fill(1);
    return { m: mm, zRef: centerActiveZ(g, mm, ones, 0, 0) };
  })();
  const ones = new Float64Array(g.N).fill(1);
  const ang: number[] = [], gE: number[] = [], gH: number[] = [];
  const gam = (z: [number, number]) => {
    const nr = z[0] - zRef[0], ni = z[1] - zRef[1], dr = z[0] + zRef[0], di = z[1] - zRef[1];
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  };
  for (let a = 0; a <= maxDeg; a += stepDeg) {
    const s = Math.sin(a * Math.PI / 180);
    ang.push(a);
    gE.push(gam(centerActiveZ(g, m, ones, s, 0)));
    gH.push(gam(centerActiveZ(g, m, ones, 0, s)));
  }
  return { ang, gE, gH, source: m.source, zRef };
}

