import { motion } from 'framer-motion';
import { Cpu, Key, Database, Palette, Info, Check, Sliders } from 'lucide-react';
import { useSettings } from '../hooks/useSettings';

// Track cursor inside a card to drive the radial spotlight glow
const handleCardMouse = (e: React.MouseEvent<HTMLDivElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--card-x', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--card-y', `${e.clientY - r.top}px`);
};

interface SettingItem {
  key: string;
  label: string;
  description: string;
  options: string[];
}

const MODEL_GROUP: SettingItem[] = [
  {
    key: 'model',
    label: 'LLM Model',
    description: 'Model used for feature code generation',
    options: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
  {
    key: 'temperature',
    label: 'Temperature',
    description: 'Sampling temperature — 0 = deterministic, higher = more creative',
    options: ['0', '0.1', '0.3', '0.5', '0.7', '1.0'],
  },
  {
    key: 'max_corrections',
    label: 'Max Self-Corrections',
    description: 'How many times the agent retries if AST validation fails',
    options: ['1', '3', '5', '10'],
  },
];

const EXECUTION_GROUP: SettingItem[] = [
  {
    key: 'timeout',
    label: 'Timeout (seconds)',
    description: 'Maximum execution time for feature code',
    options: ['30', '60', '120', '300'],
  },
  {
    key: 'sample_rows',
    label: 'Validation Sample Rows',
    description: 'Rows used when running the 6-stage validator',
    options: ['10000', '25000', '50000', '100000'],
  },
  {
    key: 'max_exec_rows',
    label: 'Max Execution Rows',
    description: 'Maximum rows processed during feature execution',
    options: ['50000', '100000', '250000', '500000'],
  },
];

export default function SettingsPage() {
  const { settings, setSettings } = useSettings();

  const handleChange = (key: string, value: string) => {
    setSettings({ [key]: value });
  };

  const renderGroup = (
    items: SettingItem[],
    title: string,
    icon: typeof Cpu,
    accent: { icon: string; tile: string; bar: string }
  ) => (
    <div className="glass-card spotlight-card overflow-hidden" onMouseMove={handleCardMouse}>
      <div className={`h-1 bg-gradient-to-r ${accent.bar} opacity-70`} />
      <div className="px-5 py-4 border-b border-slate-800/60 flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${accent.tile} border flex items-center justify-center`}>
          {(() => { const I = icon; return <I className={`w-[18px] h-[18px] ${accent.icon}`} />; })()}
        </div>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      <div className="divide-y divide-slate-800/40">
        {items.map(item => (
          <div key={item.key} className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-white">{item.label}</div>
              <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.description}</div>
            </div>
            <select
              value={settings[item.key as keyof typeof settings] as string}
              onChange={e => handleChange(item.key, e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300
                focus:outline-none focus:ring-1 focus:ring-purple-500/50 shrink-0 hover:border-slate-600 transition-colors"
            >
              {item.options.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-end justify-between mb-8"
        >
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sliders className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-purple-300/80">Configuration</span>
            </div>
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-br from-purple-300 via-indigo-300 to-sky-300 bg-clip-text text-transparent">
              Settings
            </h1>
            <p className="text-sm text-slate-400 mt-2 max-w-md">
              Changes are saved automatically and applied to all pipeline calls.
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/25 rounded-lg breathe">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs text-emerald-300 font-medium">Auto-saved</span>
          </div>
        </motion.div>

        {/* Two-column layout: config groups left, meta right */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left: primary config (2 cols) */}
          <div className="lg:col-span-2 space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 }}
            >
              {renderGroup(MODEL_GROUP, 'Model', Cpu, {
                icon: 'text-purple-300',
                tile: 'from-purple-500/25 to-indigo-500/10 border-purple-400/25',
                bar: 'from-purple-400 via-indigo-400 to-purple-500',
              })}
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.12 }}
            >
              {renderGroup(EXECUTION_GROUP, 'Execution', Database, {
                icon: 'text-sky-300',
                tile: 'from-sky-500/25 to-cyan-500/10 border-sky-400/25',
                bar: 'from-sky-400 via-cyan-400 to-sky-500',
              })}
            </motion.div>
          </div>

          {/* Right: appearance, about, api (1 col) */}
          <div className="space-y-6">
            {/* Appearance */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.18 }}
              className="glass-card spotlight-card overflow-hidden"
              onMouseMove={handleCardMouse}
            >
              <div className="h-1 bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-500 opacity-70" />
              <div className="px-5 py-4 border-b border-slate-800/60 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/25 to-teal-500/10 border border-emerald-400/25 flex items-center justify-center">
                  <Palette className="w-[18px] h-[18px] text-emerald-300" />
                </div>
                <h2 className="text-sm font-semibold text-white">Appearance</h2>
              </div>
              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-white">Theme</div>
                  <div className="text-xs text-slate-500 mt-0.5">Toggle from the sidebar</div>
                </div>
                <span className="text-xs text-slate-400 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
                  Dark · Light
                </span>
              </div>
            </motion.div>

            {/* About */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.24 }}
              className="glass-card spotlight-card overflow-hidden"
              onMouseMove={handleCardMouse}
            >
              <div className="h-1 bg-gradient-to-r from-slate-500 via-slate-400 to-slate-500 opacity-50" />
              <div className="px-5 py-4 border-b border-slate-800/60 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-slate-500/25 to-slate-400/10 border border-slate-400/25 flex items-center justify-center">
                  <Info className="w-[18px] h-[18px] text-slate-300" />
                </div>
                <h2 className="text-sm font-semibold text-white">About</h2>
              </div>
              <div className="px-5 py-4 space-y-1.5 text-xs text-slate-400">
                <p><span className="text-slate-200 font-medium">S2A Platform</span> — Signal-to-Action AML Detection</p>
                <p>Version 1.0.0 — Feature Engineering Pipeline</p>
                <p className="leading-relaxed">Built with FastAPI · React · TypeScript · Tailwind · GPT-4o · SQLite</p>
              </div>
            </motion.div>

            {/* API Keys notice */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
              className="p-4 bg-amber-500/[0.06] border border-amber-500/20 rounded-2xl flex items-start gap-3"
            >
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500/25 to-orange-500/10 border border-amber-400/25 flex items-center justify-center shrink-0">
                <Key className="w-[18px] h-[18px] text-amber-300" />
              </div>
              <div>
                <p className="text-xs text-amber-300 font-medium">API Keys</p>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Configured via <code className="text-amber-400/80">.env</code> at the project root. Not stored in the app.
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
