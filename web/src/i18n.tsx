// UI language (ES/EN). Texts are written as pairs next to the original: tr('texto', 'text').
// Texts coming from the engine (scenarios, validation, JSON names) are translated with dict().
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'es' | 'en';
const KEY = 'aesa-lang';

function initial(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'es') return q;
  } catch { /* no location (tests) */ }
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'en' || s === 'es') return s;
  } catch { /* storage blocked */ }
  return 'en';
}

// Module-level active language, for tr() and fmt() outside components.
let current: Lang = initial();
export const getLang = () => current;
export const tr = (es: string, en: string) => (current === 'en' ? en : es);
/** Translates a Spanish text coming from the engine or data; left as-is if there is no entry. */
export const dict = (es: string, table: Record<string, string>) => (current === 'en' ? table[es] ?? es : es);
/** Like dict, but for composite texts with values: exact entry or, failing that, in-order fragment substitution. */
export function phrases(es: string, table: Record<string, string>, frags: [string, string][]): string {
  if (current !== 'en') return es;
  if (table[es] !== undefined) return table[es];
  let s = es;
  for (const [a, b] of frags) s = s.split(a).join(b);
  return s;
}

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: current, setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(current);
  const setLang = useCallback((l: Lang) => {
    current = l;
    try { localStorage.setItem(KEY, l); } catch { /* no storage */ }
    try {
      const url = new URL(location.href);
      if (l === 'es') url.searchParams.set('lang', 'es'); else url.searchParams.delete('lang');
      history.replaceState(null, '', url.toString());
    } catch { /* no history */ }
    setState(l);
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);

export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-sw" role="group" aria-label="Idioma / Language">
      {(['es', 'en'] as Lang[]).map(l => (
        <button key={l} className={l === lang ? 'on' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
      ))}
    </div>
  );
}
