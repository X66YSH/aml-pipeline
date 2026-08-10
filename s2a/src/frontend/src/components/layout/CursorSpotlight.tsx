import { useEffect } from 'react';

export default function CursorSpotlight() {
  useEffect(() => {
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
        document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);

        const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('.spotlight-card');
        if (target) {
          const rect = target.getBoundingClientRect();
          target.style.setProperty('--card-x', `${e.clientX - rect.left}px`);
          target.style.setProperty('--card-y', `${e.clientY - rect.top}px`);
        }
        frame = 0;
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <div className="spotlight" aria-hidden />;
}
