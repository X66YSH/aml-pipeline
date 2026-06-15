import { NavLink, useLocation } from 'react-router-dom';
import {
  Home,
  FolderKanban,
  Database,
  Settings,
  Shield,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Search,
} from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../hooks/useTheme';

const NAV_ITEMS = [
  { to: '/', icon: Home, label: 'Home', description: 'Landing Page' },
  { to: '/projects', icon: FolderKanban, label: 'Projects', description: 'Research Workspaces' },
  { to: '/data', icon: Database, label: 'Data', description: 'Data Explorer' },
  { to: '/settings', icon: Settings, label: 'Settings', description: 'Global Config' },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 64 : 220 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="h-screen flex flex-col glass-strong border-r border-[var(--color-border)] relative z-20"
      style={{ borderRadius: 0 }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-[var(--color-border-subtle)] shrink-0">
        <div className="relative glow-ring w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 via-indigo-500 to-sky-500 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/30">
          <Shield className="w-4 h-4 text-white" />
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <h1 className="text-sm font-bold tracking-tight whitespace-nowrap text-gradient">
                S2A Platform
              </h1>
              <p className="text-[10px] text-slate-500 whitespace-nowrap">Signal-to-Action</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Command palette trigger */}
      <div className="px-2 pt-3">
        <button
          onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
          title="Search — ⌘K"
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl border transition-all duration-200 group
            ${theme === 'light'
              ? 'text-zinc-500 hover:text-zinc-800 bg-zinc-50 hover:bg-zinc-100 border-zinc-200'
              : 'text-slate-400 hover:text-slate-100 bg-white/[0.03] hover:bg-white/[0.06] border-white/10'}`}
        >
          <Search className="w-[18px] h-[18px] shrink-0 transition-transform group-hover:scale-110" />
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2 overflow-hidden flex-1"
              >
                <span className="text-sm whitespace-nowrap">Search</span>
                <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-current/20 opacity-60 whitespace-nowrap">⌘K</kbd>
              </motion.div>
            )}
          </AnimatePresence>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ to, icon: Icon, label, description }) => {
          const isActive = to === '/projects'
            ? location.pathname.startsWith('/projects')
            : location.pathname === to;

          return (
            <NavLink
              key={to}
              to={to}
              end={false}
              className={
                `relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group overflow-hidden
                ${isActive
                  ? theme === 'light'
                    ? 'text-purple-700 bg-purple-50 border border-purple-200 shadow-[0_4px_12px_-4px_rgba(139,92,246,0.18)]'
                    : 'text-white bg-gradient-to-r from-purple-500/25 via-indigo-500/15 to-transparent border border-purple-500/30 shadow-[0_6px_20px_-8px_rgba(139,92,246,0.6)]'
                  : theme === 'light'
                    ? 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 border border-transparent'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent hover:border-white/10'
                }`
              }
            >
              {isActive && (
                <motion.span
                  layoutId="nav-active-bar"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-gradient-to-b from-purple-400 to-sky-400 shadow-[0_0_12px_rgba(139,92,246,0.8)]"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <Icon className={`w-[18px] h-[18px] shrink-0 transition-transform group-hover:scale-110 ${isActive ? 'drop-shadow-[0_0_6px_rgba(139,92,246,0.7)]' : ''}`} />
              <AnimatePresence>
                {!collapsed && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div className="text-sm font-medium whitespace-nowrap">{label}</div>
                    <div className="text-[10px] text-slate-500 group-hover:text-slate-400 whitespace-nowrap">
                      {description}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </NavLink>
          );
        })}
      </nav>

      {/* Theme toggle + Version badge */}
      <div className="px-3 py-3 border-t border-[var(--color-border-subtle)] shrink-0 space-y-2">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className={`btn btn-glass w-full !justify-start !px-2 !py-2 !rounded-lg text-xs
            ${theme === 'light' ? 'text-zinc-600 hover:!text-zinc-900' : 'text-slate-400 hover:!text-white'}`}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 shrink-0" />
          ) : (
            <Moon className="w-4 h-4 shrink-0" />
          )}
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className="whitespace-nowrap overflow-hidden"
              >
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/* Version badge */}
        <AnimatePresence>
          {!collapsed ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 px-2"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500 breathe" />
              <span className="text-[10px] text-slate-500">V2 — Research Platform</span>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex justify-center"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500 breathe" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 glass rounded-full
          flex items-center justify-center text-slate-400 hover:text-white
          hover:border-purple-400/50 transition-all z-30 hover:scale-110"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>
    </motion.aside>
  );
}
