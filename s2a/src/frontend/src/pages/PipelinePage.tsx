import { useState, useCallback, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Loader2,
  Bot,
  User,
  Code2,
  CheckCircle2,
  XCircle,
  BarChart3,
  FileText,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FlaskConical,
  X,
  AlertCircle,
  TrendingUp,
  Cpu,
  GitBranch,
  Layers,
  Zap,
} from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism-tomorrow.css';
import { compileStream, postJSON, createFeature, updateFeature } from '../api/client';
import { useSettings } from '../hooks/useSettings';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  Legend,
  CartesianGrid,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
} from 'recharts';
import SchemaViewer from '../components/s2f/SchemaViewer';
import AgentMonitor from '../components/s2f/AgentMonitor';

// ─── Types ──────────────────────────────────────────────────────────────────
interface TraceEvent {
  timestamp: number;
  level: string;
  agent: string;
  message: string;
}

interface Parameter {
  name: string;
  ambiguous_term: string;
  dtype: string;
  default: number;
  valid_range: [number, number] | null;
  unit: string | null;
  rationale: string;
  regulatory_basis: string;
}

interface Stage {
  stage: string;
  label: string;
  passed: boolean;
  error?: string;
}

interface ExecResult {
  success: boolean;
  stats: { n_accounts: number; nonzero_pct: number; mean: number; std: number; min: number; max: number };
  histogram: { counts: number[]; bin_labels: string[] };
  error?: { message: string };
}

interface SessionFeature {
  id: string;
  name: string;
  code: string;
  generatedAt: Date;
}

interface ModelResult {
  key: string;
  name: string;
  mode: string;
  auc_roc?: number;
  precision_at_k?: number;
  recall_at_k?: number;
  k?: number;
  roc_curve?: { fpr: number; tpr: number }[];
  error?: string;
}

