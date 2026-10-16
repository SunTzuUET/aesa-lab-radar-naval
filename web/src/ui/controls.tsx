import { useState, type CSSProperties, type ReactNode } from 'react';
import { getLang } from '../i18n';

/** Boxless section: collapsible header and content. Acts as an inspector in the sidebars. */
export function Panel({ title, hint, children, pad = true, collapsible = true, defaultOpen = true }: {
  title: string; hint?: ReactNode; children: ReactNode; pad?: boolean; collapsible?: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={'panel' + (open ? '' : ' closed')}>
      <header className="sec-head">
        {collapsible
          ? <button className="sec-title" onClick={() => setOpen(o => !o)} aria-expanded={open}>
              <Chevron />{title}
            </button>
          : <h3 className="sec-title">{title}</h3>}
        {hint && <span className="hint" onClick={e => e.stopPropagation()}>{hint}</span>}
      </header>
      {open && (pad ? <div className="body">{children}</div> : children)}
    </section>
  );
}

function Chevron() {
  return <svg className="chev" viewBox="0 0 12 12" aria-hidden><path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Slider(p: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  const pct = Math.max(0, Math.min(100, (p.value - p.min) / (p.max - p.min) * 100));
  return (
    <label className="ctl">
      <div className="ctl-head"><span>{p.label}</span><output>{p.fmt ? p.fmt(p.value) : p.value}</output></div>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} style={{ '--p': pct + '%' } as CSSProperties}
        onChange={e => p.onChange(Number(e.target.value))} />
    </label>
  );
}

export function Seg<T extends string | number>(p: {
  label?: string; value: T; options: { v: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="ctl">
      {p.label && <div className="ctl-head"><span>{p.label}</span></div>}
      <div className="seg">
        {p.options.map(o => (
          <button key={String(o.v)} className={o.v === p.value ? 'on' : ''} onClick={() => p.onChange(o.v)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={'toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span>{label}</span><i />
    </div>
  );
}

export function Metric({ k, v, unit, tone }: { k: string; v: string; unit?: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className={'metric' + (tone ? ' ' + tone : '')}>
      <div className="k">{k}</div>
      <div className="v">{v}{unit && <small>{unit}</small>}</div>
    </div>
  );
}

/** Number formatting: decimal comma (es-ES) or decimal point (en-US) depending on language. */
export const fmt = (x: number, d = 1) => {
  if (!Number.isFinite(x)) return '—';
  if (Math.abs(x) < 0.5 * Math.pow(10, -d)) x = 0;          // avoids "−0,00"
  return x.toLocaleString(getLang() === 'en' ? 'en-US' : 'es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
};
