// "Console" colormap: bluish black → blue → cyan → amber → white.
const STOPS: [number, [number, number, number]][] = [
  [0.00, [7, 11, 16]],
  [0.25, [14, 40, 84]],
  [0.50, [22, 120, 170]],
  [0.70, [79, 214, 255]],
  [0.85, [255, 181, 71]],
  [1.00, [255, 246, 220]],
];

export const LUT: Uint8ClampedArray = (() => {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0; while (k < STOPS.length - 2 && t > STOPS[k + 1][0]) k++;
    const [t0, c0] = STOPS[k], [t1, c1] = STOPS[k + 1];
    const a = (t - t0) / (t1 - t0);
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = c0[j] + a * (c1[j] - c0[j]);
  }
  return lut;
})();

export const LUT_CSS = `linear-gradient(90deg, ${STOPS.map(([t, c]) => `rgb(${c.join(',')}) ${t * 100}%`).join(', ')})`;

/** Cyclic color for phase (HSL). */
export function phaseColor(phi: number, alpha = 1): string {
  const h = ((phi / (2 * Math.PI)) * 360 + 187 + 360) % 360;   // phase 0 → cyan (red reserved for failures)
  return `hsla(${h.toFixed(0)}, 70%, 55%, ${alpha})`;
}
