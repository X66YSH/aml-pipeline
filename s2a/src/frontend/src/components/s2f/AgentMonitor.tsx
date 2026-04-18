/**
 * AgentMonitor — real-time pipeline visualization.
 *
 * Layout: 5 compact phase cards in a row (always visible, including Correct),
 * with a shared detail panel below. Click a card to open/switch the panel tab.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism-tomorrow.css';
import {
  Brain, Code2, ShieldCheck, RefreshCw, CheckCircle2, XCircle, Clock, Zap,
  AlertTriangle, Columns, FileCode, Tag, Settings2, ArrowRight, Layers,
} from 'lucide-react';
import type { TraceEvent, PerceiveData, ValidationData, SchemaAdaptData } from '../../api/client';

// ── Types ─────────────────────────────────────────────────────────────────────

type PhaseStatus = 'idle' | 'active' | 'done' | 'error';

interface Phase {
  key: string;
  label: string;
  sublabel: string;
  icon: React.ElementType;
  color: string;
  glowColor: string;
  borderColor: string;
  status: PhaseStatus;
  logs: string[];
  startedAt?: number;
  finishedAt?: number;
}

// ── Phase detection from trace messages ───────────────────────────────────────

function derivePhases(events: TraceEvent[]): Phase[] {
  const base: Phase[] = [
    {
      key: 'perceive',
      label: 'Perceive',
      sublabel: 'Feature Engineer',
      icon: Brain,
      color: 'purple',
      glowColor: 'rgba(168,85,247,0.35)',
      borderColor: 'border-purple-500/50',
      status: 'idle',
      logs: [],
    },
    {
      key: 'schema_adapt',
      label: 'Adapter',
      sublabel: 'Schema Adapter',
      icon: Layers,
      color: 'teal',
      glowColor: 'rgba(20,184,166,0.35)',
      borderColor: 'border-teal-500/50',
      status: 'idle',
      logs: [],
    },
    {
      key: 'reason',
      label: 'Reason',
      sublabel: 'Feature Engineer',
      icon: Code2,
      color: 'sky',
      glowColor: 'rgba(56,189,248,0.35)',
      borderColor: 'border-sky-500/50',
      status: 'idle',
      logs: [],
    },
    {
      key: 'validate',
      label: 'Validate',
      sublabel: 'Det. Validator',
      icon: ShieldCheck,
      color: 'emerald',
      glowColor: 'rgba(52,211,153,0.35)',
      borderColor: 'border-emerald-500/50',
      status: 'idle',
      logs: [],
    },
    {
      key: 'correct',
      label: 'Correct',
      sublabel: 'Self-Correction',
      icon: RefreshCw,
      color: 'amber',
      glowColor: 'rgba(251,191,36,0.35)',
      borderColor: 'border-amber-500/50',
      status: 'idle',
      logs: [],
    },
  ];

  // Index helpers for readability
  const perceiveIdx = 0;
  const schemaAdaptIdx = 1;
  const reasonIdx = 2;
  const validateIdx = 3;
  const correctIdx = 4;

  for (const evt of events) {
    const msg = evt.message || '';
    const lvl = evt.level;

    if (msg.includes('PERCEIVE')) {
      const p = base[perceiveIdx];
      if (lvl === 'agent') { p.status = 'active'; p.startedAt = evt.timestamp; }
      else if (lvl === 'success') { p.status = 'done'; p.finishedAt = evt.timestamp; }
      p.logs.push(msg);
    } else if (msg.includes('SCHEMA ADAPT') || evt.agent === 'Schema Adapter') {
      const p = base[schemaAdaptIdx];
      // Auto-complete Perceive when Schema Adapt starts
      if (p.status === 'idle') { base[perceiveIdx].status = base[perceiveIdx].status === 'active' ? 'done' : base[perceiveIdx].status; }
      if (lvl === 'agent') { p.status = 'active'; p.startedAt = evt.timestamp; }
      else if (lvl === 'success') { p.status = 'done'; p.finishedAt = evt.timestamp; }
      p.logs.push(msg);
    } else if (msg.includes('REASON')) {
      const p = base[reasonIdx];
      // Auto-complete Schema Adapt when Reason starts
      if (p.status === 'idle') { base[schemaAdaptIdx].status = base[schemaAdaptIdx].status === 'active' ? 'done' : base[schemaAdaptIdx].status; }
      // Also auto-complete Perceive if it was still active (in case Schema Adapt was skipped)
      if (base[perceiveIdx].status === 'active') { base[perceiveIdx].status = 'done'; }
      if (lvl === 'agent') { p.status = 'active'; p.startedAt = evt.timestamp; }
      else if (lvl === 'success') { p.status = 'done'; p.finishedAt = evt.timestamp; }
      p.logs.push(msg);
    } else if (msg.includes('ACT phase') || evt.agent === 'Deterministic Validator') {
      const p = base[validateIdx];
      if (lvl === 'agent' && msg.includes('ACT')) { p.status = 'active'; p.startedAt = evt.timestamp; }
      else if (lvl === 'success' && (msg.includes('All checks passed') || msg.includes('AST passed after') || msg.includes('AST analysis passed'))) {
        p.status = 'done'; p.finishedAt = evt.timestamp;
      } else if (lvl === 'error') { p.status = 'error'; }
      p.logs.push(msg);
    } else if (msg.includes('Self-correction') || msg.includes('correction')) {
      const p = base[correctIdx];
      if (p.status === 'idle') { p.status = 'active'; p.startedAt = evt.timestamp; }
      if (lvl === 'success' && msg.includes('passed after')) {
        p.status = 'done'; p.finishedAt = evt.timestamp;
        base[validateIdx].status = 'done';
      }
      p.logs.push(msg);
    } else if (msg.includes('Compilation complete')) {
      base.forEach(p => { if (p.status === 'active') { p.status = 'done'; p.finishedAt = evt.timestamp; } });
    }
  }

  // If validate passed and correct was never triggered, mark correct as done (skipped)
  if (base[validateIdx].status === 'done' && base[correctIdx].status === 'idle') {
    base[correctIdx].status = 'done';
    base[correctIdx].finishedAt = base[validateIdx].finishedAt;
  }

  return base;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function elapsed(startedAt?: number, finishedAt?: number): string | null {
  if (!startedAt) return null;
  const end = finishedAt ?? Date.now() / 1000;
  const s = end - startedAt;
  return s < 60 ? `${s.toFixed(1)}s` : `${(s / 60).toFixed(1)}m`;
}

const colorMap = (color: string) => ({
  text: {
    purple: 'text-purple-300', teal: 'text-teal-300', sky: 'text-sky-300', emerald: 'text-emerald-300', amber: 'text-amber-300',
  }[color] ?? 'text-purple-300',
  bg: {
    purple: 'bg-purple-500/10', teal: 'bg-teal-500/10', sky: 'bg-sky-500/10', emerald: 'bg-emerald-500/10', amber: 'bg-amber-500/10',
  }[color] ?? 'bg-purple-500/10',
  ring: {
    purple: '#a855f7', teal: '#14b8a6', sky: '#38bdf8', emerald: '#34d399', amber: '#fbbf24',
  }[color] ?? '#a855f7',
});

// ── Detail Panels ─────────────────────────────────────────────────────────────

function PerceiveDetail({ data }: { data: PerceiveData }) {
  const { indicator, parameters, computation_plan } = data;
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Tag className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Indicator</span>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-3 space-y-1.5">
          {indicator.category && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-medium">
              {indicator.category}
            </span>
          )}
          {indicator.description && (
            <p className="text-xs text-slate-300 leading-relaxed">{indicator.description}</p>
          )}
          {indicator.risk_rationale && (
            <div className="mt-1.5 bg-purple-500/5 border border-purple-500/15 rounded-lg p-2">
              <div className="text-[9px] text-purple-400 uppercase tracking-wider mb-0.5 font-semibold">Why This Matters</div>
              <p className="text-[11px] text-slate-300 leading-relaxed">{indicator.risk_rationale}</p>
            </div>
          )}
        </div>
      </div>

      {parameters.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Settings2 className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">
              Extracted Parameters ({parameters.length})
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {parameters.map((p, i) => (
              <div key={i} className="bg-slate-800/60 rounded-lg p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <code className="text-[11px] text-purple-300 font-mono">{p.name}</code>
                  {p.unit && <span className="text-[9px] text-slate-500">{p.unit}</span>}
                </div>
                {p.ambiguous_term && (
                  <p className="text-[10px] text-slate-500 truncate" title={p.ambiguous_term}>
                    &ldquo;{p.ambiguous_term}&rdquo;
                  </p>
                )}
                {p.default !== undefined && (
                  <div className="text-[10px] text-slate-400">default: <code className="text-emerald-400">{String(p.default)}</code></div>
                )}
                {!!(p as Record<string, unknown>).rationale && (
                  <p className="text-[10px] text-sky-400/80 italic">↳ {String((p as Record<string, unknown>).rationale)}</p>
                )}
                {!!(p as Record<string, unknown>).regulatory_basis && (
                  <p className="text-[9px] text-amber-400/60">📋 {String((p as Record<string, unknown>).regulatory_basis)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {computation_plan.operation && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ArrowRight className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Computation Plan</span>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 font-mono">{computation_plan.operation}</span>
              {computation_plan.aggregation_level && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                  group by: {computation_plan.aggregation_level}
                </span>
              )}
              {computation_plan.time_window && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                  window: {computation_plan.time_window}
                </span>
              )}
              {!!(computation_plan as Record<string, unknown>).join_strategy && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-300">
                  join: {String((computation_plan as Record<string, unknown>).join_strategy)}
                </span>
              )}
            </div>
            {computation_plan.required_columns && computation_plan.required_columns.length > 0 && (
              <div>
                <div className="text-[9px] text-slate-500 mb-1">Required columns:</div>
                <div className="flex flex-wrap gap-1">
                  {computation_plan.required_columns.map((col) => (
                    <span key={col} className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">{col}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReasonDetail({ code, computationPlan }: { code: string; computationPlan?: PerceiveData['computation_plan'] }) {
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [code]);

  return (
    <div className="space-y-3">
      {/* Computation plan summary */}
      {computationPlan?.operation && (
        <div className="bg-sky-500/5 border border-sky-500/15 rounded-lg p-2.5">
          <div className="text-[9px] text-sky-400 uppercase tracking-wider mb-1 font-semibold">Coding Intent</div>
          <p className="text-[11px] text-slate-300">
            {computationPlan.aggregation_level && `Group by ${computationPlan.aggregation_level}, `}
            compute <span className="text-sky-300 font-mono">{computationPlan.operation}</span>
            {computationPlan.time_window && ` over ${computationPlan.time_window} window`}
            {computationPlan.required_columns && computationPlan.required_columns.length > 0 && (
              <> using columns: {computationPlan.required_columns.map((c, i) => (
                <span key={c}>{i > 0 && ', '}<code className="text-emerald-400">{c}</code></span>
              ))}</>
            )}
          </p>
        </div>
      )}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <FileCode className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-xs font-semibold text-sky-300 uppercase tracking-wider">Generated Code</span>
          <span className="text-[10px] text-slate-500">{code.split('\n').length} lines</span>
        </div>
        <pre className="bg-slate-900/80 rounded-lg p-3 text-[11px] overflow-x-auto max-h-72 overflow-y-auto leading-relaxed !bg-transparent !m-0">
          <code ref={codeRef} className="language-python">
            {code}
          </code>
        </pre>
      </div>
    </div>
  );
}

