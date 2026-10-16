// Vertical coverage diagram: SINR margin over threshold vs. range × height.
// Shows multipath lobes, the horizon, and the effect of clutter.
import { useEffect, useMemo, useRef, useState } from 'react';
import { effectiveEarth, type CoverageJob } from '../engine/environment';
import { LUT, LUT_CSS } from './colormap';
import { useCanvas } from './useCanvas';
import { fmt } from '../ui/controls';
import { tr } from '../i18n';

const LO = -20, HI = 30;     // displayed margin (dB)
const NX = 260, NY = 140;
const EMPTY = new Float32Array(NX * NY).fill(-300);

type JobIn = Omit<CoverageJob, 'nx' | 'ny'>;

/** Computes the grid in a worker; the previous one is kept until the result arrives. */
function useCoverage(job: JobIn) {
  const [res, setRes] = useState<{ grid: Float32Array; rMax: number; hMax: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const w = useRef<Worker | null>(null);
  const seq = useRef(0);
  const meta = useRef(new Map<number, { rMax: number; hMax: number }>());
  useEffect(() => {
    const wk = new Worker(new URL('../engine/coverage.worker.ts', import.meta.url), { type: 'module' });
    wk.onmessage = (ev: MessageEvent<{ id: number; grid: Float32Array }>) => {
      const m = meta.current.get(ev.data.id);
      meta.current.delete(ev.data.id);
      if (ev.data.id !== seq.current || !m) return;          // stale response
      setRes({ grid: ev.data.grid, ...m });
      setBusy(false);
    };
    w.current = wk;
    return () => wk.terminate();
  }, []);
  useEffect(() => {
    const id = ++seq.current;
    meta.current.set(id, { rMax: job.rMax, hMax: job.hMax });
    setBusy(true);
    w.current?.postMessage({ id, job: { ...job, nx: NX, ny: NY } });
  }, [job]);
  return { res, busy };
}

export function CoverageView({ job, reqDb, hTarget }: { job: JobIn; reqDb: number; hTarget: number }) {
  const [hover, setHover] = useState<{ R: number; h: number; m: number } | null>(null);
  const { res, busy } = useCoverage(job);
  const grid = res?.grid ?? EMPTY;
  const rMax = res?.rMax ?? job.rMax, hMax = res?.hMax ?? job.hMax;
  const ae = useMemo(() => effectiveEarth(job.e), [job.e]);

  const img = useMemo(() => {
    const off = document.createElement('canvas');
    off.width = NX; off.height = NY;
    const c2 = off.getContext('2d')!;
    const id = c2.createImageData(NX, NY);
    for (let i = 0; i < NX * NY; i++) {
      const m = grid[i] - reqDb, o = i * 4;
      if (grid[i] < -150) { id.data[o] = 10; id.data[o + 1] = 16; id.data[o + 2] = 24; id.data[o + 3] = 255; continue; }
      const t = Math.max(0, Math.min(1, (m - LO) / (HI - LO)));
      const k = Math.round(t * 255) * 3;
      id.data[o] = LUT[k]; id.data[o + 1] = LUT[k + 1]; id.data[o + 2] = LUT[k + 2]; id.data[o + 3] = 255;
      // threshold contour (0 dB margin)
      const x = i % NX, up = grid[i] >= reqDb;
      if ((x < NX - 1 && (grid[i + 1] >= reqDb) !== up) || (i + NX < NX * NY && (grid[i + NX] >= reqDb) !== up)) {
        id.data[o] = 255; id.data[o + 1] = 255; id.data[o + 2] = 255;
      }
    }
    c2.putImageData(id, 0, 0);
    return off;
  }, [grid, reqDb]);

  const pad = { L: 50, R: 14, T: 12, B: 30 };
  const ref = useCanvas(0.46, (c, w, h) => {
    const pw = w - pad.L - pad.R, ph = h - pad.T - pad.B;
    c.clearRect(0, 0, w, h);
    c.save();
    c.beginPath(); c.roundRect(pad.L, pad.T, pw, ph, 10); c.clip();
    c.imageSmoothingEnabled = true;
    c.drawImage(img, pad.L, pad.T, pw, ph);
    const X = (R: number) => pad.L + R / rMax * pw, Y = (hh: number) => pad.T + (1 - hh / hMax) * ph;
    // radar horizon for each height: R = √(2ae·hr) + √(2ae·h)
    const hr = job.L.hRadar;
    c.strokeStyle = 'rgba(255,107,107,.85)'; c.setLineDash([5, 4]); c.lineWidth = 1.3;
    c.beginPath();
    for (let j = 0; j <= 80; j++) {
      const hh = hMax * j / 80, R = Math.sqrt(2 * ae * hr) + Math.sqrt(2 * ae * hh);
      if (j === 0) c.moveTo(X(R), Y(hh)); else c.lineTo(X(R), Y(hh));
    }
    c.stroke();
    // target height
    if (hTarget < hMax) {
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.setLineDash([2, 4]);
      c.beginPath(); c.moveTo(pad.L, Y(hTarget)); c.lineTo(pad.L + pw, Y(hTarget)); c.stroke();
      c.setLineDash([]); c.fillStyle = 'rgba(255,255,255,.8)';
      c.fillText(tr(`blanco ${fmt(hTarget, 0)} m`, `target ${fmt(hTarget, 0)} m`), pad.L + 8, Y(hTarget) - 5);
    }
    c.restore();
    // axes
    c.setLineDash([]);
    c.font = '10px "Geist Mono"'; c.fillStyle = '#7f90a3';
    for (let i = 0; i <= 6; i++) {
      const R = rMax * i / 6, s = fmt(R / 1e3, 0);
      c.fillText(s, X(R) - c.measureText(s).width / 2, h - pad.B + 15);
    }
    for (let j = 0; j <= 4; j++) {
      const hh = hMax * j / 4, s = hMax >= 2000 ? fmt(hh / 1e3, 1) + ' km' : fmt(hh, 0) + ' m';
      c.fillText(s, pad.L - 8 - c.measureText(s).width, Y(hh) + 3);
    }
    c.fillStyle = '#566578';
    const xl = tr('distancia (km)', 'range (km)');
    c.fillText(xl, pad.L + pw - c.measureText(xl).width, h - 4);
  }, [img, rMax, hMax, hTarget, ae, job.L.hRadar]);

  const onMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const pw = r.width - pad.L - pad.R, ph = r.height - pad.T - pad.B;
    const fx = (ev.clientX - r.left - pad.L) / pw, fy = (ev.clientY - r.top - pad.T) / ph;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) { setHover(null); return; }
    const i = Math.min(NX - 1, Math.floor(fx * NX)), j = Math.min(NY - 1, Math.floor(fy * NY));
    setHover({ R: fx * rMax, h: (1 - fy) * hMax, m: grid[j * NX + i] - reqDb });
  };

  return (
    <>
      <div className={'view' + (busy ? ' is-busy' : '')}>
        <canvas ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        {hover && (
          <div className="readout">
            {`R ${fmt(hover.R / 1e3, 1)} km · h ${fmt(hover.h, 0)} m\n`}
            {hover.m < -150 ? tr('bajo el horizonte', 'below the horizon') : `${tr('margen', 'margin')} ${hover.m >= 0 ? '+' : ''}${fmt(hover.m, 1)} dB ${hover.m >= 0 ? tr('· detecta', '· detected') : tr('· no detecta', '· not detected')}`}
          </div>
        )}
      </div>
      <div className="legend">
        <span>{LO} dB</span><div className="bar" style={{ background: LUT_CSS }} /><span>+{HI} dB</span>
        <span className="legend-note">{tr('margen SINR sobre el umbral', 'SINR margin over threshold')} · <i className="dash red" /> {tr('horizonte', 'horizon')}</span>
      </div>
    </>
  );
}
