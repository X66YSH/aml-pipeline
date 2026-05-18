/**
 * DashboardTab — Phase 7: Dashboard Builder output.
 *
 * Renders a spec-driven grid from cached pipeline material (metrics, series, tables).
 * Chart bindings are data-driven from catalog ids, not hardcoded to AML fields.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { LayoutDashboard, Loader2 } from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { DashboardBundle } from '../../api/client';
import PRACard from './PRACard';

interface Props {
  bundle: DashboardBundle | null;
  pipelineRunning: boolean;
}

type MetricRow = { id: string; label: string; value: unknown; format?: string | null };

export default function DashboardTab({ bundle, pipelineRunning }: Props) {
  const spec = bundle?.spec;
  const material = bundle?.material;

  const metricById = useMemo(() => {
    const map = new Map<string, MetricRow>();
    for (const m of (material?.metrics || []) as MetricRow[]) {
      if (m?.id) map.set(m.id, m);
    }
    return map;
  }, [material]);

  if (!bundle && pipelineRunning) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-500 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <p className="text-sm">Dashboard Builder is caching results and designing layout…</p>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-10 text-center">
        <LayoutDashboard className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
          Run the full pipeline on this project. When the run finishes, the Dashboard Builder caches metrics,
          model curves, and evaluation tables, then composes a layout tailored to this run.
        </p>
      </div>
    );
  }

  const title = (spec?.dashboard_title as string) || 'Run dashboard';
  const subtitle = (spec?.dashboard_subtitle as string) || '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="space-y-6"
    >
      <div className="rounded-xl border border-indigo-500/25 bg-gradient-to-br from-indigo-950/40 to-slate-900/60 p-6">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-indigo-500/15 border border-indigo-500/30">
            <LayoutDashboard className="w-5 h-5 text-indigo-300" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white tracking-tight">{title}</h2>
            {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
            {bundle.updated_at && (
              <p className="text-[10px] text-slate-600 mt-2 font-mono">Updated {bundle.updated_at}</p>
            )}
          </div>
        </div>
      </div>

      {bundle.pra && (
        <PRACard
          pra={{
            perceive: String(bundle.pra.perceive || ''),
            reason: String(bundle.pra.reason || ''),
          }}
          agentName="Dashboard Builder"
          isActive={pipelineRunning}
          actContent={
            <div className="space-y-2">
              {bundle.pra.act != null && bundle.pra.act !== '' && (
                <p className="text-xs text-emerald-200/90 leading-relaxed">{String(bundle.pra.act)}</p>
              )}
              {spec?.layout_rationale && (
                <p className="text-xs text-slate-400 leading-relaxed">{String(spec.layout_rationale)}</p>
              )}
            </div>
          }
        />
      )}

      <div className="grid grid-cols-12 gap-4">
        {(spec?.widgets as Record<string, unknown>[] | undefined)?.map((w, idx) => {
          const span = Math.min(12, Math.max(1, Number(w.span) || 12));
          return (
            <div key={idx} className="min-w-0" style={{ gridColumn: `span ${span} / span ${span}` }}>
              <WidgetFrame title={w.title as string | undefined}>
                <DashboardWidget w={w} material={material} metricById={metricById} />
              </WidgetFrame>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

function WidgetFrame({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="h-full rounded-xl border border-slate-700/50 bg-slate-900/50 overflow-hidden flex flex-col">
      {title && (
        <div className="px-4 py-2 border-b border-slate-800/80 text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
          {title}
        </div>
      )}
      <div className="p-4 flex-1 min-h-[120px]">{children}</div>
    </div>
  );
}

function formatMetricValue(m: MetricRow): string {
  const v = m.value;
  if (v === null || v === undefined) return '—';
  if (m.format === 'int') return String(Math.round(Number(v)));
  if (m.format === 'float') return typeof v === 'number' ? v.toFixed(4) : String(v);
  return String(v);
}

function DashboardWidget({
  w,
  material,
  metricById,
}: {
  w: Record<string, unknown>;
  material: DashboardBundle['material'];
  metricById: Map<string, MetricRow>;
}) {
  const seriesCat = (material?.series_catalog || {}) as Record<string, { points?: unknown[]; kind?: string; label?: string }>;
  const tables = (material?.tables || {}) as Record<string, { columns?: string[]; rows?: Record<string, unknown>[] }>;

  if (w.type === 'kpi_row') {
    const ids = (w.metric_ids as string[]) || [];
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {ids.map((id) => {
          const m = metricById.get(id);
          return (
            <div
              key={id}
              className="rounded-lg border border-slate-700/60 bg-slate-950/50 px-3 py-3 text-center"
            >
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{m?.label || id}</div>
              <div className="text-lg font-mono font-semibold text-indigo-200">{m ? formatMetricValue(m) : '—'}</div>
            </div>
          );
        })}
      </div>
    );
  }

  if (w.type === 'markdown') {
    return (
      <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed whitespace-pre-wrap">
        {String(w.body || '')}
      </div>
    );
  }

  if (w.type === 'table') {
    const tid = w.table_id as string;
    const t = tables[tid];
    if (!t?.columns?.length || !t.rows?.length) {
      return <p className="text-xs text-slate-500">No table data for `{tid}`.</p>;
    }
    return (
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-950/80 text-slate-500 text-left">
              {t.columns.map((c) => (
                <th key={c} className="px-3 py-2 font-medium border-b border-slate-800">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                {t.columns!.map((c) => (
                  <td key={c} className="px-3 py-2 font-mono text-slate-300">
                    {row[c] !== undefined && row[c] !== null ? String(row[c]) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (w.type === 'bar' || w.type === 'line') {
    const sid = w.series_id as string;
    const series = seriesCat[sid];
    const pts = (series?.points || []) as Record<string, unknown>[];
    if (!pts.length) {
      return <p className="text-xs text-slate-500">No series data for `{sid}`.</p>;
    }

    const first = pts[0] || {};
    const xKey = 'name' in first ? 'name' : 'channel' in first ? 'channel' : 'x';
    const yKey =
      'value' in first ? 'value' : 'auc' in first ? 'auc' : 'tpr' in first ? 'tpr' : 'y';

    if (w.type === 'bar') {
      return (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pts} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
              />
              <Bar dataKey={yKey} fill="#818cf8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    return (
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pts} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="fpr" type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
            />
            <Line type="monotone" dataKey="tpr" stroke="#38bdf8" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return <p className="text-xs text-slate-500">Unsupported widget type.</p>;
}
