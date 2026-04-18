interface HeaderProps {
  schemaKey: string;
  isCompiling: boolean;
}

export default function Header({ schemaKey, isCompiling }: HeaderProps) {
  return (
    <header className="glass flex justify-between items-center p-4 rounded-xl shadow-md">
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isCompiling ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
          S2F Studio
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Signal-to-Feature Compiler | Regulatory Text → Detection Code
        </p>
      </div>
      <div className="flex gap-3">
        <span className="px-3 py-1 bg-indigo-900/40 text-indigo-300 rounded-md text-xs border border-indigo-700/50">
          Channels: {schemaKey ? schemaKey.toUpperCase().replace(/,/g, ', ').replace(/_/g, ' ') : 'NONE'}
        </span>
        <span className="px-3 py-1 bg-emerald-900/40 text-emerald-400 rounded-md text-xs border border-emerald-700/50">
          V1 — Feature Engineering
        </span>
      </div>
    </header>
  );
}
