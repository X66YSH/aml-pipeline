const BASE = '/api/v1';

export async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

export async function postJSON<T>(path: string, body: unknown): Promise<T> {
  return fetchJSON<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function uploadFile(file: File) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

export async function uploadPDF(file: File): Promise<{
  upload_id: string;
  filename: string;
  pages: number;
  text: string;
  size_bytes: number;
}> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/upload/pdf`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'PDF upload failed' }));
    throw new Error(err.detail || 'PDF upload failed');
  }
  return res.json();
}

export interface TraceEvent {
  timestamp: number;
  level: string;
  agent: string;
  message: string;
  data: Record<string, unknown>;
}

export interface CompileSSEEvent {
  event: string;
  data: Record<string, unknown>;
}

// ── Phase detail types (for expandable pipeline cards) ───────────────────────

export interface PerceiveData {
  indicator: { category?: string; description?: string; risk_rationale?: string };
  parameters: Array<{
    name: string;
    ambiguous_term?: string;
    default?: number | string;
    unit?: string;
    rationale?: string;
  }>;
  computation_plan: {
    operation?: string;
    aggregation_level?: string;
    time_window?: string;
    required_columns?: string[];
    join_strategy?: string;
  };
}

export interface ValidationData {
  passed: boolean;
  ast_passed: boolean;
  columns_passed: boolean;
  ast_findings: { passed: boolean; n_errors: number; n_warnings: number; findings: Array<{ severity: string; category: string; rule: string; message: string; line?: number }> };
  column_findings: { passed: boolean; n_errors: number; n_warnings: number; findings: Array<{ severity: string; category: string; rule: string; message: string }> };
  schema_columns: string[];
  compatible_channels?: string[];
  required_columns?: string[];
  iteration?: number;
}

export interface PRAData {
  perceive: string;
  reason: string;
}

export interface SchemaAdaptData {
  channel_adaptations: Record<string, {
    status: 'direct_match' | 'proxy_required' | 'not_feasible';
    strategy?: string;
    proxy_reasoning?: string;
    columns_used?: string[];
    reason?: string;
  }>;
  summary?: {
    direct_match: string[];
    proxy_required: string[];
    not_feasible: string[];
  };
}

// ── RCC Verdict (Regulatory Consistency Check) ───────────────────────────────

export interface RCCVerdict {
  verdict: 'supported' | 'contradicted' | 'ambiguous';
  confidence: 'high' | 'medium' | 'low';
  evidence: {
    feature: string;
    customer_value: number;
    population_mean?: number;
    feature_importance?: number;
    regulatory_criterion?: string;
    regulatory_source?: string;
    quoted_text?: string;
    assessment: string;
  }[];
  overall_reasoning: string;
  review_focus?: string;
}

// ── Pipeline Decision ────────────────────────────────────────────────────────

export interface PipelineDecisionRequired {
  pipeline_id: string;
  context: string;
  errors: string[];
  missing_columns: string[];
  available_columns: string[];
  options: { key: string; label: string; description: string }[];
}

// ── Pipeline Events ──────────────────────────────────────────────────────────

export interface PipelinePhaseEvent {
  phase: 'studio' | 'validation' | 'detection' | 'alerts';
  status: 'starting' | 'done' | 'error' | 'retry' | 'feedback';
  message: string;
}

export interface AgentMessageEvent {
  from: string;
  to: string;
  message: string;
}

export interface PipelineCompleteEvent {
  success: boolean;
  reason: string;
  summary: {
    feature_name?: string;
    feature_id?: string;
    indicator_category?: string;
    compatible_channels?: string[];
    best_eval_iv?: number;
    best_model?: string;
    best_model_auc?: number;
    best_channel?: string;
    alert_count?: number;
    verified_count?: number;
    run_id?: string;
  };
}

export interface IterationTrace {
  iteration: number;
  indicator: string;
  iv: number;
  ks: number;
  status: 'passed' | 'failed';
  diagnostic?: {
    root_cause: string;
    reasoning: string;
    recommendation: string;
  };
  user_decision?: string;
  perceive_summary?: string;
  code_preview?: string;
  target_agent?: string;
}

// ── Project CRUD ─────────────────────────────────────────────────────────────

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  schemaKey: 'fintrac' | 'ibm_aml';
  llmModel: string;
  temperature: number;
  maxCorrections: number;
  featureCount: number;
  createdAt: string;
  updatedAt: string;
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return fetchJSON<ProjectRecord[]>('/projects');
}

export async function getProject(id: string): Promise<ProjectRecord> {
  return fetchJSON<ProjectRecord>(`/projects/${id}`);
}

export async function createProject(body: { name: string; description?: string; schema_key?: string }): Promise<ProjectRecord> {
  return postJSON<ProjectRecord>('/projects', body);
}

export async function updateProject(
  id: string,
  body: Partial<{ name: string; description: string; llm_model: string; temperature: number; max_corrections: number }>,
): Promise<ProjectRecord> {
  return fetchJSON<ProjectRecord>(`/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${BASE}/projects/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
}

