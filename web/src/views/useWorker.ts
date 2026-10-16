// Posts a job to a worker whenever it changes and keeps the last valid response.
import { useEffect, useRef, useState } from 'react';

export function useWorker<J, R>(make: () => Worker, job: J | null): { res: R | null; busy: boolean } {
  const [res, setRes] = useState<R | null>(null);
  const [busy, setBusy] = useState(false);
  const w = useRef<Worker | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const wk = make();
    wk.onmessage = (ev: MessageEvent<{ id: number } & R>) => {
      if (ev.data.id !== seq.current) return;              // stale response
      setRes(ev.data); setBusy(false);
    };
    w.current = wk;
    return () => wk.terminate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!job) return;
    const id = ++seq.current;
    setBusy(true);
    w.current?.postMessage({ id, job });
  }, [job]);
  return { res, busy };
}