interface DetectResponse {
  success: boolean;
  n_accounts?: number;
  n_positive?: number;
  n_features?: number;
  feature_names?: string[];
  models?: ModelResult[];
  feature_errors?: { name: string; error: string }[];
  error?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  type: 'text' | 'code' | 'validation' | 'stats' | 'trace' | 'indicator' | 'parameters';
  content: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

const MODEL_OPTIONS = [
  { key: 'isolation_forest', label: 'Isolation Forest', description: 'Unsupervised anomaly detection', icon: Layers, color: 'purple' },
  { key: 'logistic_regression', label: 'Logistic Regression', description: 'Linear probabilistic classifier', icon: TrendingUp, color: 'sky' },
  { key: 'random_forest', label: 'Random Forest', description: 'Ensemble of decision trees', icon: GitBranch, color: 'emerald' },
  { key: 'gradient_boosting', label: 'Gradient Boosting', description: 'Sequential boosting ensemble', icon: Zap, color: 'amber' },
];

const MODEL_COLORS: Record<string, string> = {
  isolation_forest: '#a78bfa',
  logistic_regression: '#38bdf8',
  random_forest: '#34d399',
  gradient_boosting: '#fbbf24',
};

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function PipelinePage() {
  const location = useLocation();
  const state = location.state as { regulatoryText?: string; source?: string } | null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState(state?.regulatoryText || '');
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['eft']);
  const [isCompiling, setIsCompiling] = useState(false);
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [currentCode, setCurrentCode] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sessionFeatures, setSessionFeatures] = useState<SessionFeature[]>([]);
  const [showDetectionLab, setShowDetectionLab] = useState(false);
  const [agentTraceEvents, setAgentTraceEvents] = useState<TraceEvent[]>([]);
  const { settings } = useSettings();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (state?.regulatoryText && messages.length === 0) {
      setInputText(state.regulatoryText);
    }
  }, [state]);

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const newMsg = { ...msg, id: crypto.randomUUID(), timestamp: new Date() };
    setMessages(prev => [...prev, newMsg]);
    return newMsg.id;
  }, []);

  const handleSubmit = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isCompiling || selectedChannels.length === 0) return;

    // Client-side length guard
    if (text.length < 80) {
      addMessage({
        role: 'assistant',
        type: 'text',
        content: 'Please provide at least 80 characters of regulatory text describing AML indicators or financial crime patterns.',
      });
      return;
    }

    const regText = text.slice(0, 5000);
    setIsCompiling(true);
    setAgentTraceEvents([]); // reset monitor for new run

    addMessage({ role: 'user', type: 'text', content: regText });
    setInputText('');

    const traceId = addMessage({
      role: 'assistant',
      type: 'trace',
      content: 'Starting compilation pipeline...',
      data: { events: [] },
    });

    try {
      let codeGenerated = '';
      let indicatorData: Record<string, unknown> | null = null;
      let indicatorName = '';

      await compileStream(
        {
          regulatory_text: regText,
          channels: selectedChannels,
          model: settings.model,
          temperature: parseFloat(settings.temperature),
          max_corrections: parseInt(settings.max_corrections),
        },
        (evt) => {
          if (evt.event === 'trace') {
            const t = evt.data as unknown as TraceEvent;
            setAgentTraceEvents(prev => [...prev, t]);
            setMessages(prev => prev.map(m => {
              if (m.id === traceId) {
                const events = (m.data?.events as TraceEvent[]) || [];
                return { ...m, content: t.message, data: { events: [...events, t] } };
              }
              return m;
            }));
          } else if (evt.event === 'perceive') {
            indicatorData = evt.data;
            const d = evt.data as { indicator: { category: string; description: string }; parameters: Parameter[] };
            indicatorName = d.indicator.category || 'feature';
            addMessage({
              role: 'assistant',
              type: 'indicator',
              content: d.indicator.description,
              data: { indicator: d.indicator, parameters: d.parameters },
            });
          } else if (evt.event === 'code') {
            const d = evt.data as { code: string; iteration: number };
            codeGenerated = d.code;
            setCurrentCode(d.code);
          }
        },
      );

      if (codeGenerated) {
        addMessage({
          role: 'assistant',
          type: 'code',
          content: codeGenerated,
          data: indicatorData || undefined,
        });

        // Accumulate in session features
        const featureNum = sessionFeatures.length + 1;
        const safeName = indicatorName
          ? indicatorName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)
          : `feature_${featureNum}`;

        // Persist to DB (fire-and-forget — don't block the UI)
        const description = (indicatorData as { indicator?: { description?: string } } | undefined)
          ?.indicator?.description ?? '';
        createFeature({
          name: safeName,
          code: codeGenerated,
          description,
          channels: selectedChannels,
          status: 'draft',
        }).then(saved => {
          setSessionFeatures(prev => [
            ...prev,
            { id: saved.id, name: saved.name, code: saved.code, generatedAt: new Date() },
          ]);
        }).catch(() => {
          // fallback: still add with local ID if DB save fails
          setSessionFeatures(prev => [
            ...prev,
            { id: crypto.randomUUID(), name: safeName, code: codeGenerated, generatedAt: new Date() },
          ]);
        });
      }
    } catch (e) {
      addMessage({
        role: 'assistant',
        type: 'text',
        content: `Compilation failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    } finally {
      setIsCompiling(false);
    }
  }, [inputText, selectedChannels, isCompiling, addMessage, sessionFeatures.length]);

  const handleValidate = useCallback(async () => {
    if (!currentCode) return;
    addMessage({ role: 'assistant', type: 'text', content: 'Running 6-stage validation...' });
    try {
      const res = await postJSON<{ stages: Stage[] }>('/validate', {
        code: currentCode,
        channels: selectedChannels,
        sample_rows: parseInt(settings.sample_rows),
      });
      const allPassed = res.stages.every(s => s.passed);
      addMessage({
        role: 'assistant',
        type: 'validation',
        content: allPassed ? 'All validation stages passed' : 'Some validation stages failed',
        data: { stages: res.stages },
      });

      // Update DB status to validated/failed for the most recent session feature
      const lastFeature = sessionFeatures[sessionFeatures.length - 1];
      if (lastFeature?.id) {
        updateFeature(lastFeature.id, { status: allPassed ? 'validated' : 'failed' }).catch(() => {});
      }
    } catch (e) {
      addMessage({ role: 'assistant', type: 'text', content: `Validation failed: ${e instanceof Error ? e.message : 'Unknown error'}` });
    }
  }, [currentCode, selectedChannels, addMessage, sessionFeatures]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="h-full flex flex-col relative">
      {/* Chat area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
            {messages.map(msg => (
              <MessageBubble key={msg.id} message={msg} onCopy={handleCopy} copiedId={copiedId} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Action bar */}
      {/* Agent Monitor — shown during and after compilation */}
      {(isCompiling || agentTraceEvents.length > 0) && (
        <div className="border-t border-slate-800/40 bg-slate-950/60 pt-3 pb-1">
          <AgentMonitor traceEvents={agentTraceEvents} isRunning={isCompiling} />
        </div>
      )}

      {currentCode && !isCompiling && (
        <div className="border-t border-slate-800/60 bg-slate-900/40 px-4 py-2">
          <div className="max-w-4xl mx-auto flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 mr-1">Actions:</span>
            <button
              onClick={handleValidate}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30
                text-emerald-300 text-xs rounded-lg border border-emerald-600/30 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Validate
            </button>
            <button
              onClick={() => setShowDetectionLab(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30
                text-purple-300 text-xs rounded-lg border border-purple-600/30 transition-colors"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Detection Lab
              {sessionFeatures.length > 0 && (
                <span className="ml-1 bg-purple-700/60 text-purple-200 text-[9px] px-1.5 py-0.5 rounded-full">
                  {sessionFeatures.length}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                const blob = new Blob([currentCode], { type: 'text/x-python' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'compute_feature.py';
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600/20 hover:bg-slate-600/30
                text-slate-300 text-xs rounded-lg border border-slate-600/30 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-slate-800/60 bg-[var(--color-bg)] px-4 py-4">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => setShowChannelPicker(!showChannelPicker)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-300 mb-2 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Channels: {selectedChannels.length} selected
            {showChannelPicker ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          <AnimatePresence>
            {showChannelPicker && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden mb-3"
              >
                <SchemaViewer selectedChannels={selectedChannels} onChannelsChange={setSelectedChannels} />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Paste regulatory text or describe AML indicators to detect..."
                rows={Math.min(inputText.split('\n').length, 6)}
                className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3 text-sm
                  text-slate-200 placeholder-slate-500 resize-none focus:outline-none
                  focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50 leading-relaxed
                  min-h-[48px] max-h-[200px]"
              />
            </div>
            <button
              onClick={handleSubmit}
              disabled={isCompiling || !inputText.trim() || selectedChannels.length === 0}
              className="w-10 h-10 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500
                text-white rounded-xl flex items-center justify-center transition-colors shrink-0"
            >
              {isCompiling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[10px] text-slate-600 mt-2 text-center">
            Enter to send · Shift+Enter for new line · Requires regulatory text ≥ 80 characters
          </p>
        </div>
      </div>

      {/* Detection Lab Modal */}
      <AnimatePresence>
        {showDetectionLab && (
          <DetectionLabModal
            features={sessionFeatures}
            channels={selectedChannels}
            onClose={() => setShowDetectionLab(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Detection Lab Modal ─────────────────────────────────────────────────────
function DetectionLabModal({
  features,
  channels,
  onClose,
}: {
  features: SessionFeature[];
  channels: string[];
  onClose: () => void;
}) {
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(
    new Set(features.map(f => f.id)),
  );
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    new Set(['isolation_forest', 'logistic_regression', 'random_forest', 'gradient_boosting']),
  );
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<DetectResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'setup' | 'results'>('setup');

  const toggleFeature = (id: string) => {
    setSelectedFeatures(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleModel = (key: string) => {
    setSelectedModels(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleRun = async () => {
    const featsToRun = features.filter(f => selectedFeatures.has(f.id));
    if (featsToRun.length === 0 || selectedModels.size === 0) return;

    setIsRunning(true);
    setResults(null);

    try {
      const res = await postJSON<DetectResponse>('/detect', {
        features: featsToRun.map(f => ({ name: f.name, code: f.code })),
        channels,
        models: Array.from(selectedModels),
        max_rows: 100000,
      });
      setResults(res);
      setActiveTab('results');
    } catch (e) {
      setResults({ success: false, error: e instanceof Error ? e.message : 'Unknown error' });
      setActiveTab('results');
    } finally {
      setIsRunning(false);
    }
  };

  const bestModel = results?.models
    ?.filter(m => m.auc_roc !== undefined)
    .sort((a, b) => (b.auc_roc || 0) - (a.auc_roc || 0))[0];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="w-full max-w-4xl max-h-[90vh] bg-[var(--color-bg-code)] border border-slate-700/60 rounded-2xl
          shadow-2xl flex flex-col overflow-hidden mx-4"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
              <FlaskConical className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Detection Lab</h2>
              <p className="text-[10px] text-slate-500">Compare ML models on generated features</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Tabs */}
            <div className="flex bg-slate-800/60 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setActiveTab('setup')}
                className={`px-3 py-1 rounded-md transition-colors ${
                  activeTab === 'setup'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                Setup
              </button>
              <button
                onClick={() => setActiveTab('results')}
                disabled={!results}
                className={`px-3 py-1 rounded-md transition-colors disabled:opacity-40 ${
                  activeTab === 'results'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                Results
                {results?.success && (
                  <span className="ml-1 text-emerald-400">✓</span>
                )}
              </button>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Setup Tab */}
        {activeTab === 'setup' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Feature selection */}
            <div>
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Code2 className="w-3.5 h-3.5 text-purple-400" />
                Features ({selectedFeatures.size}/{features.length} selected)
              </h3>
              {features.length === 0 ? (
                <div className="flex items-center gap-2 text-slate-500 text-sm bg-slate-800/30 rounded-xl p-4">
                  <AlertCircle className="w-4 h-4" />
                  No features generated yet. Compile some regulatory text first.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {features.map(f => (
                    <label
                      key={f.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        selectedFeatures.has(f.id)
                          ? 'bg-purple-500/10 border-purple-500/30 text-slate-200'
                          : 'bg-slate-800/30 border-slate-700/40 text-slate-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFeatures.has(f.id)}
                        onChange={() => toggleFeature(f.id)}
                        className="accent-purple-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono font-medium truncate">{f.name}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Generated {f.generatedAt.toLocaleTimeString()}
                        </div>
                      </div>
                      <span className="text-[10px] bg-slate-700/60 text-slate-400 px-1.5 py-0.5 rounded">
                        {f.code.split('\n').length} lines
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Model selection */}
            <div>
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-sky-400" />
                Models ({selectedModels.size} selected)
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {MODEL_OPTIONS.map(model => {
                  const Icon = model.icon;
                  const selected = selectedModels.has(model.key);
                  const colorMap: Record<string, string> = {
                    purple: selected ? 'bg-purple-500/10 border-purple-500/30' : 'bg-slate-800/30 border-slate-700/40',
                    sky: selected ? 'bg-sky-500/10 border-sky-500/30' : 'bg-slate-800/30 border-slate-700/40',
                    emerald: selected ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-800/30 border-slate-700/40',
                    amber: selected ? 'bg-amber-500/10 border-amber-500/30' : 'bg-slate-800/30 border-slate-700/40',
                  };
                  const iconColorMap: Record<string, string> = {
                    purple: 'text-purple-400',
                    sky: 'text-sky-400',
                    emerald: 'text-emerald-400',
                    amber: 'text-amber-400',
                  };
                  return (
                    <label
                      key={model.key}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                        colorMap[model.color]
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleModel(model.key)}
                        className="mt-0.5 accent-purple-500"
                      />
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        selected ? 'bg-slate-800/80' : 'bg-slate-800/40'
                      }`}>
                        <Icon className={`w-3.5 h-3.5 ${iconColorMap[model.color]}`} />
                      </div>
                      <div>
                        <div className={`text-xs font-medium ${selected ? 'text-slate-200' : 'text-slate-400'}`}>
                          {model.label}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{model.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Run button */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleRun}
                disabled={isRunning || selectedFeatures.size === 0 || selectedModels.size === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-500
                  disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm rounded-xl
                  transition-colors font-medium"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Running models...
                  </>
                ) : (
                  <>
                    <FlaskConical className="w-4 h-4" />
                    Run Detection
                  </>
                )}
              </button>
              <p className="text-[10px] text-slate-500">
                {selectedFeatures.size} feature{selectedFeatures.size !== 1 ? 's' : ''} × {selectedModels.size} model{selectedModels.size !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        )}

        {/* Results Tab */}
        {activeTab === 'results' && results && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {!results.success ? (
              <div className="flex items-start gap-3 bg-red-900/20 border border-red-700/30 rounded-xl p-4">
                <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-red-300 font-medium">Detection failed</p>
                  <p className="text-xs text-red-400/80 mt-1">{results.error}</p>
                </div>
              </div>
            ) : (
              <>
                {/* Summary bar */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Accounts', value: results.n_accounts?.toLocaleString() || '—' },
                    { label: 'Suspicious', value: results.n_positive?.toString() || '—' },
                    { label: 'Features', value: results.n_features?.toString() || '—' },
                    { label: 'Best AUC', value: bestModel ? bestModel.auc_roc?.toFixed(4) : '—' },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-800/40 rounded-xl p-3 text-center border border-slate-700/40">
                      <div className="text-[10px] text-slate-500 mb-1">{s.label}</div>
                      <div className="text-sm font-mono font-semibold text-slate-200">{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Model comparison table */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
                    Model Comparison
                  </h3>
                  <div className="bg-slate-800/30 rounded-xl border border-slate-700/40 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-700/40 bg-slate-800/40">
                          <th className="text-left px-4 py-2.5 text-slate-400 font-medium">Model</th>
                          <th className="text-left px-4 py-2.5 text-slate-400 font-medium">Type</th>
                          <th className="text-right px-4 py-2.5 text-slate-400 font-medium">AUC-ROC</th>
                          <th className="text-right px-4 py-2.5 text-slate-400 font-medium">Precision@K</th>
                          <th className="text-right px-4 py-2.5 text-slate-400 font-medium">Recall@K</th>
                          <th className="text-center px-4 py-2.5 text-slate-400 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.models?.map(m => {
                          const isBest = m.key === bestModel?.key;
                          return (
                            <tr
                              key={m.key}
                              className={`border-b border-slate-700/20 transition-colors ${
                                isBest ? 'bg-purple-500/5' : 'hover:bg-slate-800/20'
                              }`}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-2 h-2 rounded-full"
                                    style={{ background: MODEL_COLORS[m.key] || '#94a3b8' }}
                                  />
                                  <span className={isBest ? 'text-white font-medium' : 'text-slate-300'}>
                                    {m.name}
                                  </span>
                                  {isBest && (
                                    <span className="text-[9px] bg-purple-700/50 text-purple-300 px-1.5 py-0.5 rounded-full border border-purple-600/30">
                                      BEST
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  m.mode === 'unsupervised'
                                    ? 'bg-amber-900/30 text-amber-400 border border-amber-700/30'
                                    : 'bg-sky-900/30 text-sky-400 border border-sky-700/30'
                                }`}>
                                  {m.mode}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono">
                                {m.error ? (
                                  <span className="text-red-400">—</span>
                                ) : (
                                  <AucBar value={m.auc_roc || 0} color={MODEL_COLORS[m.key]} />
                                )}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-slate-300">
                                {m.error ? '—' : `${((m.precision_at_k || 0) * 100).toFixed(1)}%`}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-slate-300">
                                {m.error ? '—' : `${((m.recall_at_k || 0) * 100).toFixed(1)}%`}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {m.error ? (
                                  <span className="text-[10px] bg-red-900/30 text-red-400 border border-red-700/30 px-1.5 py-0.5 rounded">
                                    Error
                                  </span>
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mx-auto" />
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* AUC bar chart */}
                {results.models && results.models.some(m => m.auc_roc !== undefined) && (
                  <div>
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
                      AUC-ROC Comparison
                    </h3>
                    <div className="bg-slate-800/30 rounded-xl border border-slate-700/40 p-4">
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={results.models
                              .filter(m => m.auc_roc !== undefined)
                              .map(m => ({ name: m.name, auc: m.auc_roc, fill: MODEL_COLORS[m.key] }))}
                            margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                            <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                            <Tooltip
                              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 10 }}
                              formatter={(v: number) => [v.toFixed(4), 'AUC-ROC']}
                            />
                            <Bar dataKey="auc" radius={[4, 4, 0, 0]}>
                              {results.models
                                .filter(m => m.auc_roc !== undefined)
                                .map(m => (
                                  <Cell key={m.key} fill={MODEL_COLORS[m.key] || '#94a3b8'} fillOpacity={0.85} />
                                ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {/* ROC curves */}
                {results.models && results.models.some(m => m.roc_curve && m.roc_curve.length > 0) && (
                  <div>
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
                      ROC Curves
                    </h3>
                    <div className="bg-slate-800/30 rounded-xl border border-slate-700/40 p-4">
                      <div className="h-52">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart margin={{ top: 4, right: 8, bottom: 16, left: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis
                              dataKey="fpr"
                              type="number"
                              domain={[0, 1]}
                              tick={{ fontSize: 9, fill: '#64748b' }}
                              label={{ value: 'FPR', position: 'bottom', fontSize: 10, fill: '#64748b' }}
                            />
                            <YAxis
                              domain={[0, 1]}
                              tick={{ fontSize: 9, fill: '#64748b' }}
                              label={{ value: 'TPR', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#64748b' }}
                            />
                            <Tooltip
                              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 10 }}
                            />
                            <Legend iconType="line" wrapperStyle={{ fontSize: 10 }} />
                            {results.models
                              .filter(m => m.roc_curve && m.roc_curve.length > 0)
                              .map(m => (
                                <Line
                                  key={m.key}
                                  data={m.roc_curve}
                                  dataKey="tpr"
                                  name={m.name}
                                  stroke={MODEL_COLORS[m.key] || '#94a3b8'}
                                  strokeWidth={2}
                                  dot={false}
                                />
                              ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {/* Radar chart: multi-metric comparison */}
                {results.models && results.models.filter(m => !m.error).length > 1 && (
                  <div>
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
                      Multi-Metric Radar
                    </h3>
                    <div className="bg-slate-800/30 rounded-xl border border-slate-700/40 p-4">
                      <div className="h-52">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart
                            data={[
                              { metric: 'AUC-ROC', ...Object.fromEntries(results.models.filter(m => !m.error).map(m => [m.key, m.auc_roc || 0])) },
                              { metric: 'Precision@K', ...Object.fromEntries(results.models.filter(m => !m.error).map(m => [m.key, m.precision_at_k || 0])) },
                              { metric: 'Recall@K', ...Object.fromEntries(results.models.filter(m => !m.error).map(m => [m.key, m.recall_at_k || 0])) },
                            ]}
                          >
                            <PolarGrid stroke="#1e293b" />
                            <PolarAngleAxis dataKey="metric" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                            {results.models.filter(m => !m.error).map(m => (
                              <Radar
                                key={m.key}
                                name={m.name}
                                dataKey={m.key}
                                stroke={MODEL_COLORS[m.key]}
                                fill={MODEL_COLORS[m.key]}
                                fillOpacity={0.15}
                              />
                            ))}
                            <Legend iconType="line" wrapperStyle={{ fontSize: 10 }} />
                            <Tooltip
                              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 10 }}
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {/* Feature errors */}
                {results.feature_errors && results.feature_errors.length > 0 && (
                  <div className="bg-amber-900/10 border border-amber-700/20 rounded-xl p-4">
                    <p className="text-xs text-amber-400 font-medium mb-2 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Feature execution warnings
                    </p>
                    {results.feature_errors.map((fe, i) => (
                      <p key={i} className="text-[10px] text-amber-500/80 font-mono">
                        {fe.name}: {fe.error}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// Small inline AUC bar
function AucBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="w-20 h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${value * 100}%`, background: color }}
        />
      </div>
      <span className="text-slate-200 w-12 text-right">{value.toFixed(4)}</span>
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20
          border border-purple-500/20 flex items-center justify-center mx-auto mb-4">
          <Bot className="w-7 h-7 text-purple-400" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">S2F Compilation Pipeline</h2>
        <p className="text-sm text-slate-400 mb-6">
          Paste regulatory text and select transaction channels.
          The multi-agent pipeline extracts indicators and generates executable feature code.
          Use <span className="text-purple-400 font-medium">Detection Lab</span> to compare ML models.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {['Structuring', 'Layering', 'Velocity Anomaly', 'Geographic Risk'].map(tag => (
            <span key={tag} className="px-2.5 py-1 bg-slate-800/60 border border-slate-700/50 rounded-lg text-xs text-slate-400">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function MessageBubble({
  message,
  onCopy,
  copiedId,
}: {
  message: ChatMessage;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (message.type === 'code' && codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [message.content, message.type]);

  if (message.role === 'user') {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 justify-end">
        <div className="max-w-[80%] bg-purple-600/20 border border-purple-500/20 rounded-2xl rounded-tr-md px-4 py-3">
          <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed line-clamp-6">
            {message.content.slice(0, 500)}
            {message.content.length > 500 && '...'}
          </p>
          {message.content.length > 500 && (
            <p className="text-[10px] text-purple-400 mt-1">{message.content.length.toLocaleString()} chars total</p>
          )}
        </div>
        <div className="w-8 h-8 rounded-lg bg-purple-600/20 flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-purple-400" />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
      <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="w-4 h-4 text-slate-400" />
      </div>
      <div className="flex-1 min-w-0">
        {message.type === 'text' && <p className="text-sm text-slate-300 py-2">{message.content}</p>}
        {message.type === 'trace' && <TraceCard message={message} expanded={expanded} onToggle={() => setExpanded(!expanded)} />}
        {message.type === 'indicator' && <IndicatorCard message={message} />}
        {message.type === 'code' && <CodeCard message={message} codeRef={codeRef} onCopy={onCopy} copiedId={copiedId} />}
        {message.type === 'validation' && <ValidationCard message={message} />}
        {message.type === 'stats' && <StatsCard message={message} />}
      </div>
    </motion.div>
  );
}

function TraceCard({ message, expanded, onToggle }: { message: ChatMessage; expanded: boolean; onToggle: () => void }) {
  const events = (message.data?.events as TraceEvent[]) || [];
  const LEVEL_COLORS: Record<string, string> = {
    agent: 'text-purple-400', tool: 'text-sky-400', success: 'text-emerald-400',
    error: 'text-red-400', info: 'text-slate-400',
  };
  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-slate-400 hover:text-slate-300">
        <span className="flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5" />
          Agent Trace ({events.length} events)
        </span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      <AnimatePresence>
        {expanded && events.length > 0 && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-4 pb-3 space-y-0.5 max-h-48 overflow-y-auto">
              {events.map((e, i) => (
                <div key={i} className={`text-[10px] font-mono flex gap-2 ${LEVEL_COLORS[e.level] || 'text-slate-400'}`}>
                  <span className="text-slate-600 w-10 shrink-0 text-right">{e.timestamp.toFixed(1)}s</span>
                  <span className="text-slate-500 w-24 shrink-0 truncate">{e.agent}</span>
                  <span className="truncate">{e.message}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function IndicatorCard({ message }: { message: ChatMessage }) {
  const indicator = message.data?.indicator as { category: string; description: string };
  const parameters = message.data?.parameters as Parameter[];
  return (
    <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] bg-purple-900/40 text-purple-300 border border-purple-700/50 px-2 py-0.5 rounded-md uppercase tracking-wider">
          {indicator?.category}
        </span>
        <span className="text-xs text-slate-300">{indicator?.description}</span>
      </div>
      {parameters && parameters.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {parameters.map(p => (
            <div key={p.name} className="bg-slate-800/40 rounded-lg px-3 py-2">
              <div className="text-[10px] text-slate-500 font-mono">{p.name}</div>
              <div className="text-xs text-sky-400 font-mono">
                {p.unit === 'USD' ? `$${p.default.toLocaleString()}` : `${p.default} ${p.unit || ''}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CodeCard({
  message, codeRef, onCopy, copiedId,
}: {
  message: ChatMessage;
  codeRef: React.RefObject<HTMLElement | null>;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
}) {
  return (
    <div className="bg-[var(--color-bg-code)] border border-slate-700/50 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800/50 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <Code2 className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-[11px] text-slate-400 font-mono">compute_feature.py</span>
        </div>
        <button
          onClick={() => onCopy(message.content, message.id)}
          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white bg-slate-700/50 hover:bg-slate-600 px-2 py-1 rounded transition-colors"
        >
          {copiedId === message.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copiedId === message.id ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="p-4 overflow-x-auto max-h-80 overflow-y-auto">
        <pre className="text-[11px] leading-relaxed !bg-transparent !m-0 !p-0">
          <code ref={codeRef} className="language-python">{message.content}</code>
        </pre>
      </div>
    </div>
  );
}

function ValidationCard({ message }: { message: ChatMessage }) {
  const stages = (message.data?.stages as Stage[]) || [];
  const allPassed = stages.every(s => s.passed);
  return (
    <div className={`border rounded-xl p-4 ${allPassed ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
      <div className="flex items-center gap-2 mb-3">
        {allPassed ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
        <span className={`text-sm font-medium ${allPassed ? 'text-emerald-300' : 'text-red-300'}`}>{message.content}</span>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {stages.map(s => (
          <div key={s.stage} className="text-center">
            <div className={`w-full aspect-square rounded-lg flex items-center justify-center text-lg ${
              s.passed ? 'bg-emerald-900/40 border border-emerald-700/50 text-emerald-400' : 'bg-red-900/40 border border-red-700/50 text-red-400'
            }`}>
              {s.passed ? '✓' : '✗'}
            </div>
            <div className="text-[8px] text-slate-500 mt-1 leading-tight">{s.label}</div>
          </div>
        ))}
      </div>
      {stages.some(s => !s.passed && s.error) && (
        <div className="mt-3 text-[10px] text-red-400 bg-red-900/20 rounded-lg p-2 font-mono">
          {stages.find(s => !s.passed)?.error}
        </div>
      )}
    </div>
  );
}

function StatsCard({ message }: { message: ChatMessage }) {
  const stats = message.data?.stats as ExecResult['stats'];
  const histogram = message.data?.histogram as ExecResult['histogram'];
  const chartData = histogram ? histogram.counts.map((count, i) => ({ bin: histogram.bin_labels[i], count })) : [];
  return (
    <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-sky-400" />
        <span className="text-sm font-medium text-sky-300">Feature Statistics</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Accounts', value: stats?.n_accounts?.toLocaleString() || '0' },
          { label: 'Nonzero %', value: `${stats?.nonzero_pct || 0}%` },
          { label: 'Mean', value: stats?.mean?.toFixed(3) || '0' },
          { label: 'Std', value: stats?.std?.toFixed(3) || '0' },
          { label: 'Min', value: stats?.min?.toFixed(2) || '0' },
          { label: 'Max', value: stats?.max?.toFixed(2) || '0' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900/60 rounded-lg px-3 py-2 text-center">
            <div className="text-[9px] text-slate-500">{s.label}</div>
            <div className="text-xs font-mono text-slate-200">{s.value}</div>
          </div>
        ))}
      </div>
      {chartData.length > 0 && (
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <XAxis dataKey="bin" hide />
              <YAxis hide />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 10 }} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {chartData.map((_, i) => <Cell key={i} fill={i === 0 ? '#38bdf8' : '#1e40af'} fillOpacity={0.7} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
