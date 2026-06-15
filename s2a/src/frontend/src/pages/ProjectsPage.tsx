import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, FolderOpen, Trash2, X, Layers, Clock, Loader2, FileText, Database, Sparkles, Activity } from 'lucide-react';
import { listProjects, createProject, deleteProject } from '../api/client';
import type { ProjectRecord } from '../api/client';
import CountUp from '../components/ui/CountUp';
import { SkeletonGrid, SkeletonStat } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import Tooltip from '../components/ui/Tooltip';

interface LocationState {
  regulatoryText?: string;
  source?: string;
  openNew?: boolean;
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const locationState = location.state as LocationState | null;
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New project modal
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSchema, setNewSchema] = useState<'fintrac' | 'ibm_aml'>('fintrac');
  const [creating, setCreating] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ProjectRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listProjects();
      setProjects(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Opened from the command palette "New project" action
  useEffect(() => {
    if (locationState?.openNew) {
      setShowModal(true);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationState?.openNew]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await createProject({ name: newName.trim(), description: newDescription.trim() || undefined, schema_key: newSchema });
      setShowModal(false);
      setNewName('');
      setNewDescription('');
      setNewSchema('fintrac');
      await fetchProjects();
      toast.success('Project created', created.name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create project';
      setError(msg);
      toast.error('Could not create project', msg);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const name = deleteTarget.name;
    try {
      await deleteProject(deleteTarget.id);
      setDeleteTarget(null);
      await fetchProjects();
      toast.success('Project deleted', name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to delete project';
      setError(msg);
      toast.error('Could not delete project', msg);
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatRelative = (iso: string) => {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return formatDate(iso);
  };

  // Per-schema accent identity — carries color from icon → top bar → badge → glow
  const schemaAccent = (key: string) =>
    key === 'ibm_aml'
      ? {
          label: 'IBM AML',
          icon: 'text-sky-300',
          tile: 'from-sky-500/25 to-cyan-500/10 border-sky-400/25',
          bar: 'from-sky-400 via-cyan-400 to-sky-500',
          badge: 'bg-sky-500/15 text-sky-300 border-sky-400/25',
          glow: 'rgba(56, 189, 248, 0.20)',
        }
      : {
          label: 'FINTRAC',
          icon: 'text-emerald-300',
          tile: 'from-emerald-500/25 to-teal-500/10 border-emerald-400/25',
          bar: 'from-emerald-400 via-teal-400 to-emerald-500',
          badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25',
          glow: 'rgba(16, 185, 129, 0.20)',
        };

  // Track cursor inside a card to drive the radial spotlight glow
  const handleCardMouse = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--card-x', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--card-y', `${e.clientY - r.top}px`);
  };

  // Aggregate overview metrics for the stats strip
  const totalFeatures = projects.reduce((sum, p) => sum + p.featureCount, 0);
  const schemaCount = new Set(projects.map((p) => p.schemaKey)).size;
  const lastActivity = projects.length
    ? formatRelative(projects.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b)).updatedAt)
    : '—';

  const stats: Array<{ label: string; value: string; num?: number; icon: typeof FolderOpen; accent: string; tile: string }> = [
    { label: 'Projects', value: String(projects.length), num: projects.length, icon: FolderOpen, accent: 'text-purple-300', tile: 'from-purple-500/25 to-indigo-500/10 border-purple-400/25' },
    { label: 'Features', value: String(totalFeatures), num: totalFeatures, icon: Layers, accent: 'text-sky-300', tile: 'from-sky-500/25 to-cyan-500/10 border-sky-400/25' },
    { label: 'Schemas', value: String(schemaCount), num: schemaCount, icon: Database, accent: 'text-emerald-300', tile: 'from-emerald-500/25 to-teal-500/10 border-emerald-400/25' },
    { label: 'Last activity', value: lastActivity, icon: Activity, accent: 'text-amber-300', tile: 'from-amber-500/25 to-orange-500/10 border-amber-400/25' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-8 py-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-end justify-between mb-8"
        >
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-purple-300/80">Workspace</span>
            </div>
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-br from-purple-300 via-indigo-300 to-sky-300 bg-clip-text text-transparent">
              Projects
            </h1>
            <p className="text-slate-400 text-sm mt-2 max-w-md">
              {projects.length > 0
                ? 'Organize AML features, detection rules, and pipeline runs into focused workspaces.'
                : 'Organize your AML features into projects.'}
            </p>
          </div>
          <button onClick={() => setShowModal(true)} className="btn btn-primary">
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </motion.div>

        {/* Stats overview strip */}
        {!loading && projects.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
          >
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.1 + i * 0.05 }}
                className="glass-card spotlight-card p-4 flex items-center gap-3.5"
                onMouseMove={handleCardMouse}
              >
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${s.tile} border flex items-center justify-center flex-shrink-0`}>
                  <s.icon className={`w-5 h-5 ${s.accent}`} />
                </div>
                <div className="min-w-0">
                  <div className="text-xl font-semibold text-white tracking-tight truncate">
                    {s.num !== undefined ? <CountUp value={s.num} /> : s.value}
                  </div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{s.label}</div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Incoming regulatory text banner */}
        {locationState?.regulatoryText && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-purple-900/20 border border-purple-500/30 rounded-xl flex items-center gap-3"
          >
            <FileText className="w-5 h-5 text-purple-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-purple-200">
                <span className="font-medium">Document loaded{locationState.source ? `: ${locationState.source}` : ''}</span>
              </p>
              <p className="text-xs text-purple-300/60 mt-0.5">Select a project below or create a new one to start compiling.</p>
            </div>
            <span className="text-xs text-purple-400/60 shrink-0">
              {locationState.regulatoryText.length.toLocaleString()} chars
            </span>
          </motion.div>
        )}

        {/* Error banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-6 p-3 bg-red-900/20 border border-red-700/30 rounded-xl text-red-300 text-sm flex items-center justify-between"
            >
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading state — skeleton stats + grid */}
        {loading && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonStat key={i} />)}
            </div>
            <SkeletonGrid count={6} />
          </>
        )}

        {/* Empty state */}
        {!loading && projects.length === 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center justify-center py-32"
          >
            <div className="w-20 h-20 rounded-2xl bg-slate-800/60 border border-slate-700/40 flex items-center justify-center mb-5">
              <FolderOpen className="w-9 h-9 text-slate-500" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">No projects yet</h2>
            <p className="text-slate-400 text-sm mb-6 max-w-sm text-center">
              Projects help you organize related AML features, detection rules, and pipeline configurations.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-500
                text-white text-sm font-medium rounded-xl transition-colors shadow-lg shadow-purple-900/30"
            >
              <Plus className="w-4 h-4" />
              Create your first project
            </button>
          </motion.div>
        )}

        {/* Project cards grid */}
        {!loading && projects.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"
          >
            {projects.map((project, i) => {
              const accent = schemaAccent(project.schemaKey);
              return (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => navigate(`/projects/${project.id}`, {
                  state: locationState?.regulatoryText ? { regulatoryText: locationState.regulatoryText, source: locationState.source } : undefined
                })}
                onMouseMove={handleCardMouse}
                style={{ ['--card-glow' as string]: accent.glow }}
                className="group glass-card spotlight-card cursor-pointer p-6 pt-7 overflow-hidden"
              >
                {/* Accent top bar — reveals on hover */}
                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent.bar}
                  opacity-60 group-hover:opacity-100 transition-opacity duration-300`} />

                {/* Delete button */}
                <div className="absolute top-3.5 right-3.5 z-10">
                  <Tooltip label="Delete project" side="left">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(project);
                      }}
                      className="p-1.5 rounded-lg text-slate-600
                        opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400
                        transition-all duration-200"
                      aria-label="Delete project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </Tooltip>
                </div>

                {/* Project icon + name */}
                <div className="flex items-start gap-3.5 mb-4">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${accent.tile} border
                    flex items-center justify-center flex-shrink-0 shadow-inner
                    group-hover:scale-105 transition-transform duration-300`}>
                    <FolderOpen className={`w-6 h-6 ${accent.icon}`} />
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <h3 className="text-base font-semibold text-white truncate pr-6 leading-snug">{project.name}</h3>
                    <span className={`inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded-full font-medium border ${accent.badge}`}>
                      {accent.label}
                    </span>
                  </div>
                </div>

                {/* Description */}
                <p className="text-[13px] text-slate-400 line-clamp-2 leading-relaxed mb-5 min-h-[2.4em]">
                  {project.description || 'No description provided.'}
                </p>

                {/* Metadata row */}
                <div className="flex items-center gap-4 pt-4 border-t border-slate-700/40">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Layers className="w-3.5 h-3.5 text-slate-500" />
                    <span className="font-medium text-slate-300">{project.featureCount}</span>
                    <span>feature{project.featureCount === 1 ? '' : 's'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatRelative(project.updatedAt)}</span>
                  </div>
                  <div className="ml-auto text-[10px] text-slate-600 font-mono">
                    {formatDate(project.createdAt)}
                  </div>
                </div>
              </motion.div>
              );
            })}

            {/* Ghost "new project" tile — invites action and fills the grid */}
            <motion.button
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: projects.length * 0.06, ease: [0.16, 1, 0.3, 1] }}
              onClick={() => setShowModal(true)}
              className="group flex flex-col items-center justify-center gap-3 min-h-[200px] rounded-2xl
                border border-dashed border-slate-700/60 text-slate-500
                hover:border-purple-500/40 hover:text-purple-300 hover:bg-purple-500/[0.03]
                transition-all duration-300"
            >
              <div className="w-12 h-12 rounded-xl border border-dashed border-slate-700/60
                group-hover:border-purple-500/40 flex items-center justify-center
                group-hover:scale-110 transition-all duration-300">
                <Plus className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium">New project</span>
            </motion.button>
          </motion.div>
        )}
      </div>

      {/* New Project Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => !creating && setShowModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold text-white">New Project</h2>
                <button
                  onClick={() => !creating && setShowModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Project Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. FINTRAC ML Initiative 2025"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    className="w-full px-3 py-2.5 bg-slate-800/70 border border-slate-700/60 rounded-xl
                      text-sm text-white placeholder-slate-500 outline-none
                      focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Description <span className="text-slate-600">(optional)</span>
                  </label>
                  <textarea
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Brief description of the project scope..."
                    rows={3}
                    className="w-full px-3 py-2.5 bg-slate-800/70 border border-slate-700/60 rounded-xl
                      text-sm text-white placeholder-slate-500 outline-none resize-none
                      focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Dataset Schema
                  </label>
                  <select
                    value={newSchema}
                    onChange={(e) => setNewSchema(e.target.value as 'fintrac' | 'ibm_aml')}
                    className="w-full px-3 py-2.5 bg-slate-800/70 border border-slate-700/60 rounded-xl
                      text-sm text-white outline-none
                      focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                  >
                    <option value="fintrac">FINTRAC (7-channel Canadian banking)</option>
                    <option value="ibm_aml">IBM AML (dual-table synthetic benchmark)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-6">
                <button
                  onClick={() => !creating && setShowModal(false)}
                  disabled={creating}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors
                    disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || creating}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500
                    text-white text-sm font-medium rounded-xl transition-colors
                    disabled:opacity-50 disabled:hover:bg-purple-600"
                >
                  {creating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Create Project
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => !deleting && setDeleteTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">Delete Project</h2>
                  <p className="text-xs text-slate-400">This action cannot be undone</p>
                </div>
              </div>

              <p className="text-sm text-slate-300 mb-6">
                Are you sure you want to delete{' '}
                <span className="font-medium text-white">{deleteTarget.name}</span>?
                {deleteTarget.featureCount > 0 && (
                  <span className="text-red-400">
                    {' '}This will also remove {deleteTarget.featureCount} feature
                    {deleteTarget.featureCount === 1 ? '' : 's'}.
                  </span>
                )}
              </p>

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => !deleting && setDeleteTarget(null)}
                  disabled={deleting}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors
                    disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500
                    text-white text-sm font-medium rounded-xl transition-colors
                    disabled:opacity-50 disabled:hover:bg-red-600"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
