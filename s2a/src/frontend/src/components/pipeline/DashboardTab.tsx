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
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
  Label,
} from 'recharts';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DashboardBundle } from '../../api/client';
import PRACard from './PRACard';

interface Props {
  bundle: DashboardBundle | null;
  pipelineRunning: boolean;
}

type MetricRow = { id: string; label: string; value: unknown; format?: string | null };

// ── Threshold-based colour helpers ───────────────────────────────────────────

// Muted hex fills for SVG bars — 55% alpha over dark slate, matching /20–/30 card style
function aucColor(v: number): string {
  if (v >= 0.85) return '#34d3998c'; // emerald-400/55
  if (v >= 0.70) return '#fbbf248c'; // amber-400/55
  return '#f871718c';                // red-400/55
}

function ivColor(v: number): string {
  if (v >= 0.10) return '#34d3998c';
  if (v >= 0.02) return '#fbbf248c';
  return '#f871718c';
}

// Text colours mirror home-page card pattern: -300 shades, no sharp -400 on accents
function kpiTextColor(id: string, raw: unknown): string {
  if (id === 'features_passing_gate') {
    const parts = String(raw).split('/').map(s => parseInt(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[1] > 0) {
      const ratio = parts[0] / parts[1];
      return ratio === 1 ? 'text-emerald-300' : ratio >= 0.5 ? 'text-amber-300' : 'text-red-300';
    }
    return 'text-slate-400';
  }
  const v = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (isNaN(v)) return 'text-slate-300';
  if (id === 'best_auc') return v >= 0.85 ? 'text-emerald-300' : v >= 0.70 ? 'text-amber-300' : 'text-red-300';
  if (id === 'best_iv')  return v >= 0.10 ? 'text-emerald-300' : v >= 0.02 ? 'text-amber-300' : 'text-red-300';
  return 'text-slate-300';
}

function barFill(id: string, value: unknown): string {
  const v = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(v)) return '#818cf880'; // indigo-400/50
  if (id === 'model_auc_bar') return aucColor(v);
  if (id === 'channel_iv_bar' || id === 'feature_iv_bar') return ivColor(v);
  if (id.startsWith('woe_bins_bar')) return v >= 0 ? '#34d3998c' : '#f871718c'; // sign-based: emerald vs red
  return '#818cf880';
}

// ── Regulatory text cleaner ───────────────────────────────────────────────────
// Strip document-header boilerplate (title, reference number, date, PDF link)
// and return just the substantive body + a short source attribution line.
function cleanRegulatoryText(raw: string): { body: string; source: string } {
  const METADATA = /^(operational alert:|reference number:|pdf version|\w+ \d{1,2},?\s*\d{4})/i;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const sourceLines: string[] = [];
  const bodyLines: string[] = [];
  for (const line of lines) {
    if (METADATA.test(line) || line.includes('(PDF version') || line.includes('PDF version')) {
      if (/reference number/i.test(line)) sourceLines.push(line.replace(/^reference number:\s*/i, '').trim());
    } else {
      bodyLines.push(line);
    }
  }
  const body = bodyLines.join(' ').trim();
  const truncated = body.length > 280 ? body.slice(0, 280).trimEnd() + '…' : body;
  return { body: truncated, source: sourceLines.join(' · ') };
}

// ── Main component ────────────────────────────────────────────────────────────

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

  const bestAuc = useMemo(() => {
    const m = metricById.get('best_auc');
    const v = parseFloat(String(m?.value ?? ''));
    return isNaN(v) ? null : v;
  }, [metricById]);

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
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06 }}
              className="min-w-0"
              style={{ gridColumn: `span ${span} / span ${span}` }}
            >
              <WidgetFrame title={w.title as string | undefined}>
                <DashboardWidget
                  w={w}
                  material={material}
                  metricById={metricById}
                  bestAuc={bestAuc}
                />
              </WidgetFrame>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Widget chrome ─────────────────────────────────────────────────────────────

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

// ── Metric formatting ─────────────────────────────────────────────────────────

function formatMetricValue(m: MetricRow): string {
  const v = m.value;
  if (v === null || v === undefined) return '—';
  if (m.format === 'int') return String(Math.round(Number(v)));
  if (m.format === 'float') return typeof v === 'number' ? v.toFixed(4) : String(v);
  return String(v);
}

// ── Widget renderer ───────────────────────────────────────────────────────────

