/**
 * PipelineTabBar -- horizontal tab bar acting as a pipeline progress indicator.
 *
 * 6 tabs representing the paper's multi-agent architecture:
 * Analyst -> Adapter -> Engineer -> Validator -> Detection -> RCC
 */

import { motion } from 'framer-motion';
import {
  FileSearch, Layers, Code2, ShieldCheck, BarChart3, Shield,
  CheckCircle2, XCircle,
} from 'lucide-react';

// ── Public types ──────────────────────────────────────────────────────────────

export type PipelineTab = 'analyst' | 'adapter' | 'engineer' | 'validator' | 'detection' | 'rcc';
export type PipelinePhase = 'idle' | PipelineTab | 'done';
export type PhaseStatus = 'idle' | 'active' | 'done' | 'error';

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS: { key: PipelineTab; label: string; icon: typeof FileSearch; sublabel: string; color: string; ring: string }[] = [
  { key: 'analyst',   label: 'Analyst',   icon: FileSearch,  sublabel: 'Regulatory Analyst',      color: 'purple', ring: '#a855f7' },
  { key: 'adapter',   label: 'Adapter',   icon: Layers,      sublabel: 'Schema Adapter',          color: 'teal',   ring: '#14b8a6' },
  { key: 'engineer',  label: 'Engineer',  icon: Code2,       sublabel: 'Feature Engineer',        color: 'sky',    ring: '#38bdf8' },
  { key: 'validator', label: 'Validator', icon: ShieldCheck, sublabel: 'Deterministic Validator',  color: 'emerald', ring: '#34d399' },
  { key: 'detection', label: 'Detection', icon: BarChart3,   sublabel: 'Anomaly Detection',       color: 'amber',  ring: '#fbbf24' },
  { key: 'rcc',       label: 'RCC',       icon: Shield,      sublabel: 'Regulatory Consistency',  color: 'rose',   ring: '#fb7185' },
];

// ── Color helpers ─────────────────────────────────────────────────────────────

const textColor: Record<string, string> = {
  purple: 'text-purple-300', teal: 'text-teal-300', sky: 'text-sky-300',
  emerald: 'text-emerald-300', amber: 'text-amber-300', rose: 'text-rose-300',
};

const bgColor: Record<string, string> = {
  purple: 'bg-purple-500/10', teal: 'bg-teal-500/10', sky: 'bg-sky-500/10',
  emerald: 'bg-emerald-500/10', amber: 'bg-amber-500/10', rose: 'bg-rose-500/10',
};

const borderColor: Record<string, string> = {
  purple: 'border-purple-500/50', teal: 'border-teal-500/50', sky: 'border-sky-500/50',
  emerald: 'border-emerald-500/50', amber: 'border-amber-500/50', rose: 'border-rose-500/50',
};