function ValidateDetail({ data }: { data: ValidationData }) {
  const allFindings = [
    ...data.ast_findings.findings,
    ...data.column_findings.findings,
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg ${
          data.ast_passed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
        }`}>
          <ShieldCheck className="w-3.5 h-3.5" />
          AST Safety: {data.ast_passed ? 'Passed' : 'Failed'}
        </div>
        <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg ${
          data.columns_passed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
        }`}>
          <Columns className="w-3.5 h-3.5" />
          Column Alignment: {data.columns_passed ? 'Passed' : 'Failed'}
        </div>
      </div>

      {allFindings.length > 0 && (
        <div className="space-y-1.5">
          {allFindings.map((f, i) => (
            <div key={i} className={`flex items-start gap-2 p-2 rounded-lg text-[11px] ${
              f.severity === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'
            }`}>
              {f.severity === 'error'
                ? <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              }
              <div className="min-w-0">
                <span className="font-mono text-[10px] opacity-60">[{f.category}]</span>
                {!!(f as Record<string, unknown>).line && <span className="font-mono text-[10px] opacity-40 ml-1">L{String((f as Record<string, unknown>).line)}</span>}
                {' '}{f.message}
              </div>
            </div>
          ))}
        </div>
      )}

      {!data.columns_passed && data.schema_columns.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-500 mb-1.5">Available schema columns:</div>
          <div className="flex flex-wrap gap-1">
            {data.schema_columns.map((col) => (
              <code key={col} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">{col}</code>
            ))}
          </div>
        </div>
      )}

      {allFindings.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-emerald-400 p-2">
          <CheckCircle2 className="w-4 h-4" />
          All validation checks passed — code is safe, columns aligned with schema.
        </div>
      )}
    </div>
  );
}

