// Live scan viewers. Redrawn every frame from the simulation clock,
// bypassing React state.
import { useEffect, useRef } from 'react';
import {
  FACE_AZ, FACE_COLOR, FACE_NAME, beamAt, faceGain, lfm,
  type ScanClock, type ScanConfig, type ScanPlan, type UTable,
} from '../engine/scan';
import { fmt } from '../ui/controls';
import { dict, tr } from '../i18n';

/** Canvas that tracks the container width and calls draw every frame while visible. */
function useLiveCanvas(aspect: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const cv = ref.current!, host = cv.parentElement!;
    let w = 0, h = 0, raf = 0, visible = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      w = Math.floor(host.clientWidth); h = Math.round(w * aspect);
      cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
    };
    const ro = new ResizeObserver(resize); ro.observe(host); resize();
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(cv);
    const ctx = cv.getContext('2d')!;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!visible || !w) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawRef.current(ctx, w, h);
    };
    loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [aspect]);
  return ref;
}

export interface LiveScan {
  clock: ScanClock; plan: ScanPlan; cfg: ScanConfig;
  tables: UTable[];          // table per face (face 0 with its failures)
  active: boolean;           // false: fixed beams (face 0 at its manual pointing)
  manual: { azDeg: number; elDeg: number };
}

const FACE_EN: Record<string, string> = { proa: 'bow', babor: 'port', popa: 'stern', estribor: 'starboard' };
const DYN = 50;              // polar plot dynamic range (dB)
const FONT = '10px "Geist Mono"';

function beamsNow(s: LiveScan) {
  const t = s.clock.now();
  return [0, 1, 2, 3].map(k => {
    if (s.active) return beamAt(s.plan, s.cfg, k, t);
    return { face: k, azDeg: k === 0 ? s.manual.azDeg : 0, elDeg: k === 0 ? s.manual.elDeg : 0, posIdx: 0, nPos: 1, pulseIdx: 0, tInPri: 0, frameFrac: 0 };
  });
}

/** Azimuth radiation pattern of the 4 faces, in the ship frame (bow up). */
export function PolarPatterns({ live }: { live: LiveScan }) {
  const ref = useLiveCanvas(1, (c, w, h) => {
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 40;
    const pk = Math.max(...live.tables.map(t => t.peakDbi));
    const rad = (g: number) => Math.max(0, (g - (pk - DYN)) / DYN) * R;
    // graticule
    c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 1;
    for (let i = 1; i <= 5; i++) { c.beginPath(); c.arc(cx, cy, R * i / 5, 0, 2 * Math.PI); c.stroke(); }
    for (let a = 0; a < 360; a += 30) {
      const s = Math.sin(a * Math.PI / 180), co = Math.cos(a * Math.PI / 180);
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + R * s, cy - R * co); c.stroke();
    }
    c.font = FONT; c.fillStyle = '#5e5e68';
    for (let i = 1; i <= 5; i++) { const r = R * i / 5; c.fillText(i === 5 ? '0 dB' : `−${DYN - 10 * i}`, cx + r * 0.26 + 3, cy - r * 0.966 + 10); }
    c.fillStyle = '#8a8a94';
    const lab = (t: string, a: number) => { const s = Math.sin(a * Math.PI / 180), co = Math.cos(a * Math.PI / 180); const m = c.measureText(t).width; c.fillText(t, cx + (R + 12) * s - m / 2, cy - (R + 12) * co + 3); };
    lab(tr('proa', 'bow'), 0); lab(tr('estribor', 'starboard'), 90); lab(tr('popa', 'stern'), 180); lab(tr('babor', 'port'), 270);
    // schematic ship
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.beginPath(); c.moveTo(cx, cy - 16); c.lineTo(cx + 5, cy - 4); c.lineTo(cx + 5, cy + 12); c.lineTo(cx - 5, cy + 12); c.lineTo(cx - 5, cy - 4); c.closePath(); c.fill();

    const beams = beamsNow(live);
    for (let k = 0; k < 4; k++) {
      const b = beams[k], t = live.tables[k];
      c.beginPath();
      let first = true;
      for (let th = -89.5; th <= 89.5; th += 0.25) {
        const g = faceGain(t, th, b.azDeg, b.elDeg);
        const phi = (FACE_AZ[k] - th) * Math.PI / 180, r = rad(g);
        const x = cx + r * Math.sin(phi), y = cy - r * Math.cos(phi);
        if (first) { c.moveTo(x, y); first = false; } else c.lineTo(x, y);
      }
      c.closePath();
      c.fillStyle = FACE_COLOR[k] + '22'; c.fill();
      c.strokeStyle = FACE_COLOR[k]; c.lineWidth = 1.3; c.stroke();
      // pointing marker on the rim
      const phi = (FACE_AZ[k] - b.azDeg) * Math.PI / 180;
      c.fillStyle = FACE_COLOR[k];
      c.beginPath(); c.arc(cx + (R + 2) * Math.sin(phi), cy - (R + 2) * Math.cos(phi), 3, 0, 2 * Math.PI); c.fill();
    }
  });
  return <div className="view live"><canvas ref={ref} /></div>;
}

