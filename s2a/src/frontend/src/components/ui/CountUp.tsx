import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  value: number;
  duration?: number;
  decimals?: number;
  className?: string;
}

/**
 * Animates a number from 0 → value once it mounts (and re-animates when value
 * changes). Respects the OS "reduce motion" preference by snapping instantly.
 */
export default function CountUp({ value, duration = 900, decimals = 0, className }: CountUpProps) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || duration <= 0) { setDisplay(value); return; }

    const from = fromRef.current;
    const delta = value - from;
    let raf = 0;
    let start: number | null = null;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic

    const tick = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min((ts - start) / duration, 1);
      setDisplay(from + delta * ease(t));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className={className}>{display.toFixed(decimals)}</span>;
}
