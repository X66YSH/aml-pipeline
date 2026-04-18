interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function RegulatoryTextInput({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-slate-400 font-medium">Regulatory Text</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Paste regulatory text here, or select an initiative above..."
        rows={6}
        className="w-full bg-slate-800/60 border border-slate-700 rounded-lg p-3 text-sm
          text-slate-200 placeholder-slate-500 resize-none focus:outline-none
          focus:ring-1 focus:ring-sky-500/50 focus:border-sky-500/50 font-serif italic leading-relaxed"
      />
      <div className="text-[10px] text-slate-500 text-right">
        {value.length > 0 ? `${value.length} chars` : ''}
      </div>
    </div>
  );
}