/** Timeline: scan progress of each face and pulses of the current dwell. */
export function ScanTimeline({ live }: { live: LiveScan }) {
  const ref = useLiveCanvas(0.62, (c, w) => {
    const beams = beamsNow(live);
    const L = 74, Rr = 8, rowH = 46, top = 6;
    c.font = FONT;
    for (let k = 0; k < 4; k++) {
      const b = beams[k], y = top + k * rowH;
      c.fillStyle = FACE_COLOR[k]; c.fillRect(0, y + 4, 3, 30);
      c.fillStyle = '#ededf0'; c.font = '600 12px "Geist"'; c.fillText(dict(FACE_NAME[k], FACE_EN), 10, y + 14);
      c.font = FONT; c.fillStyle = '#8a8a94';
      c.fillText(`${b.azDeg >= 0 ? '+' : '−'}${fmt(Math.abs(b.azDeg), 1)}° / ${fmt(b.elDeg, 1)}°`, 10, y + 30);
      // full scan: positions as a fine grid
      const x0 = L + 30, bw = w - x0 - Rr;
      c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(x0, y + 6, bw, 8);
      c.fillStyle = FACE_COLOR[k] + '88'; c.fillRect(x0, y + 6, bw * b.frameFrac, 8);
      c.fillStyle = FACE_COLOR[k]; c.fillRect(x0 + bw * b.frameFrac - 1, y + 3, 2, 14);
      // dwell pulses
      const n = live.cfg.pulses, pw = Math.min(14, (bw - (n - 1) * 3) / n);
      for (let i = 0; i < n; i++) {
        c.fillStyle = !live.active ? 'rgba(255,255,255,0.08)' : i < b.pulseIdx ? FACE_COLOR[k] + '66' : i === b.pulseIdx ? FACE_COLOR[k] : 'rgba(255,255,255,0.08)';
        c.fillRect(x0 + i * (pw + 3), y + 22, pw, 10);
      }
      if (live.active) {
        c.fillStyle = '#5e5e68';
        const s = `pos ${b.posIdx + 1}/${b.nPos}`;
        c.fillText(s, x0 + bw - c.measureText(s).width, y + 42);
      }
    }
  });
  const { plan, cfg } = live;
  return (
    <>
      <div className="view live"><canvas ref={ref} /></div>
      <p className="note">
        {tr('Cuadro de búsqueda', 'Search frame')}: {plan.pos.length} {tr('posiciones', 'positions')} × {cfg.pulses} {tr('pulsos', 'pulses')} × {fmt(cfg.priS * 1e3, 2)} ms
        = {fmt(plan.frameS, 2)} {tr('s por cara. Las caras van desfasadas ¼ de cuadro.', 's per face. Faces are staggered by ¼ frame.')}
      </p>
    </>
  );
}

