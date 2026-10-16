// Wide-angle parabolic equation via split-step Fourier (port of matlab/lib/propagacion/pe_ssf.m).
//
//   u(x+Δx, z) = e^{j·k·Δx·(m(z)−1)} · T⁻¹{ e^{j·Δx·(√(k²−p²) − k)} · T{u(x, ·)} }
//
// Equivalent flat earth with modified refractivity M(z) = N(z) + z/Re·10⁶; Hann absorbing layer
// above zMax. Surface: perfect conductor (T = sine transform) or real sea with Fresnel Γ(ψ)
// (H or V) times roughness, via the spectral image method: at each step the image at z < 0 is
// U_img(p) = Γ(asin|p|/k)·U_real(−p) (with Γ = −1 this matches the sine transform).
// F = |u|·√x / √(k/2π) is the antenna pattern times the propagation factor (one-way).
// Used near and beyond the horizon (diffraction and ducts); in the interference zone the
// engine still uses two-ray with roughness (environment.ts), and the two are blended with a ramp.
import { C0 } from './config';
import { fft1d } from './fft';

export interface PeJob {
  fHz: number;
  hAnt: number;           // antenna height (m)
  pattern: (elRad: number) => number;   // amplitude relative to the peak
  k: number;              // effective radius factor of the local standard atmosphere
  ductM: number;          // evaporation duct height (m); 0 = no duct
  layer?: [number, number, number] | null;   // inversion layer [base, thickness, ΔM] (trilinear profile)
  gamma?: ((psi: number) => [number, number]) | null;   // surface Γ(ψ); without it, perfect conductor
  xMax: number; dx: number;
  zMax: number; nz: number;
  nOutX: number; nOutZ: number;          // uniform output grid (x from dx·step to xMax, z from 0 to zMax)
}

export interface PeGrid {
  xMax: number; zMax: number; nx: number; nz: number;
  F: Float32Array;        // linear amplitude, index iz*nx + ix (ix = 0 ↔ x = xMax/nx)
  dz: number; thMaxDeg: number;
}

const RE = 6_371_000;
const Z0 = 1.5e-4;

/**
 * M(z) − M(0): local standard atmosphere gradient, evaporation duct (Paulus-Jeske) and trilinear
 * inversion layer (M drops by |ΔM| across the layer, as in matlab/lib/propagacion/perfil_m.m).
 */
export function modRefractivity(z: number, k: number, ductM: number, layer?: [number, number, number] | null): number {
  const s = 1e6 / (k * RE);                     // dM/dz in M/m (0.118 with k = 4/3)
  let m = s * z - (ductM > 0 ? 0.125 * ductM * Math.log((z + Z0) / Z0) : 0);
  if (layer) { const [zb, t, dM] = layer; m -= (dM + s * t) * Math.min(Math.max((z - zb) / t, 0), 1); }
  return m;
}

