interface Stage {
  stage: string;
  label: string;
  passed: boolean;
  error?: string;
  warnings?: number;
}

interface Props {
  stages: Stage[] | null;
  loading: boolean;
}

export default function ValidationResults({ stages, loading }: Props) {
  if (loading) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
        <h3 className="text-xs font-semibold text-slate-400 mb-2">Validation</h3>
        <div className="flex gap-2">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="w-5 h-5 rounded bg-slate-700 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!stages) return null;

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
      <h3 className="text-xs font-semibold text-slate-400 mb-2">6-Stage Validation</h3>
      <div className="grid grid-cols-6 gap-1.5">
        {stages.map(s => (
          <div key={s.stage} className="text-center">
            <div className={`w-full aspect-square rounded-lg flex items-center justify-center text-lg
              ${s.passed
                ? 'bg-emerald-900/40 border border-emerald-700/50 text-emerald-400'
                : 'bg-red-900/40 border border-red-700/50 text-red-400'
              }`}
            >
              {s.passed ? '\u2713' : '\u2717'}
            </div>
            <div className="text-[8px] text-slate-500 mt-1 leading-tight">{s.label}</div>
          </div>
        ))}
      </div>
      {stages.some(s => !s.passed && s.error) && (
        <div className="mt-2 text-[10px] text-red-400 bg-red-900/20 rounded p-2 font-mono">
          {stages.find(s => !s.passed)?.error}
        </div>
      )}
    </div>
  );
}
