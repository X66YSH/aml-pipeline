/**
 * EngineerTab -- Tab 3: Feature Engineer workspace.
 *
 * Displays the generated Python feature code with syntax highlighting,
 * coding intent from the computation plan, and schema adaptation context.
 */

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Code2, FileCode, Loader2, CheckCircle2, Zap, XCircle, ArrowRight,
} from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import type { TraceEvent, PRAData } from '../../api/client';
import PRACard from './PRACard';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  generatedCode: string | null;
  computationPlan: {
    operation?: string;
    aggregation_level?: string;
    time_window?: string;
    required_columns?: string[];
  } | null;
  schemaAdaptSummary: {
    direct_match: string[];
    proxy_required: string[];
    not_feasible: string[];
  } | null;
  traceEvents: TraceEvent[];
  pipelineRunning: boolean;
  pra?: PRAData | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EngineerTab({
  generatedCode,
  computationPlan,
  schemaAdaptSummary,
  traceEvents,
  pipelineRunning,
  pra,
}: Props) {
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current && generatedCode) {
      Prism.highlightElement(codeRef.current);
    }
  }, [generatedCode]);

  const lineCount = generatedCode ? generatedCode.split('\n').length : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Code2 className="w-4 h-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-slate-200">
          Feature Engineer
        </h3>
        <span className="text-[11px] text-slate-500">
          Code Generation
        </span>
      </div>

      {/* ── PRA Card ───────────────────────────────────────────────────────── */}
      {(pra || generatedCode) && (
        <PRACard
          pra={pra || null}
          agentName="Feature Engineer"
          isActive={pipelineRunning}
        />
      )}

      {/* ── Waiting State ──────────────────────────────────────────────────── */}
      {!generatedCode && pipelineRunning && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 flex items-center justify-center gap-3"
        >
          <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
          <span className="text-sm text-slate-400">
            Generating feature code...
          </span>
        </motion.div>
      )}

      {/* ── No data, not running ───────────────────────────────────────────── */}
      {!generatedCode && !pipelineRunning && (
        <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-8 text-center">
          <p className="text-sm text-slate-600">
            No generated code yet. Run the pipeline to generate feature code.
          </p>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {generatedCode && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-4"
          >
            {/* ── Coding Intent ─────────────────────────────────────────────── */}
            {computationPlan?.operation && (
              <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowRight className="w-3.5 h-3.5 text-sky-400" />
                  <span className="text-[10px] text-sky-400 uppercase tracking-wider font-semibold">
                    Coding Intent
                  </span>
                </div>
                <p className="text-[12px] text-slate-300 leading-relaxed">
                  {computationPlan.aggregation_level && (
                    <>Group by <span className="text-sky-300 font-medium">{computationPlan.aggregation_level}</span>, </>
                  )}
                  compute <span className="text-sky-300 font-mono font-medium">{computationPlan.operation}</span>
                  {computationPlan.time_window && (
                    <> over <span className="text-sky-300 font-medium">{computationPlan.time_window}</span> window</>
                  )}
                  {computationPlan.required_columns && computationPlan.required_columns.length > 0 && (
                    <> using columns:{' '}
                      {computationPlan.required_columns.map((col, i) => (
                        <span key={col}>
                          {i > 0 && ', '}
                          <code className="text-emerald-400 font-mono text-[11px]">{col}</code>
                        </span>
                      ))}
                    </>
                  )}
                </p>
              </div>
            )}

            {/* ── Schema Adaptation Context ─────────────────────────────────── */}
            {schemaAdaptSummary && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                    Channel Compatibility
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(schemaAdaptSummary.direct_match || []).map((ch) => (
                    <span
                      key={ch}
                      className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full
                                 bg-emerald-500/10 text-emerald-400 font-medium"
                    >
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      {ch}
                    </span>
                  ))}
                  {(schemaAdaptSummary.proxy_required || []).map((ch) => (
                    <span
                      key={ch}
                      className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full
                                 bg-amber-500/10 text-amber-400 font-medium"
                    >
                      <Zap className="w-2.5 h-2.5" />
                      {ch}
                    </span>
                  ))}
                  {(schemaAdaptSummary.not_feasible || []).map((ch) => (
                    <span
                      key={ch}
                      className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full
                                 bg-red-500/10 text-red-400 font-medium"
                    >
                      <XCircle className="w-2.5 h-2.5" />
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── Generated Code ────────────────────────────────────────────── */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
              {/* Code header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/40 bg-slate-800/30">
                <div className="flex items-center gap-2">
                  <FileCode className="w-3.5 h-3.5 text-sky-400" />
                  <span className="text-xs font-semibold text-sky-300">
                    compute_feature()
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {lineCount} lines
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 font-mono">
                    Python
                  </span>
                </div>
              </div>

              {/* Code block with line numbers */}
              <div className="relative max-h-[480px] overflow-y-auto">
                <div className="flex">
                  {/* Line numbers gutter */}
                  <div className="shrink-0 select-none py-3 pl-3 pr-2 text-right border-r border-slate-700/20">
                    {generatedCode.split('\n').map((_, i) => (
                      <div
                        key={i}
                        className="text-[10px] leading-[1.65] text-slate-600 font-mono"
                      >
                        {i + 1}
                      </div>
                    ))}
                  </div>

                  {/* Code content */}
                  <pre className="flex-1 p-3 text-[11px] overflow-x-auto leading-[1.65] !bg-transparent !m-0">
                    <code ref={codeRef} className="language-python">
                      {generatedCode}
                    </code>
                  </pre>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Trace Events (compact) ─────────────────────────────────────────── */}
      {traceEvents.length > 0 && (
        <div className="bg-slate-800/20 border border-slate-700/20 rounded-lg px-3 py-2">
          <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1 font-medium">
            Engineer Trace ({traceEvents.length})
          </div>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {traceEvents.slice(-10).map((evt, i) => (
              <div key={i} className="text-[10px] text-slate-500 truncate">
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                  evt.level === 'success' ? 'bg-emerald-500' :
                  evt.level === 'error' ? 'bg-red-500' :
                  'bg-slate-600'
                }`} />
                {evt.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
