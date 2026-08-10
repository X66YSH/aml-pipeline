import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Layers, Plus, Trash2, X, Loader2,
  CheckCircle2, Code2, Copy, Check,
  Upload, Eye, Edit2, AlertCircle, FolderOpen, Database, Activity,
} from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism-tomorrow.css';
import {
  getProject, getProjectDashboard, listFeaturesByProject, createFeature, deleteFeature,
  uploadPDF, listAlerts, getAlertStats, updateAlertFeedback, explainAlert,
  pipelineStream,
  submitPipelineDecision,
  createBenchmarkFeatures,
  promoteFeature,
} from '../api/client';
import type {
  ProjectRecord, FeatureRecord, CompileSSEEvent,
  DetectResponse,
  AlertRecord, AlertStats, FeatureValidationResult,
  PerceiveData, ValidationData, SchemaAdaptData, TraceEvent,
  PRAData, PipelineDecisionRequired, IterationTrace,
  DashboardBundle, FeatureGateSummary,
} from '../api/client';
import { useSettings } from '../hooks/useSettings';
import CountUp from '../components/ui/CountUp';
import FeatureEditorModal from '../components/s2f/FeatureEditorModal';
import FeatureLibrary from '../components/pipeline/FeatureLibrary';
import PipelineTabBar from '../components/pipeline/PipelineTabBar';
import type { PipelineTab, PipelinePhase, PhaseStatus } from '../components/pipeline/PipelineTabBar';
import AnalystTab from '../components/pipeline/AnalystTab';
import AdapterTab from '../components/pipeline/AdapterTab';
import EngineerTab from '../components/pipeline/EngineerTab';
import ValidatorTab from '../components/pipeline/ValidatorTab';
import DetectionTab from '../components/pipeline/DetectionTab';
import RCCTab from '../components/pipeline/RCCTab';
import DashboardTab from '../components/pipeline/DashboardTab';

// ─── Helper: Status badge ────────────────────────────────────────────────────

