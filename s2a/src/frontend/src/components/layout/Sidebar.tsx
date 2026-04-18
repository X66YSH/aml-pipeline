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
      className="h-screen flex flex-col bg-[var(--color-bg-sidebar)] border-r border-slate-800/60 relative z-20"
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-slate-800/60 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shrink-0">
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
              <h1 className="text-sm font-bold text-white tracking-tight whitespace-nowrap">S2A Platform</h1>
              <p className="text-[10px] text-slate-500 whitespace-nowrap">Signal-to-Action</p>
            </motion.div>
          )}
        </AnimatePresence>
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
                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group
                ${isActive
                  ? 'bg-purple-500/15 text-purple-300 border border-purple-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                }`
              }
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
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
      <div className="px-3 py-3 border-t border-slate-800/60 shrink-0 space-y-2">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-slate-400 hover:text-white
                     hover:bg-slate-800/50 transition-colors"
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
                className="text-xs whitespace-nowrap overflow-hidden"
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
              className="flex items-center gap-2"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-[10px] text-slate-500">V2 — Research Platform</span>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex justify-center"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 bg-slate-800 border border-slate-700 rounded-full
          flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700
          transition-colors z-30"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>
    </motion.aside>
  );
}
