// Canvas line plot with horizontal and vertical markers.
import { useCanvas } from './useCanvas';

export interface Series { x: ArrayLike<number>; y: ArrayLike<number>; color: string; width?: number; dash?: number[]; label?: string; }
export interface Mark { at: number; color: string; label?: string; dash?: number[]; }

export function LinePlot(p: {
  series: Series[]; xRange: [number, number]; yRange: [number, number];
  xLabel: string; yLabel: string; aspect?: number;
  hMarks?: Mark[]; vMarks?: Mark[]; xTicks?: number; yTicks?: number;
  xFmt?: (v: number) => string; yFmt?: (v: number) => string;
}) {
  const ref = useCanvas(p.aspect ?? 0.42, (ctx, w, h) => {
    const L = 46, R = 12, T = 12, B = 30;
    const pw = w - L - R, ph = h - T - B;
    const [x0, x1] = p.xRange, [y0, y1] = p.yRange;
    const X = (x: number) => L + (x - x0) / (x1 - x0) * pw;
    const Y = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * ph;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '10px "Geist Mono"';
    // grid and axes
    const nx = p.xTicks ?? 6, ny = p.yTicks ?? 5;
    ctx.strokeStyle = 'rgba(148,178,214,0.07)'; ctx.fillStyle = '#7f90a3'; ctx.lineWidth = 1;
    for (let i = 0; i <= nx; i++) {
      const xv = x0 + (x1 - x0) * i / nx, xp = X(xv);
      ctx.beginPath(); ctx.moveTo(xp, T); ctx.lineTo(xp, T + ph); ctx.stroke();
      const s = p.xFmt ? p.xFmt(xv) : String(Math.round(xv));
      ctx.fillText(s, xp - ctx.measureText(s).width / 2, h - B + 14);
    }
    for (let i = 0; i <= ny; i++) {
      const yv = y0 + (y1 - y0) * i / ny, yp = Y(yv);
      ctx.beginPath(); ctx.moveTo(L, yp); ctx.lineTo(L + pw, yp); ctx.stroke();
      const s = p.yFmt ? p.yFmt(yv) : String(Math.round(yv));
      ctx.fillText(s, L - 6 - ctx.measureText(s).width, yp + 3);
    }
    ctx.fillStyle = '#566578';
    ctx.fillText(p.xLabel, L + pw - ctx.measureText(p.xLabel).width, h - 4);
    ctx.save(); ctx.translate(11, T + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText(p.yLabel, -ctx.measureText(p.yLabel).width / 2, 0); ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
    for (const m of p.hMarks ?? []) {
      ctx.strokeStyle = m.color; ctx.setLineDash(m.dash ?? [4, 4]);
      ctx.beginPath(); ctx.moveTo(L, Y(m.at)); ctx.lineTo(L + pw, Y(m.at)); ctx.stroke();
      if (m.label) { ctx.fillStyle = m.color; ctx.fillText(m.label, L + pw - ctx.measureText(m.label).width - 6, Y(m.at) - 4); }
    }
    for (const m of p.vMarks ?? []) {
      ctx.strokeStyle = m.color; ctx.setLineDash(m.dash ?? [4, 4]);
      ctx.beginPath(); ctx.moveTo(X(m.at), T); ctx.lineTo(X(m.at), T + ph); ctx.stroke();
      if (m.label) { ctx.fillStyle = m.color; ctx.fillText(m.label, X(m.at) + 4, T + 28); }
    }
    ctx.setLineDash([]);
    for (const s of p.series) {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width ?? 1.5; ctx.setLineDash(s.dash ?? []); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < s.x.length; i++) {
        const yv = s.y[i];
        if (!Number.isFinite(yv)) { pen = false; continue; }
        const xp = X(s.x[i]), yp = Y(Math.max(y0 - 5, Math.min(y1 + 5, yv)));
        if (pen) ctx.lineTo(xp, yp); else { ctx.moveTo(xp, yp); pen = true; }
      }
      ctx.stroke();
    }
    ctx.restore();
    // legend
    let lx = L + pw;
    ctx.setLineDash([]);
    for (const s of [...p.series].reverse()) {
      if (!s.label) continue;
      const tw = ctx.measureText(s.label).width;
      lx -= tw + 30;
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.setLineDash(s.dash ?? []);
      ctx.beginPath(); ctx.moveTo(lx, T + 8); ctx.lineTo(lx + 16, T + 8); ctx.stroke();
      ctx.fillStyle = '#c9d6e3'; ctx.fillText(s.label, lx + 20, T + 11);
    }
  }, [p]);
  return <div className="view"><canvas ref={ref} /></div>;
}