function StatusBadge({ status }: { status: FeatureRecord['status'] }) {
  const colors = {
    draft: 'bg-slate-600/60 text-slate-300',
    validated: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    failed: 'bg-red-500/20 text-red-400 border border-red-500/30',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${colors[status]}`}>
      {status}
    </span>
  );
}

// ─── Code Modal ──────────────────────────────────────────────────────────────

function CodeModal({
  feature,
  onClose,
}: {
  feature: FeatureRecord;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [feature.code]);

  const handleCopy = () => {
    navigator.clipboard.writeText(feature.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <Code2 className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-semibold text-white">{feature.name}</span>
            <StatusBadge status={feature.status} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                         bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Code */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-xs leading-relaxed">
            <code ref={codeRef} className="language-python">
              {feature.code}
            </code>
          </pre>
        </div>
        {/* Footer info */}
        {feature.description && (
          <div className="px-5 py-3 border-t border-slate-700">
            <p className="text-xs text-slate-400">{feature.description}</p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { settings } = useSettings();
  const incomingText = (location.state as { regulatoryText?: string } | null)?.regulatoryText;

  // ── Project & features state ──────────────────────────────────────────────
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [features, setFeatures] = useState<FeatureRecord[]>([]);
  const [loadingProject, setLoadingProject] = useState(true);

  // ── Pipeline tab state ────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<PipelineTab>('analyst');
  const [pipelinePhase, setPipelinePhase] = useState<PipelinePhase>('idle');
  const [pipelineRunning, setPipelineRunning] = useState(false);
  // No auto-switch: pipeline progresses but user stays on current tab
  const [phaseStatuses, setPhaseStatuses] = useState<Record<PipelineTab, PhaseStatus>>({
    analyst: 'idle', adapter: 'idle', engineer: 'idle',
    validator: 'idle', detection: 'idle', rcc: 'idle', dashboard: 'idle',
  });
  const [agentMessages, setAgentMessages] = useState<{ from: string; to: string; message: string }[]>([]);

  // ── Feature Studio / pipeline data state ──────────────────────────────────
  const [inputText, setInputText] = useState(incomingText ?? '');
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [perceiveData, setPerceiveData] = useState<PerceiveData | null>(null);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [codeHistory, setCodeHistory] = useState<Map<number, string>>(new Map());
  const [validationData, setValidationData] = useState<ValidationData | null>(null);
  const [schemaAdaptData, setSchemaAdaptData] = useState<SchemaAdaptData | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['eft']);
  const [useMultiFeature, setUseMultiFeature] = useState(false);
  const [multiFeatureFallback, setMultiFeatureFallback] = useState<string | null>(null);
  const [featureEvalData, setFeatureEvalData] = useState<FeatureValidationResult | null>(null);
  const [allFeatureEvals, setAllFeatureEvals] = useState<
    { candidateIndex: number; featureName: string; evalData: any }[]
  >([]);
  const [featureGateSummary, setFeatureGateSummary] = useState<FeatureGateSummary | null>(null);
  const [detectResult, setDetectResult] = useState<DetectResponse | null>(null);
  const [pipelineSummary, setPipelineSummary] = useState<{
    alertCount: number; verifiedCount: number; featureName?: string;
    bestModel?: string; bestAuc?: number;
  } | null>(null);
  const [dashboardBundle, setDashboardBundle] = useState<DashboardBundle | null>(null);

  // ── Pipeline decision state ──────────────────────────────────────────
  const [pendingDecision, setPendingDecision] = useState<PipelineDecisionRequired | null>(null);
  const [iterationHistory, setIterationHistory] = useState<IterationTrace[]>([]);

  // ── Feature editor state ──────────────────────────────────────────────────
  const [viewCodeFeature, setViewCodeFeature] = useState<FeatureRecord | null>(null);
  const [showFeatureEditor, setShowFeatureEditor] = useState(false);
  const [editingFeature, setEditingFeature] = useState<FeatureRecord | null>(null);
  const [uploadingPDF, setUploadingPDF] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── PRA (Perceive-Reason-Act) state ──────────────────────────────────────
  const [analystPRA, setAnalystPRA] = useState<PRAData | null>(null);
  const [adapterPRA, setAdapterPRA] = useState<PRAData | null>(null);
  const [engineerPRA, setEngineerPRA] = useState<PRAData | null>(null);
  const [validatorPRA, setValidatorPRA] = useState<PRAData | null>(null);
  const [detectionPRA, setDetectionPRA] = useState<PRAData | null>(null);

  // ── Benchmark state ──────────────────────────────────────────────────────
  const [loadingBenchmarks, setLoadingBenchmarks] = useState(false);
  const [latestTraceMessage, setLatestTraceMessage] = useState('');

  // ── Alerts tab state ──────────────────────────────────────────────────────
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [alertStats, setAlertStats] = useState<AlertStats | null>(null);
  const [explainingAlertId, setExplainingAlertId] = useState<string | null>(null);

  // Collapse the hero + stats strip on scroll, keeping the tab bar pinned
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  useEffect(() => {
    const sc = document.querySelector('main');
    if (!sc) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // hysteresis so it doesn't flicker right at the threshold
        setHeaderCollapsed((prev) => (prev ? sc.scrollTop > 40 : sc.scrollTop > 88));
      });
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      sc.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // ── Load project & features ───────────────────────────────────────────────

  const loadFeatures = useCallback(async () => {
    if (!id) return;
    try {
      const f = await listFeaturesByProject(id);
      setFeatures(f);
    } catch (err) {
      console.error('Failed to load features', err);
    }
  }, [id]);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [p, f] = await Promise.all([getProject(id), listFeaturesByProject(id)]);
      setProject(p);
      setFeatures(f);
    } catch (err) {
      console.error('Failed to load project', err);
    } finally {
      setLoadingProject(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!id) return;
    getProjectDashboard(id).then(setDashboardBundle).catch(() => setDashboardBundle(null));
  }, [id]);

  // ── Load alerts ───────────────────────────────────────────────────────────

  const loadAlerts = useCallback(async () => {
    if (!id) return;
    try {
      const [alertList, stats] = await Promise.all([
        listAlerts({ project_id: id, sort: 'anomaly_score', order: 'desc', limit: 100 }),
        getAlertStats(id),
      ]);
      setAlerts(alertList);
      setAlertStats(stats);
    } catch (err) {
      console.error('Failed to load alerts', err);
    }
  }, [id]);

  useEffect(() => {
    if (activeTab === 'rcc') loadAlerts();
  }, [activeTab, loadAlerts]);

  // ── Alert feedback handler ────────────────────────────────────────────────

  const handleAlertFeedback = useCallback(async (alertId: string, feedback: 'true_positive' | 'false_positive') => {
    try {
      const updated = await updateAlertFeedback(alertId, feedback);
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? updated : a)));
      if (id) getAlertStats(id).then(setAlertStats);
    } catch (err) {
      console.error('Failed to update feedback', err);
    }
  }, [id]);

  // ── Alert verify handler (renamed from handleExplain) ─────────────────────

  const handleVerifyAlert = useCallback(async (alertId: string) => {
    setExplainingAlertId(alertId);
    try {
      const res = await explainAlert(alertId);
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, explanation: res.explanation } : a)));
    } catch (err: any) {
      console.error('Verify error:', err);
    } finally {
      setExplainingAlertId(null);
    }
  }, []);

  // ── Pipeline decision handler ──────────────────────────────────────────

  const handleDecision = useCallback(async (pipelineId: string, decision: string) => {
    setPendingDecision(null);
    try {
      await submitPipelineDecision(pipelineId, decision);
    } catch (err: any) {
      console.error('Decision error:', err);
    }
  }, []);

  // ── Pipeline jump-to-tab handler ──────────────────────────────────────

  const handleJumpToTab = useCallback((tab: string, _iteration: number) => {
    setActiveTab(tab as PipelineTab);
  }, []);

  // ── PDF upload handler ────────────────────────────────────────────────────

  const handlePDFUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPDF(true);
    try {
      const result = await uploadPDF(file);
      setInputText(result.text);
    } catch (err: unknown) {
      console.error('PDF upload failed', err);
    } finally {
      setUploadingPDF(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  // ── Benchmark handler ─────────────────────────────────────────────────────

  const handleLoadBenchmarks = useCallback(async () => {
    if (!id) return;
    setLoadingBenchmarks(true);
    try {
      await createBenchmarkFeatures(id);
      await loadFeatures();
    } catch (err: any) {
      console.error('Benchmark error:', err);
    } finally {
      setLoadingBenchmarks(false);
    }
  }, [id]);

  // ── Feature delete handler ────────────────────────────────────────────────

  const handleDeleteFeature = useCallback(async (featureId: string) => {
    try {
      await deleteFeature(featureId);
      setFeatures((prev) => prev.filter((f) => f.id !== featureId));
    } catch (err) {
      console.error('Delete failed', err);
    }
  }, []);

  // ── Feature promote handler ─────────────────────────────────────────────

  const handlePromoteFeature = useCallback(async (featureId: string) => {
    try {
      const updated = await promoteFeature(featureId);
      setFeatures(prev => prev.map(f => f.id === featureId ? updated : f));
    } catch (err) {
      console.error('Promote failed', err);
    }
  }, []);

  // ── Feature save handler (create / edit) ──────────────────────────────────

  const handleFeatureSaved = useCallback((saved: FeatureRecord) => {
    setFeatures((prev) => {
      const idx = prev.findIndex((f) => f.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
  }, []);

  // ── Pipeline run handler ──────────────────────────────────────────────────

  const handleRunPipeline = useCallback(async () => {
    if (!inputText.trim() || !id) return;

    // Reset all state
    setPipelineRunning(true);
    setPipelinePhase('analyst');
    // Pipeline starts on analyst tab
    setPhaseStatuses({
      analyst: 'active', adapter: 'idle', engineer: 'idle',
      validator: 'idle', detection: 'idle', rcc: 'idle', dashboard: 'idle',
    });
    setTraceEvents([]);
    setPerceiveData(null);
    setSchemaAdaptData(null);
    setGeneratedCode(null);
    setCodeHistory(new Map());
    setValidationData(null);
    setFeatureEvalData(null);
    setAllFeatureEvals([]);
    setFeatureGateSummary(null);
    setDetectResult(null);
    setAgentMessages([]);
    setPipelineSummary(null);
    setDashboardBundle(null);
    setPendingDecision(null);
    setIterationHistory([]);
    setAlerts([]);
    setAlertStats({ total: 0, pending: 0, truePositive: 0, falsePositive: 0, avgScore: 0 });
    setAnalystPRA(null);
    setAdapterPRA(null);
    setEngineerPRA(null);
    setValidatorPRA(null);
    setDetectionPRA(null);
    setMultiFeatureFallback(null);
    setActiveTab('analyst');

    try {
      await pipelineStream(
        {
          regulatory_text: inputText.slice(0, 5000),
          project_id: id,
          schema_key: project?.schemaKey || 'fintrac',
          model: settings.model || project?.llmModel || 'gpt-4o',
          temperature: project?.temperature ?? 0,
          max_corrections: project?.maxCorrections ?? 5,
          channels: useMultiFeature ? selectedChannels : undefined,
          multi_feature: useMultiFeature,
        },
        (evt: CompileSSEEvent) => {
          const eventType = evt.event;
          const data = evt.data;

          // Trace events
          if (eventType === 'trace') {
            setTraceEvents(prev => [...prev, data as unknown as TraceEvent]);
            setLatestTraceMessage((data as any).message || '');
          }
          // Top-level pipeline / OpenAI errors (SSE from backend exception handler)
          else if (eventType === 'error') {
            const msg = String((data as { message?: string })?.message || 'Pipeline error');
            setTraceEvents((prev) => {
              const lastT = prev.length ? prev[prev.length - 1].timestamp : 0;
              return [
                ...prev,
                {
                  timestamp: lastT + 0.01,
                  level: 'error',
                  agent: 'Pipeline',
                  message: msg,
                  data: (data || {}) as Record<string, unknown>,
                } as TraceEvent,
              ];
            });
            setLatestTraceMessage(msg);
            setPhaseStatuses((prev) => ({ ...prev, analyst: 'error' }));
          }
          // Phase changes -> update tab status + auto-switch
          else if (eventType === 'phase_change') {
            const { phase, status } = data as { phase: string; status: string };
            const phaseToTab: Record<string, PipelineTab> = {
              analyst: 'analyst', adapter: 'adapter', engineer: 'engineer',
              validator: 'validator', detection: 'detection', rcc: 'rcc',
              dashboard: 'dashboard',
            };
            const tab = phaseToTab[phase];
            if (tab) {
              if (status === 'starting' || status === 'active') {
                const TAB_ORDER: PipelineTab[] = ['analyst', 'adapter', 'engineer', 'validator', 'detection', 'rcc', 'dashboard'];
                setPipelinePhase(tab);
                setPhaseStatuses(prev => {
                  const next = { ...prev, [tab]: 'active' as PhaseStatus };
                  // Auto-mark all earlier tabs as done (if they were active)
                  const idx = TAB_ORDER.indexOf(tab);
                  for (let i = 0; i < idx; i++) {
                    if (next[TAB_ORDER[i]] === 'active') {
                      next[TAB_ORDER[i]] = 'done';
                    }
                  }
                  return next;
                });
                // No auto-switch — user stays on current tab
              } else if (status === 'done') {
                setPhaseStatuses(prev => ({ ...prev, [tab]: 'done' }));
              } else if (status === 'error') {
                setPhaseStatuses(prev => ({ ...prev, [tab]: 'error' }));
              } else if (status === 'retry') {
                // Loopback: reset tab to active (e.g., Engineer retry after decision)
                setPhaseStatuses(prev => ({ ...prev, [tab]: 'active' }));
              } else if (status === 'idle') {
                setPhaseStatuses(prev => ({ ...prev, [tab]: 'idle' }));
              }
            }
          }
          // Agent messages
          else if (eventType === 'agent_message') {
            setAgentMessages(prev => [...prev, data as { from: string; to: string; message: string }]);
          }
          // Perceive
          else if (eventType === 'perceive') {
            setPerceiveData(data as unknown as PerceiveData);
            if ((data as any).pra) setAnalystPRA((data as any).pra);
          }
          // Schema adapt
          else if (eventType === 'schema_adapt') {
            setSchemaAdaptData(data as unknown as SchemaAdaptData);
            if ((data as any).pra) setAdapterPRA((data as any).pra);
          }
          // Code
          else if (eventType === 'code') {
            const d = data as { code: string; iteration?: number };
            setGeneratedCode(d.code);
            setCodeHistory(prev => {
              const next = new Map(prev);
              next.set(d.iteration ?? 0, d.code);
              return next;
            });
            if ((data as any).pra && (d.iteration ?? 0) === 0) setEngineerPRA((data as any).pra);
          }
          // Validation
          else if (eventType === 'validation') {
            setValidationData(data as unknown as ValidationData);
            if ((data as any).pra) setValidatorPRA((data as any).pra);
          }
          // Feature evaluation
          else if (eventType === 'feature_eval') {
            const rawEval = data as any;
            // Multi-feature mode wraps the result under eval_result; single-feature sends it flat
            const evalData = rawEval.eval_result ?? rawEval;
            setFeatureEvalData(evalData as FeatureValidationResult);
            // Accumulate per-candidate results for the gate summary table
            if (rawEval.candidate_index != null) {
              setAllFeatureEvals(prev => [...prev, {
                candidateIndex: rawEval.candidate_index,
                featureName: rawEval.feature_name ?? '',
                evalData,
              }]);
            }
          }
          // Feature gate summary (multi-feature IV filter result)
          else if (eventType === 'feature_gate_summary') {
            setFeatureGateSummary(data as unknown as FeatureGateSummary);
          }
          // Detection result
          else if (eventType === 'detection_result') {
            setDetectResult(data as unknown as DetectResponse);
            if ((data as any).pra) setDetectionPRA((data as any).pra);
          }
          // Alert verified
          else if (eventType === 'alert_verified') {
            // Will be loaded from DB when RCC tab mounts
          }
          // Decision required (human-in-the-loop)
          else if (eventType === 'decision_required') {
            setPendingDecision(data as unknown as PipelineDecisionRequired);
            setActiveTab('validator');
          }
          // Iteration trace
          else if (eventType === 'iteration_trace') {
            setIterationHistory(prev => [...prev, data as IterationTrace]);
          }
          else if (eventType === 'fallback_notice') {
            setMultiFeatureFallback((data as { message: string }).message);
          }
          else if (eventType === 'dashboard_spec') {
            setDashboardBundle(data as unknown as DashboardBundle);
          }
          // Pipeline complete
          else if (eventType === 'pipeline_complete') {
            const summary = (data as any).summary || {};
            setPipelineSummary({
              alertCount: summary.alert_count || 0,
              verifiedCount: summary.verified_count || 0,
              featureName: summary.feature_name,
              bestModel: summary.best_model,
              bestAuc: summary.best_model_auc,
            });
            setPipelinePhase('done');
            // Reload features and alerts
            loadFeatures();
            loadAlerts();
            if (id) {
              getProjectDashboard(id).then(setDashboardBundle).catch(() => {});
            }
          }
        },
      );
    } catch (err: any) {
      console.error('Pipeline error:', err);
    } finally {
      setPipelineRunning(false);
      // Always refresh the feature list — pipeline_complete may not fire on error/interruption
      loadFeatures();
    }
  }, [inputText, id, project, settings, useMultiFeature, selectedChannels, loadFeatures, loadAlerts]);

  // ── Spotlight cursor tracking for hoverable cards ─────────────────────────
  const handleCardMouse = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--card-x', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--card-y', `${e.clientY - r.top}px`);
  };

  // ── Per-schema accent identity (mirrors ProjectsPage) ─────────────────────
  const schemaAccent = (key: string) =>
    key === 'ibm_aml'
      ? {
          label: 'IBM AML',
          icon: 'text-sky-300',
          tile: 'from-sky-500/25 to-cyan-500/10 border-sky-400/25',
          badge: 'bg-sky-500/15 text-sky-300 border-sky-400/25',
          glow: 'rgba(56, 189, 248, 0.20)',
        }
      : {
          label: 'FINTRAC',
          icon: 'text-emerald-300',
          tile: 'from-emerald-500/25 to-teal-500/10 border-emerald-400/25',
          badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25',
          glow: 'rgba(16, 185, 129, 0.20)',
        };

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loadingProject) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin mb-3" />
        <p className="text-slate-400 text-sm">Loading project...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="min-h-screen flex flex-col items-center justify-center"
      >
        <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5">
          <AlertCircle className="w-9 h-9 text-red-400" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Project not found</h2>
        <p className="text-slate-400 text-sm mb-6 max-w-sm text-center">
          This project may have been deleted or the link is no longer valid.
        </p>
        <button onClick={() => navigate('/projects')} className="btn btn-glass">
          <ArrowLeft className="w-4 h-4" />
          Back to Projects
        </button>
      </motion.div>
    );
  }

  // =========================================================================
  // RENDER
  // =========================================================================

  const accent = schemaAccent(project.schemaKey);
  const validatedCount = features.filter((f) => f.status === 'validated').length;
  const headerStats: Array<{ label: string; value: string; num?: number; icon: typeof Layers; accent: string; tile: string }> = [
    { label: 'Features', value: String(features.length), num: features.length, icon: Layers, accent: 'text-sky-300', tile: 'from-sky-500/25 to-cyan-500/10 border-sky-400/25' },
    { label: 'Validated', value: String(validatedCount), num: validatedCount, icon: CheckCircle2, accent: 'text-emerald-300', tile: 'from-emerald-500/25 to-teal-500/10 border-emerald-400/25' },
    { label: 'Schema', value: accent.label, icon: Database, accent: accent.icon, tile: accent.tile },
    { label: 'Pipeline', value: pipelineRunning ? 'Running' : pipelinePhase === 'done' ? 'Complete' : 'Idle', icon: Activity, accent: 'text-amber-300', tile: 'from-amber-500/25 to-orange-500/10 border-amber-400/25' },
  ];

  return (
    <div className="min-h-screen">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="border-b border-[var(--color-border)] glass sticky top-0 z-40">
        <div className={`max-w-7xl mx-auto px-8 transition-[padding] duration-300 ${headerCollapsed ? 'py-3' : 'py-6'}`}>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-start justify-between gap-6"
          >
            <div className="min-w-0">
              <button
                onClick={() => navigate('/projects')}
                className={`group inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-purple-300/80 hover:text-purple-200 transition-all duration-300 overflow-hidden ${
                  headerCollapsed ? 'max-h-0 opacity-0 mb-0' : 'max-h-6 opacity-100 mb-2.5'
                }`}
              >
                <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
                Projects
              </button>
              <div className="flex items-center gap-3.5">
                <div className={`rounded-xl bg-gradient-to-br ${accent.tile} border flex items-center justify-center flex-shrink-0 shadow-inner transition-all duration-300 ${
                  headerCollapsed ? 'w-9 h-9' : 'w-12 h-12'
                }`}>
                  <FolderOpen className={`${accent.icon} transition-all duration-300 ${headerCollapsed ? 'w-[18px] h-[18px]' : 'w-6 h-6'}`} />
                </div>
                <div className="min-w-0">
                  <h1 className={`font-bold tracking-tight bg-gradient-to-br from-purple-300 via-indigo-300 to-sky-300 bg-clip-text text-transparent truncate transition-all duration-300 ${
                    headerCollapsed ? 'text-2xl' : 'text-4xl'
                  }`}>
                    {project.name}
                  </h1>
                  <div className={`flex items-center gap-2 transition-all duration-300 ${headerCollapsed ? 'mt-0.5' : 'mt-1.5'}`}>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${accent.badge}`}>
                      {accent.label}
                    </span>
                    {project.description && !headerCollapsed && (
                      <p className="text-xs text-slate-500 truncate">{project.description}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {/* PDF upload */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handlePDFUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingPDF || pipelineRunning}
                className="btn btn-glass disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {uploadingPDF ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                Upload PDF
              </button>
            </div>
          </motion.div>

          {/* ── Stats overview strip ────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{
              opacity: headerCollapsed ? 0 : 1,
              height: headerCollapsed ? 0 : 'auto',
              marginTop: headerCollapsed ? 0 : 20,
            }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-2 lg:grid-cols-4 gap-3 overflow-hidden"
          >
            {headerStats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.1 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                className="glass-card spotlight-card p-3.5 flex items-center gap-3"
                onMouseMove={handleCardMouse}
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.tile} border flex items-center justify-center flex-shrink-0`}>
                  <s.icon className={`w-5 h-5 ${s.accent}`} />
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-white tracking-tight truncate">
                    {s.num !== undefined ? <CountUp value={s.num} /> : s.value}
                  </div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{s.label}</div>
                </div>
              </motion.div>
            ))}
          </motion.div>

          {/* ── Pipeline Tab Bar ────────────────────────────────────────────── */}
          <div className={`-mb-px transition-[margin] duration-300 ${headerCollapsed ? 'mt-3' : 'mt-5'}`}>
            <PipelineTabBar
              activeTab={activeTab}
              pipelinePhase={pipelinePhase}
              phaseStatuses={phaseStatuses}
              onTabChange={(tab) => {
                // User manually switched tab
                setActiveTab(tab);
              }}
              pipelineRunning={pipelineRunning}
              latestMessage={latestTraceMessage}
              pendingDecision={!!pendingDecision}
              activeTabView={activeTab}
            />
          </div>
          {/* PERCEIVE error banner */}
          {traceEvents.some(t => t.level === 'error' && ((t.agent === 'Pipeline' && (t.data as any)?.phase === 'perceive') || (t.agent === 'Feature Engineer' && t.message?.toLowerCase().includes('perceive')))) && (
            <div className="max-w-7xl mx-auto px-6 py-2">
              <div className="bg-red-600/8 border border-red-500/20 text-red-200 rounded-md p-3 flex items-center justify-between">
                <div className="text-sm">PERCEIVE phase returned incomplete data or an error — see trace for details.</div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setActiveTab('analyst')} className="text-xs px-2 py-1 rounded bg-red-700/10 hover:bg-red-700/20">View Analyst</button>
                  <button onClick={() => setActiveTab('validator')} className="text-xs px-2 py-1 rounded bg-slate-700/10 hover:bg-slate-700/20">Open Validator</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        <AnimatePresence mode="wait">
          {activeTab === 'analyst' && (
            <motion.div key="analyst" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AnalystTab
                inputText={inputText}
                onInputChange={setInputText}
                onRunPipeline={handleRunPipeline}
                pipelineRunning={pipelineRunning}
                perceiveData={perceiveData}
                traceEvents={traceEvents.filter(t => t.agent === 'Feature Engineer' || t.level === 'error')}
                pra={analystPRA}
                useMultiFeature={useMultiFeature}
                onToggleMultiFeature={() => setUseMultiFeature(v => !v)}
                selectedChannels={selectedChannels}
                onChannelsChange={setSelectedChannels}
                multiFeatureFallback={multiFeatureFallback}
              />

              {/* ── Feature Library ────────────────────────────────────────── */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/25 to-indigo-500/10 border border-purple-400/25 flex items-center justify-center">
                      <Layers className="w-4 h-4 text-purple-300" />
                    </div>
                    <h2 className="text-base font-semibold text-white">
                      Features
                      <span className="ml-2 text-sm font-normal text-slate-500">{features.length}</span>
                    </h2>
                  </div>
                  <button
                    onClick={() => { setEditingFeature(null); setShowFeatureEditor(true); }}
                    className="btn btn-glass text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Feature
                  </button>
                </div>

                <FeatureLibrary
                  features={features}
                  onDelete={handleDeleteFeature}
                  onPromote={handlePromoteFeature}
                  onEdit={(f) => {
                    setEditingFeature(f);
                    setShowFeatureEditor(true);
                  }}
                  onLoadBenchmarks={handleLoadBenchmarks}
                  loadingBenchmarks={loadingBenchmarks}
                />
              </div>
            </motion.div>
          )}
          {activeTab === 'adapter' && (
            <motion.div key="adapter" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AdapterTab
                schemaAdaptData={schemaAdaptData}
                traceEvents={traceEvents.filter(t => t.agent === 'Schema Adapter' || t.level === 'error')}
                pipelineRunning={pipelineRunning}
                pra={adapterPRA}
              />
            </motion.div>
          )}
          {activeTab === 'engineer' && (
            <motion.div key="engineer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <EngineerTab
                generatedCode={generatedCode}
                computationPlan={perceiveData?.computation_plan || null}
                schemaAdaptSummary={schemaAdaptData?.summary || null}
                traceEvents={traceEvents.filter(t => t.message?.includes('REASON') || t.level === 'error')}
                pipelineRunning={pipelineRunning}
                pra={engineerPRA}
              />
            </motion.div>
          )}
          {activeTab === 'validator' && (
            <motion.div key="validator" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ValidatorTab
                validationData={validationData}
                codeHistory={codeHistory}
                featureEvalData={featureEvalData}
                allFeatureEvals={allFeatureEvals}
                featureGateSummary={featureGateSummary}
                traceEvents={traceEvents.filter(t => t.agent === 'Deterministic Validator' || t.level === 'error')}
                pipelineRunning={pipelineRunning}
                agentMessages={agentMessages}
                pra={validatorPRA}
                iterationHistory={iterationHistory}
                onJumpToTab={handleJumpToTab}
                pendingDecision={pendingDecision}
                onDecision={handleDecision}
              />
            </motion.div>
          )}
          {activeTab === 'detection' && (
            <motion.div key="detection" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <DetectionTab
                detectResult={detectResult}
                traceEvents={traceEvents}
                agentMessages={agentMessages}
                pipelineRunning={pipelineRunning}
                pra={detectionPRA}
              />
            </motion.div>
          )}
          {activeTab === 'rcc' && (
            <motion.div key="rcc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <RCCTab
                alerts={alerts}
                alertStats={alertStats}
                pipelineSummary={pipelineSummary}
                onFeedback={handleAlertFeedback}
                onVerifyAlert={handleVerifyAlert}
                verifyingAlertId={explainingAlertId}
                pipelineRunning={pipelineRunning}
                traceEvents={traceEvents}
                pra={analystPRA}
              />
            </motion.div>
          )}
          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <DashboardTab bundle={dashboardBundle} pipelineRunning={pipelineRunning} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Code Modal ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {viewCodeFeature && (
          <CodeModal feature={viewCodeFeature} onClose={() => setViewCodeFeature(null)} />
        )}
      </AnimatePresence>

      {/* ── Feature Editor Modal (create / edit) ─────────────────────────────── */}
      <AnimatePresence>
        {showFeatureEditor && (
          <FeatureEditorModal
            projectId={id!}
            feature={editingFeature}
            onSave={handleFeatureSaved}
            onClose={() => { setShowFeatureEditor(false); setEditingFeature(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