/** Transmitted waveform: linear chirp (I/Q under a moving magnifier) and instantaneous frequency. */
export function Waveform({ live }: { live: LiveScan }) {
  const { cfg } = live;
  const ref = useLiveCanvas(0.62, (c, w, h) => {
    const tau = cfg.tauS, B = cfg.bwHz;
    const pad = 8, h1 = h * 0.42, y1 = pad, y2 = h1 + 22, h2 = h - y2 - 16;
    // illustrative magnifier that sweeps the pulse every 4 s of wall-clock time
    const lupa = ((performance.now() / 4000) % 1) * tau;
    const win = tau / 60;
    // (1) instantaneous frequency along the pulse
    c.strokeStyle = 'rgba(255,255,255,0.06)';
    c.strokeRect(0.5, y1 + 0.5, w - 1, h1 - 1);
    c.strokeStyle = '#6b8cff'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, y1 + h1 - 4); c.lineTo(w, y1 + 4); c.stroke();
    const xl = lupa / tau * w;
    c.fillStyle = 'rgba(107,140,255,0.18)'; c.fillRect(xl - Math.max(2, win / tau * w / 2), y1, Math.max(4, win / tau * w), h1);
    c.fillStyle = '#8a8a94'; c.font = FONT;
    c.fillText(`+${fmt(B / 2e6, 1)} MHz`, 6, y1 + 13); c.fillText(`−${fmt(B / 2e6, 1)} MHz`, 6, y1 + h1 - 6);
    const tl = `τ = ${fmt(tau * 1e6, 0)} µs`; c.fillText(tl, w - c.measureText(tl).width - 6, y1 + h1 - 6);
    // (2) I/Q inside the magnifier
    c.strokeStyle = 'rgba(255,255,255,0.06)'; c.strokeRect(0.5, y2 + 0.5, w - 1, h2 - 1);
    const mid = y2 + h2 / 2, A = h2 * 0.4;
    const N = 400;
    for (const [comp, color] of [['i', '#59d8ff'], ['q', '#ffc061']] as const) {
      c.strokeStyle = color; c.lineWidth = 1.2; c.beginPath();
      for (let n = 0; n <= N; n++) {
        const t = lupa - win / 2 + win * n / N;
        const v = t < 0 || t > tau ? 0 : lfm(tau, B, t)[comp];
        const x = w * n / N, y = mid - A * v;
        if (n === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    const f = lfm(tau, B, lupa).fHz;
    c.fillStyle = '#ededf0';
    const s = `f = ${f >= 0 ? '+' : '−'}${fmt(Math.abs(f) / 1e6, 2)} MHz`;
    c.fillText(s, w - c.measureText(s).width - 6, y2 + 13);
    c.fillStyle = '#59d8ff'; c.fillText('I', 8, y2 + 13); c.fillStyle = '#ffc061'; c.fillText('Q', 20, y2 + 13);
    c.fillStyle = '#5e5e68'; c.fillText(tr('lupa ×60 · cámara lenta', 'zoom ×60 · slow motion'), 8, h - 3);
  });
  const bt = cfg.tauS * cfg.bwHz;
  return (
    <>
      <div className="view live"><canvas ref={ref} /></div>
      <div className="wf-facts">
        <span><b>{fmt(cfg.bwHz / 1e6, 1)}</b> MHz</span>
        <span><b>{fmt(cfg.tauS * 1e6, 0)}</b> µs</span>
        <span>BT <b>{fmt(bt, 0)}</b></span>
        <span>{tr('compresión', 'compression')} <b>{fmt(10 * Math.log10(bt), 1)}</b> dB</span>
        <span>ΔR <b>{fmt(150 / (cfg.bwHz / 1e6), 0)}</b> m</span>
        <span>{tr('ciclo', 'duty')} <b>{fmt(100 * cfg.tauS / cfg.priS, 1)}</b> %</span>
      </div>
    </>
  );
}