export function runPe(j: PeJob): PeGrid {
  const k = 2 * Math.PI * j.fHz / C0, lam = C0 / j.fHz;
  const nz = j.nz, zTop = j.zMax * 1.5, dz = zTop / nz;
  const N2 = 2 * nz;
  // initial field:v(z) = (1/2π)∫ f(θ)e^{−jph}e^{jpz} dp over (−zTop, zTop); odd part
  const ar = new Float64Array(N2), ai = new Float64Array(N2);
  for (let m = -nz; m < nz; m++) {
    const p = m * Math.PI / zTop;
    if (Math.abs(p) >= k) continue;
    const a = j.pattern(Math.asin(p / k)), ph = -p * j.hAnt;
    const idx = (m + N2) % N2;                  // ifftshift
    ar[idx] = a * Math.cos(ph); ai[idx] = a * Math.sin(ph);
  }
  fft1d(ar, ai, 1);                             // Σ A e^{+j…} (without 1/N)
  const sc = (Math.PI / zTop) / (2 * Math.PI);
  const ur = new Float64Array(nz), ui = new Float64Array(nz);
  for (let n = 1; n < nz; n++) {               // v(n) − v(−n); circular indices
    ur[n] = sc * (ar[n] - ar[N2 - n]); ui[n] = sc * (ai[n] - ai[N2 - n]);
  }
  // propagator, phase screen and absorbing layer
  const pr = new Float64Array(nz), pi_ = new Float64Array(nz);
  for (let m = 0; m < nz; m++) {
    const p = m * Math.PI / zTop, kz2 = k * k - p * p;
    if (kz2 <= 0) continue;
    const ph = j.dx * (Math.sqrt(kz2) - k);
    pr[m] = Math.cos(ph); pi_[m] = Math.sin(ph);
  }
  const sr = new Float64Array(nz), si = new Float64Array(nz), w = new Float64Array(nz);
  for (let n = 0; n < nz; n++) {
    const z = n * dz, ph = k * j.dx * modRefractivity(z, j.k, j.ductM, j.layer) * 1e-6;
    sr[n] = Math.cos(ph); si[n] = Math.sin(ph);
    w[n] = z <= j.zMax ? 1 : 0.5 * (1 + Math.cos(Math.PI * (z - j.zMax) / (zTop - j.zMax)));
  }
  const er = new Float64Array(N2), ei = new Float64Array(N2);
  // sine transform via odd extension: S = (j/2)·FFT(e);  inverse:x = −2j·IFFT(e) = −(j/nz)·Σ e…
  const sine = (xr: Float64Array, xi: Float64Array, inverse: boolean) => {
    er.fill(0); ei.fill(0);
    for (let n = 1; n < nz; n++) { er[n] = xr[n]; ei[n] = xi[n]; er[N2 - n] = -xr[n]; ei[N2 - n] = -xi[n]; }
    fft1d(er, ei, inverse ? 1 : -1);
    const g = inverse ? 1 / nz : 0.5;          // inverse: −2j·(1/2N)·Σ = −(j/nz)·Σ ; forward: (j/2)·Σ
    const sgn = inverse ? -1 : 1;
    for (let n = 0; n < nz; n++) {             // multiply by ±j·g
      const r = er[n], i = ei[n];
      xr[n] = -sgn * g * i; xi[n] = sgn * g * r;
    }
    xr[0] = 0; xi[0] = 0;
  };
  // surface with Γ(ψ): full domain of 2·nz (z ≥ 0 at 0..nz−1, z < 0 at the end)
  const img = j.gamma ? (() => {
    const gr = new Float64Array(N2), gi = new Float64Array(N2), qr = new Float64Array(N2), qi = new Float64Array(N2);
    for (let m = 0; m < N2; m++) {
      const p = (m < nz ? m : m - N2) * Math.PI / zTop;
      if (Math.abs(p) >= k) continue;
      [gr[m], gi[m]] = j.gamma!(Math.asin(Math.abs(p) / k));
      const ph = j.dx * (Math.sqrt(k * k - p * p) - k);
      qr[m] = Math.cos(ph); qi[m] = Math.sin(ph);
    }
    const vr = new Float64Array(N2), vi = new Float64Array(N2);
    for (let n = 0; n < nz; n++) { vr[n] = sc * ar[n]; vi[n] = sc * ai[n]; }   // direct field at z ≥ 0
    return { gr, gi, qr, qi, vr, vi, br: new Float64Array(N2), bi: new Float64Array(N2), cr: new Float64Array(N2), ci: new Float64Array(N2) };
  })() : null;
  const stepImage = () => {
    const I = img!, { vr, vi, br, bi, cr, ci } = I;
    for (let n = nz; n < N2; n++) { vr[n] = 0; vi[n] = 0; }
    br.set(vr); bi.set(vi);
    fft1d(br, bi, -1);                                       // spectrum of the real field
    // image:Γ(p)·U(−p)  →  ifft
    for (let m = 0; m < N2; m++) {
      const mm = m === 0 ? 0 : N2 - m, a = br[mm], b = bi[mm];
      cr[m] = I.gr[m] * a - I.gi[m] * b; ci[m] = I.gr[m] * b + I.gi[m] * a;
    }
    fft1d(cr, ci, 1);
    for (let n = nz; n < N2; n++) { vr[n] = cr[n] / N2; vi[n] = ci[n] / N2; }
    // propagation over the full domain
    fft1d(vr, vi, -1);
    for (let m = 0; m < N2; m++) { const r = vr[m] * I.qr[m] - vi[m] * I.qi[m], i = vr[m] * I.qi[m] + vi[m] * I.qr[m]; vr[m] = r; vi[m] = i; }
    fft1d(vr, vi, 1);
    for (let n = 0; n < N2; n++) {
      const zi = n < nz ? n : N2 - n;                       // screen with M(|z|); absorber at the top
      const r = vr[n] / N2, i = vi[n] / N2, ww = n < nz ? w[n] : 1, srr = sr[Math.min(zi, nz - 1)], sii = si[Math.min(zi, nz - 1)];
      vr[n] = (r * srr - i * sii) * ww; vi[n] = (r * sii + i * srr) * ww;
    }
    for (let n = 0; n < nz; n++) { ur[n] = vr[n]; ui[n] = vi[n]; }
  };
  const nSteps = Math.round(j.xMax / j.dx);
  const outEvery = Math.max(1, Math.round(nSteps / j.nOutX));
  const nxOut = Math.floor(nSteps / outEvery);
  const F = new Float32Array(nxOut * j.nOutZ);
  const c = Math.sqrt(k / (2 * Math.PI));
  for (let s = 1; s <= nSteps; s++) {
    if (img) { stepImage(); } else {
    sine(ur, ui, false);
    for (let m = 0; m < nz; m++) {
      const r = ur[m] * pr[m] - ui[m] * pi_[m], i = ur[m] * pi_[m] + ui[m] * pr[m];
      ur[m] = r; ui[m] = i;
    }
    sine(ur, ui, true);
    for (let n = 0; n < nz; n++) {
      const r = (ur[n] * sr[n] - ui[n] * si[n]) * w[n], i = (ur[n] * si[n] + ui[n] * sr[n]) * w[n];
      ur[n] = r; ui[n] = i;
    }
    }
    if (s % outEvery === 0) {
      const ix = s / outEvery - 1, x = s * j.dx, g = Math.sqrt(x) / c;
      for (let iz = 0; iz < j.nOutZ; iz++) {
        const zf = (iz * j.zMax / (j.nOutZ - 1)) / dz, n0 = Math.floor(zf), t = zf - n0;
        if (n0 + 1 >= nz) continue;
        const a0 = Math.hypot(ur[n0], ui[n0]), a1 = Math.hypot(ur[n0 + 1], ui[n0 + 1]);
        F[iz * nxOut + ix] = (a0 * (1 - t) + a1 * t) * g;
      }
    }
  }
  return { xMax: nxOut * outEvery * j.dx, zMax: j.zMax, nx: nxOut, nz: j.nOutZ, F, dz, thMaxDeg: Math.asin(Math.min(1, lam / (2 * dz))) * 180 / Math.PI };
}

/** F (linear) at (x, z) by bilinear interpolation; NaN outside the grid. */
export function peAt(g: PeGrid, x: number, z: number): number {
  const fx = x / g.xMax * g.nx - 1, fz = z / g.zMax * (g.nz - 1);
  if (fx < 0 || fx > g.nx - 1 || fz < 0 || fz > g.nz - 1) return NaN;
  const ix = Math.min(Math.floor(fx), g.nx - 2), iz = Math.min(Math.floor(fz), g.nz - 2);
  const tx = fx - ix, tz = fz - iz, F = g.F, n = g.nx;
  return (F[iz * n + ix] * (1 - tx) + F[iz * n + ix + 1] * tx) * (1 - tz)
       + (F[(iz + 1) * n + ix] * (1 - tx) + F[(iz + 1) * n + ix + 1] * tx) * tz;
}
