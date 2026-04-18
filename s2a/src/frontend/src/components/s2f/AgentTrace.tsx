interface TraceEvent {
  timestamp: number;
  level: string;
  agent: string;
  message: string;
}

interface Props {
  events: TraceEvent[];
}

const LEVEL_STYLES: Record<string, string> = {
  agent: 'text-purple-400',
  tool: 'text-sky-400',
  success: 'text-emerald-400',
  error: 'text-red-400',
  info: 'text-slate-400',
};

const LEVEL_ICONS: Record<string, string> = {
  agent: '\u25B6',
  tool: '\u2699',
  success: '\u2713',
  error: '\u2717',
  info: '\u2022',
};

export default function AgentTrace({ events }: Props) {
  if (events.length === 0) return null;

  return (
    <div className="bg-slate-900/80 border border-slate-700 rounded-lg p-2.5 max-h-40 overflow-y-auto">
      <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Agent Trace</h3>
      <div className="space-y-0.5">
        {events.map((e, i) => (
          <div key={i} className={`text-[10px] font-mono flex gap-2 ${LEVEL_STYLES[e.level] || 'text-slate-400'}`}>
            <span className="text-slate-600 w-10 shrink-0 text-right">{e.timestamp.toFixed(1)}s</span>
            <span className="w-3 shrink-0">{LEVEL_ICONS[e.level] || '\u2022'}</span>
            <span className="text-slate-500 w-24 shrink-0 truncate">{e.agent}</span>
            <span className="truncate">{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
