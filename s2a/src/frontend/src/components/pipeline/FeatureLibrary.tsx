import { useState } from 'react';
import { Database, Code2, Star, Trash2, ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import type { FeatureRecord } from '../../api/client';

interface Props {
  features: FeatureRecord[];
  onDelete: (id: string) => void;
  onPromote: (id: string) => void;
  onEdit?: (feature: FeatureRecord) => void;
  onLoadBenchmarks: () => void;
  loadingBenchmarks: boolean;
}

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

interface GroupConfig {
  key: 'benchmark' | 'compiled' | 'library';
  label: string;
  icon: typeof Database;
  headerColor: string;
  iconColor: string;
  borderColor: string;
}

const GROUPS: GroupConfig[] = [
  {
    key: 'benchmark',
    label: 'Benchmarks',
    icon: Database,
    headerColor: 'text-emerald-400',
    iconColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/30',
  },
  {
    key: 'compiled',
    label: 'Compiled',
    icon: Code2,
    headerColor: 'text-purple-400',
    iconColor: 'text-purple-400',
    borderColor: 'border-purple-500/30',
  },
];

export default function FeatureLibrary({
  features,
  onDelete,
  onPromote,
  onEdit,
  onLoadBenchmarks,
  loadingBenchmarks,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleFeature = (id: string) => {
    setExpandedFeature((prev) => (prev === id ? null : id));
  };

  const grouped: Record<string, FeatureRecord[]> = {
    benchmark: [],
    compiled: [],
  };

  for (const f of features) {
    const source = f.source || 'compiled';
    if (source === 'benchmark') {
      grouped.benchmark.push(f);
    } else {
      grouped.compiled.push(f);
    }
  }

  const hasBenchmarks = grouped.benchmark.length > 0;

  return (
    <div className="space-y-3">
      {GROUPS.map((group) => {
        const items = grouped[group.key];
        if (items.length === 0 && group.key !== 'benchmark') return null;

        const isCollapsed = !!collapsed[group.key];
        const Icon = group.icon;

        return (
          <div
            key={group.key}
            className={`bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden`}
          >
            {/* Group header */}
            <button
              onClick={() => toggleGroup(group.key)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700/30 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                {isCollapsed ? (
                  <ChevronRight className={`w-4 h-4 ${group.iconColor}`} />
                ) : (
                  <ChevronDown className={`w-4 h-4 ${group.iconColor}`} />
                )}
                <Icon className={`w-4 h-4 ${group.iconColor}`} />
                <span className={`text-sm font-semibold ${group.headerColor}`}>
                  {group.label}
                </span>
                <span className="text-xs text-slate-500">({items.length})</span>
              </div>
            </button>

            {/* Group content */}
            {!isCollapsed && (
              <div className="border-t border-slate-700/50">
                {items.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-xs text-slate-500">No {group.label.toLowerCase()} features</p>
                    {group.key === 'benchmark' && !hasBenchmarks && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onLoadBenchmarks();
                        }}
                        disabled={loadingBenchmarks}
                        className="mt-3 px-4 py-2 rounded-lg border border-emerald-500/30 text-emerald-400
                                   hover:bg-emerald-500/10 transition-all text-xs font-medium
                                   disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {loadingBenchmarks ? 'Loading...' : 'Load Benchmarks'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-700/30">
                    {items.map((f) => (
                      <div key={f.id} className="group">
                        <div className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-700/20 transition-colors">
                          {/* Feature info (clickable to expand) */}
                          <button
                            onClick={() => toggleFeature(f.id)}
                            className="flex-1 min-w-0 mr-3 text-left"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-mono text-white truncate">
                                {f.name}
                              </span>
                              <StatusBadge status={f.status} />
                            </div>
                          </button>

                          {/* Action buttons */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            {onEdit && (
                              <button
                                onClick={() => onEdit(f)}
                                className="p-1.5 rounded-lg hover:bg-sky-500/20 text-slate-400
                                           hover:text-sky-400 transition-colors"
                                title="View / Edit Code"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {group.key === 'compiled' && (
                              <button
                                onClick={() => onPromote(f.id)}
                                className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-slate-400
                                           hover:text-emerald-400 transition-colors"
                                title="Add to Benchmarks"
                              >
                                <Database className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {group.key === 'benchmark' && f.source !== 'benchmark' && (
                              <button
                                onClick={() => onPromote(f.id)}
                                className="p-1.5 rounded-lg hover:bg-purple-500/20 text-slate-400
                                           hover:text-purple-400 transition-colors"
                                title="Remove from Benchmarks"
                              >
                                <Code2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => onDelete(f.id)}
                              className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-400
                                         hover:text-red-400 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Expanded details */}
                        {expandedFeature === f.id && (
                          <div className="px-4 pb-3 pl-8 space-y-2">
                            {f.description && (
                              <p className="text-xs text-slate-400 leading-relaxed">
                                {f.description}
                              </p>
                            )}
                            {f.channels && f.channels.length > 0 && (
                              <div className="flex gap-1.5 flex-wrap">
                                {f.channels.map((ch) => (
                                  <span
                                    key={ch}
                                    className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400"
                                  >
                                    {ch}
                                  </span>
                                ))}
                              </div>
                            )}
                            {f.code && (
                              <pre className="mt-2 p-3 bg-slate-900/80 rounded-lg text-[11px] font-mono text-slate-300 overflow-x-auto max-h-40 overflow-y-auto border border-slate-700/30">
                                {f.code}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
