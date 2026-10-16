// AESA face: elements colored by phase or amplitude, subarray borders, and failure editing.
import { useRef, useState } from 'react';
import type { FaceConfig, FaceGeometry } from '../engine/config';
import type { Weights } from '../engine/array';
import { phaseColor } from './colormap';
import { useCanvas } from './useCanvas';
import { Seg } from '../ui/controls';
import { tr } from '../i18n';

type Mode = 'phase' | 'amp';
type Tool = 'element' | 'subarray';

export function FaceView(p: {
  face: FaceConfig; g: FaceGeometry; w: Weights; failed: Uint8Array;
  onToggle: (idx: number[], fail: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>('phase');
  const [tool, setTool] = useState<Tool>('element');
  const drag = useRef<{ fail: boolean } | null>(null);
  const { g, w, failed, face } = p;

  const ref = useCanvas(g.Ny / g.Nx, (ctx, W, H) => {
    const cw = W / g.Nx, ch = H / g.Ny;
    ctx.fillStyle = '#05080c'; ctx.fillRect(0, 0, W, H);
    let amax = 0;
    for (let i = 0; i < g.N; i++) amax = Math.max(amax, Math.hypot(w.re[i], w.im[i]));
    for (let iy = 0; iy < g.Ny; iy++) {
      for (let ix = 0; ix < g.Nx; ix++) {
        const i = iy * g.Nx + ix;
        const X = ix * cw, Y = (g.Ny - 1 - iy) * ch;    // row 0 at the bottom
        if (failed[i]) {
          ctx.fillStyle = '#5a1414'; ctx.fillRect(X + 0.5, Y + 0.5, cw - 1, ch - 1);
          continue;
        }
        const a = Math.hypot(w.re[i], w.im[i]) / (amax || 1);
        ctx.fillStyle = mode === 'phase'
          ? phaseColor(Math.atan2(w.im[i], w.re[i]), 0.35 + 0.65 * a)
          : `rgba(255,181,71,${(0.08 + 0.92 * a).toFixed(3)})`;
        ctx.fillRect(X + 0.5, Y + 0.5, cw - 1, ch - 1);
      }
    }
    ctx.strokeStyle = 'rgba(214,226,236,0.55)'; ctx.lineWidth = 1;
    for (let s = 0; s <= face.nSubX; s++) {
      const X = Math.round(s * face.subNx * cw) + 0.5;
      ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, H); ctx.stroke();
    }
    for (let s = 0; s <= face.nSubY; s++) {
      const Y = Math.round(s * face.subNy * ch) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, Y); ctx.lineTo(W, Y); ctx.stroke();
    }
  }, [w, failed, mode, face]);

  const pick = (e: React.PointerEvent<HTMLCanvasElement>): number[] | null => {
    const r = e.currentTarget.getBoundingClientRect();
    const ix = Math.floor((e.clientX - r.left) / r.width * g.Nx);
    const iy = g.Ny - 1 - Math.floor((e.clientY - r.top) / r.height * g.Ny);
    if (ix < 0 || iy < 0 || ix >= g.Nx || iy >= g.Ny) return null;
    const i = iy * g.Nx + ix;
    if (tool === 'element') return [i];
    const s = g.sub[i], out: number[] = [];
    for (let j = 0; j < g.N; j++) if (g.sub[j] === s) out.push(j);
    return out;
  };

  return (
    <>
      <div className="view">
        <canvas ref={ref} style={{ cursor: 'crosshair', touchAction: 'none' }}
          onPointerDown={e => {
            const idx = pick(e); if (!idx) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { fail: !failed[idx[0]] };
            p.onToggle(idx, drag.current.fail);
          }}
          onPointerMove={e => {
            if (!drag.current) return;
            const idx = pick(e); if (idx) p.onToggle(idx, drag.current.fail);
          }}
          onPointerUp={() => { drag.current = null; }} />
      </div>
      <div className="body" style={{ paddingTop: 4 }}>
        <div className="row">
          <div style={{ flex: 1 }}><Seg value={mode} onChange={setMode} options={[{ v: 'phase', label: tr('fase', 'phase') }, { v: 'amp', label: tr('amplitud', 'amplitude') }]} /></div>
          <div style={{ flex: 1 }}><Seg value={tool} onChange={setTool} options={[{ v: 'element', label: tr('elemento', 'element') }, { v: 'subarray', label: 'subarray' }]} /></div>
        </div>
        <p className="note">{tr('Haz clic o arrastra para apagar o encender ', 'Click or drag to switch off or on ')}{tool === 'element' ? tr('elementos', 'elements') : tr('subarrays completos', 'whole subarrays')} {tr('(módulos T/R caídos).', '(failed T/R modules).')}</p>
      </div>
    </>
  );
}
