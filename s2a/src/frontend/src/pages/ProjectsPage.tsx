import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, FolderOpen, Trash2, X, Layers, Clock, Loader2, FileText } from 'lucide-react';
import { listProjects, createProject, deleteProject } from '../api/client';
import type { ProjectRecord } from '../api/client';

interface LocationState {
  regulatoryText?: string;
  source?: string;
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const location = useLocation();
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

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createProject({ name: newName.trim(), description: newDescription.trim() || undefined, schema_key: newSchema });
      setShowModal(false);
      setNewName('');
      setNewDescription('');
      setNewSchema('fintrac');
      await fetchProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteProject(deleteTarget.id);
      setDeleteTarget(null);
      await fetchProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete project');
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

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center justify-between mb-8"
        >
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Projects</h1>
            <p className="text-slate-400 text-sm mt-1">
              {projects.length > 0
                ? `${projects.length} project${projects.length === 1 ? '' : 's'}`
                : 'Organize your AML features into projects'}
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-500
              text-white text-sm font-medium rounded-xl transition-colors shadow-lg shadow-purple-900/30"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </motion.div>

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

        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-32">
            <Loader2 className="w-8 h-8 text-purple-400 animate-spin mb-3" />
            <p className="text-slate-400 text-sm">Loading projects...</p>
          </div>
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
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {projects.map((project, i) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.06 }}
                onClick={() => navigate(`/projects/${project.id}`, {
                  state: locationState?.regulatoryText ? { regulatoryText: locationState.regulatoryText, source: locationState.source } : undefined
                })}
                className="group relative bg-slate-800/50 border border-slate-700/50 rounded-xl p-5
                  cursor-pointer hover:border-purple-500/40 hover:bg-slate-800/70
                  transition-all duration-200 hover:shadow-lg hover:shadow-purple-900/10"
              >
                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(project);
                  }}
                  className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-600
                    opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400
                    transition-all duration-200"
                  title="Delete project"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                {/* Project icon + name */}
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20
                    flex items-center justify-center flex-shrink-0">
                    <FolderOpen className="w-5 h-5 text-purple-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-white truncate pr-6">{project.name}</h3>
                    {project.description && (
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
                        {project.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Metadata row */}
                <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-700/40">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                    project.schemaKey === 'ibm_aml'
                      ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  }`}>
                    {project.schemaKey === 'ibm_aml' ? 'IBM AML' : 'FINTRAC'}
                  </span>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Layers className="w-3.5 h-3.5" />
                    <span>
                      {project.featureCount} feature{project.featureCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatRelative(project.updatedAt)}</span>
                  </div>
                  <div className="ml-auto text-[10px] text-slate-600">
                    {formatDate(project.createdAt)}
                  </div>
                </div>
              </motion.div>
            ))}
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