function DashboardWidget({
  w,
  material,
  metricById,
  bestAuc,
}: {
  w: Record<string, unknown>;
  material: DashboardBundle['material'];
  metricById: Map<string, MetricRow>;
  bestAuc: number | null;
}) {
  const seriesCat = (material?.series_catalog || {}) as Record<string, { points?: unknown[]; kind?: string; label?: string }>;
  const tables = (material?.tables || {}) as Record<string, { columns?: string[]; rows?: Record<string, unknown>[] }>;
  const confusionMatrix = material?.confusion_matrix as { tp: number; fp: number; fn: number; tn: number; model_name?: string } | null | undefined;
  const narrative = (material?.narrative || {}) as Record<string, unknown>;

  // ── KPI row ──────────────────────────────────────────────────────────────────
  if (w.type === 'kpi_row') {
    const ids = (w.metric_ids as string[]) || [];
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {ids.map((id) => {
          const m = metricById.get(id);
          const textClass = m ? kpiTextColor(id, m.value) : 'text-indigo-200';
          return (
            <div
              key={id}
              className="rounded-lg border border-slate-700/60 bg-slate-950/50 px-3 py-3 text-center"
            >
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{m?.label || id}</div>
              <div className={`text-lg font-mono font-semibold ${textClass}`}>
                {m ? formatMetricValue(m) : '—'}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Markdown ─────────────────────────────────────────────────────────────────
  if (w.type === 'markdown') {
    return (
      <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed
                      prose-headings:text-slate-200 prose-strong:text-slate-100
                      prose-code:text-indigo-300 prose-li:marker:text-slate-500">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {String(w.body || '')}
        </ReactMarkdown>
      </div>
    );
  }

  // ── Table ────────────────────────────────────────────────────────────────────
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
                {t.columns!.map((c) => {
                  const val = row[c] !== undefined && row[c] !== null ? String(row[c]) : '—';
                  const passColor = c === 'pass'
                    ? val === '✓' ? 'text-emerald-400/70' : val === '✗' ? 'text-red-400/70' : ''
                    : '';
                  return (
                    <td key={c} className={`px-3 py-2 font-mono text-slate-300 ${passColor}`}>
                      {val}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Bar chart ────────────────────────────────────────────────────────────────
  if (w.type === 'bar') {
    const sid = w.series_id as string;
    const series = seriesCat[sid];
    const pts = (series?.points || []) as Record<string, unknown>[];
    if (!pts.length) {
      return <p className="text-xs text-slate-500">No series data for `{sid}`.</p>;
    }

    const first = pts[0] || {};
    const xKey = 'name' in first ? 'name' : 'channel' in first ? 'channel' : 'range' in first ? 'range' : 'x';
    const yKey = 'value' in first ? 'value' : 'auc' in first ? 'auc' : 'woe' in first ? 'woe' : 'y';
    const isIvChart = sid === 'channel_iv_bar' || sid === 'feature_iv_bar';
    const isWoe = sid.startsWith('woe_bins_bar');
    const isHorizontal = w.horizontal === true;

    if (isHorizontal) {
      // Horizontal bar chart: layout="vertical" in recharts (counterintuitive but correct)
      const labelWidth = Math.min(150, Math.max(80, Math.max(...pts.map(p => String(p[xKey] || '').length)) * 7));
      return (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pts} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 'auto']}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
              />
              <YAxis
                type="category"
                dataKey={xKey}
                tick={{ fontSize: 9, fill: '#94a3b8' }}
                width={labelWidth}
              />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11, color: '#e2e8f0' }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              {isIvChart && (
                <ReferenceLine x={0.02} stroke="#f59e0b80" strokeDasharray="4 3" strokeWidth={1.2}>
                  <Label value="0.02" position="top" fontSize={9} fill="#f59e0b99" />
                </ReferenceLine>
              )}
              <Bar dataKey={yKey} radius={[0, 4, 4, 0]}>
                {pts.map((pt, i) => (
                  <Cell key={i} fill={barFill(sid, pt[yKey])} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    return (
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={pts} margin={{ top: 4, right: 8, bottom: isWoe ? 28 : 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: isWoe ? 8 : 10, fill: '#94a3b8' }}
              angle={isWoe ? -25 : 0}
              textAnchor={isWoe ? 'end' : 'middle'}
              interval={0}
            />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} domain={isWoe ? ['auto', 'auto'] : [0, 'auto']} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11, color: '#e2e8f0' }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#e2e8f0' }}
            />
            {isIvChart && (
              <ReferenceLine y={0.02} stroke="#f59e0b80" strokeDasharray="4 3" strokeWidth={1.2}>
                <Label value="IV gate (0.02)" position="insideTopRight" fontSize={9} fill="#f59e0b99" />
              </ReferenceLine>
            )}
            {isWoe && (
              <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
            )}
            <Bar dataKey={yKey} radius={[3, 3, 0, 0]}>
              {pts.map((pt, i) => (
                <Cell key={i} fill={barFill(sid, pt[yKey])} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Line chart (ROC) ─────────────────────────────────────────────────────────
  if (w.type === 'line') {
    const sid = w.series_id as string;
    const series = seriesCat[sid];
    const pts = (series?.points || []) as Record<string, unknown>[];
    if (!pts.length) {
      return <p className="text-xs text-slate-500">No series data for `{sid}`.</p>;
    }

    const isRoc = sid === 'roc_best';

    return (
      <div className="h-56 relative">
        {isRoc && bestAuc !== null && (
          <div className="absolute top-2 right-10 z-10 text-[10px] font-mono text-sky-300/70 bg-slate-900/60 px-2 py-0.5 rounded border border-slate-700/50">
            AUC = {bestAuc.toFixed(4)}
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pts} margin={{ top: 4, right: 8, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="fpr"
              type="number"
              domain={[0, 1]}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              label={{ value: 'False Positive Rate', position: 'insideBottom', offset: -12, fontSize: 10, fill: '#64748b' }}
            />
            <YAxis
              domain={[0, 1]}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              label={{ value: 'True Positive Rate', angle: -90, position: 'insideLeft', offset: 10, fontSize: 10, fill: '#64748b' }}
            />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11, color: '#e2e8f0' }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#e2e8f0' }}
            />
            {/* Random classifier baseline */}
            {isRoc && (
              <ReferenceLine
                segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
                stroke="#475569"
                strokeDasharray="4 3"
                strokeWidth={1}
              />
            )}
            <Line type="monotone" dataKey="tpr" stroke="#38bdf8cc" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Confusion matrix ─────────────────────────────────────────────────────────
  if (w.type === 'confusion_matrix') {
    if (!confusionMatrix) return <p className="text-xs text-slate-500">No confusion matrix data.</p>;
    const { tp, fp, fn, tn } = confusionMatrix;
    const precision = tp + fp > 0 ? tp / (tp + fp) : null;
    const recall    = tp + fn > 0 ? tp / (tp + fn) : null;
    const specificity = tn + fp > 0 ? tn / (tn + fp) : null;
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-1.5 text-xs">
          <div />
          <div className="text-center text-[10px] text-slate-500 uppercase tracking-wide pb-0.5">Pred +</div>
          <div className="text-center text-[10px] text-slate-500 uppercase tracking-wide pb-0.5">Pred −</div>

          <div className="text-[10px] text-slate-500 uppercase tracking-wide flex items-center">Actual +</div>
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-center">
            <div className="text-[10px] text-slate-500 mb-0.5">TP</div>
            <div className="font-mono text-emerald-300 text-sm font-semibold">{tp.toLocaleString()}</div>
          </div>
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-center">
            <div className="text-[10px] text-slate-500 mb-0.5">FN</div>
            <div className="font-mono text-amber-300 text-sm font-semibold">{fn.toLocaleString()}</div>
          </div>

          <div className="text-[10px] text-slate-500 uppercase tracking-wide flex items-center">Actual −</div>
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 text-center">
            <div className="text-[10px] text-slate-500 mb-0.5">FP</div>
            <div className="font-mono text-red-300 text-sm font-semibold">{fp.toLocaleString()}</div>
          </div>
          <div className="rounded-lg bg-slate-800/50 border border-slate-700/40 p-2.5 text-center">
            <div className="text-[10px] text-slate-500 mb-0.5">TN</div>
            <div className="font-mono text-slate-300 text-sm font-semibold">{tn.toLocaleString()}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-800/60">
          {[
            { label: 'Precision', value: precision },
            { label: 'Recall',    value: recall },
            { label: 'Specificity', value: specificity },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
              <div className="font-mono text-slate-300 text-xs mt-0.5">
                {value !== null ? value.toFixed(3) : '—'}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Regulatory basis ──────────────────────────────────────────────────────────
  if (w.type === 'regulatory_basis') {
    const category    = narrative.indicator_category as string | undefined;
    const description = narrative.indicator_description as string | undefined;
    const rawPreview  = narrative.regulatory_preview as string | undefined;
    if (!description && !rawPreview) return <p className="text-xs text-slate-500">No regulatory context available.</p>;
    const { body: excerptBody, source: excerptSource } = rawPreview
      ? cleanRegulatoryText(rawPreview)
      : { body: '', source: '' };
    return (
      <div className="space-y-3">
        {/* Category badge */}
        {category && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full
            bg-purple-500/10 border border-purple-500/20 text-purple-300
            text-[10px] uppercase tracking-wider">
            {category}
          </span>
        )}
        {/* Indicator description — the pipeline-extracted signal */}
        {description && (
          <p className="text-xs text-slate-300 leading-relaxed">{description}</p>
        )}
        {/* Cleaned regulatory excerpt */}
        {excerptBody && (
          <div className="rounded-lg bg-slate-800/40 border border-slate-700/40 px-3 py-2.5 space-y-1.5">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Source document excerpt</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">{excerptBody}</p>
            {excerptSource && (
              <p className="text-[10px] text-slate-600 font-mono pt-0.5">Ref: {excerptSource}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  return <p className="text-xs text-slate-500">Unsupported widget type.</p>;
}