function CorrectDetail({ logs, latestValidation, codeHistory }: { logs: string[]; latestValidation?: ValidationData; codeHistory?: Map<number, string> }) {
  // Simple line diff between original and latest code
  const diffLines = useMemo(() => {
    if (!codeHistory || codeHistory.size < 2) return null;
    const iterations = Array.from(codeHistory.keys()).sort((a, b) => a - b);
    const original = (codeHistory.get(iterations[0]) || '').split('\n');
    const latest = (codeHistory.get(iterations[iterations.length - 1]) || '').split('\n');
    const diff: { type: 'same' | 'add' | 'remove'; line: string }[] = [];
    const maxLen = Math.max(original.length, latest.length);
    for (let i = 0; i < maxLen; i++) {
      const origLine = i < original.length ? original[i] : undefined;
      const newLine = i < latest.length ? latest[i] : undefined;
      if (origLine === newLine) {
        diff.push({ type: 'same', line: origLine || '' });
      } else {
        if (origLine !== undefined) diff.push({ type: 'remove', line: origLine });
        if (newLine !== undefined) diff.push({ type: 'add', line: newLine });
      }
    }
    // Only show if there are actual changes
    return diff.some(d => d.type !== 'same') ? diff : null;
  }, [codeHistory]);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {logs.map((log, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px] text-slate-400">
            <RefreshCw className="w-3 h-3 shrink-0 mt-0.5 text-amber-400" />
            {log}
          </div>
        ))}
      </div>
      {diffLines && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Code2 className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Code Changes</span>
            <span className="text-[10px] text-slate-500">{codeHistory?.size ?? 0} iterations</span>
          </div>
          <pre className="bg-slate-900/80 rounded-lg p-3 text-[10px] overflow-x-auto max-h-64 overflow-y-auto leading-relaxed font-mono">
            {diffLines.filter(d => d.type !== 'same').map((d, i) => (
              <div key={i} className={d.type === 'add' ? 'text-emerald-400 bg-emerald-500/5' : 'text-red-400 bg-red-500/5'}>
                <span className="opacity-50 select-none">{d.type === 'add' ? '+' : '-'} </span>{d.line}
              </div>
            ))}
          </pre>
        </div>
      )}
      {latestValidation && <ValidateDetail data={latestValidation} />}
    </div>
  );
}

