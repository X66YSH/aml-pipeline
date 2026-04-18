/**
 * RCCTab — RCC Verifier workspace (Pipeline Tab 6).
 *
 * Displays alerts with Regulatory Consistency Check verdicts,
 * evidence cards, feedback buttons, and pipeline summary.
 * Handles both new RCC verdict format and legacy structured format.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Loader2, Zap, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp,
  MessageSquare, CheckCircle2, AlertCircle, Eye,
} from 'lucide-react';
import type { AlertRecord, AlertStats, StructuredExplanation, TraceEvent, PRAData } from '../../api/client';
import PRACard from './PRACard';

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  alerts: AlertRecord[];
  alertStats: AlertStats | null;
  pipelineSummary: {
    alertCount: number;
    verifiedCount: number;
    featureName?: string;
    bestModel?: string;
    bestAuc?: number;
  } | null;
  onFeedback: (alertId: string, feedback: 'true_positive' | 'false_positive') => void;
  onVerifyAlert: (alertId: string) => void;
  verifyingAlertId: string | null;
  pipelineRunning: boolean;
  traceEvents: TraceEvent[];
  pra?: PRAData | null;
}

// ── Verdict styling ──────────────────────────────────────────────────────────

const VERDICT_COLORS: Record<string, string> = {
  supported: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  contradicted: 'bg-red-500/20 text-red-400 border-red-500/30',
  ambiguous: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'text-emerald-400',
  medium: 'text-amber-400',
  low: 'text-red-400',
};

const RISK_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/40',
  HIGH: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
  MEDIUM: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  LOW: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
};

// ── Component ────────────────────────────────────────────────────────────────

export default function RCCTab({
  alerts,
  alertStats,
  pipelineSummary,
  onFeedback,
  onVerifyAlert,
  verifyingAlertId,
  pipelineRunning,
  traceEvents,
  pra,
}: Props) {
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);

  // ── Empty / waiting state ────────────────────────────────────────────────
  if (alerts.length === 0 && pipelineRunning) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-5"
      >
        {pra && (
          <PRACard
            pra={pra}
            agentName="RCC Verifier"
            isActive={pipelineRunning}
          />
        )}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-16 flex flex-col items-center justify-center">
          <Loader2 className="w-10 h-10 text-purple-400 animate-spin mb-4" />
          <p className="text-sm text-slate-400">
            Generating and verifying alerts...
          </p>
          <p className="text-xs text-slate-600 mt-1">
            Running regulatory consistency checks on flagged accounts
          </p>
        </div>
      </motion.div>
    );
  }

  if (alerts.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-16 flex flex-col items-center justify-center"
      >
        <Shield className="w-12 h-12 text-slate-700 mb-4" />
        <p className="text-sm text-slate-500 mb-1">No alerts yet</p>
        <p className="text-xs text-slate-600 text-center max-w-sm">
          Run the pipeline to generate alerts and regulatory consistency checks.
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
          agentName="RCC Verifier"
          isActive={pipelineRunning}
        />
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Shield className="w-5 h-5 text-purple-400" />
        <h2 className="text-lg font-bold text-white">
          RCC Verifier &mdash; Regulatory Consistency Check
        </h2>
      </div>

      {/* ── Pipeline Summary Card ───────────────────────────────────────────── */}
      {pipelineSummary && (
        <div className="bg-gradient-to-r from-slate-800/80 via-slate-800/50 to-slate-800/80 border border-slate-700/50 rounded-xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-sm text-slate-300">
                <span className="text-white font-bold">{pipelineSummary.alertCount}</span> alerts generated
                {pipelineSummary.verifiedCount > 0 && (
                  <>
                    {' | '}
                    <span className="text-emerald-400 font-bold">{pipelineSummary.verifiedCount}</span> verified by RCC
                  </>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1 text-[11px] text-slate-500">
                {pipelineSummary.featureName && (
                  <span>
                    Feature: <span className="text-slate-300">{pipelineSummary.featureName}</span>
                  </span>
                )}
                {pipelineSummary.bestModel && (
                  <span>
                    Model: <span className="text-slate-300">{pipelineSummary.bestModel}</span>
                  </span>
                )}
                {pipelineSummary.bestAuc != null && (
                  <span>
                    AUC-ROC: <span className="text-emerald-400 font-mono">{(pipelineSummary.bestAuc * 100).toFixed(1)}%</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Stats Cards ─────────────────────────────────────────────────────── */}
      {alertStats && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total Alerts', value: alertStats.total, color: 'text-white', bg: 'bg-slate-800/60' },
            { label: 'Pending Review', value: alertStats.pending, color: 'text-amber-400', bg: 'bg-amber-500/5 border-amber-500/20' },
            { label: 'True Positive', value: alertStats.truePositive, color: 'text-red-400', bg: 'bg-red-500/5 border-red-500/20' },
            { label: 'False Positive', value: alertStats.falsePositive, color: 'text-emerald-400', bg: 'bg-emerald-500/5 border-emerald-500/20' },
          ].map((s) => (
            <div key={s.label} className={`${s.bg} border border-slate-700/50 rounded-xl p-4`}>
              <p className="text-[11px] text-slate-500 mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Alert List ──────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <AnimatePresence>
          {alerts.map((alert, alertIndex) => {
            const isExpanded = expandedAlertId === alert.id;
            const isVerifying = verifyingAlertId === alert.id;

            // Parse explanation
            let parsed: StructuredExplanation | null = null;
            if (alert.explanation) {
              try {
                parsed = JSON.parse(alert.explanation);
              } catch {
                /* legacy plain text — handled in fallback */
              }
            }

            // Determine format type
            const isRCCFormat = parsed && parsed.verdict;
            const isLegacyFormat = parsed && (parsed.risk_level || (parsed.explanations && parsed.explanations.length));

            return (
              <motion.div
                key={alert.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: alertIndex * 0.03 }}
                className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden"
              >
                {/* ── Alert header row ──────────────────────────────────────── */}
                <div
                  onClick={() => setExpandedAlertId(isExpanded ? null : alert.id)}
                  className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-slate-700/30 transition-colors cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono text-white">{alert.customerId}</span>
                      {/* Feedback status badge */}
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          alert.analystFeedback === 'pending'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            : alert.analystFeedback === 'true_positive'
                            ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        }`}
                      >
                        {alert.analystFeedback === 'pending'
                          ? 'Pending'
                          : alert.analystFeedback === 'true_positive'
                          ? 'True Positive'
                          : 'False Positive'}
                      </span>
                      {/* RCC Verdict badge (inline) */}
                      {isRCCFormat && parsed?.verdict && (
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold border uppercase tracking-wider ${
                            VERDICT_COLORS[parsed.verdict] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'
                          }`}
                        >
                          {parsed.verdict}
                        </span>
                      )}
                      {isRCCFormat && parsed?.confidence && (
                        <span
                          className={`text-[10px] ${
                            CONFIDENCE_COLORS[parsed.confidence] || 'text-slate-400'
                          }`}
                        >
                          {parsed.confidence}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-[11px] text-slate-500">
                      {alert.featureName && <span>{alert.featureName}</span>}
                      {alert.modelName && <span>{alert.modelName}</span>}
                    </div>
                  </div>

                  {/* Score bar */}
                  <div className="w-32 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-red-500 rounded-full"
                        style={{
                          width: `${Math.min(alert.anomalyScore * 100, 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs font-mono text-slate-400 w-12 text-right">
                      {(alert.anomalyScore ?? 0).toFixed(3)}
                    </span>
                  </div>

                  {/* Feedback buttons */}
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onFeedback(alert.id, 'true_positive')}
                      disabled={alert.analystFeedback === 'true_positive'}
                      className={`p-1.5 rounded-lg transition-colors ${
                        alert.analystFeedback === 'true_positive'
                          ? 'bg-red-500/20 text-red-400'
                          : 'hover:bg-red-500/10 text-slate-600 hover:text-red-400'
                      }`}
                      title="True Positive"
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onFeedback(alert.id, 'false_positive')}
                      disabled={alert.analystFeedback === 'false_positive'}
                      className={`p-1.5 rounded-lg transition-colors ${
                        alert.analystFeedback === 'false_positive'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'hover:bg-emerald-500/10 text-slate-600 hover:text-emerald-400'
                      }`}
                      title="False Positive"
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-600" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-600" />
                  )}
                </div>

                {/* ── Expanded panel ──────────────────────────────────────────── */}
                {isExpanded && (
                  <div className="border-t border-slate-700/50 px-4 py-4 bg-slate-900/40">
                    <div className="flex items-center gap-3 mb-3">
                      <MessageSquare className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-medium text-white">Verification</span>
                      {!alert.explanation && !isVerifying && (
                        <button
                          onClick={() => onVerifyAlert(alert.id)}
                          className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 transition-colors flex items-center gap-1.5"
                        >
                          <Zap className="w-3 h-3" />
                          Verify Alert
                        </button>
                      )}
                    </div>

                    {/* Verifying spinner */}
                    {isVerifying ? (
                      <div className="flex items-center gap-2 py-4">
                        <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                        <span className="text-xs text-slate-500">Verifying alert...</span>
                      </div>
                    ) : alert.explanation ? (
                      (() => {
                        // ── New RCC Verdict format ─────────────────────────
                        if (isRCCFormat && parsed) {
                          return (
                            <div className="space-y-3">
                              {/* Verdict badge + confidence */}
                              <div className="flex items-center gap-3">
                                <span
                                  className={`text-xs px-3 py-1 rounded-full font-bold border uppercase tracking-wider ${
                                    VERDICT_COLORS[parsed.verdict!] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'
                                  }`}
                                >
                                  {parsed.verdict}
                                </span>
                                {parsed.confidence && (
                                  <span
                                    className={`text-[10px] ${
                                      CONFIDENCE_COLORS[parsed.confidence] || 'text-slate-400'
                                    }`}
                                  >
                                    {parsed.confidence} confidence
                                  </span>
                                )}
                              </div>

                              {/* Overall reasoning */}
                              {parsed.overall_reasoning && (
                                <p className="text-sm text-slate-300 leading-relaxed">
                                  {parsed.overall_reasoning}
                                </p>
                              )}

                              {/* Evidence cards */}
                              {parsed.evidence && parsed.evidence.length > 0 && (
                                <div className="space-y-2">
                                  {parsed.evidence.map((ev, i) => (
                                    <div
                                      key={i}
                                      className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 space-y-2"
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="text-sm font-semibold text-slate-200">
                                          {ev.feature}
                                        </span>
                                        <div className="flex items-center gap-2 text-xs">
                                          {ev.feature_importance != null && (
                                            <span className="text-teal-400">
                                              importance: {typeof ev.feature_importance === 'number' ? ev.feature_importance.toFixed(3) : ev.feature_importance}
                                            </span>
                                          )}
                                          <span className="text-cyan-400 font-mono">
                                            = {ev.customer_value}
                                          </span>
                                          {ev.population_mean != null && (
                                            <span className="text-slate-500">
                                              avg: {ev.population_mean}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <p className="text-xs text-slate-300">{ev.assessment}</p>
                                      {ev.quoted_text &&
                                        ev.quoted_text !== 'No source text available' && (
                                          <div className="border-l-2 border-teal-500/50 pl-3 py-1">
                                            <p className="text-xs text-slate-400 italic">
                                              &ldquo;{ev.quoted_text}&rdquo;
                                            </p>
                                            {ev.regulatory_source && (
                                              <p className="text-[10px] text-teal-500 mt-0.5">
                                                &mdash; {ev.regulatory_source}
                                              </p>
                                            )}
                                          </div>
                                        )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Review focus */}
                              {parsed.review_focus && (
                                <div className="bg-slate-800/30 rounded-lg px-4 py-3 border border-slate-700/20">
                                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                                    Review Focus
                                  </p>
                                  <p className="text-xs text-slate-400 leading-relaxed">
                                    {parsed.review_focus}
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        }

                        // ── Legacy structured format ───────────────────────
                        if (isLegacyFormat && parsed) {
                          const maxImp = Math.max(
                            ...(parsed.explanations || []).map(
                              (e: { importance?: number }) => e.importance || 0,
                            ),
                            0.01,
                          );
                          return (
                            <div className="space-y-3">
                              {/* Risk level + summary */}
                              {parsed.risk_level && (
                                <div className="flex items-start gap-3">
                                  <span
                                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold border shrink-0 ${
                                      RISK_COLORS[parsed.risk_level] || ''
                                    }`}
                                  >
                                    {parsed.risk_level}
                                  </span>
                                  {parsed.summary && (
                                    <p className="text-sm text-slate-300">{parsed.summary}</p>
                                  )}
                                </div>
                              )}
                              {/* Per-feature explanations */}
                              {parsed.explanations && parsed.explanations.length > 0 && (
                                <div className="space-y-2">
                                  {parsed.explanations.map((ex, i) => (
                                    <div
                                      key={i}
                                      className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/20"
                                    >
                                      <div className="flex items-center gap-3 mb-2">
                                        <span className="text-xs font-mono font-medium text-emerald-400">
                                          {ex.feature}
                                        </span>
                                        <span className="text-[11px] text-slate-400">
                                          ={' '}
                                          <span className="text-slate-200 font-mono">
                                            {ex.value}
                                          </span>
                                        </span>
                                        {ex.importance != null && (
                                          <div className="flex items-center gap-1.5 ml-auto">
                                            <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                              <div
                                                className="h-full bg-emerald-500 rounded-full"
                                                style={{
                                                  width: `${Math.min(
                                                    (ex.importance / maxImp) * 100,
                                                    100,
                                                  )}%`,
                                                }}
                                              />
                                            </div>
                                            <span className="text-[10px] text-slate-500">
                                              {ex.importance.toFixed(3)}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                      <p className="text-[11px] text-slate-300 leading-relaxed">
                                        {ex.reasoning}
                                      </p>
                                      {ex.regulatory_excerpt &&
                                        ex.regulatory_excerpt !== 'No source text available' && (
                                          <div className="mt-2 pl-3 border-l-2 border-blue-500/30">
                                            <p className="text-[10px] text-blue-400/70 italic leading-relaxed">
                                              {ex.regulatory_excerpt}
                                            </p>
                                          </div>
                                        )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* Model Explanation */}
                              {parsed.model_explanation && (
                                <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/30">
                                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                                    Model: {parsed.model_explanation.model_type} (
                                    {parsed.model_explanation.method})
                                  </div>
                                  <p className="text-xs text-slate-300">
                                    {parsed.model_explanation.details}
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        }

                        // ── Fallback: plain text ───────────────────────────
                        return (
                          <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap bg-slate-800/40 rounded-lg p-4 border border-slate-700/30">
                            {alert.explanation}
                          </div>
                        );
                      })()
                    ) : (
                      <p className="text-xs text-slate-600 py-2">
                        Click &ldquo;Verify Alert&rdquo; to get an AI-powered regulatory
                        consistency check for this flagged customer.
                      </p>
                    )}

                    {/* Detail row */}
                    <div className="mt-3 flex gap-6 text-[11px] text-slate-500">
                      <span>
                        Score:{' '}
                        <span className="text-slate-300 font-mono">
                          {(alert.anomalyScore ?? 0).toFixed(6)}
                        </span>
                      </span>
                      {alert.aucRoc != null && (
                        <span>
                          AUC-ROC:{' '}
                          <span className="text-slate-300 font-mono">
                            {(alert.aucRoc * 100).toFixed(1)}%
                          </span>
                        </span>
                      )}
                      <span>
                        Created:{' '}
                        <span className="text-slate-300">
                          {new Date(alert.createdAt).toLocaleDateString()}
                        </span>
                      </span>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
