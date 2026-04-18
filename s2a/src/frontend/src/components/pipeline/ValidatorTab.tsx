/**
 * ValidatorTab — Deterministic Validator workspace (Pipeline Tab 4).
 *
 * Shows AST safety + column alignment results, self-correction iterations
 * with code diffs, statistical validation preview, and agent feedback messages.
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, XCircle, CheckCircle2, AlertTriangle, Loader2,
  Code2, TrendingUp, MessageSquare, RefreshCw, Columns,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import type { ValidationData, TraceEvent, FeatureValidationResult, PRAData, IterationTrace } from '../../api/client';
import PRACard from './PRACard';

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  validationData: ValidationData | null;
  codeHistory: Map<number, string>;
  featureEvalData: FeatureValidationResult | null;
  traceEvents: TraceEvent[];
  pipelineRunning: boolean;
  agentMessages: { from: string; to: string; message: string }[];
  pra?: PRAData | null;
  iterationHistory: IterationTrace[];
  onJumpToTab?: (tab: string, iteration: number) => void;
  pendingDecision?: {
    pipeline_id: string;
    context: string;
    errors?: string[];
    missing_columns?: string[];
    available_columns?: string[];
    diagnostic?: { root_cause: string; reasoning: string; recommendation: string };
    best_iv?: number;
    best_channel?: string;
    options: { key: string; label: string; description: string; recommended?: boolean; agent?: string }[];
  } | null;
  onDecision?: (pipelineId: string, decision: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simple line-by-line diff: returns lines tagged as 'same', 'removed', or 'added'. */
