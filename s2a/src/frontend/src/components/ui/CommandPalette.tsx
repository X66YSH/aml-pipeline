import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Home, FolderOpen, Settings, Database, Plus, Sun, Moon,
  CornerDownLeft, ArrowUp, ArrowDown, FileText,
} from 'lucide-react';
import { listProjects, type ProjectRecord } from '../../api/client';
import { useTheme } from '../../hooks/useTheme';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: typeof Home;
  keywords?: string;
  run: () => void;
}

export default function CommandPalette() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global ⌘K / Ctrl+K to toggle, plus a custom event for UI triggers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onTrigger = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-command-palette', onTrigger);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('open-command-palette', onTrigger);
    };
  }, []);

  // On open: reset, focus, refresh project list
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    listProjects().then(setProjects).catch(() => {});
    return () => clearTimeout(t);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);
  const go = useCallback((to: string) => { close(); navigate(to); }, [close, navigate]);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      { id: 'home', label: 'Home', hint: 'Landing page', group: 'Navigation', icon: Home, run: () => go('/') },
      { id: 'projects', label: 'Projects', hint: 'All workspaces', group: 'Navigation', icon: FolderOpen, run: () => go('/projects') },
      { id: 'data', label: 'Data', hint: 'Data explorer', group: 'Navigation', icon: Database, run: () => go('/data') },
      { id: 'settings', label: 'Settings', hint: 'Configuration', group: 'Navigation', icon: Settings, run: () => go('/settings') },
    ];
    const actions: Command[] = [
      { id: 'new-project', label: 'New project', hint: 'Create a workspace', group: 'Actions', icon: Plus, keywords: 'create add', run: () => { close(); navigate('/projects', { state: { openNew: true } }); } },
      { id: 'toggle-theme', label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', group: 'Actions', icon: theme === 'dark' ? Sun : Moon, keywords: 'theme dark light appearance', run: () => { toggleTheme(); close(); } },
    ];
    const projCmds: Command[] = projects.map((p) => ({
      id: `proj-${p.id}`,
      label: p.name,
      hint: p.schemaKey === 'ibm_aml' ? 'IBM AML' : 'FINTRAC',
      group: 'Projects',
      icon: FileText,
      keywords: p.description,
      run: () => go(`/projects/${p.id}`),
    }));
    return [...nav, ...actions, ...projCmds];
  }, [projects, theme, go, close, navigate, toggleTheme]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''} ${c.group}`.toLowerCase().includes(q));
  }, [commands, query]);

  // Group while preserving order
  const groups = useMemo(() => {
    const map = new Map<string, Command[]>();
    filtered.forEach((c) => {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    });
    return Array.from(map.entries());
  }, [filtered]);

  useEffect(() => { setActive(0); }, [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[active]?.run(); }
  };

  // Keep active item in view
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  let runningIdx = -1;
  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[120] flex items-start justify-center pt-[12vh] px-4 bg-black/50 backdrop-blur-sm"
        onClick={close}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -8 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-xl glass-strong rounded-2xl overflow-hidden"
          role="dialog"
          aria-label="Command palette"
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 border-b border-[var(--color-border)]">
            <Search className="w-[18px] h-[18px] text-slate-500 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search projects, pages, actions…"
              className="flex-1 bg-transparent py-4 text-sm text-white placeholder-slate-500 outline-none"
            />
            <kbd className="text-[10px] text-slate-500 border border-[var(--color-border)] rounded px-1.5 py-0.5">ESC</kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2">
            {filtered.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                No results for “{query}”
              </div>
            )}
            {groups.map(([group, items]) => (
              <div key={group} className="mb-1">
                <div className="px-4 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                  {group}
                </div>
                {items.map((c) => {
                  runningIdx += 1;
                  const idx = runningIdx;
                  const isActive = idx === active;
                  const Icon = c.icon;
                  return (
                    <button
                      key={c.id}
                      data-idx={idx}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => c.run()}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        isActive ? 'bg-purple-500/15' : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                        isActive ? 'bg-purple-500/20 border-purple-400/30 text-purple-200' : 'bg-white/[0.03] border-[var(--color-border)] text-slate-400'
                      }`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-sm text-white truncate flex-1">{c.label}</span>
                      {c.hint && <span className="text-xs text-slate-500 truncate shrink-0">{c.hint}</span>}
                      {isActive && <CornerDownLeft className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Footer hint */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-t border-[var(--color-border)] text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><ArrowUp className="w-3 h-3" /><ArrowDown className="w-3 h-3" /> navigate</span>
            <span className="flex items-center gap-1"><CornerDownLeft className="w-3 h-3" /> select</span>
            <span className="ml-auto flex items-center gap-1"><kbd className="border border-[var(--color-border)] rounded px-1">⌘</kbd><kbd className="border border-[var(--color-border)] rounded px-1">K</kbd> toggle</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
