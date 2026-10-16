// In-place radix-2 complex FFT on separate re/im arrays.
// sign = -1: forward DFT (e^{-j}); sign = +1: unnormalized e^{+j} kernel.

// Per-size tables (bit reversal and twiddle factors), cached: the PE calls this thousands of times.
const tables = new Map<number, { rev: Uint32Array; c: Float64Array; s: Float64Array }>();
function tableFor(n: number) {
  let t = tables.get(n);
  if (!t) {
    const rev = new Uint32Array(n), bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    const c = new Float64Array(n >> 1), s = new Float64Array(n >> 1);
    for (let k = 0; k < n >> 1; k++) { c[k] = Math.cos(2 * Math.PI * k / n); s[k] = Math.sin(2 * Math.PI * k / n); }
    t = { rev, c, s };
    tables.set(n, t);
  }
  return t;
}

export function fft1d(re: Float64Array, im: Float64Array, sign: 1 | -1 = -1): void {
  const n = re.length;
  if ((n & (n - 1)) !== 0) throw new Error('fft1d: n debe ser potencia de 2');
  const { rev, c, s } = tableFor(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0, tw = 0; k < half; k++, tw += step) {
        const cr = c[tw], ci = sign * s[tw];
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

/** 2D FFT on a P×P grid in row-major order (index = row*P + col). */
export function fft2d(re: Float64Array, im: Float64Array, P: number, sign: 1 | -1 = -1): void {
  const rr = new Float64Array(P), ri = new Float64Array(P);
  for (let r = 0; r < P; r++) {
    const o = r * P;
    rr.set(re.subarray(o, o + P)); ri.set(im.subarray(o, o + P));
    fft1d(rr, ri, sign);
    re.set(rr, o); im.set(ri, o);
  }
  for (let c = 0; c < P; c++) {
    for (let r = 0; r < P; r++) { rr[r] = re[r * P + c]; ri[r] = im[r * P + c]; }
    fft1d(rr, ri, sign);
    for (let r = 0; r < P; r++) { re[r * P + c] = rr[r]; im[r * P + c] = ri[r]; }
  }
}