// ── Feature Library CRUD ──────────────────────────────────────────────────────

export interface FeatureRecord {
  id: string;
  projectId: string | null;
  name: string;
  code: string;
  description: string;
  category: string;
  channels: string[];
  requiredColumns: string[];
  status: 'draft' | 'validated' | 'failed';
  source: 'compiled' | 'benchmark' | 'library';
  createdAt: string;
  updatedAt: string;
}

export async function listFeatures(): Promise<FeatureRecord[]> {
  return fetchJSON<FeatureRecord[]>('/features');
}

export async function listFeaturesByProject(projectId: string): Promise<FeatureRecord[]> {
  return fetchJSON<FeatureRecord[]>(`/features/by-project/${projectId}`);
}

export async function getFeature(id: string): Promise<FeatureRecord> {
  return fetchJSON<FeatureRecord>(`/features/${id}`);
}

export async function createFeature(body: {
  project_id?: string;
  name: string;
  code: string;
  description?: string;
  category?: string;
  channels?: string[];
  required_columns?: string[];
  status?: string;
  source_text?: string;
  indicator?: Record<string, unknown>;
  parameters?: Record<string, unknown>[];
  computation_plan?: Record<string, unknown>;
}): Promise<FeatureRecord> {
  return postJSON<FeatureRecord>('/features', body);
}

