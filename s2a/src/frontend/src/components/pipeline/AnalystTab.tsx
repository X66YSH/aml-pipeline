/**
 * AnalystTab -- Tab 1: Regulatory Analyst workspace.
 *
 * Provides a textarea for regulatory text input, a "Run Pipeline" button,
 * and displays parsed perceive output (indicator, parameters, computation plan).
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Tag, Settings2, ArrowRight, Loader2,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import type { PerceiveData, TraceEvent, PRAData } from '../../api/client';
import PRACard from './PRACard';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  inputText: string;
  onInputChange: (text: string) => void;
  onRunPipeline: () => void;
  pipelineRunning: boolean;
  perceiveData: PerceiveData | null;
  traceEvents: TraceEvent[];
  pra?: PRAData | null;
}

// ── Category color mapping ────────────────────────────────────────────────────

const categoryColors: Record<string, string> = {
  structuring: 'bg-rose-500/20 text-rose-300',
  velocity: 'bg-sky-500/20 text-sky-300',
  geographic: 'bg-amber-500/20 text-amber-300',
  behavioral: 'bg-purple-500/20 text-purple-300',
  threshold: 'bg-emerald-500/20 text-emerald-300',
  temporal: 'bg-teal-500/20 text-teal-300',
  network: 'bg-indigo-500/20 text-indigo-300',
};

function getCategoryColor(category?: string): string {
  if (!category) return 'bg-slate-500/20 text-slate-300';
  const lower = category.toLowerCase();
  for (const [key, val] of Object.entries(categoryColors)) {
    if (lower.includes(key)) return val;
  }
  return 'bg-purple-500/20 text-purple-300';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AnalystTab({
  inputText,
  onInputChange,
  onRunPipeline,
  pipelineRunning,
  perceiveData,
  traceEvents,
  pra,
}: Props) {
  const [showTrace, setShowTrace] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
    >
      {/* ── Input Section ──────────────────────────────────────────────────── */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Regulatory Text Input
        </label>
        <textarea
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Paste regulatory text from FINTRAC, FFIEC, or other AML guidance..."
          rows={6}
          disabled={pipelineRunning}
          className="w-full bg-slate-900/60 border border-slate-700/40 rounded-lg p-3 text-sm text-slate-200
                     placeholder-slate-600 resize-y focus:outline-none focus:ring-1 focus:ring-purple-500/40
                     focus:border-purple-500/40 disabled:opacity-50 disabled:cursor-not-allowed
                     leading-relaxed"
        />

        {/* Run Pipeline button */}
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={onRunPipeline}
            disabled={pipelineRunning || !inputText.trim()}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white
                       bg-gradient-to-r from-purple-600 to-indigo-600
                       hover:from-purple-500 hover:to-indigo-500
                       disabled:opacity-40 disabled:cursor-not-allowed
                       transition-all duration-200 shadow-lg shadow-purple-500/20"
          >
            {pipelineRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run Pipeline
              </>
            )}
          </button>
          {pipelineRunning && (
            <span className="text-[11px] text-slate-500">
              Processing regulatory text through multi-agent pipeline...
            </span>
          )}
        </div>
      </div>

      {/* ── PRA Card + Agent Output Section ──────────────────────────────── */}
      {(pra || perceiveData) && (
        <PRACard
          pra={pra || null}
          agentName="Regulatory Analyst"
          isActive={pipelineRunning}
          actContent={
            perceiveData ? (
              <div className="space-y-4">
                {/* ── Indicator Card ──────────────────────────────────────────── */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Tag className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">
                      Indicator
                    </span>
                  </div>

                  <div className="bg-slate-900/50 rounded-lg p-3 space-y-2">
                    {perceiveData.indicator.category && (
                      <span className={`inline-block text-[10px] px-2.5 py-0.5 rounded-full font-medium ${getCategoryColor(perceiveData.indicator.category)}`}>
                        {perceiveData.indicator.category}
                      </span>
                    )}
                    {perceiveData.indicator.description && (
                      <p className="text-sm text-slate-300 leading-relaxed">
                        {perceiveData.indicator.description}
                      </p>
                    )}
                    {perceiveData.indicator.risk_rationale && (
                      <div className="bg-purple-500/5 border border-purple-500/15 rounded-lg p-3">
                        <div className="text-[9px] text-purple-400 uppercase tracking-wider mb-1 font-semibold">
                          Risk Rationale
                        </div>
                        <p className="text-[12px] text-slate-300 leading-relaxed">
                          {perceiveData.indicator.risk_rationale}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Parameters Grid ─────────────────────────────────────────── */}
                {perceiveData.parameters.length > 0 && (
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Settings2 className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">
                        Extracted Parameters ({perceiveData.parameters.length})
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {perceiveData.parameters.map((param, i) => (
                        <div
                          key={i}
                          className="bg-slate-900/50 rounded-lg p-3 space-y-1.5 border border-slate-700/30"
                        >
                          <div className="flex items-center justify-between">
                            <code className="text-[12px] text-purple-300 font-mono font-medium">
                              {param.name}
                            </code>
                            {param.unit && (
                              <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                                {param.unit}
                              </span>
                            )}
                          </div>
                          {param.default !== undefined && (
                            <div className="text-[11px] text-slate-400">
                              default:{' '}
                              <code className="text-emerald-400 font-mono">
                                {String(param.default)}
                              </code>
                            </div>
                          )}
                          {param.ambiguous_term && (
                            <p className="text-[10px] text-slate-500 italic truncate" title={param.ambiguous_term}>
                              &ldquo;{param.ambiguous_term}&rdquo;
                            </p>
                          )}
                          {(param as Record<string, unknown>).regulatory_basis && (
                            <p className="text-[10px] text-amber-400/70 leading-relaxed">
                              {String((param as Record<string, unknown>).regulatory_basis)}
                            </p>
                          )}
                          {param.rationale && (
                            <p className="text-[10px] text-sky-400/80 italic leading-relaxed">
                              {param.rationale}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Computation Plan ────────────────────────────────────────── */}
                {perceiveData.computation_plan.operation && (
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <ArrowRight className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">
                        Computation Plan
                      </span>
                    </div>

                    <div className="bg-slate-900/50 rounded-lg p-3 space-y-3">
                      {/* Badges */}
                      <div className="flex flex-wrap gap-2">
                        <span className="text-[11px] px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-300 font-mono font-medium">
                          {perceiveData.computation_plan.operation}
                        </span>
                        {perceiveData.computation_plan.aggregation_level && (
                          <span className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-700/60 text-slate-300">
                            group by: {perceiveData.computation_plan.aggregation_level}
                          </span>
                        )}
                        {perceiveData.computation_plan.time_window && (
                          <span className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-700/60 text-slate-300">
                            window: {perceiveData.computation_plan.time_window}
                          </span>
                        )}
                        {perceiveData.computation_plan.join_strategy && (
                          <span className="text-[11px] px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-300">
                            join: {perceiveData.computation_plan.join_strategy}
                          </span>
                        )}
                      </div>

                      {/* Required columns */}
                      {perceiveData.computation_plan.required_columns &&
                        perceiveData.computation_plan.required_columns.length > 0 && (
                        <div>
                          <div className="text-[10px] text-slate-500 mb-1.5">Required columns:</div>
                          <div className="flex flex-wrap gap-1.5">
                            {perceiveData.computation_plan.required_columns.map((col) => (
                              <span
                                key={col}
                                className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono"
                              >
                                {col}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : undefined
          }
        />
      )}

      {/* ── Trace Events (collapsible) ─────────────────────────────────────── */}
      {traceEvents.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowTrace(!showTrace)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-[11px] text-slate-500
                       hover:text-slate-400 transition-colors"
          >
            <span className="font-medium uppercase tracking-wider">
              Trace Log ({traceEvents.length} events)
            </span>
            {showTrace ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <AnimatePresence>
            {showTrace && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-3 space-y-1 max-h-48 overflow-y-auto">
                  {traceEvents.map((evt, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className="text-slate-600 font-mono shrink-0 w-16 text-right">
                        {new Date(evt.timestamp * 1000).toLocaleTimeString()}
                      </span>
                      <span className={`shrink-0 px-1 py-0.5 rounded text-[9px] font-medium uppercase ${
                        evt.level === 'error' ? 'bg-red-500/10 text-red-400' :
                        evt.level === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                        evt.level === 'agent' ? 'bg-purple-500/10 text-purple-400' :
                        'bg-slate-700/50 text-slate-500'
                      }`}>
                        {evt.level}
                      </span>
                      <span className="text-slate-400 break-all">{evt.message}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

    </motion.div>
  );
}
