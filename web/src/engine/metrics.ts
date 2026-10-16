// Beam metrics on a cut: peak, HPBW, first nulls and SLL.
import type { Cut } from './pattern';

export interface BeamMetrics {
  peakDbi: number;
  peakAngDeg: number;   // angle of the maximum (parabolic interpolation)
  hpbwDeg: number;      // -3 dB width
  sllDb: number;        // peak sidelobe relative to the main peak (dB, negative)
  nullLoDeg: number; nullHiDeg: number;
}

export function cutMetrics(c: Cut): BeamMetrics {
  const g = c.gainDbi, a = c.angDeg, n = g.length;
  // maximum ignoring NaN (outside visible space, e.g. the elevation cut with the beam steered off in azimuth)
  let i0 = -1;
  for (let i = 0; i < n; i++) if (Number.isFinite(g[i]) && (i0 < 0 || g[i] > g[i0])) i0 = i;
  if (i0 < 0) return { peakDbi: NaN, peakAngDeg: NaN, hpbwDeg: NaN, sllDb: NaN, nullLoDeg: NaN, nullHiDeg: NaN };
  // sub-sample peak: 3-point parabola
  let peakAng = a[i0], peak = g[i0];
  if (i0 > 0 && i0 < n - 1) {
    const y1 = g[i0 - 1], y2 = g[i0], y3 = g[i0 + 1];
    const den = y1 - 2 * y2 + y3;
    if (den < 0) {
      const dlt = 0.5 * (y1 - y3) / den;
      peakAng = a[i0] + dlt * (a[1] - a[0]);
      peak = y2 - 0.25 * (y1 - y3) * dlt;
    }
  }
  // -3 dB crossings by linear interpolation
  const thr = peak - 3;
  let lo = i0; while (lo > 0 && g[lo] > thr) lo--;
  let hi = i0; while (hi < n - 1 && g[hi] > thr) hi++;
  const xl = lo === i0 ? a[i0] : a[lo] + (thr - g[lo]) / (g[lo + 1] - g[lo]) * (a[lo + 1] - a[lo]);
  const xh = hi === i0 ? a[i0] : a[hi - 1] + (thr - g[hi - 1]) / (g[hi] - g[hi - 1]) * (a[hi] - a[hi - 1]);
  // first nulls: monotonic descent from the peak
  let nl = i0; while (nl > 0 && g[nl - 1] < g[nl]) nl--;
  let nh = i0; while (nh < n - 1 && g[nh + 1] < g[nh]) nh++;
  let side = -Infinity;
  for (let i = 0; i < n; i++) if ((i < nl || i > nh) && Number.isFinite(g[i]) && g[i] > side) side = g[i];
  return {
    peakDbi: peak, peakAngDeg: peakAng, hpbwDeg: xh - xl,
    sllDb: Number.isFinite(side) ? side - peak : -Infinity,
    nullLoDeg: a[nl], nullHiDeg: a[nh],
  };
}

/**
 * 2D SLL on the u-v map: the main lobe is the connected region around the
 * peak reachable by monotonic descent (down to the nulls); SLL = maximum outside it.
 */
export function sll2D(gainDbi: Float32Array, res: number): number {
  let p0 = 0;
  for (let i = 1; i < gainDbi.length; i++) if (gainDbi[i] > gainDbi[p0] || Number.isNaN(gainDbi[p0])) p0 = i;
  const inMain = new Uint8Array(gainDbi.length);
  const stack = [p0]; inMain[p0] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % res, y = (i / res) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= res || ny >= res) continue;
      const j = ny * res + nx;
      if (inMain[j] || Number.isNaN(gainDbi[j])) continue;
      if (gainDbi[j] <= gainDbi[i]) { inMain[j] = 1; stack.push(j); }
    }
  }
  let side = -Infinity;
  for (let i = 0; i < gainDbi.length; i++) if (!inMain[i] && gainDbi[i] > side) side = gainDbi[i];
  return side - gainDbi[p0];
}
