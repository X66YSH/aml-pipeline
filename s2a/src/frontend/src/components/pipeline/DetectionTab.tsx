/**
 * DetectionTab — Anomaly Detection workspace (Pipeline Tab 5).
 *
 * Displays Isolation Forest detection results: per-channel metrics,
 * ROC curves, feature importance bars, confusion matrices, and
 * the Detection Strategist's reasoning from agent messages.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Cpu, Loader2, AlertCircle, XCircle, Zap, TrendingUp, BarChart3,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
  BarChart, Bar,
} from 'recharts';
import type { DetectResponse, TraceEvent, PRAData } from '../../api/client';
import PRACard from './PRACard';

// ── Color palette for channels ───────────────────────────────────────────────

const CHANNEL_COLORS: Record<string, string> = {
  card: '#a855f7',
  eft: '#38bdf8',
  emt: '#10b981',
  cheque: '#f59e0b',
  abm: '#ef4444',
  wire: '#6366f1',
  westernunion: '#ec4899',
};

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  detectResult: DetectResponse | null;
  traceEvents: TraceEvent[];
  agentMessages: { from: string; to: string; message: string }[];
  pipelineRunning: boolean;
  pra?: PRAData | null;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DetectionTab({
  detectResult,
  traceEvents,
  agentMessages,
  pipelineRunning,
  pra,
}: Props) {
  // Extract the Detection Strategist's reasoning
  const strategistMessages = useMemo(() => {
    return agentMessages.filter(
      (m) =>
        m.from === 'Detection Strategist' ||
        m.from.toLowerCase().includes('detection') ||
        m.from.toLowerCase().includes('strategist'),
    );
  }, [agentMessages]);

  // Collect valid channel results (skip errors / empty)
  const validChannels = useMemo(() => {
    if (!detectResult) return [];
    return Object.entries(detectResult.channels)
      .filter(([, ch]) => ch.models && ch.models.some((m) => !m.error))
      .map(([name, ch]) => ({ name, ...ch }));
  }, [detectResult]);

  // Build ROC curve data per channel (take best model per channel)
  const rocCurveData = useMemo(() => {
    if (!detectResult) return [];
    const curves: { channel: string; roc_curve: { fpr: number; tpr: number }[] }[] = [];
    for (const [ch, chResult] of Object.entries(detectResult.channels)) {
      const bestModel = (chResult.models || [])
        .filter((m) => !m.error && m.roc_curve && m.roc_curve.length > 0)
        .sort((a, b) => (b.auc_roc ?? 0) - (a.auc_roc ?? 0))[0];
      if (bestModel?.roc_curve) {
        curves.push({ channel: ch, roc_curve: bestModel.roc_curve });
      }
    }
    return curves;
  }, [detectResult]);

  // Build feature importance data (from first valid channel/model with importances)
  const featureImportanceData = useMemo(() => {
    if (!detectResult) return null;
    for (const [, ch] of Object.entries(detectResult.channels)) {
      for (const m of (ch.models || [])) {
        if (!m.error && m.feature_importances && m.feature_importances.length > 0) {
          const names = ch.feature_names || m.feature_importances.map((_, i) => `feature_${i}`);
          return m.feature_importances
            .map((val, i) => ({ name: names[i] || `feature_${i}`, importance: val }))
            .sort((a, b) => b.importance - a.importance);
        }
      }
    }
    return null;
  }, [detectResult]);

  // Total flagged
  const totalFlagged = useMemo(() => {
    if (!detectResult) return 0;
    let count = 0;
    for (const ch of Object.values(detectResult.channels)) {
      for (const m of (ch.models || [])) {
        if (!m.error && m.flagged_accounts) count += m.flagged_accounts;
      }
    }
    return count;
  }, [detectResult]);

  // ── Waiting state ────────────────────────────────────────────────────────
  if (!detectResult && pipelineRunning) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-5"
      >
        {pra && (
          <PRACard
            pra={pra}
            agentName="Detection Strategist"
            isActive={pipelineRunning}
          />
        )}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-16 flex flex-col items-center justify-center">
          <Loader2 className="w-10 h-10 text-purple-400 animate-spin mb-4" />
          <p className="text-sm text-slate-400">
            Running Isolation Forest on compatible channels...
          </p>
          <p className="text-xs text-slate-600 mt-1">
            Training models and computing anomaly scores
          </p>
        </div>
      </motion.div>
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!detectResult) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-16 flex flex-col items-center justify-center"
      >
        <Cpu className="w-12 h-12 text-slate-700 mb-4" />
        <p className="text-sm text-slate-500 mb-1">No detection results yet</p>
        <p className="text-xs text-slate-600 text-center max-w-sm">
          Run the pipeline to see anomaly detection results here.
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {/* ── PRA Card ────────────────────────────────────────────────────────── */}
      {pra && (
        <PRACard
          pra={pra}
          agentName="Detection Strategist"
          isActive={pipelineRunning}
        />
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Cpu className="w-5 h-5 text-purple-400" />
        <h2 className="text-lg font-bold text-white">
          Anomaly Detection &mdash; Isolation Forest
        </h2>
        {detectResult.success && (
          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold border uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
            COMPLETE
          </span>
        )}
      </div>

      {/* ── Detection Strategy (from agent messages) ────────────────────────── */}
      {strategistMessages.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            Detection Strategy
          </h3>
          <div className="space-y-2">
            {strategistMessages.map((msg, i) => (
              <div
                key={i}
                className="border-l-2 border-amber-500/40 pl-3 py-1.5"
              >
                <p className="text-xs text-slate-300 leading-relaxed">{msg.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Feature errors ──────────────────────────────────────────────────── */}
      {detectResult.feature_errors && detectResult.feature_errors.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-2">
            <XCircle className="w-4 h-4" />
            Feature Errors
          </h3>
          <div className="space-y-1">
            {detectResult.feature_errors.map((fe, i) => (
              <div key={i} className="text-xs text-red-300">
                <span className="font-medium">{fe.name}:</span> {fe.error}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Per-channel results ─────────────────────────────────────────────── */}
      {validChannels.length > 0 && (
        <div className="space-y-4">
          {validChannels.map((ch) => {
            const bestModel = (ch.models || [])
              .filter((m) => !m.error && m.auc_roc !== undefined)
              .sort((a, b) => (b.auc_roc ?? 0) - (a.auc_roc ?? 0))[0];
            if (!bestModel) return null;

            const cm = bestModel.confusion_matrix;

            return (
              <div
                key={ch.name}
                className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden"
              >
                {/* Channel header */}
                <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: CHANNEL_COLORS[ch.name] || '#6366f1' }}
                  />
                  <span className="text-sm font-semibold text-white capitalize">{ch.name}</span>
                  {ch.n_accounts != null && (
                    <span className="text-[10px] text-slate-500">
                      {ch.n_accounts.toLocaleString()} accounts
                    </span>
                  )}
                  {bestModel.auc_roc != null && (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold">
                      AUC {(bestModel.auc_roc * 100).toFixed(1)}%
                    </span>
                  )}
                </div>

                {/* Metrics row */}
                <div className="px-4 py-3 flex items-center gap-5 flex-wrap">
                  {bestModel.auc_roc != null && (
                    <div className="text-center">
                      <div className="text-xl font-bold text-emerald-400">
                        {(bestModel.auc_roc * 100).toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-slate-500 uppercase">AUC-ROC</div>
                    </div>
                  )}
                  {bestModel.f1_score != null && (
                    <div className="text-center">
                      <div className="text-xl font-bold text-amber-400">
                        {(bestModel.f1_score * 100).toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-slate-500 uppercase">F1</div>
                    </div>
                  )}
                  {bestModel.precision_at_k != null && (
                    <div className="text-center">
                      <div className="text-xl font-bold text-sky-400">
                        {(bestModel.precision_at_k * 100).toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-slate-500 uppercase">
                        Prec@{bestModel.k ?? 'K'}
                      </div>
                    </div>
                  )}
                  {bestModel.recall_at_k != null && (
                    <div className="text-center">
                      <div className="text-xl font-bold text-purple-400">
                        {(bestModel.recall_at_k * 100).toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-slate-500 uppercase">
                        Rec@{bestModel.k ?? 'K'}
                      </div>
                    </div>
                  )}
                  {bestModel.flagged_accounts != null && (
                    <>
                      <div className="h-10 w-px bg-slate-700" />
                      <div className="text-center">
                        <div className="text-sm font-semibold text-red-400">
                          {bestModel.flagged_accounts}
                        </div>
                        <div className="text-[10px] text-slate-500 uppercase">Flagged</div>
                      </div>
                    </>
                  )}
                </div>

                {/* Confusion Matrix */}
                {cm && (
                  <div className="px-4 py-3 border-t border-slate-700/30">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                      Confusion Matrix (Test Set)
                    </div>
                    <div className="grid grid-cols-2 gap-1 max-w-[200px]">
                      <div className="bg-emerald-500/20 border border-emerald-500/30 rounded-lg p-2 text-center">
                        <div className="text-lg font-bold text-emerald-400">{cm.tp}</div>
                        <div className="text-[9px] text-emerald-400/60">True Pos</div>
                      </div>
                      <div className="bg-red-500/15 border border-red-500/25 rounded-lg p-2 text-center">
                        <div className="text-lg font-bold text-red-400">{cm.fp}</div>
                        <div className="text-[9px] text-red-400/60">False Pos</div>
                      </div>
                      <div className="bg-orange-500/15 border border-orange-500/25 rounded-lg p-2 text-center">
                        <div className="text-lg font-bold text-orange-400">{cm.fn}</div>
                        <div className="text-[9px] text-orange-400/60">False Neg</div>
                      </div>
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 text-center">
                        <div className="text-lg font-bold text-emerald-300">{cm.tn}</div>
                        <div className="text-[9px] text-emerald-300/60">True Neg</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Charts row: ROC + Feature Importance ────────────────────────────── */}
      {(rocCurveData.length > 0 || featureImportanceData) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* ROC Curves */}
          {rocCurveData.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-sky-400" />
                ROC Curves (per Channel)
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="fpr"
                    type="number"
                    domain={[0, 1]}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    label={{ value: 'FPR', position: 'bottom', fill: '#64748b', fontSize: 10 }}
                  />
                  <YAxis
                    dataKey="tpr"
                    type="number"
                    domain={[0, 1]}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    label={{
                      value: 'TPR',
                      angle: -90,
                      position: 'insideLeft',
                      fill: '#64748b',
                      fontSize: 10,
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  {/* Diagonal reference */}
                  <Line
                    data={[
                      { fpr: 0, tpr: 0 },
                      { fpr: 1, tpr: 1 },
                    ]}
                    dataKey="tpr"
                    stroke="#334155"
                    strokeDasharray="4 4"
                    dot={false}
                    name="Random"
                    strokeWidth={1}
                  />
                  {rocCurveData.map((curve) => (
                    <Line
                      key={curve.channel}
                      data={curve.roc_curve}
                      dataKey="tpr"
                      stroke={CHANNEL_COLORS[curve.channel] || '#6366f1'}
                      strokeWidth={2}
                      dot={false}
                      name={curve.channel}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Feature Importance */}
          {featureImportanceData && featureImportanceData.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-400" />
                Feature Importance
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={featureImportanceData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    type="number"
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={120}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    formatter={(v: number) => [v.toFixed(4), 'Importance']}
                  />
                  <Bar dataKey="importance" fill="#a855f7" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ── Summary ─────────────────────────────────────────────────────────── */}
      {totalFlagged > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-slate-800/80 via-slate-800/50 to-slate-800/80 border border-slate-700/50 rounded-xl p-4 flex items-center gap-3"
        >
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="text-sm text-slate-300">
            <span className="font-bold text-white">{totalFlagged}</span> accounts flagged
            across {validChannels.length} channel{validChannels.length !== 1 ? 's' : ''}{' '}
            &mdash; generating alerts...
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
