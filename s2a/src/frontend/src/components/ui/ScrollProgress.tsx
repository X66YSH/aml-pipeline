import { useEffect, useState } from 'react';

/**
 * Thin gradient bar pinned to the very top that reflects how far the main
 * content area is scrolled. Tracks the <main> scroll container.
 */
export default function ScrollProgress() {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const sc = document.querySelector('main');
    if (!sc) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = sc.scrollHeight - sc.clientHeight;
        setPct(max > 0 ? (sc.scrollTop / max) * 100 : 0);
      });
    };
    sc.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(sc);
    update();
    return () => {
      sc.removeEventListener('scroll', update);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="fixed top-0 left-0 right-0 z-[90] h-[2px] pointer-events-none">
      <div
        className="h-full bg-gradient-to-r from-purple-400 via-indigo-400 to-sky-400 transition-[width] duration-75 ease-out"
        style={{ width: `${pct}%`, opacity: pct > 0.5 ? 1 : 0 }}
      />
    </div>
  );
}
