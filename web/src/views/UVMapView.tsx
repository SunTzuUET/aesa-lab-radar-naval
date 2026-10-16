// Gain map in sine space (u, v), visible region u² + v² ≤ 1.
import { useMemo, useState } from 'react';
import type { UVMap } from '../engine/pattern';
import { LUT, LUT_CSS } from './colormap';
import { useCanvas } from './useCanvas';
import { fmt } from '../ui/controls';

const DYN = 60;   // displayed dynamic range (dB below peak)

export function UVMapView({ map, steer }: { map: UVMap; steer: [number, number] }) {
  const [hover, setHover] = useState<{ u: number; v: number; g: number } | null>(null);

  // base image at map resolution
  const img = useMemo(() => {
    const { res, gainDbi, peakDbi } = map;
    const off = document.createElement('canvas');
    off.width = res; off.height = res;
    const ctx = off.getContext('2d')!;
    const id = ctx.createImageData(res, res);
    for (let i = 0; i < res * res; i++) {
      const gv = gainDbi[i];
      const o = i * 4;
      if (Number.isNaN(gv)) { id.data[o + 3] = 0; continue; }
      const t = Math.max(0, Math.min(1, (gv - (peakDbi - DYN)) / DYN));
      const k = Math.round(t * 255) * 3;
      id.data[o] = LUT[k]; id.data[o + 1] = LUT[k + 1]; id.data[o + 2] = LUT[k + 2]; id.data[o + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return off;
  }, [map]);

  const ref = useCanvas(1, (ctx, w, h) => {
    const m = 28, S = Math.min(w, h) - 2 * m;
    const cx = w / 2, cy = h / 2, R = S / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, cx - R, cy - R, S, S);
    // graticule
    ctx.strokeStyle = 'rgba(214,226,236,0.13)'; ctx.lineWidth = 1;
    for (const r of [0.5, Math.sin(Math.PI / 3), 1]) {
      ctx.beginPath(); ctx.arc(cx, cy, r * R, 0, 2 * Math.PI); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.fillStyle = 'rgba(125,143,160,0.9)'; ctx.font = '10px "Geist Mono"';
    ctx.fillText('30°', cx + 0.5 * R + 3, cy - 3); ctx.fillText('60°', cx + Math.sin(Math.PI / 3) * R + 3, cy - 3);
    ctx.fillText('u →', cx + R - 22, cy + 13); ctx.fillText('v ↑', cx + 5, cy - R + 11);
    // commanded pointing
    const sx = cx + steer[0] * R, sy = cy - steer[1] * R;
    ctx.strokeStyle = '#4be39a'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 2 * Math.PI);
    ctx.moveTo(sx - 15, sy); ctx.lineTo(sx - 5, sy); ctx.moveTo(sx + 5, sy); ctx.lineTo(sx + 15, sy);
    ctx.moveTo(sx, sy - 15); ctx.lineTo(sx, sy - 5); ctx.moveTo(sx, sy + 5); ctx.lineTo(sx, sy + 15);
    ctx.stroke();
  }, [img, steer[0], steer[1]]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const w = r.width, m = 28, R = (w - 2 * m) / 2;
    const u = (e.clientX - r.left - w / 2) / R, v = -(e.clientY - r.top - w / 2) / R;
    if (u * u + v * v > 1) { setHover(null); return; }
    const a = Math.round((u + 1) / 2 * (map.res - 1)), b = Math.round((1 - v) / 2 * (map.res - 1));
    setHover({ u, v, g: map.gainDbi[b * map.res + a] });
  };

  const el = hover ? Math.asin(hover.v) * 180 / Math.PI : 0;
  const az = hover ? Math.asin(Math.max(-1, Math.min(1, hover.u / Math.cos(el * Math.PI / 180)))) * 180 / Math.PI : 0;

  return (
    <>
      <div className="view uvmap">
        <canvas ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        {hover && (
          <div className="readout">
            {`az ${fmt(az)}°  el ${fmt(el)}°\nG  ${fmt(hover.g)} dBi  (${fmt(hover.g - map.peakDbi)} dB)`}
          </div>
        )}
      </div>
      <div className="legend uvlegend">
        <span>{fmt(map.peakDbi - DYN, 0)}</span>
        <div className="bar" style={{ background: LUT_CSS }} />
        <span>{fmt(map.peakDbi, 0)} dBi</span>
      </div>
    </>
  );
}
