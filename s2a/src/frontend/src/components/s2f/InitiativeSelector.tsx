import { useEffect, useState } from 'react';
import { fetchJSON } from '../../api/client';

interface Initiative {
  key: string;
  name: string;
  crime_type: string;
  url: string;
}

interface Props {
  onSelect: (key: string, text: string) => void;
}

const CRIME_COLORS: Record<string, string> = {
  ML: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
  HT: 'bg-red-900/40 text-red-300 border-red-700/50',
  TF: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  Drugs: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
  Tax: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
  Fraud: 'bg-orange-900/40 text-orange-300 border-orange-700/50',
  Sanctions: 'bg-rose-900/40 text-rose-300 border-rose-700/50',
  Wildlife: 'bg-green-900/40 text-green-300 border-green-700/50',
  CSAM: 'bg-slate-900/40 text-slate-300 border-slate-700/50',
};

export default function InitiativeSelector({ onSelect }: Props) {
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [fetching, setFetching] = useState<string | null>(null);

  useEffect(() => {
    fetchJSON<{ initiatives: Initiative[] }>('/initiatives')
      .then(d => setInitiatives(d.initiatives))
      .catch(console.error);
  }, []);

  const handleSelect = async (key: string) => {
    setFetching(key);
    try {
      const doc = await fetchJSON<{ full_text: string }>(`/initiatives/${key}`);
      onSelect(key, doc.full_text);
    } catch (e) {
      console.error(e);
    } finally {
      setFetching(null);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-xs text-slate-400 font-medium">FINTRAC Initiative</label>
      <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
        {initiatives.map(i => (
          <button
            key={i.key}
            onClick={() => handleSelect(i.key)}
            disabled={fetching !== null}
            className={`text-left px-2 py-1.5 rounded text-[10px] border transition-all
              hover:ring-1 hover:ring-slate-500 disabled:opacity-50
              ${CRIME_COLORS[i.crime_type] || 'bg-slate-800 text-slate-300 border-slate-700'}
              ${fetching === i.key ? 'ring-1 ring-sky-500 animate-pulse' : ''}
            `}
          >
            <div className="font-medium truncate">{i.name}</div>
            <div className="text-[9px] opacity-60 mt-0.5">{i.crime_type}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
