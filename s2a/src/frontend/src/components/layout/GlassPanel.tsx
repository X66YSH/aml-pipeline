import type { ReactNode } from 'react';

interface GlassPanelProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export default function GlassPanel({ title, children, className = '' }: GlassPanelProps) {
  return (
    <div className={`glass rounded-xl p-4 flex flex-col gap-3 ${className}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-700/50 pb-2">
        {title}
      </h2>
      {children}
    </div>
  );
}
