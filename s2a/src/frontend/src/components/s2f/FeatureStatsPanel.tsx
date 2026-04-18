import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface Stats {
  n_accounts: number;
  nonzero_pct: number;
  mean: number;
  std: number;
  min: number;
  max: number;
}

interface Histogram {
  counts: number[];
  bin_labels: string[];
}

interface Props {
  stats: Stats | null;
  histogram: Histogram | null;
  loading: boolean;
  error?: string | null;
}

export default function FeatureStatsPanel({ stats, histogram, loading, error }: Props) {
  if (loading) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
        <h3 className="text-xs font-semibold text-slate-400 mb-2">Running on data...</h3>
        <div className="h-24 bg-slate-700/30 rounded animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3">
        <h3 className="text-xs font-semibold text-red-400 mb-1">Execution Failed</h3>
        <p className="text-[10px] text-red-300 font-mono whitespace-pre-wrap">{error}</p>
      </div>
    );
  }

  if (!stats) return null;

  const chartData = histogram
    ? histogram.counts.map((count, i) => ({
        bin: histogram.bin_labels[i],
        count,
      }))
    : [];

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-2">
      <h3 className="text-xs font-semibold text-slate-400">Feature Statistics</h3>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Accounts', value: stats.n_accounts.toLocaleString() },
          { label: 'Nonzero %', value: `${stats.nonzero_pct}%` },
          { label: 'Mean', value: stats.mean.toFixed(3) },
          { label: 'Std', value: stats.std.toFixed(3) },
          { label: 'Min', value: stats.min.toFixed(2) },
          { label: 'Max', value: stats.max.toFixed(2) },
        ].map(s => (
          <div key={s.label} className="bg-slate-900/50 rounded px-2 py-1.5 text-center">
            <div className="text-[9px] text-slate-500">{s.label}</div>
            <div className="text-xs font-mono text-slate-200">{s.value}</div>
          </div>
        ))}
      </div>

      {chartData.length > 0 && (
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <XAxis dataKey="bin" hide />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 10 }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#38bdf8' }}
              />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? '#38bdf8' : '#1e40af'} fillOpacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