const glowColor: Record<string, string> = {
  purple: 'rgba(168,85,247,0.35)', teal: 'rgba(20,184,166,0.35)', sky: 'rgba(56,189,248,0.35)',
  emerald: 'rgba(52,211,153,0.35)', amber: 'rgba(251,191,36,0.35)', rose: 'rgba(251,113,133,0.35)',
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  activeTab: PipelineTab;
  pipelinePhase: PipelinePhase;
  phaseStatuses: Record<PipelineTab, PhaseStatus>;
  onTabChange: (tab: PipelineTab) => void;
  pipelineRunning: boolean;
  latestMessage?: string;
  pendingDecision?: boolean;
  activeTabView?: PipelineTab;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PipelineTabBar({
  activeTab,
  phaseStatuses,
  onTabChange,
  pipelineRunning,
  latestMessage,
  pendingDecision,
}: Props) {
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-center gap-0 min-w-max">
        {TABS.map((tab, idx) => {
          const status = phaseStatuses[tab.key];
          const isActive = activeTab === tab.key;
          const Icon = tab.icon;
          const isLast = idx === TABS.length - 1;

          return (
            <div key={tab.key} className="flex items-center">
              {/* Tab card */}
              <motion.button
                onClick={() => onTabChange(tab.key)}
                className={`
                  relative rounded-xl border px-4 py-3 min-w-[130px] text-left transition-all duration-200
                  ${status === 'idle'
                    ? `border-slate-800 bg-slate-900/30 hover:bg-slate-900/50 hover:border-slate-700`
                    : status === 'active'
                      ? `${borderColor[tab.color]} ${bgColor[tab.color]}`
                      : status === 'done'
                        ? `border-slate-700/60 bg-slate-900/40 hover:bg-slate-900/60`
                        : 'border-red-500/40 bg-red-500/5'
                  }
                  ${isActive ? 'ring-1 ring-slate-500/30' : ''}
                `}
                style={status === 'active' ? { boxShadow: `0 0 20px ${glowColor[tab.color]}` } : undefined}
                animate={status === 'active' ? { scale: [1, 1.02, 1] } : {}}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                {/* Active pulsing border */}
                {status === 'active' && (
                  <motion.div
                    className="absolute inset-0 rounded-xl"
                    style={{ border: `1.5px solid ${tab.ring}` }}
                    animate={{ opacity: [0.6, 0, 0.6] }}
                    transition={{ duration: 1.8, repeat: Infinity }}
                  />
                )}

                <div className="flex items-center gap-2.5">
                  {/* Icon container */}
                  <div className={`
                    relative p-1.5 rounded-lg shrink-0
                    ${status === 'idle' ? 'bg-slate-800 text-slate-600'
                      : status === 'active' ? `${bgColor[tab.color]} ${textColor[tab.color]}`
                      : status === 'done' ? 'bg-slate-800/60 text-slate-400'
                      : 'bg-red-500/10 text-red-400'}
                  `}>
                    {status === 'active' ? (
                      <motion.div
                        animate={{ rotate: [0, 5, -5, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                      >
                        <Icon className="w-4 h-4" />
                      </motion.div>
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                    {/* Status overlay icon */}
                    {status === 'done' && (
                      <CheckCircle2 className="absolute -top-1 -right-1 w-3 h-3 text-emerald-400" />
                    )}
                    {status === 'error' && (
                      <XCircle className="absolute -top-1 -right-1 w-3 h-3 text-red-400" />
                    )}
                  </div>

                  {/* Label area */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-semibold ${
                        status === 'idle' ? 'text-slate-600'
                        : status === 'active' ? textColor[tab.color]
                        : status === 'done' ? 'text-slate-300'
                        : 'text-red-400'
                      }`}>
                        {tab.label}
                      </span>
                      {status === 'active' && (
                        <motion.div
                          className={`w-1.5 h-1.5 rounded-full ${textColor[tab.color].replace('text-', 'bg-')}`}
                          animate={{ opacity: [1, 0, 1] }}
                          transition={{ duration: 0.8, repeat: Infinity }}
                        />
                      )}
                    </div>
                    <div className="text-[9px] text-slate-600 truncate">{tab.sublabel}</div>
                  </div>
                </div>

                {/* Active tab bottom bar */}
                {isActive && (
                  <motion.div
                    layoutId="pipelineActiveTab"
                    className="absolute -bottom-px left-3 right-3 h-0.5 rounded-full"
                    style={{
                      background: status === 'idle' ? '#475569' : tab.ring,
                    }}
                  />
                )}
              </motion.button>

              {/* Arrow connector */}
              {!isLast && (
                <div className="flex items-center mx-1.5 shrink-0">
                  <motion.div
                    className="w-5 h-px"
                    style={{
                      background: status === 'done' ? tab.ring : '#334155',
                    }}
                    animate={status === 'done' ? { opacity: [0.5, 1, 0.5] } : {}}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  <motion.div
                    className="w-0 h-0"
                    style={{
                      borderTop: '3px solid transparent',
                      borderBottom: '3px solid transparent',
                      borderLeft: `5px solid ${status === 'done' ? tab.ring : '#334155'}`,
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pipeline status bar */}
      {pipelineRunning && (
        <div className="mt-2 px-4 py-2 rounded-lg bg-slate-800/50 border border-slate-700/30 flex items-center gap-3">
          {pendingDecision ? (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs text-amber-400 font-medium">Decision Required</span>
              <span className="text-xs text-slate-500">— check Validator tab</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              <span className="text-xs text-slate-400">{latestMessage || 'Pipeline running...'}</span>
            </>
          )}
          {/* Progress dots */}
          <div className="ml-auto flex items-center gap-1">
            {TABS.map((tab) => (
              <span
                key={tab.key}
                className={`w-1.5 h-1.5 rounded-full ${
                  phaseStatuses[tab.key] === 'done' ? 'bg-emerald-400' :
                  phaseStatuses[tab.key] === 'active' ? 'bg-purple-400 animate-pulse' :
                  phaseStatuses[tab.key] === 'error' ? 'bg-red-400' :
                  'bg-slate-600'
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
