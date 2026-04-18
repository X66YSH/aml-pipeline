interface Parameter {
  name: string;
  ambiguous_term: string;
  dtype: string;
  default: number;
  valid_range: [number, number] | null;
  unit: string | null;
  rationale: string;
  regulatory_basis: string;
}

interface Props {
  parameters: Parameter[];
  values: Record<string, number>;
  onChange: (name: string, value: number) => void;
}

export default function ParameterSliders({ parameters, values, onChange }: Props) {
  if (parameters.length === 0) return null;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
      <h3 className="text-xs font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
        Parameterised Ambiguity Resolution
      </h3>
      <p className="text-[9px] text-slate-500 mb-3">
        Adjust thresholds to override default interpretations without re-prompting the LLM.
      </p>
      <div className="space-y-3">
        {parameters.map(p => {
          const min = p.valid_range?.[0] ?? 0;
          const max = p.valid_range?.[1] ?? p.default * 5;
          const val = values[p.name] ?? p.default;
          const fmt = p.unit === 'USD' ? `$${val.toLocaleString()}` : `${val} ${p.unit || ''}`;

          return (
            <div key={p.name}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="font-mono text-slate-300">{p.name}</span>
                <span className="text-sky-400 font-mono">{fmt}</span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={p.dtype === 'int' ? 1 : (max - min) / 100}
                value={val}
                onChange={e => onChange(p.name, Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-[8px] text-slate-500 mt-0.5">
                <span>{min}</span>
                <span className="truncate mx-2">"{p.ambiguous_term}"</span>
                <span>{max}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