export async function updateFeature(
  id: string,
  body: Partial<{ name: string; code: string; description: string; category: string; channels: string[]; status: string }>,
): Promise<FeatureRecord> {
  return fetchJSON<FeatureRecord>(`/features/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function promoteFeature(id: string): Promise<FeatureRecord> {
  return fetchJSON<FeatureRecord>(`/features/${id}/promote`, { method: 'PATCH' });
}

export async function deleteFeature(id: string): Promise<void> {
  const res = await fetch(`${BASE}/features/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
}

export async function fetchChannelCompatibility(
  featureIds: string[],
): Promise<Record<string, boolean>> {
  const params = featureIds.map((id) => `feature_ids=${encodeURIComponent(id)}`).join('&');
  return fetchJSON<Record<string, boolean>>(`/features/channel-compatibility?${params}`);
}

// ── Feature Validation ────────────────────────────────────────────────────────

export interface FeatureValidationResult {
  feature_name: string;
  n_customers: number;
  n_positive: number;
  n_negative: number;
  stats: {
    positive: { mean: number; median: number; std: number; min: number; max: number };
    negative: { mean: number; median: number; std: number; min: number; max: number };
  };
  ks_statistic: number;
  ks_pvalue: number;
  information_value: number;
  iv_interpretation: string;
  iv_bins: { range: string; count: number; positive: number; negative: number; woe: number; iv: number }[];
  distribution: { bin: string; binMid: number; positive: number; negative: number }[];
}

export async function validateFeatureStats(body: {
  code: string;
  name: string;
  channels?: string[];
}): Promise<FeatureValidationResult> {
  return postJSON<FeatureValidationResult>('/feature-validate', body);
}

// ── Detection Lab ─────────────────────────────────────────────────────────────

export interface DetectModelResult {
  key: string;
  name: string;
  mode: 'supervised' | 'unsupervised';
  auc_roc?: number;
  precision_at_k?: number;
  recall_at_k?: number;
  k?: number;
  f1_score?: number;
  accuracy?: number;
  flagged_accounts?: number;
  feature_importances?: number[];
  threshold?: number;
  threshold_percentile?: number;
  confusion_matrix?: { tp: number; fp: number; fn: number; tn: number };
  roc_curve?: { fpr: number; tpr: number }[];
  error?: string;
}

export interface DetectChannelResult {
  n_accounts?: number;
  n_positive?: number;
  n_features?: number;
  n_train?: number;
  n_test?: number;
  n_pos_train?: number;
  n_pos_test?: number;
  test_size?: number;
  threshold_percentile?: number;
  feature_names?: string[];
  error?: string;
  models: DetectModelResult[];
}

export interface DetectResponse {
  success: boolean;
  channels: Record<string, DetectChannelResult>;
  feature_errors: { name: string; error: string }[];
}

export async function runDetection(body: {
  features: { name: string; code: string }[];
  feature_ids?: string[];
  models: string[];
  channels: string[];
  test_size?: number;
  random_state?: number;
  threshold_percentile?: number;
}): Promise<DetectResponse> {
  return postJSON<DetectResponse>('/detect', body);
}

// ── Generate Alerts (manual trigger) ─────────────────────────────────────────

export async function generateAlerts(body: {
  feature_ids: string[];
  model_key: string;
  model_metrics: Record<string, unknown>;
  flagged_customers: { customer_id: string; anomaly_score: number }[];
}): Promise<{ run_id: string; alert_count: number }> {
  return postJSON('/generate-alerts', body);
}

// ── Alert Explanation (structured) ───────────────────────────────────────────

export interface StructuredExplanation {
  // RCC Verdict format (new)
  verdict?: 'supported' | 'contradicted' | 'ambiguous';
  confidence?: 'high' | 'medium' | 'low';
  evidence?: {
    feature: string;
    customer_value: number;
    population_mean?: number;
    feature_importance?: number;
    regulatory_criterion?: string;
    regulatory_source?: string;
    quoted_text?: string;
    assessment: string;
  }[];
  overall_reasoning?: string;
  review_focus?: string;
  // Legacy format (backward compat)
  risk_level?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  summary?: string;
  explanations?: {
    feature: string;
    value: number;
    importance: number;
    reasoning: string;
    regulatory_excerpt: string;
  }[];
  model_explanation?: { model_type: string; method: string; details: string };
  behavioral_pattern?: string;
  recommended_actions?: unknown[];
  regulatory_reference?: unknown;
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export interface AlertRecord {
  id: string;
  runId: string;
  customerId: string;
  anomalyScore: number;
  featureValues: Record<string, number> | null;
  analystFeedback: 'true_positive' | 'false_positive' | 'pending';
  reviewedAt: string | null;
  explanation: string | null;
  createdAt: string;
  modelName: string | null;
  featureName: string | null;
  featureId: string | null;
  aucRoc: number | null;
}

export interface AlertStats {
  total: number;
  pending: number;
  truePositive: number;
  falsePositive: number;
  avgScore: number;
}

export async function listAlerts(params: {
  project_id?: string;
  feedback?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}): Promise<AlertRecord[]> {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return fetchJSON<AlertRecord[]>(`/alerts${qs ? `?${qs}` : ''}`);
}

export async function getAlertStats(projectId?: string): Promise<AlertStats> {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  return fetchJSON<AlertStats>(`/alerts/stats${qs}`);
}

export async function updateAlertFeedback(
  id: string,
  feedback: 'true_positive' | 'false_positive',
): Promise<AlertRecord> {
  return fetchJSON<AlertRecord>(`/alerts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analyst_feedback: feedback }),
  });
}

export async function explainAlert(id: string): Promise<{ explanation: string }> {
  return postJSON<{ explanation: string }>(`/alerts/${id}/explain`, {});
}

// ─────────────────────────────────────────────────────────────────────────────

export async function compileStream(
  body: {
    regulatory_text: string;
    schema_key?: string;
    channels?: string[];
    model?: string;
    temperature?: number;
    max_corrections?: number;
  },
  onEvent: (evt: CompileSSEEvent) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error('Compile request failed');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          onEvent(JSON.parse(payload));
        } catch { /* skip malformed */ }
      }
    }
  }
}

// ── Pipeline (end-to-end multi-agent) ────────────────────────────────────────

export async function pipelineStream(
  body: {
    regulatory_text: string;
    project_id: string;
    schema_key?: string;
    channels?: string[];
    model?: string;
    temperature?: number;
    max_corrections?: number;
    max_feature_retries?: number;
    test_size?: number;
    threshold_pct?: number;
  },
  onEvent: (evt: CompileSSEEvent) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/pipeline/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error('Pipeline request failed');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          onEvent(JSON.parse(payload));
        } catch { /* skip malformed */ }
      }
    }
  }
}

export async function submitPipelineDecision(
  pipelineId: string,
  decision: string,
): Promise<void> {
  await postJSON('/pipeline/decide', { pipeline_id: pipelineId, decision });
}

export async function createBenchmarkFeatures(projectId: string): Promise<{ created: number; features: FeatureRecord[] }> {
  return postJSON(`/benchmark-features/${projectId}`, {});
}
