import { useState, type ReactNode } from 'react';

interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const POS: Record<NonNullable<TooltipProps['side']>, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

/**
 * Lightweight CSS-only tooltip (no portal). Wraps an element; shows on
 * hover/focus. Keep labels short.
 */
export default function Tooltip({ label, children, side = 'top', className = '' }: TooltipProps) {
  const [show, setShow] = useState(false);
  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-[110] ${POS[side]} whitespace-nowrap rounded-lg
          glass-strong px-2.5 py-1.5 text-[11px] font-medium text-slate-100 shadow-lg
          transition-all duration-150 ${show ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
      >
        {label}
      </span>
    </span>
  );
}
