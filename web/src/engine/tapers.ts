// 1D amplitude tapers (separable across the face). Normalized to a maximum of 1.
import type { TaperKind } from './config';

export function taper1d(kind: TaperKind, N: number, sllDb: number, nbar: number): Float64Array {
  if (kind === 'taylor') return taylor(N, sllDb, nbar);
  if (kind === 'chebyshev') return chebyshev(N, sllDb);
  return new Float64Array(N).fill(1);
}

/** n̄-term Taylor (Taylor 1955), sampled at element positions. */
export function taylor(N: number, sllDb: number, nbar: number): Float64Array {
  const R = Math.pow(10, sllDb / 20);
  const A = Math.acosh(R) / Math.PI;
  const s2 = nbar * nbar / (A * A + (nbar - 0.5) * (nbar - 0.5));
  const F: number[] = [];
  for (let m = 1; m < nbar; m++) {
    let num = 1, den = 1;
    for (let n = 1; n < nbar; n++) {
      num *= 1 - (m * m) / (s2 * (A * A + (n - 0.5) * (n - 0.5)));
      if (n !== m) den *= 1 - (m * m) / (n * n);
    }
    F.push(((m + 1) % 2 === 0 ? 1 : -1) * num / (2 * den));
  }
  const w = new Float64Array(N);
  let mx = 0;
  for (let i = 0; i < N; i++) {
    const xi = (i - (N - 1) / 2) / N;   // position normalized to the aperture
    let v = 1;
    for (let m = 1; m < nbar; m++) v += 2 * F[m - 1] * Math.cos(2 * Math.PI * m * xi);
    w[i] = v; mx = Math.max(mx, v);
  }
  for (let i = 0; i < N; i++) w[i] /= mx;
  return w;
}

/** Exact Dolph-Chebyshev: inverse DFT of the pattern T_{N-1}(x0 cos(ψ/2)) sampled at N points. */
export function chebyshev(N: number, sllDb: number): Float64Array {
  if (N < 2) return new Float64Array(N).fill(1);
  const R = Math.pow(10, sllDb / 20);
  const M = N - 1;
  const x0 = Math.cosh(Math.acosh(R) / M);
  const T = (x: number) =>
    Math.abs(x) <= 1 ? Math.cos(M * Math.acos(x))
      : (x > 0 ? 1 : (M % 2 === 0 ? 1 : -1)) * Math.cosh(M * Math.acosh(Math.abs(x)));
  const w = new Float64Array(N);
  // AF(ψ) = Σ w_n e^{j n ψ} = e^{j M ψ/2} T(x0 cos(ψ/2)); sampled at ψ_k = 2πk/N
  for (let n = 0; n < N; n++) {
    let acc = 0;
    for (let k = 0; k < N; k++) {
      const psi = 2 * Math.PI * k / N;
      const t = T(x0 * Math.cos(psi / 2));
      acc += t * Math.cos((M / 2 - n) * psi);    // real part of AF(ψ_k) e^{-j n ψ_k}
    }
    w[n] = acc / N;
  }
  let mx = 0;
  for (let n = 0; n < N; n++) mx = Math.max(mx, Math.abs(w[n]));
  for (let n = 0; n < N; n++) w[n] /= mx;
  return w;
}
