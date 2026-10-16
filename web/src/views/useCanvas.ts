import { useEffect, useRef, useState } from 'react';
import { useLang } from '../i18n';

/**
 * Canvas that tracks its container width (aspect = height/width) with HiDPI sharpness.
 * draw receives the already-scaled context and the size in CSS px.
 */
export function useCanvas(
  aspect: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  deps: unknown[],
) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);
  const { lang } = useLang();   // redraw on language change (labels and number format)
  // redraw once web fonts load (otherwise the first draw uses the fallback font)
  useEffect(() => { document.fonts?.ready.then(() => setFontsReady(true)); }, []);

  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c || width === 0) return;
    const h = Math.round(width * aspect);
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr; c.height = h * dpr;
    c.style.height = h + 'px';
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, width, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, fontsReady, lang, ...deps]);

  return ref;
}
