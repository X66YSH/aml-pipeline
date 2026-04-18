/**
 * AdapterTab -- Tab 2: Schema Adapter workspace.
 *
 * Displays channel compatibility analysis results: per-channel status
 * (direct match, proxy required, not feasible) with strategy details.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layers, CheckCircle2, Zap, XCircle, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react';
import type { SchemaAdaptData, TraceEvent, PRAData } from '../../api/client';
import PRACard from './PRACard';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  schemaAdaptData: SchemaAdaptData | null;
  traceEvents: TraceEvent[];
  pipelineRunning: boolean;
  pra?: PRAData | null;
}

// ── Status helpers ────────────────────────────────────────────────────────────

type AdaptStatus = 'direct_match' | 'proxy_required' | 'not_feasible';

const statusConfig: Record<AdaptStatus, {
  label: string;
  icon: typeof CheckCircle2;
  badge: string;
  border: string;
  bg: string;
  text: string;
  leftBorder: string;
}> = {
  direct_match: {
    label: 'DIRECT',
    icon: CheckCircle2,
    badge: 'bg-emerald-500/20 text-emerald-400',
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/5',
    text: 'text-emerald-400',
    leftBorder: 'border-l-emerald-500',
  },
  proxy_required: {
    label: 'PROXY',
    icon: Zap,
    badge: 'bg-amber-500/20 text-amber-400',
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/5',
    text: 'text-amber-400',
    leftBorder: 'border-l-amber-500',
  },
  not_feasible: {
    label: 'NOT FEASIBLE',
    icon: XCircle,
    badge: 'bg-red-500/20 text-red-400',
    border: 'border-red-500/30',
    bg: 'bg-red-500/5',
    text: 'text-red-400',
    leftBorder: 'border-l-red-500',
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdapterTab({
  schemaAdaptData,
  traceEvents,
  pipelineRunning,
  pra,
}: Props) {
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set());

  const toggleChannel = (ch: string) => {
    setExpandedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  };

  // Count summary from data or summary field
  const adaptations = schemaAdaptData?.channel_adaptations || {};
  const channels = Object.entries(adaptations);

  const summaryFromData = {
    direct_match: channels.filter(([, v]) => v.status === 'direct_match').length,
    proxy_required: channels.filter(([, v]) => v.status === 'proxy_required').length,
    not_feasible: channels.filter(([, v]) => v.status === 'not_feasible').length,
  };

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
        <Layers className="w-4 h-4 text-teal-400" />
        <h3 className="text-sm font-semibold text-slate-200">
          Schema Adapter
        </h3>
        <span className="text-[11px] text-slate-500">
          Channel Compatibility Analysis
        </span>
      </div>

      {/* ── PRA Card ───────────────────────────────────────────────────────── */}
      {(pra || schemaAdaptData) && (
        <PRACard
          pra={pra || null}
          agentName="Schema Adapter"
          isActive={pipelineRunning}
        />
      )}

      {/* ── Waiting State ──────────────────────────────────────────────────── */}
      {!schemaAdaptData && pipelineRunning && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 flex items-center justify-center gap-3"
        >
          <Loader2 className="w-5 h-5 text-teal-400 animate-spin" />
          <span className="text-sm text-slate-400">
            Analyzing channel schemas...
          </span>
        </motion.div>
      )}

      {/* ── No data, not running ───────────────────────────────────────────── */}
      {!schemaAdaptData && !pipelineRunning && (
        <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-8 text-center">
          <p className="text-sm text-slate-600">
            No schema adaptation data yet. Run the pipeline to analyze channel compatibility.
          </p>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {schemaAdaptData && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-4"
          >
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-emerald-400">
                  {summaryFromData.direct_match}
                </div>
                <div className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-medium mt-0.5">
                  Direct Match
                </div>
              </div>
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-amber-400">
                  {summaryFromData.proxy_required}
                </div>
                <div className="text-[10px] text-amber-400/70 uppercase tracking-wider font-medium mt-0.5">
                  Proxy Required
                </div>
              </div>
              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-red-400">
                  {summaryFromData.not_feasible}
                </div>
                <div className="text-[10px] text-red-400/70 uppercase tracking-wider font-medium mt-0.5">
                  Not Feasible
                </div>
              </div>
            </div>

            {/* Per-channel cards */}
            <div className="space-y-2">
              {channels.map(([channelName, info], idx) => {
                const config = statusConfig[info.status];
                const StatusIcon = config.icon;
                const isExpanded = expandedChannels.has(channelName);
                const hasExpandableContent =
                  (info.status === 'proxy_required' && info.proxy_reasoning) ||
                  (info.status === 'not_feasible' && info.reason);

                return (
                  <motion.div
                    key={channelName}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05, duration: 0.3 }}
                    className={`
                      rounded-xl border ${config.border} ${config.bg}
                      border-l-4 ${config.leftBorder}
                      overflow-hidden
                    `}
                  >
                    {/* Main row */}
                    <div
                      className={`flex items-center justify-between p-3 ${hasExpandableContent ? 'cursor-pointer hover:bg-white/[0.02]' : ''}`}
                      onClick={() => hasExpandableContent && toggleChannel(channelName)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Channel name */}
                        <span className="text-sm font-medium text-slate-200 min-w-[60px]">
                          {channelName}
                        </span>

                        {/* Status badge */}
                        <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold ${config.badge}`}>
                          <StatusIcon className="w-3 h-3" />
                          {config.label}
                        </span>

                        {/* Strategy text */}
                        {info.strategy && (
                          <span className="text-[11px] text-slate-400 truncate">
                            {info.strategy}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Column pills */}
                        {info.columns_used && info.columns_used.length > 0 && (
                          <div className="hidden md:flex flex-wrap gap-1">
                            {info.columns_used.slice(0, 4).map((col) => (
                              <span
                                key={col}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 font-mono"
                              >
                                {col}
                              </span>
                            ))}
                            {info.columns_used.length > 4 && (
                              <span className="text-[9px] text-slate-600">
                                +{info.columns_used.length - 4}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Expand toggle */}
                        {hasExpandableContent && (
                          isExpanded
                            ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                            : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                        )}
                      </div>
                    </div>

                    {/* Expandable section */}
                    <AnimatePresence>
                      {isExpanded && hasExpandableContent && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-3 pt-0 border-t border-slate-700/20">
                            {info.status === 'proxy_required' && info.proxy_reasoning && (
                              <div className="mt-2 bg-amber-500/5 border border-amber-500/15 rounded-lg p-2.5">
                                <div className="text-[9px] text-amber-400 uppercase tracking-wider mb-1 font-semibold">
                                  Proxy Reasoning
                                </div>
                                <p className="text-[11px] text-slate-300 leading-relaxed">
                                  {info.proxy_reasoning}
                                </p>
                              </div>
                            )}
                            {info.status === 'not_feasible' && info.reason && (
                              <div className="mt-2 bg-red-500/5 border border-red-500/15 rounded-lg p-2.5">
                                <div className="text-[9px] text-red-400 uppercase tracking-wider mb-1 font-semibold">
                                  Reason
                                </div>
                                <p className="text-[11px] text-slate-300 leading-relaxed">
                                  {info.reason}
                                </p>
                              </div>
                            )}

                            {/* Full column list (visible on expand for mobile too) */}
                            {info.columns_used && info.columns_used.length > 0 && (
                              <div className="mt-2">
                                <div className="text-[9px] text-slate-500 mb-1">Columns used:</div>
                                <div className="flex flex-wrap gap-1">
                                  {info.columns_used.map((col) => (
                                    <span
                                      key={col}
                                      className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 font-mono"
                                    >
                                      {col}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Trace Events (compact) ─────────────────────────────────────────── */}
      {traceEvents.length > 0 && (
        <div className="bg-slate-800/20 border border-slate-700/20 rounded-lg px-3 py-2">
          <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1 font-medium">
            Adapter Trace ({traceEvents.length})
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
