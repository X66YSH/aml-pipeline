import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Library,
  Code2,
  Search,
  Filter,
  Clock,
  Tag,
  MoreHorizontal,
  CheckCircle2,
  Trash2,
  Eye,
  X,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { listFeatures, deleteFeature, type FeatureRecord } from '../api/client';

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  validated: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Validated' },
  draft: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'Draft' },
  failed: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Failed' },
};

const CATEGORY_COLORS: Record<string, string> = {
  structuring: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  velocity_anomaly: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  geographic_risk: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  layering: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  amount_anomaly: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  unknown: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

function CodeModal({ feature, onClose }: { feature: FeatureRecord; onClose: () => void }) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl mx-4 overflow-hidden"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-semibold text-white font-mono">{feature.name}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-md border ${
                CATEGORY_COLORS[feature.category] || CATEGORY_COLORS.unknown
              }`}>
                {feature.category}
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {feature.description && (
            <div className="px-5 py-3 bg-slate-800/40 border-b border-slate-800 text-xs text-slate-400">
              {feature.description}
            </div>
          )}
          <div className="overflow-auto max-h-[60vh] p-5">
            <pre className="text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap">
              {feature.code}
            </pre>
          </div>
          <div className="px-5 py-3 border-t border-slate-800 flex items-center gap-3 text-[10px] text-slate-500">
            <Clock className="w-3 h-3" />
            Created {new Date(feature.createdAt).toLocaleString()}
            <span className="ml-2 flex gap-1">
              {feature.channels.map(ch => (
                <span key={ch} className="bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">{ch}</span>
              ))}
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default function FeaturesPage() {
  const [features, setFeatures] = useState<FeatureRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [viewingFeature, setViewingFeature] = useState<FeatureRecord | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listFeatures();
      setFeatures(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load features');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setMenuOpenId(null);
    try {
      await deleteFeature(id);
      setFeatures(prev => prev.filter(f => f.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = features.filter(f => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = f.name.toLowerCase().includes(q) ||
      f.description.toLowerCase().includes(q) ||
      f.category.toLowerCase().includes(q);
    const matchesFilter = selectedFilter === 'all' || f.status === selectedFilter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="h-full overflow-y-auto" onClick={() => setMenuOpenId(null)}>
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Library className="w-6 h-6 text-purple-400" />
              Feature Library
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Browse, manage, and export your compiled AML detection features.
            </p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700
              text-slate-300 text-sm font-medium rounded-xl transition-colors border border-slate-700"
          >
            Refresh
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 mb-6 bg-red-500/10 border border-red-500/20
            rounded-xl text-sm text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Search & Filters */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search features..."
              className="w-full bg-slate-800/60 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm
                text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
            />
          </div>
          <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700 rounded-xl p-1">
            {['all', 'validated', 'draft', 'failed'].map(f => (
              <button
                key={f}
                onClick={() => setSelectedFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                  ${selectedFilter === f
                    ? 'bg-purple-500/20 text-purple-300'
                    : 'text-slate-400 hover:text-slate-300'
                  }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-8">
          {[
            { label: 'Total Features', value: features.length, icon: Code2, color: 'text-slate-300' },
            { label: 'Validated', value: features.filter(f => f.status === 'validated').length, icon: CheckCircle2, color: 'text-emerald-400' },
            { label: 'Categories', value: new Set(features.map(f => f.category)).size, icon: Tag, color: 'text-purple-400' },
            { label: 'Channels Used', value: new Set(features.flatMap(f => f.channels)).size, icon: Filter, color: 'text-sky-400' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div className="text-2xl font-bold text-white">{value}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading features...
          </div>
        )}

        {/* Feature list */}
        {!loading && (
          <div className="space-y-3">
            {filtered.map((feature, i) => {
              const status = STATUS_STYLES[feature.status] ?? STATUS_STYLES.draft;
              const categoryStyle = CATEGORY_COLORS[feature.category] ?? CATEGORY_COLORS.unknown;

              return (
                <motion.div
                  key={feature.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-5 hover:border-slate-700/60
                    transition-colors group"
                >
                  <div className="flex items-start justify-between">
                    <div
                      className="flex-1 cursor-pointer"
                      onClick={() => setViewingFeature(feature)}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <Code2 className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-semibold text-white font-mono">{feature.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-md border ${categoryStyle}`}>
                          {feature.category}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-md ${status.bg} ${status.text}`}>
                          {status.label}
                        </span>
                      </div>
                      {feature.description && (
                        <p className="text-xs text-slate-400 mb-3">{feature.description}</p>
                      )}
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                          <Clock className="w-3 h-3" />
                          {new Date(feature.createdAt).toLocaleDateString()}
                        </div>
                        <div className="flex gap-1">
                          {feature.channels.map(ch => (
                            <span key={ch} className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                              {ch}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Action menu */}
                    <div className="relative ml-3">
                      <button
                        onClick={e => { e.stopPropagation(); setMenuOpenId(menuOpenId === feature.id ? null : feature.id); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-slate-800 rounded-lg"
                      >
                        {deletingId === feature.id
                          ? <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                          : <MoreHorizontal className="w-4 h-4 text-slate-400" />
                        }
                      </button>

                      {menuOpenId === feature.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="absolute right-0 top-8 z-20 bg-slate-800 border border-slate-700
                            rounded-xl shadow-xl overflow-hidden min-w-[140px]"
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            onClick={() => { setViewingFeature(feature); setMenuOpenId(null); }}
                            className="flex items-center gap-2 w-full px-4 py-2.5 text-xs text-slate-300
                              hover:bg-slate-700 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View Code
                          </button>
                          <button
                            onClick={() => handleDelete(feature.id)}
                            className="flex items-center gap-2 w-full px-4 py-2.5 text-xs text-red-400
                              hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </motion.div>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-20">
            <Library className="w-12 h-12 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500">
              {features.length === 0
                ? 'No features yet. Compile your first feature from the Pipeline.'
                : 'No features match your search.'}
            </p>
          </div>
        )}
      </div>

      {/* Code viewer modal */}
      {viewingFeature && (
        <CodeModal feature={viewingFeature} onClose={() => setViewingFeature(null)} />
      )}
    </div>
  );
}
