import { useEffect, useRef, useState } from 'react';

// a value that settles `ms` after it stops changing (the timer is cleared on every change and on unmount)
export function useSettled<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

// the latest value without re-running effects
export function useLatest<T>(value: T) {
  const r = useRef(value);
  r.current = value;
  return r;
}
