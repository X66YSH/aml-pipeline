/**
 * PRACard — Perceive-Reason-Act display card.
 *
 * Unified component for displaying each agent's reasoning process.
 * Used by all 6 pipeline tabs for consistent traceability.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Brain, Zap, ChevronDown } from 'lucide-react';

// Known column names for highlighting
const KNOWN_COLUMNS = new Set([
  'transaction_id', 'customer_id', 'amount_cad', 'debit_credit', 'transaction_datetime',
  'merchant_category', 'ecommerce_ind', 'country', 'province', 'city',
  'cash_indicator', 'channel', 'birth_date', 'gender', 'marital_status',
  'occupation_code', 'income', 'onboard_date',
]);

/** Split text into highlighted React nodes */
function highlightTerms(text: string): React.ReactNode[] {
  // Pattern: numbers ($X,XXX or plain), quoted strings, known columns / snake_case identifiers
  const pattern = /(\$\d[\d,]*\.?\d*|\b\d[\d,]*\.?\d*%?)|("[^"]+"|'[^']+')|(\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const [full, num, quoted, snake] = match;
    if (num) {
      parts.push(<span key={match.index} className="text-cyan-400 font-mono font-medium">{full}</span>);
    } else if (quoted) {
      parts.push(<span key={match.index} className="italic text-slate-300">{full}</span>);
    } else if (snake) {
      const isColumn = KNOWN_COLUMNS.has(snake);
      parts.push(
        <code key={match.index} className={`text-xs px-1 py-0.5 rounded ${isColumn ? 'bg-teal-500/10 text-teal-400' : 'bg-slate-700/50 text-purple-300'}`}>
          {snake}
        </code>
      );
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : [text];
}

/** Render text as structured bullet points with highlighted terms */
function StructuredText({ text, type }: { text: string; type: 'perceive' | 'reason' }) {
  if (!text) return null;
  // Split on sentence boundaries (. followed by space/uppercase) or explicit newlines
  const sentences = text
    .split(/(?:\.\s+(?=[A-Z])|\n+)/)
    .map(s => s.trim().replace(/\.$/, ''))
    .filter(s => s.length > 0);

  const color = type === 'perceive' ? 'text-slate-500' : 'text-sky-600';

  return (
    <div className="space-y-1.5">
      {sentences.map((sentence, i) => (
        <div key={i} className="flex items-start gap-2 text-sm leading-relaxed">
          <span className={`${color} mt-1 flex-shrink-0`}>→</span>
          <span className={type === 'perceive' ? 'text-slate-300' : 'text-sky-200'}>
            {highlightTerms(sentence + '.')}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface PRAData {
  perceive: string;
  reason: string;
}

interface PRACardProps {
  pra: PRAData | null;
  actContent?: React.ReactNode;
  agentName: string;
  isActive?: boolean;
}

export default function PRACard({ pra, actContent, agentName, isActive }: PRACardProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['perceive', 'reason', 'act']));

  const toggle = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  if (!pra && !actContent) {
    return (
      <div className="rounded-xl border border-slate-700/30 bg-slate-800/20 p-6 text-center">
        <div className="text-slate-500 text-sm">
          {isActive ? (
            <span className="inline-flex items-center gap-2">
              <motion.span
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="inline-block w-2 h-2 rounded-full bg-purple-400"
              />
              {agentName} is working...
            </span>
          ) : (
            `Waiting for ${agentName}...`
          )}
        </div>
      </div>
    );
  }

  const sections = [
    {
      key: 'perceive',
      icon: Eye,
      label: 'Perceive',
      sublabel: 'What I observed',
      content: pra?.perceive,
      color: 'slate',
      borderColor: 'border-slate-600/30',
      bgColor: 'bg-slate-800/30',
      textColor: 'text-slate-300',
      iconColor: 'text-slate-400',
    },
    {
      key: 'reason',
      icon: Brain,
      label: 'Reason',
      sublabel: 'My analysis',
      content: pra?.reason,
      color: 'sky',
      borderColor: 'border-sky-500/20',
      bgColor: 'bg-sky-500/5',
      textColor: 'text-sky-200',
      iconColor: 'text-sky-400',
    },
    {
      key: 'act',
      icon: Zap,
      label: 'Act',
      sublabel: 'What I produced',
      content: null, // Act uses actContent prop
      color: 'emerald',
      borderColor: 'border-emerald-500/20',
      bgColor: 'bg-emerald-500/5',
      textColor: 'text-emerald-200',
      iconColor: 'text-emerald-400',
    },
  ];

  return (
    <div className="space-y-2">
      {sections.map((section) => {
        const hasContent = section.key === 'act' ? !!actContent : !!section.content;
        if (!hasContent) return null;

        const isExpanded = expandedSections.has(section.key);
        const Icon = section.icon;

        return (
          <div
            key={section.key}
            className={`rounded-lg border ${section.borderColor} ${section.bgColor} overflow-hidden`}
          >
            {/* Section header */}
            <button
              onClick={() => toggle(section.key)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-white/5 transition-colors"
            >
              <Icon size={14} className={section.iconColor} />
              <span className={`text-xs font-semibold uppercase tracking-wider ${section.iconColor}`}>
                {section.label}
              </span>
              <span className="text-[10px] text-slate-500 ml-1">{section.sublabel}</span>
              <ChevronDown
                size={12}
                className={`ml-auto text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Section content */}
            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-3">
                    {section.key === 'act' ? (
                      actContent
                    ) : (
                      <StructuredText text={section.content || ''} type={section.key as 'perceive' | 'reason'} />
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
