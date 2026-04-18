import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Layers, Plus, Trash2, X, Loader2,
  CheckCircle2, Code2, Copy, Check,
  Upload, Eye, Edit2, AlertCircle,
} from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism-tomorrow.css';
import {
  getProject, listFeaturesByProject, createFeature, deleteFeature,
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
} from '../api/client';
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
    validator: 'idle', detection: 'idle', rcc: 'idle',
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
  const [featureEvalData, setFeatureEvalData] = useState<FeatureValidationResult | null>(null);
  const [detectResult, setDetectResult] = useState<DetectResponse | null>(null);
  const [pipelineSummary, setPipelineSummary] = useState<{
    alertCount: number; verifiedCount: number; featureName?: string;
    bestModel?: string; bestAuc?: number;
  } | null>(null);

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
      validator: 'idle', detection: 'idle', rcc: 'idle',
    });
    setTraceEvents([]);
    setPerceiveData(null);
    setSchemaAdaptData(null);
    setGeneratedCode(null);
    setCodeHistory(new Map());
    setValidationData(null);
    setFeatureEvalData(null);
    setDetectResult(null);
    setAgentMessages([]);
    setPipelineSummary(null);
    setPendingDecision(null);
    setIterationHistory([]);
    setAlerts([]);
    setAlertStats({ total: 0, pending: 0, truePositive: 0, falsePositive: 0, avgScore: 0 });
    setAnalystPRA(null);
    setAdapterPRA(null);
    setEngineerPRA(null);
    setValidatorPRA(null);
    setDetectionPRA(null);
    setActiveTab('analyst');

    try {
      await pipelineStream(
        {
          regulatory_text: inputText.slice(0, 5000),
          project_id: id,
          schema_key: project?.schemaKey || 'fintrac',
          model: project?.llmModel || 'gpt-4o',
          temperature: project?.temperature ?? 0,
          max_corrections: project?.maxCorrections ?? 5,
        },
        (evt: CompileSSEEvent) => {
          const eventType = evt.event;
          const data = evt.data;

          // Trace events
          if (eventType === 'trace') {
            setTraceEvents(prev => [...prev, data as unknown as TraceEvent]);
            setLatestTraceMessage((data as any).message || '');
          }
          // Phase changes -> update tab status + auto-switch
          else if (eventType === 'phase_change') {
            const { phase, status } = data as { phase: string; status: string };
            const phaseToTab: Record<string, PipelineTab> = {
              analyst: 'analyst', adapter: 'adapter', engineer: 'engineer',
              validator: 'validator', detection: 'detection', rcc: 'rcc',
            };
            const tab = phaseToTab[phase];
            if (tab) {
              if (status === 'starting' || status === 'active') {
                const TAB_ORDER: PipelineTab[] = ['analyst', 'adapter', 'engineer', 'validator', 'detection', 'rcc'];
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
            setFeatureEvalData(data as unknown as FeatureValidationResult);
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
          }
        },
      );
    } catch (err: any) {
      console.error('Pipeline error:', err);
    } finally {
      setPipelineRunning(false);
    }
  }, [inputText, id, project, loadFeatures, loadAlerts]);

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loadingProject) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-slate-300 text-lg">Project not found</p>
          <button
            onClick={() => navigate('/projects')}
            className="mt-4 text-sm text-purple-400 hover:text-purple-300"
          >
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/projects')}
                className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-xl font-bold text-white">{project.name}</h1>
                {project.description && (
                  <p className="text-xs text-slate-500 mt-0.5">{project.description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                           bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {uploadingPDF ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Upload className="w-3 h-3" />
                )}
                Upload PDF
              </button>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Layers className="w-3.5 h-3.5" />
                {features.length} feature{features.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {/* ── Pipeline Tab Bar ────────────────────────────────────────────── */}
          <div className="mt-4 -mb-px">
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
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <AnimatePresence mode="wait">
          {activeTab === 'analyst' && (
            <motion.div key="analyst" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AnalystTab
                inputText={inputText}
                onInputChange={setInputText}
                onRunPipeline={handleRunPipeline}
                pipelineRunning={pipelineRunning}
                perceiveData={perceiveData}
                traceEvents={traceEvents.filter(t => t.agent === 'Feature Engineer' && t.message?.includes('PERCEIVE'))}
                pra={analystPRA}
              />

              {/* ── Feature Library ────────────────────────────────────────── */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-slate-400" />
                    Features ({features.length})
                  </h2>
                  <button
                    onClick={() => { setEditingFeature(null); setShowFeatureEditor(true); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                               bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 border border-purple-500/30
                               transition-colors"
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
                traceEvents={traceEvents.filter(t => t.agent === 'Schema Adapter')}
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
                traceEvents={traceEvents.filter(t => t.message?.includes('REASON'))}
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
                traceEvents={traceEvents.filter(t => t.agent === 'Deterministic Validator')}
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
