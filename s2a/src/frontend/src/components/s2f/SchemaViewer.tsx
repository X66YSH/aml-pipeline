import { useEffect, useState } from 'react';
import { fetchJSON } from '../../api/client';

interface Channel {
  key: string;
  name: string;
  columns: string[];
  row_count: number;
}

interface SampleData {
  table_name: string;
  columns: string[];
  dtypes: Record<string, string>;
  sample: Record<string, unknown>[];
}

interface Props {
  selectedChannels: string[];
  onChannelsChange: (channels: string[]) => void;
}

export default function SchemaViewer({ selectedChannels, onChannelsChange }: Props) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [sample, setSample] = useState<SampleData | null>(null);
  const [showSample, setShowSample] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    fetchJSON<{ channels: Channel[] }>('/channels')
      .then(d => setChannels(d.channels))
      .catch(console.error);
  }, []);

  // Load sample for the first selected channel
  useEffect(() => {
    if (selectedChannels.length > 0) {
      fetchJSON<{ info: SampleData }>(`/channels/${selectedChannels[0]}/sample`)
        .then(d => setSample(d.info))
        .catch(console.error);
    } else {
      setSample(null);
    }
  }, [selectedChannels]);

  const toggleChannel = (key: string) => {
    if (selectedChannels.includes(key)) {
      onChannelsChange(selectedChannels.filter(k => k !== key));
    } else {
      onChannelsChange([...selectedChannels, key]);
    }
  };

  const selectAll = () => onChannelsChange(channels.map(c => c.key));
  const clearAll = () => onChannelsChange([]);

  const totalRows = channels
    .filter(c => selectedChannels.includes(c.key))
    .reduce((sum, c) => sum + c.row_count, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-slate-400 font-medium">Transaction Channels</label>
        <span className="text-[10px] text-slate-500">
          {selectedChannels.length} selected · {totalRows.toLocaleString()} rows
        </span>
      </div>

      {/* Multi-select dropdown */}
      <div className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-300 text-left flex items-center justify-between"
        >
          <span className="truncate">
            {selectedChannels.length === 0
              ? 'Select channels...'
              : selectedChannels.length === channels.length
                ? 'All channels'
                : selectedChannels.map(k => channels.find(c => c.key === k)?.name || k).join(', ')}
          </span>
          <svg className={`w-3 h-3 text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {dropdownOpen && (
          <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
            {/* Select all / Clear */}
            <div className="flex gap-2 p-2 border-b border-slate-700">
              <button onClick={selectAll} className="text-[10px] text-sky-400 hover:text-sky-300">Select All</button>
              <span className="text-slate-600">|</span>
              <button onClick={clearAll} className="text-[10px] text-sky-400 hover:text-sky-300">Clear</button>
            </div>

            {channels.map(ch => (
              <label
                key={ch.key}
                className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-700/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedChannels.includes(ch.key)}
                  onChange={() => toggleChannel(ch.key)}
                  className="rounded border-slate-600 bg-slate-700 text-purple-500 focus:ring-purple-500 focus:ring-offset-0 w-3.5 h-3.5"
                />
                <span className="text-xs text-slate-300 flex-1">{ch.name}</span>
                <span className="text-[9px] text-slate-500">{ch.row_count.toLocaleString()}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Selected channel tags */}
      {selectedChannels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedChannels.map(key => {
            const ch = channels.find(c => c.key === key);
            return (
              <span
                key={key}
                className="text-[9px] bg-purple-900/40 text-purple-300 border border-purple-700/50 px-1.5 py-0.5 rounded flex items-center gap-1"
              >
                {ch?.name || key}
                <button
                  onClick={() => toggleChannel(key)}
                  className="hover:text-purple-100 ml-0.5"
                >
                  x
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Schema preview */}
      {selectedChannels.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 space-y-2">
          <p className="text-[10px] text-slate-400">
            Common columns: transaction_id, customer_id, amount_cad, debit_credit, transaction_datetime
          </p>

          <button
            onClick={() => setShowSample(!showSample)}
            className="text-[10px] text-sky-400 hover:text-sky-300 transition"
          >
            {showSample ? 'Hide' : 'Show'} sample rows ({selectedChannels[0]})
          </button>

          {showSample && sample && (
            <div className="overflow-x-auto max-h-32 mt-1">
              <table className="text-[9px] font-mono w-full">
                <thead>
                  <tr className="text-slate-400">
                    {sample.columns.map(c => <th key={c} className="px-1 py-0.5 text-left">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {sample.sample.slice(0, 3).map((row, i) => (
                    <tr key={i} className="text-slate-300 border-t border-slate-700/30">
                      {sample.columns.map(c => (
                        <td key={c} className="px-1 py-0.5 truncate max-w-20">
                          {String(row[c] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