function computeDiff(
  oldCode: string,
  newCode: string,
): { type: 'same' | 'removed' | 'added'; text: string }[] {
  const oldLines = oldCode.split('\n');
  const newLines = newCode.split('\n');
  const result: { type: 'same' | 'removed' | 'added'; text: string }[] = [];

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  // Mark removed lines (in old but not in new)
  for (const line of oldLines) {
    if (!newSet.has(line)) {
      result.push({ type: 'removed', text: line });
    }
  }

  // Walk new lines: if present in old, mark as same; else added
  for (const line of newLines) {
    if (oldSet.has(line)) {
      result.push({ type: 'same', text: line });
    } else {
      result.push({ type: 'added', text: line });
    }
  }

  return result;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ValidatorTab({
  validationData,
  codeHistory,
  featureEvalData,
  traceEvents,
  pipelineRunning,
  agentMessages,
  pra,
  iterationHistory,
  onJumpToTab,
  pendingDecision,
  onDecision,
}: Props) {
  // Derive correction-related trace events (errors that triggered re-generation)
  const correctionEvents = useMemo(() => {
    return traceEvents.filter(
      (e) => {
        const msg = (e.message || '').toLowerCase();
        return e.agent === 'Validator' &&
          (msg.includes('fail') || msg.includes('error') || msg.includes('retry'));
      },
    );
  }, [traceEvents]);

  // Agent messages directed to Feature Engineer (feedback loop)
  const feedbackMessages = useMemo(() => {
    return agentMessages.filter((m) => m.to === 'Feature Engineer');
  }, [agentMessages]);

  const iterations = codeHistory instanceof Map
    ? Array.from(codeHistory.entries()).sort(([a], [b]) => a - b)
    : [];

  // ── Waiting state ────────────────────────────────────────────────────────
  if (!validationData && pipelineRunning) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-5"
      >
        {pra && (
          <PRACard
            pra={pra}
            agentName="Deterministic Validator"
            isActive={pipelineRunning}
          />
        )}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-16 flex flex-col items-center justify-center">
          <Loader2 className="w-10 h-10 text-purple-400 animate-spin mb-4" />
          <p className="text-sm text-slate-400">Validating generated code...</p>
          <p className="text-xs text-slate-600 mt-1">
            Running AST safety analysis and column alignment checks
          </p>
        </div>
      </motion.div>
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!validationData) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-16 flex flex-col items-center justify-center"
      >
        <ShieldCheck className="w-12 h-12 text-slate-700 mb-4" />
        <p className="text-sm text-slate-500 mb-1">No validation data yet</p>
        <p className="text-xs text-slate-600 text-center max-w-sm">
          Run the pipeline to see deterministic validation results here.
        </p>
      </motion.div>
    );
  }

  // Safe destructure — backend may send partial validation data
  const astFindings = validationData.ast_findings || { passed: true, n_errors: 0, n_warnings: 0, findings: [] };
  const colFindings = validationData.column_findings || { passed: true, n_errors: 0, n_warnings: 0, findings: [] };
  const compatChannels = validationData.compatible_channels || [];

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
          agentName="Deterministic Validator"
          isActive={pipelineRunning}
        />
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-purple-400" />
        <h2 className="text-lg font-bold text-white">
          Deterministic Validator &mdash; Code Verification
        </h2>
        <span
          className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border uppercase tracking-wider ${
            validationData.passed
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
              : 'bg-red-500/20 text-red-400 border-red-500/30'
          }`}
        >
          {validationData.passed ? 'PASSED' : 'FAILED'}
        </span>
        {validationData.iteration != null && validationData.iteration > 1 && (
          <span className="text-[10px] text-slate-500 ml-auto">
            Iteration {validationData.iteration}
          </span>
        )}
      </div>

      {/* ── Validation Results: 2-column grid ───────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* AST Safety Card */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <Code2 className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-white">AST Safety</h3>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <div
              className={`w-16 h-16 rounded-xl flex items-center justify-center ${
                validationData.ast_passed
                  ? 'bg-emerald-500/15 border-2 border-emerald-500/40'
                  : 'bg-red-500/15 border-2 border-red-500/40'
              }`}
            >
              {validationData.ast_passed ? (
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              ) : (
                <XCircle className="w-8 h-8 text-red-400" />
              )}
            </div>
            <div>
              <div
                className={`text-2xl font-bold ${
                  validationData.ast_passed ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {validationData.ast_passed ? 'PASS' : 'FAIL'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {astFindings?.n_errors ?? 0} errors, {astFindings?.n_warnings ?? 0} warnings
              </div>
            </div>
          </div>
        </div>

        {/* Column Alignment Card */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <Columns className="w-4 h-4 text-teal-400" />
            <h3 className="text-sm font-semibold text-white">Column Alignment</h3>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <div
              className={`w-16 h-16 rounded-xl flex items-center justify-center ${
                validationData.columns_passed
                  ? 'bg-emerald-500/15 border-2 border-emerald-500/40'
                  : 'bg-red-500/15 border-2 border-red-500/40'
              }`}
            >
              {validationData.columns_passed ? (
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              ) : (
                <XCircle className="w-8 h-8 text-red-400" />
              )}
            </div>
            <div>
              <div
                className={`text-2xl font-bold ${
                  validationData.columns_passed ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {validationData.columns_passed ? 'PASS' : 'FAIL'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {colFindings?.n_errors ?? 0} errors, {colFindings?.n_warnings ?? 0} warnings
              </div>
            </div>
          </div>
          {/* Compatible channels pills */}
          {compatChannels && compatChannels.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-700/30">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                Compatible Channels
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(compatChannels || []).map((ch) => (
                  <span
                    key={ch}
                    className="text-[10px] px-2.5 py-1 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 font-medium"
                  >
                    {ch}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Findings List ───────────────────────────────────────────────────── */}
      {(() => {
        const allFindings = [
          ...(astFindings?.findings || []),
          ...(colFindings?.findings || []),
        ];
        if (allFindings.length === 0) return null;
        return (
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Findings ({allFindings.length})
            </h3>
            <div className="space-y-2">
              {allFindings.map((f, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-slate-900/50 border border-slate-700/30"
                >
                  {f.severity === 'error' ? (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          f.severity === 'error'
                            ? 'bg-red-500/15 text-red-400 border border-red-500/25'
                            : 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                        }`}
                      >
                        {f.severity}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400 font-mono">
                        {f.category}
                      </span>
                      {f.line != null && (
                        <span className="text-[10px] text-slate-600">line {f.line}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{f.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Self-Correction ─────────────────────────────────────────────────── */}
      {iterations.length > 1 && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-amber-400" />
            Self-Correction &mdash; {iterations.length} iterations
          </h3>
          <div className="space-y-4">
            {iterations.slice(0, -1).map(([iterNum, oldCode], idx) => {
              const nextEntry = iterations[idx + 1];
              if (!nextEntry) return null;
              const [nextIterNum, newCode] = nextEntry;
              const diff = computeDiff(oldCode, newCode);

              // Find correction event for this iteration
              const correctionEvent = correctionEvents.find(
                (e) =>
                  e.data?.iteration === iterNum ||
                  e.message.includes(`iteration ${iterNum}`),
              );

              return (
                <div
                  key={iterNum}
                  className="bg-slate-900/50 border border-slate-700/30 rounded-xl overflow-hidden"
                >
                  {/* Iteration header */}
                  <div className="px-4 py-2.5 border-b border-slate-700/30 flex items-center gap-3">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25 font-semibold">
                      v{iterNum} &rarr; v{nextIterNum}
                    </span>
                    {correctionEvent && (
                      <span className="text-[11px] text-slate-500 truncate flex-1">
                        {correctionEvent.message}
                      </span>
                    )}
                  </div>

                  {/* Code diff */}
                  <div className="px-4 py-3 font-mono text-[11px] leading-5 overflow-x-auto max-h-[300px] overflow-y-auto">
                    {diff.map((line, li) => {
                      if (line.type === 'same') {
                        return (
                          <div key={li} className="text-slate-600 whitespace-pre">
                            {'  '}{line.text}
                          </div>
                        );
                      }
                      if (line.type === 'removed') {
                        return (
                          <div
                            key={li}
                            className="text-red-400 bg-red-500/10 whitespace-pre rounded-sm px-1 -mx-1"
                          >
                            {'- '}{line.text}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={li}
                          className="text-emerald-400 bg-emerald-500/10 whitespace-pre rounded-sm px-1 -mx-1"
                        >
                          {'+ '}{line.text}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Statistical Validation Preview ──────────────────────────────────── */}
      {featureEvalData && (() => {
        // Handle both old flat format and new per-channel format
        const channelResults = (featureEvalData as any).channel_results;
        const bestChannel = (featureEvalData as any).best_channel;
        const bestData = channelResults?.[bestChannel] || null;
        // Fall back to flat format fields if they exist
        const ks = bestData?.ks ?? (featureEvalData as any).ks_statistic ?? 0;
        const ksPvalue = bestData?.ks_pvalue ?? (featureEvalData as any).ks_pvalue ?? 1;
        const iv = bestData?.iv ?? (featureEvalData as any).information_value ?? 0;
        const ivInterp = bestData?.iv_interpretation ?? (featureEvalData as any).iv_interpretation ?? '';
        const channelCount = channelResults ? Object.keys(channelResults).length : 0;

        return (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Statistical Validation Preview
            {bestChannel && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 ml-2">
                best: {bestChannel} ({channelCount} channel{channelCount !== 1 ? 's' : ''} tested)
              </span>
            )}
          </h3>

          {/* KS & IV highlight cards */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-slate-900/50 rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">KS Statistic</div>
              <div
                className={`text-2xl font-bold ${
                  ks > 0.3 ? 'text-emerald-400' : ks > 0.1 ? 'text-amber-400' : 'text-red-400'
                }`}
              >
                {ks.toFixed(4)}
              </div>
              <div className="text-[11px] text-slate-600 mt-1">
                p-value: {ksPvalue < 0.001 ? '<0.001' : ksPvalue.toFixed(4)}
                {ksPvalue < 0.05 && <span className="text-emerald-400 ml-2">Significant</span>}
              </div>
            </div>
            <div className="bg-slate-900/50 rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">Information Value</div>
              <div
                className={`text-2xl font-bold ${
                  iv >= 0.3 ? 'text-emerald-400' : iv >= 0.1 ? 'text-amber-400' : 'text-red-400'
                }`}
              >
                {iv.toFixed(4)}
              </div>
              <div className="text-[11px] text-slate-600 mt-1">{ivInterp}</div>
            </div>
          </div>

          {/* Per-channel summary */}
          {channelResults && Object.keys(channelResults).length > 1 && (
            <div className="mt-3 pt-3 border-t border-slate-700/30">
              <h4 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Per-Channel Results</h4>
              <div className="space-y-1">
                {Object.entries(channelResults).map(([ch, data]: [string, any]) => (
                  <div key={ch} className="flex items-center justify-between px-3 py-1.5 rounded bg-slate-900/30">
                    <span className="text-xs text-slate-300 font-mono">{ch}</span>
                    <div className="flex items-center gap-4 text-xs">
                      <span className={data.iv >= 0.1 ? 'text-emerald-400' : 'text-slate-500'}>
                        IV: {data.iv?.toFixed(3) ?? '—'}
                      </span>
                      <span className={data.ks >= 0.2 ? 'text-emerald-400' : 'text-slate-500'}>
                        KS: {data.ks?.toFixed(3) ?? '—'}
                      </span>
                      <span className="text-slate-600">{data.n_customers ?? '?'} customers</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {/* ── Agent Messages (Evaluator feedback) ─────────────────────────────── */}
      {feedbackMessages.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-sky-400" />
            Evaluator Feedback
          </h3>
          <div className="space-y-2">
            {feedbackMessages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="border-l-2 border-sky-500/40 pl-3 py-2"
              >
                <div className="text-[10px] text-sky-400 font-semibold mb-0.5">
                  {msg.from}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{msg.message}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* ── Iteration Timeline ──────────────────────────────────────────────── */}
      {iterationHistory.length > 0 && (
        <div className="mt-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Iteration Timeline
          </h3>
          {iterationHistory.map((trace, idx) => (
            <div key={idx} className={`p-3 rounded-lg border ${trace.status === 'passed' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400">#{trace.iteration}</span>
                  <span className="font-medium text-slate-200">{trace.indicator}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${trace.status === 'passed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    IV={(trace.iv ?? 0).toFixed(4)}
                  </span>
                  {trace.status === 'passed' && <span className="text-xs text-emerald-400">&#10003; Passed</span>}
                </div>
              </div>

              {trace.diagnostic && (
                <div className="mt-2 text-xs text-slate-400">
                  <span className="text-amber-400 font-medium">Diagnostic:</span>{' '}
                  {trace.diagnostic.reasoning}
                </div>
              )}

              {trace.user_decision && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-slate-500">Decision:</span>
                  <span className="text-purple-400 font-medium">
                    {trace.user_decision.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </span>
                  {trace.target_agent && onJumpToTab && (
                    <button
                      onClick={() => onJumpToTab(trace.target_agent!, trace.iteration)}
                      className="text-cyan-400 hover:text-cyan-300 underline"
                    >
                      View in {trace.target_agent.charAt(0).toUpperCase() + trace.target_agent.slice(1)} tab &rarr;
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Human-in-the-Loop Decision UI ──────────────────────────────────── */}
      {pendingDecision && (
        <div className="mt-6 p-5 rounded-xl border-2 border-amber-500/30 bg-amber-500/5 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-400" />
            <h4 className="text-amber-400 font-semibold text-sm">Decision Required</h4>
          </div>

          {/* Context: validation_failed (column errors) */}
          {pendingDecision.context === 'validation_failed' && (
            <>
              <p className="text-sm text-slate-300">
                The Feature Engineer could not fix these errors after maximum correction attempts:
              </p>
              {(pendingDecision.missing_columns ?? []).length > 0 && (
                <ul className="space-y-1 ml-4">
                  {(pendingDecision.missing_columns ?? []).map(col => (
                    <li key={col} className="text-xs text-red-400 flex items-center gap-1.5">
                      <XCircle size={10} />
                      Column &apos;{col}&apos; not found in any channel
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* Context: feature_not_predictive (IV too low) */}
          {pendingDecision.context === 'feature_not_predictive' && (
            <>
              <p className="text-sm text-slate-300">
                Feature has no predictive power (IV = {(pendingDecision.best_iv ?? 0).toFixed(4)}).
                The Diagnostic Agent analyzed the root cause:
              </p>
              {pendingDecision.diagnostic && (
                <div className="p-3 rounded-lg bg-slate-800/80 border border-slate-700/50 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30 font-medium uppercase">
                      Root cause: {pendingDecision.diagnostic.root_cause}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {pendingDecision.diagnostic.reasoning}
                  </p>
                  <p className="text-xs text-teal-400 italic">
                    Recommendation: {pendingDecision.diagnostic.recommendation}
                  </p>
                </div>
              )}
            </>
          )}

          <div className="space-y-2 mt-3">
            {pendingDecision.options.map(opt => {
              const isRecommended = opt.recommended;
              const colorClass =
                opt.key === 'find_similar' || opt.key === 'rethink_code' ? 'border-teal-500/30 bg-teal-500/5 hover:bg-teal-500/10 hover:border-teal-500/50' :
                opt.key === 'rethink' || opt.key === 'rethink_indicator' ? 'border-sky-500/30 bg-sky-500/5 hover:bg-sky-500/10 hover:border-sky-500/50' :
                opt.key === 'continue_benchmarks' ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 hover:border-emerald-500/50' :
                'border-red-500/30 bg-red-500/5 hover:bg-red-500/10 hover:border-red-500/50';
              const textClass =
                opt.key === 'find_similar' || opt.key === 'rethink_code' ? 'text-teal-300' :
                opt.key === 'rethink' || opt.key === 'rethink_indicator' ? 'text-sky-300' :
                opt.key === 'continue_benchmarks' ? 'text-emerald-300' :
                'text-red-300';
              return (
                <button
                  key={opt.key}
                  onClick={() => onDecision?.(pendingDecision.pipeline_id, opt.key)}
                  className={`w-full text-left p-3.5 rounded-lg border transition-all ${colorClass} ${isRecommended ? 'ring-1 ring-amber-400/40' : ''}`}
                >
                  <div className={`text-sm font-medium ${textClass} flex items-center gap-2`}>
                    {opt.label}
                    {opt.agent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 font-normal">→ {opt.agent}</span>}
                    {isRecommended && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 font-medium">RECOMMENDED</span>}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">{opt.description}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}