function SchemaAdaptDetail({ data }: { data: SchemaAdaptData }) {
  const adaptations = data.channel_adaptations || {};
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-200">Channel Compatibility Analysis</h4>
      <div className="space-y-2">
        {Object.entries(adaptations).map(([ch, info]) => (
          <div key={ch} className={`p-3 rounded-lg border ${
            info.status === 'direct_match' ? 'border-emerald-500/30 bg-emerald-500/5' :
            info.status === 'proxy_required' ? 'border-amber-500/30 bg-amber-500/5' :
            'border-red-500/30 bg-red-500/5'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                info.status === 'direct_match' ? 'bg-emerald-500/20 text-emerald-400' :
                info.status === 'proxy_required' ? 'bg-amber-500/20 text-amber-400' :
                'bg-red-500/20 text-red-400'
              }`}>
                {info.status === 'direct_match' ? '\u2713 DIRECT' :
                 info.status === 'proxy_required' ? '\u26A1 PROXY' : '\u2717 NOT FEASIBLE'}
              </span>
              <span className="text-sm font-medium text-slate-200">{ch}</span>
            </div>
            <p className="text-xs text-slate-400">{info.strategy || info.reason || ''}</p>
            {info.proxy_reasoning && (
              <p className="text-xs text-amber-400/80 mt-1 italic">Proxy: {info.proxy_reasoning}</p>
            )}
            {info.columns_used && info.columns_used.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {info.columns_used.map(col => (
                  <span key={col} className="text-[10px] px-1.5 py-0.5 bg-slate-700/50 rounded text-teal-400 font-mono">{col}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function IdleDetail({ phase }: { phase: Phase }) {
  return (
    <div className="flex items-center justify-center h-24 text-slate-600 text-xs">
      <span>{phase.label} has not started yet</span>
    </div>
  );
}

// ── Compact Phase Card (top row) ──────────────────────────────────────────────

function CompactCard({
  phase,
  isSelected,
  isLast,
  onClick,
}: {
  phase: Phase;
  isSelected: boolean;
  isLast: boolean;
  onClick: () => void;
}) {
  const Icon = phase.icon;
  const StatusIcon = phase.status === 'done' ? CheckCircle2 : phase.status === 'error' ? XCircle : null;
  const elapsedStr = elapsed(phase.startedAt, phase.finishedAt);
  const cm = colorMap(phase.color);

  return (
    <div className="flex items-center flex-1 min-w-0">
      <motion.div
        className={`
          relative rounded-xl border p-3 flex-1 min-w-0 cursor-pointer transition-all duration-200
          ${phase.status === 'idle'
            ? `border-slate-800 bg-slate-900/30 ${isSelected ? 'border-slate-600 bg-slate-900/50' : ''}`
            : phase.status === 'active'
              ? `border-opacity-60 ${phase.borderColor} ${cm.bg}`
              : phase.status === 'done'
                ? `border-slate-700/60 bg-slate-900/40 ${isSelected ? `${phase.borderColor} border-opacity-60` : ''}`
                : 'border-red-500/40 bg-red-500/5'
          }
          ${isSelected ? 'ring-1 ring-slate-500/30' : ''}
        `}
        style={phase.status === 'active' ? { boxShadow: `0 0 16px ${phase.glowColor}` } : undefined}
        animate={phase.status === 'active' ? { scale: [1, 1.01, 1] } : {}}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        onClick={onClick}
      >
        {phase.status === 'active' && (
          <motion.div
            className="absolute inset-0 rounded-xl"
            style={{ border: `1.5px solid ${cm.ring}` }}
            animate={{ opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          />
        )}

        <div className="flex items-center gap-2">
          <div className={`
            p-1.5 rounded-lg shrink-0
            ${phase.status === 'idle' ? 'bg-slate-800 text-slate-600'
              : phase.status === 'active' ? `${cm.bg} ${cm.text}`
              : phase.status === 'done' ? 'bg-slate-800/60 text-slate-400'
              : 'bg-red-500/10 text-red-400'}
          `}>
            {phase.status === 'active'
              ? <motion.div animate={{ rotate: phase.key === 'correct' ? 360 : 0 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
                  <Icon className="w-3.5 h-3.5" />
                </motion.div>
              : <Icon className="w-3.5 h-3.5" />
            }
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-semibold ${
                phase.status === 'idle' ? 'text-slate-600'
                : phase.status === 'active' ? cm.text
                : phase.status === 'done' ? 'text-slate-300'
                : 'text-red-400'
              }`}>
                {phase.label}
              </span>
              {StatusIcon && (
                <StatusIcon className={`w-3 h-3 ${phase.status === 'done' ? 'text-emerald-400' : 'text-red-400'}`} />
              )}
              {phase.status === 'active' && (
                <motion.div
                  className={`w-1.5 h-1.5 rounded-full ${cm.text.replace('text-', 'bg-')}`}
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                />
              )}
            </div>
            <div className="text-[9px] text-slate-600">{phase.sublabel}</div>
          </div>

          {elapsedStr && (
            <div className="flex items-center gap-0.5 text-[9px] text-slate-600 shrink-0">
              <Clock className="w-2.5 h-2.5" />
              {elapsedStr}
            </div>
          )}
        </div>

        {/* Selected indicator bar */}
        {isSelected && (
          <motion.div
            layoutId="activeTab"
            className={`absolute -bottom-px left-3 right-3 h-0.5 rounded-full`}
            style={{ background: cm.ring }}
          />
        )}
      </motion.div>

      {/* Connector arrow */}
      {!isLast && (
        <div className="flex items-center mx-1 shrink-0">
          <motion.div
            className="w-5 h-px"
            style={{ background: phase.status !== 'idle' ? cm.ring : '#334155' }}
            animate={phase.status === 'done' ? { opacity: [0.6, 1, 0.6] } : {}}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <motion.div
            className="w-0 h-0"
            style={{
              borderTop: '3px solid transparent',
              borderBottom: '3px solid transparent',
              borderLeft: `5px solid ${phase.status !== 'idle' ? cm.ring : '#334155'}`,
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface AgentMonitorProps {
  traceEvents: TraceEvent[];
  isRunning: boolean;
  perceiveData?: PerceiveData | null;
  schemaAdaptData?: SchemaAdaptData | null;
  generatedCode?: string | null;
  validationData?: ValidationData | null;
  codeHistory?: Map<number, string>;
}

export default function AgentMonitor({
  traceEvents,
  isRunning,
  perceiveData,
  schemaAdaptData,
  generatedCode,
  validationData,
  codeHistory,
}: AgentMonitorProps) {
  const phases = useMemo(() => derivePhases(traceEvents), [traceEvents]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const hasActivity = isRunning || phases.some(p => p.status !== 'idle');
  const activePhase = phases.find(p => p.status === 'active');

  // Auto-select the currently active phase tab — must be before any conditional return
  useEffect(() => {
    if (activePhase && !activeTab) {
      setActiveTab(activePhase.key);
    }
  }, [activePhase?.key, activeTab]);

  if (!hasActivity) return null;

  const doneCount = phases.filter(p => p.status === 'done').length;
  const isDone = !isRunning && doneCount > 0;

  const toggleTab = (key: string) => {
    setActiveTab(prev => prev === key ? null : key);
  };

  const getDetailContent = (phase: Phase): React.ReactNode => {
    switch (phase.key) {
      case 'perceive':
        return perceiveData ? <PerceiveDetail data={perceiveData} /> : <IdleDetail phase={phase} />;
      case 'schema_adapt':
        return schemaAdaptData ? <SchemaAdaptDetail data={schemaAdaptData} /> : <IdleDetail phase={phase} />;
      case 'reason':
        return generatedCode ? <ReasonDetail code={generatedCode} computationPlan={perceiveData?.computation_plan} /> : <IdleDetail phase={phase} />;
      case 'validate':
        return validationData ? <ValidateDetail data={validationData} /> : <IdleDetail phase={phase} />;
      case 'correct':
        return phases[4].logs.length > 0
          ? <CorrectDetail logs={phases[4].logs} latestValidation={validationData ?? undefined} codeHistory={codeHistory} />
          : <IdleDetail phase={phase} />;
      default:
        return <IdleDetail phase={phase} />;
    }
  };

  const selectedPhase = phases.find(p => p.key === activeTab);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3 }}
        className="mx-4 mb-4"
      >
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="flex items-center gap-1.5">
              {isRunning
                ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
                    <Zap className="w-3 h-3 text-purple-400" />
                  </motion.div>
                : <Zap className="w-3 h-3 text-slate-500" />
              }
              <span className="text-[10px] font-semibold text-slate-400 tracking-widest uppercase">
                Agent Pipeline
              </span>
            </div>
            {isRunning && (
              <span className="text-[10px] text-slate-600">
                {activePhase?.label ?? 'initializing'}...
              </span>
            )}
            {isDone && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-500">
                <CheckCircle2 className="w-3 h-3" />
                Complete — click any phase to inspect
              </span>
            )}
          </div>

          {/* Phase cards row — always show all 5 */}
          <div className="flex items-center gap-0">
            {phases.map((phase, i) => (
              <CompactCard
                key={phase.key}
                phase={phase}
                isSelected={activeTab === phase.key}
                isLast={i === phases.length - 1}
                onClick={() => toggleTab(phase.key)}
              />
            ))}
          </div>

          {/* Shared detail panel below */}
          <AnimatePresence mode="wait">
            {activeTab && selectedPhase && (
              <motion.div
                key={activeTab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
              >
                <div className={`
                  mt-2 rounded-xl border p-4
                  ${selectedPhase.borderColor} border-opacity-30 bg-slate-900/60
                  max-h-72 overflow-y-auto
                `}>
                  {getDetailContent(selectedPhase)}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
